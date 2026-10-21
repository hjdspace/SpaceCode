// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'
import { debug as loggerDebug, info as loggerInfo, warn as loggerWarn } from '../../../infra/logger'

/**
 * The stdout seam of the Pi engine.
 *
 * `pi --mode rpc` speaks newline-delimited JSON on stdout, but the OS delivers
 * arbitrary byte chunks: one frame can be split over several reads, several
 * frames can arrive glued together, and the stream can carry junk (progress
 * banners, partial UTF-8 sequences). The framing contract therefore has to be
 * order-preserving and lossless across chunk boundaries — a frame that is
 * parsed twice dispatches a tool call twice, and a frame that is dropped loses
 * the assistant text the renderer is already waiting for.
 *
 * What this pins down:
 *   - half a frame stays in the buffer; a frame is dispatched exactly once, when
 *     its newline arrives
 *   - a multi-byte character split across chunks must not become U+FFFD, which
 *     is why the buffer is fed through a StringDecoder rather than per-chunk
 *     `toString()`
 *   - unparsable lines are logged and skipped; they never reach the renderer and
 *     never count as session activity (a chatty-but-broken engine must not look
 *     alive to the eviction logic)
 *   - agent_start / agent_end drive status + the in-flight flag, while the
 *     pending-tool set is *only* closed by tool_execution_end — agent_end does
 *     not clear it, so a turn that died mid-tool keeps blocking suspension
 *   - frames are forwarded verbatim on `message`; translation to unified events
 *     belongs to PiEventMapper, not here
 *
 * Only the child process is faked (spawn returns an EventEmitter with controllable
 * stdout/stderr); the real framer, decoder and state machine run.
 */

interface FakeChild {
  child: EventEmitter
  stdout: EventEmitter
  stderr: EventEmitter
  stdinWrite: ReturnType<typeof vi.fn>
  stdinEnd: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

interface SpawnCall {
  command: string
  args: string[]
  opts: { cwd: string; env: Record<string, string | undefined>; stdio: string[] }
}

type Frame = Record<string, unknown> & { type?: string }

const SRC_DIR = path.resolve(__dirname, '..')
/** Mirrors the __dirname-relative candidate the production resolver checks first. */
const DEV_CLI = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')

const H = vi.hoisted(() => ({
  spawnCalls: [] as SpawnCall[],
  children: [] as FakeChild[],
  existing: new Set<string>(),
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const { EventEmitter: Emitter } = await import('events')
  return {
    ...actual,
    spawn: (command: string, args: string[], opts: SpawnCall['opts']) => {
      const child: any = new Emitter()
      child.stdout = new Emitter()
      child.stderr = new Emitter()
      child.stdin = { write: vi.fn(), end: vi.fn() }
      child.pid = 41000 + H.spawnCalls.length
      child.killed = false
      child.kill = vi.fn(() => true)
      H.spawnCalls.push({ command, args, opts })
      H.children.push({
        child,
        stdout: child.stdout,
        stderr: child.stderr,
        stdinWrite: child.stdin.write,
        stdinEnd: child.stdin.end,
        kill: child.kill,
      })
      return child
    },
  }
})

vi.mock('fs', () => ({
  existsSync: (p: unknown) => H.existing.has(String(p)),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  // 解析器靠包根 package.json 拿版本；不给版本号就会被判「无从核验」而拒绝起进程
  readFileSync: (p: unknown) => String(p).endsWith('package.json') ? '{"version":"1.3.0"}' : '{}',
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app/root', getPath: () => '/home/u' },
}))

vi.mock('os', () => ({ homedir: () => '/home/u' }))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('../../../session/engineChildProcess', () => ({
  killTree: vi.fn(),
  isProbableBunExecutable: vi.fn(() => false),
}))

const BASE: EngineSessionConfig = { cwd: '/ws', provider: 'anthropic', model: 'claude-sonnet-4' }

/** Started processes that still own listeners when the test ends. */
let open: PiSessionProcess[] = []

/**
 * Bring a session up to `idle`. `start()` parks for a 500ms grace window before
 * declaring the process healthy, so the clock is faked and wound forward here.
 */
async function startedSession(
  config: Partial<EngineSessionConfig> = {},
  sessionId = 'pi-stream-0001',
): Promise<{ proc: PiSessionProcess; child: FakeChild }> {
  const proc = new PiSessionProcess(sessionId, { ...BASE, ...config })
  open.push(proc)
  const starting = proc.start()
  await vi.advanceTimersByTimeAsync(500)
  await starting
  const child = H.children[H.children.length - 1]
  return { proc, child }
}

function feed(child: FakeChild, chunk: string): void {
  child.stdout.emit('data', Buffer.from(chunk, 'utf8'))
}

function collectMessages(proc: PiSessionProcess): Frame[] {
  const seen: Frame[] = []
  proc.on('message', (msg) => seen.push(msg as Frame))
  return seen
}

function frameLine(frame: Record<string, unknown>): string {
  return JSON.stringify(frame) + '\n'
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  H.spawnCalls = []
  H.children = []
  H.existing = new Set([DEV_CLI])
  open = []
})

afterEach(() => {
  for (const proc of open) {
    void proc.kill()
    proc.removeAllListeners()
  }
  open = []
  vi.useRealTimers()
})

describe('PiSessionProcess stdout framing — bytes are not messages', () => {
  it('holds a frame split across three chunks and dispatches it exactly once', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(child, '{"type":"tool_execution_start","toolCal')
    expect(seen).toHaveLength(0)
    feed(child, 'lId":"tc-1","toolName":"Bash"')
    expect(seen).toHaveLength(0)
    expect(proc.getPendingToolCount()).toBe(0)
    feed(child, ',"args":{"command":"ls"}}\n')

    // a split frame is one frame — parsing it twice would double-open the tool
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      type: 'tool_execution_start',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      args: { command: 'ls' },
    })
    expect(proc.getPendingToolCount()).toBe(1)
  })

  it('dispatches every frame glued into one chunk, in protocol order', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(
      child,
      frameLine({ type: 'agent_start' }) +
        frameLine({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a' } }) +
        frameLine({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'Bash', args: {} }) +
        frameLine({ type: 'tool_execution_end', toolCallId: 'tc-1', toolName: 'Bash', result: 'ok', isError: false }) +
        frameLine({ type: 'agent_end', messages: [] }),
    )

    expect(seen.map((f) => f.type)).toEqual([
      'agent_start',
      'message_update',
      'tool_execution_start',
      'tool_execution_end',
      'agent_end',
    ])
    expect(proc.status).toBe('idle')
    expect(proc.getPendingToolCount()).toBe(0)
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('reassembles a multi-byte character cut inside its UTF-8 sequence', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    const bytes = Buffer.from(
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"你好"}}\n',
      'utf8',
    )
    // split right after the lead byte of 好 (E5 A5 BD) — per-chunk toString() would
    // hand the decoder a truncated sequence and bake in a replacement character
    const cut = bytes.indexOf(Buffer.from('好', 'utf8')) + 1
    child.stdout.emit('data', bytes.subarray(0, cut))
    child.stdout.emit('data', bytes.subarray(cut))

    expect(seen).toHaveLength(1)
    const delta = (seen[0].assistantMessageEvent as { delta: string }).delta
    expect(delta).toBe('你好')
    expect(delta).not.toContain('\uFFFD')
  })

  it('frames a string chunk the same way as a Buffer chunk', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    child.stdout.emit('data', '{"type":"agent_start"}\n{"type":"agen')
    child.stdout.emit('data', 't_end","messages":[]}\n')

    expect(seen.map((f) => f.type)).toEqual(['agent_start', 'agent_end'])
  })

  it('tolerates CRLF framing, including a whitespace-only line', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    child.stdout.emit('data', '{"type":"agent_start"}\r\n\r\n   \r\n{"type":"agent_end","messages":[]}\r\n')

    expect(seen.map((f) => f.type)).toEqual(['agent_start', 'agent_end'])
    expect(proc.status).toBe('idle')
  })

  it('skips blank lines without losing the frames around them', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(child, '\n\n')
    feed(child, frameLine({ type: 'agent_start' }))
    feed(child, '\n   \n')
    feed(child, frameLine({ type: 'turn_start' }))

    expect(seen.map((f) => f.type)).toEqual(['agent_start', 'turn_start'])
  })

  it('logs a non-JSON line and keeps parsing the frames behind it', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(child, 'pi: loading 12 extensions\n' + frameLine({ type: 'agent_start' }))

    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('agent_start')
    expect(loggerDebug).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining('stdout: pi: loading 12 extensions'),
    )
  })

  it('swallows a null frame, which the framer reports as a bad line', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    // JSON.parse succeeds on `null`, the handler then throws on it — the catch wraps
    // both, so a handler bug is indistinguishable from garbage in the logs.
    feed(child, 'null\n' + frameLine({ type: 'agent_start' }))

    expect(seen.map((f) => f.type)).toEqual(['agent_start'])
    expect(loggerDebug).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('stdout: null'))
  })
})

describe('PiSessionProcess state machine — agent and tool frames', () => {
  it('marks the turn active on agent_start and blocks safe suspension', async () => {
    const { proc, child } = await startedSession()
    expect(proc.canSafelySuspend()).toBe(true)

    feed(child, frameLine({ type: 'agent_start' }))

    expect(proc.status).toBe('active')
    expect(proc.isRunning()).toBe(true)
    expect(proc.canSafelySuspend()).toBe(false)
  })

  it('returns to idle on agent_end but keeps an in-flight tool pending', async () => {
    const { proc, child } = await startedSession()

    feed(child, frameLine({ type: 'tool_execution_start', toolCallId: 'tc-9', toolName: 'Write', args: {} }))
    feed(child, frameLine({ type: 'agent_end', messages: [] }))

    expect(proc.status).toBe('idle')
    // agent_end settles the turn, not the tool: the eviction logic must still see
    // this session as busy, otherwise a lost tool_execution_end hangs forever
    expect(proc.getPendingToolCount()).toBe(1)
    expect(proc.canSafelySuspend()).toBe(false)

    feed(child, frameLine({ type: 'tool_execution_end', toolCallId: 'tc-9', result: 'ok', isError: false }))

    expect(proc.getPendingToolCount()).toBe(0)
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('keys the pending set by toolCallId so a duplicate start or orphan end cannot skew it', async () => {
    const { proc, child } = await startedSession()
    const start = frameLine({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'Bash', args: {} })

    feed(child, start + start)
    expect(proc.getPendingToolCount()).toBe(1)

    feed(child, frameLine({ type: 'tool_execution_end', toolCallId: 'never-opened', result: '', isError: true }))
    expect(proc.getPendingToolCount()).toBe(1)

    feed(child, frameLine({ type: 'tool_execution_end', toolCallId: 'tc-1', result: '', isError: true }))
    expect(proc.getPendingToolCount()).toBe(0)
  })

  it('forwards an unknown frame type verbatim so the event mapper owns translation', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(child, frameLine({ type: 'queue_update', items: 3, weird: { nested: true } }))

    expect(seen).toEqual([{ type: 'queue_update', items: 3, weird: { nested: true } }])
    expect(proc.status).toBe('idle')
  })

  it('forwards an extension UI request without touching status or pending tools', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(child, frameLine({ type: 'agent_start' }))
    feed(child, frameLine({ type: 'tool_execution_start', toolCallId: 'tc-4', toolName: 'Read', args: {} }))
    feed(child, frameLine({ type: 'extension_ui_request', method: 'notify', message: { content: 'saved' } }))

    expect(seen[2]).toEqual({
      type: 'extension_ui_request',
      method: 'notify',
      message: { content: 'saved' },
    })
    // the UI request is a side-channel frame: the turn is still running and its
    // tool is still in flight afterwards
    expect(proc.status).toBe('active')
    expect(proc.getPendingToolCount()).toBe(1)
    expect(loggerDebug).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining('Extension UI request | method=notify'),
    )
  })

  it('swallows a response frame nothing is waiting on', async () => {
    const { proc, child } = await startedSession()
    const seen = collectMessages(proc)

    feed(child, frameLine({ type: 'response', id: 'req_7', command: 'prompt', success: true }))

    // RPC acks never become renderer events — neither the tracked nor the late kind
    expect(seen).toHaveLength(0)
    expect(proc.status).toBe('idle')
  })

  it('logs the frame shape for array, string and absent message content', async () => {
    const { proc, child } = await startedSession()
    collectMessages(proc)

    feed(child, frameLine({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text' }, { type: 'tool_use' }] } }))
    feed(child, frameLine({ type: 'message_start', message: { role: 'user', content: 'hello' } }))
    feed(child, frameLine({ type: 'message_start', message: { role: 'assistant', content: 42 } }))
    feed(child, frameLine({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } }))
    feed(child, frameLine({ type: 'agent_end' }))

    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('msgRole=assistant | msgContentLen=2'))
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('msgRole=user | msgContentLen=5'))
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('msgContentLen=-1'))
    // 逐 delta 高频帧不再逐条打印（防刷屏）：只随下一条低频事件汇总计数
    expect(loggerInfo).not.toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('subType=text_delta'))
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('suppressedDeltas=1'))
  })
})

describe('PiSessionProcess stderr side-channel', () => {
  it('logs every non-empty stderr line, trimmed', async () => {
    const { proc, child } = await startedSession()

    child.stderr.emit('data', Buffer.from('warn one\n\n   warn two   \n\n', 'utf8'))

    // exactly one log line per non-empty stderr line, padding trimmed away, and the
    // blank lines in between produce nothing
    expect(vi.mocked(loggerWarn).mock.calls.map((call) => call[1])).toEqual([
      '[pi-strea] stderr: warn one',
      '[pi-strea] stderr: warn two',
    ])
  })

  it('keeps only the last 8 KB of stderr for the exit report', async () => {
    const { proc, child } = await startedSession()
    const exits: unknown[][] = []
    proc.on('exit', (...args) => exits.push(args))

    child.stderr.emit('data', Buffer.from('x'.repeat(9000), 'utf8'))
    child.stderr.emit('data', Buffer.from('\nFATAL: model overflow', 'utf8'))
    child.child.emit('exit', 1, null)

    const tail = exits[0][2] as string
    expect(tail.length).toBeLessThanOrEqual(8 * 1024)
    expect(tail.endsWith('FATAL: model overflow')).toBe(true)
    expect(tail.startsWith('xxxx')).toBe(true)
  })
})

describe('PiSessionProcess activity heartbeat', () => {
  it('stamps lastActivityAt when a frame is parsed, not when bytes arrive', async () => {
    const { proc, child } = await startedSession()
    const before = proc.lastActivityAt

    vi.advanceTimersByTime(4000)
    expect(proc.lastActivityAt).toBe(before)

    feed(child, frameLine({ type: 'agent_start' }))

    expect(proc.lastActivityAt).toBe(before + 4000)
  })

  it('does not count a garbage line as activity', async () => {
    const { proc, child } = await startedSession()
    const before = proc.lastActivityAt

    vi.advanceTimersByTime(60_000)
    feed(child, 'not json at all\n')

    // an engine spewing junk must still age out of the pool
    expect(proc.lastActivityAt).toBe(before)
  })
})
