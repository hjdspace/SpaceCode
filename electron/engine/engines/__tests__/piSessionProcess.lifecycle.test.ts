// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig, ImageAttachment } from '../types'
import { error as loggerError, info as loggerInfo, warn as loggerWarn } from '../../../infra/logger'
import { killTree as mockedKillTree } from '../../../session/engineChildProcess'

/**
 * Process lifecycle and the outbound prompt leg.
 *
 * `start()` never waits for a handshake: it spawns, wires stdio, and parks for a
 * 500 ms grace window, so a launcher that dies immediately (bad cli.js, missing
 * runtime) has to fail the launch with the stderr tail rather than leave the pool
 * holding a session that can never answer a prompt. In the other direction a
 * prompt is fire-and-check: the frame goes to stdin and the call stays pending
 * until the engine acks it by request id — so every exit path has to release those
 * waiters, otherwise the UI sits on a spinner until the 30 s timeout.
 *
 * Pinned here:
 *   - spawn command / args / env assembly, including ELECTRON_RUN_AS_NODE, which
 *     is what makes stdout flush per line (bun buffers it and streaming dies)
 *   - early exit and spawn error semantics, and how many times `error` reaches the pool
 *   - in-flight prompt requests rejected with the last stderr lines when the child dies
 *   - kill / suspend / resume / abort control frames and the suspend-safety gate
 *   - attachment handling: images are written under the session upload dir and
 *     referenced as `@"path"` in the prompt text; a broken data URL must not sink
 *     the whole message
 */

interface FakeChild {
  child: EventEmitter & { killed: boolean; pid: number }
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

const SRC_DIR = path.resolve(__dirname, '..')
const DEV_CLI = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js')

const H = vi.hoisted(() => ({
  spawnCalls: [] as SpawnCall[],
  children: [] as FakeChild[],
  existing: new Set<string>(),
  writes: [] as Array<{ path: string; data: Buffer | string }>,
  mkdirs: [] as string[],
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
      child.pid = 42000 + H.spawnCalls.length
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
  mkdirSync: (p: unknown) => {
    H.mkdirs.push(String(p))
  },
  writeFileSync: (p: unknown, data: unknown) => {
    H.writes.push({ path: String(p), data: data as Buffer | string })
  },
  readFileSync: () => '{}',
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

const SESSION_ID = 'pi-lifecycle-0001'
const SHORT_ID = SESSION_ID.slice(0, 8)
const BASE: EngineSessionConfig = { cwd: '/ws', provider: 'anthropic', model: 'claude-sonnet-4' }

let open: PiSessionProcess[] = []

function newProc(config: Partial<EngineSessionConfig> = {}, sessionId = SESSION_ID): PiSessionProcess {
  const proc = new PiSessionProcess(sessionId, { ...BASE, ...config })
  open.push(proc)
  return proc
}

/** Runs start() through its 500 ms grace window on a faked clock. */
async function startUp(config: Partial<EngineSessionConfig> = {}, sessionId = SESSION_ID) {
  const proc = newProc(config, sessionId)
  const starting = proc.start()
  await vi.advanceTimersByTimeAsync(500)
  await starting
  return { proc, child: H.children[H.children.length - 1] }
}

function feed(child: FakeChild, chunk: string): void {
  child.stdout.emit('data', Buffer.from(chunk, 'utf8'))
}

function ackFor(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'response', id, command: 'prompt', success: true, ...extra }) + '\n'
}

function writtenFrames(child: FakeChild): Array<{ id: string; type: string; message?: string }> {
  return child.stdinWrite.mock.calls.map((call) => JSON.parse(String(call[0])))
}

function attachment(name: string, data: string, mimeType = 'image/png'): ImageAttachment {
  return { id: 'img-1', name, type: 'image', mimeType, previewUrl: '', data }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  H.spawnCalls = []
  H.children = []
  H.existing = new Set([DEV_CLI])
  H.writes = []
  H.mkdirs = []
  open = []
})

afterEach(() => {
  for (const proc of open) {
    void proc.kill()
    proc.removeAllListeners()
  }
  open = []
  delete process.env.PISPACE_PROBE
  delete process.env.CLAUDE_CONFIG_DIR
  vi.useRealTimers()
})

describe('PiSessionProcess start — how the engine is launched', () => {
  it('spawns cli.js under ELECTRON_RUN_AS_NODE so every event line is flushed immediately', async () => {
    process.env.PISPACE_PROBE = 'from-process-env'
    const proc = newProc({ apiKey: 'sk-config-key' })

    const starting = proc.start()
    expect(proc.status).toBe('starting')
    expect(H.spawnCalls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    await starting

    const call = H.spawnCalls[0]
    expect(call.command).toBe(process.execPath)
    expect(call.args).toEqual([
      DEV_CLI,
      '--mode',
      'rpc',
      '--provider',
      'anthropic',
      '--model',
      'claude-sonnet-4',
      '--api-key',
      'sk-config-key',
    ])
    expect(call.opts.cwd).toBe('/ws')
    expect(call.opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(call.opts.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(call.opts.env.PISPACE_PROBE).toBe('from-process-env')
    // the engine env is layered on top of the inherited one
    expect(call.opts.env.ANTHROPIC_API_KEY).toBe('sk-config-key')
    expect(proc.status).toBe('idle')
    expect(proc.isRunning()).toBe(true)
    expect(loggerInfo).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`Using ELECTRON_RUN_AS_NODE | execPath=${process.execPath} | entry=${DEV_CLI}`),
    )
    expect(loggerInfo).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`[${SHORT_ID}] RPC process started successfully`),
    )
  })

  it('launches the global pi command when the resolver reports one', async () => {
    const proc = newProc()
    vi.spyOn(proc as unknown as { resolveCliPath(): string }, 'resolveCliPath').mockReturnValue('pi')

    const starting = proc.start()
    await vi.advanceTimersByTimeAsync(500)
    await starting

    expect(H.spawnCalls[0].command).toBe('pi')
    expect(H.spawnCalls[0].args).toEqual(['--mode', 'rpc', '--provider', 'anthropic', '--model', 'claude-sonnet-4'])
    // no launcher env: `pi` brings its own runtime
    expect(H.spawnCalls[0].opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('launches the published package through npx as the last resort', async () => {
    const proc = newProc()
    vi.spyOn(proc as unknown as { resolveCliPath(): string }, 'resolveCliPath').mockReturnValue('npx')

    const starting = proc.start()
    await vi.advanceTimersByTimeAsync(500)
    await starting

    expect(H.spawnCalls[0].command).toBe('npx')
    expect(H.spawnCalls[0].args).toEqual([
      '@mariozechner/pi-coding-agent',
      '--mode',
      'rpc',
      '--provider',
      'anthropic',
      '--model',
      'claude-sonnet-4',
    ])
  })

  it('fails the launch when the child dies inside the grace window, quoting its stderr', async () => {
    const proc = newProc()
    const errors: Error[] = []
    proc.on('error', (e: Error) => errors.push(e))

    const starting = proc.start()
    const child = H.children[0]
    child.stderr.emit('data', Buffer.from('line one\nError: cannot find module\n'))
    child.child.emit('exit', 3, null)

    await expect(starting).rejects.toThrow('Process exited early with code 3: line one | Error: cannot find module')
    expect(proc.status).toBe('exited')
    expect(proc.isRunning()).toBe(false)
    // exactly one error emission: the exit path does not also fire the error listener
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Process exited early')
  })

  it('fails the launch when the child is already dead by the end of the grace window', async () => {
    const proc = newProc()

    const starting = proc.start()
    const rejected = expect(starting).rejects.toThrow('Process failed to start')
    H.children[0].child.killed = true
    await vi.advanceTimersByTimeAsync(500)

    // nothing ever answers on stdio, so the pool must not keep the session
    await rejected
    expect(proc.status).toBe('exited')
  })

  it('reports a spawn failure twice, once from the process and once from start()', async () => {
    const proc = newProc()
    const errors: Error[] = []
    proc.on('error', (e: Error) => errors.push(e))

    const starting = proc.start()
    H.children[0].child.emit('error', Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' }))

    await expect(starting).rejects.toThrow('spawn pi ENOENT')
    // the pool tears the session down on the first one; the second is noise, not a bug fix
    expect(errors).toHaveLength(2)
    expect(errors.map((e) => e.message)).toEqual(['spawn pi ENOENT', 'spawn pi ENOENT'])
    expect(proc.status).toBe('exited')
  })
})

describe('PiSessionProcess exit — releasing whoever is waiting', () => {
  it('settles the session and forwards the exit payload once the process is up', async () => {
    const { proc, child } = await startUp()
    const exits: unknown[][] = []
    proc.on('exit', (...args) => exits.push(args))

    feed(child, JSON.stringify({ type: 'agent_start' }) + '\n')
    expect(proc.canSafelySuspend()).toBe(false)

    child.child.emit('exit', 0, null)

    expect(proc.status).toBe('exited')
    expect(exits).toEqual([[0, null, '']])
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('rejects an in-flight prompt with the last five stderr lines and the exit reason', async () => {
    const { proc, child } = await startUp()
    const sending = proc.sendMessage('summarize this')
    expect(writtenFrames(child)).toHaveLength(1)
    // the expectation is attached before the child dies so the rejection is never unhandled
    const rejected = expect(sending).rejects.toThrow(
      'Pi RPC process exited with code 2 (signal SIGKILL): l3 | l4 | l5 | l6 | l7',
    )

    child.stderr.emit('data', Buffer.from('l1\nl2\nl3\nl4\nl5\nl6\nl7\n', 'utf8'))
    child.child.emit('exit', 2, 'SIGKILL')

    await rejected
    // the request is gone from the ledger: a late ack for it must be ignored
    const seen: unknown[] = []
    proc.on('message', (m) => seen.push(m))
    feed(child, ackFor('req_1'))
    expect(seen).toHaveLength(0)
    // known wart, asserted so a change is deliberate: sendMessage's catch resets the
    // status to idle after the exit handler set it to exited, and _process survives,
    // so a dead session still reports isRunning() === true to the pool
    expect(proc.status).toBe('idle')
    expect(proc.isRunning()).toBe(true)
  })

  it('names the exit reason plainly when the process died without touching stderr', async () => {
    const { proc, child } = await startUp()
    const sending = proc.sendMessage('summarize this')
    const rejected = expect(sending).rejects.toThrow('Pi RPC process exited with code null')

    child.child.emit('exit', null, null)

    await rejected
  })

  it('does not build an exit rejection when nothing is waiting', async () => {
    const { proc, child } = await startUp()
    child.stderr.emit('data', Buffer.from('noise\n'))

    child.child.emit('exit', 1, null)

    expect(proc.status).toBe('exited')
    expect(proc.canSafelySuspend()).toBe(true)
  })
})

describe('PiSessionProcess kill, suspend, resume', () => {
  it('kills the whole process tree and forgets the in-flight tools', async () => {
    const { proc, child } = await startUp()
    feed(child, JSON.stringify({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'Bash', args: {} }) + '\n')
    expect(proc.getPendingToolCount()).toBe(1)

    await proc.kill()

    expect(mockedKillTree).toHaveBeenCalledWith(child.child, `PiSessionProcess[${SHORT_ID}]`)
    expect(proc.status).toBe('exited')
    expect(proc.isRunning()).toBe(false)
    expect(proc.getPendingToolCount()).toBe(0)
    expect(proc.canSafelySuspend()).toBe(true)

    await proc.kill()
    expect(mockedKillTree).toHaveBeenCalledTimes(1)
  })

  it('leaves the tree alone when killing a session that never started', async () => {
    const proc = newProc()

    await proc.kill()

    expect(mockedKillTree).not.toHaveBeenCalled()
    expect(proc.status).toBe('exited')
  })

  it('suspends by closing stdin and resumes by spawning a fresh process', async () => {
    const { proc, child } = await startUp()

    await proc.suspend()

    expect(child.stdinEnd).toHaveBeenCalledTimes(1)
    expect(proc.status).toBe('suspended')
    expect(proc.isRunning()).toBe(false)

    const resuming = proc.resume()
    await vi.advanceTimersByTimeAsync(500)
    await resuming

    expect(H.spawnCalls).toHaveLength(2)
    expect(proc.status).toBe('idle')
    expect(proc.isRunning()).toBe(true)
  })

  it('ignores suspend, abort and thinking-level requests before there is a process', async () => {
    const proc = newProc()

    await proc.suspend()
    await proc.abort()
    await proc.setThinkingLevel('high')

    expect(proc.status).toBe('starting')
    expect(H.spawnCalls).toHaveLength(0)
  })

  it('writes the abort and thinking-level control frames verbatim', async () => {
    const { proc, child } = await startUp()

    await proc.abort()
    await proc.setThinkingLevel('off')

    expect(writtenFrames(child)).toEqual([
      { type: 'abort' },
      { type: 'set_thinking_level', level: 'off' },
    ])
    expect(child.stdinWrite.mock.calls.map((call) => String(call[0]))).toEqual([
      '{"type":"abort"}\n',
      '{"type":"set_thinking_level","level":"off"}\n',
    ])
  })

  it('warns instead of throwing when a control frame cannot be written', async () => {
    const { proc, child } = await startUp()
    child.stdinWrite.mockImplementation(() => {
      throw new Error('EPIPE: write after end')
    })

    await expect(proc.abort()).resolves.toBeUndefined()
    await expect(proc.setThinkingLevel('medium')).resolves.toBeUndefined()

    expect(loggerWarn).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`[${SHORT_ID}] Abort failed`),
      expect.any(Error),
    )
    expect(loggerWarn).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`[${SHORT_ID}] Set thinking level failed`),
      expect.any(Error),
    )
  })
})

describe('PiSessionProcess prompt round-trip', () => {
  it('writes one prompt frame and stays busy until agent_end even after a successful ack', async () => {
    const { proc, child } = await startUp()

    const sending = proc.sendMessage('summarize this')
    expect(child.stdinWrite).toHaveBeenCalledTimes(1)
    expect(String(child.stdinWrite.mock.calls[0][0]).endsWith('\n')).toBe(true)
    expect(writtenFrames(child)).toEqual([{ id: 'req_1', type: 'prompt', message: 'summarize this' }])
    expect(proc.status).toBe('active')
    expect(proc.canSafelySuspend()).toBe(false)

    feed(child, ackFor('req_1'))
    await expect(sending).resolves.toBeUndefined()

    // an ack only means "the engine took the prompt" — the turn is still running
    expect(proc.status).toBe('active')
    expect(proc.canSafelySuspend()).toBe(false)
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining(`[${SHORT_ID}] Prompt accepted`))
  })

  it('only lets the ack with the matching request id settle its own prompt', async () => {
    const { proc, child } = await startUp()

    const first = proc.sendMessage('one')
    const second = proc.sendMessage('two')
    expect(writtenFrames(child).map((f) => f.id)).toEqual(['req_1', 'req_2'])

    feed(child, ackFor('req_2'))
    await expect(second).resolves.toBeUndefined()
    const stillPending = Promise.race([
      first.then(() => 'settled'),
      Promise.resolve().then(() => 'pending'),
    ])
    await expect(stillPending).resolves.toBe('pending')

    feed(child, ackFor('req_1'))
    await expect(first).resolves.toBeUndefined()
  })

  it('resets the session when the engine refuses the prompt', async () => {
    const { proc, child } = await startUp()

    const sending = proc.sendMessage('go')
    feed(child, ackFor('req_1', { success: false, error: 'model context exceeded' }))

    await expect(sending).rejects.toThrow('model context exceeded')
    expect(proc.status).toBe('idle')
    expect(proc.canSafelySuspend()).toBe(true)
  })

  it('reports a generic failure when the engine refuses without saying why', async () => {
    const { proc, child } = await startUp()

    const sending = proc.sendMessage('go')
    feed(child, ackFor('req_1', { success: false }))

    await expect(sending).rejects.toThrow('Prompt failed')
    expect(loggerError).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`[${SHORT_ID}] Prompt failed`),
      expect.any(Error),
    )
  })

  it('gives up on a prompt that is never acked and drops the late ack', async () => {
    const { proc, child } = await startUp()
    const seen: unknown[] = []
    proc.on('message', (m) => seen.push(m))

    const sending = proc.sendMessage('go')
    const rejected = expect(sending).rejects.toThrow('Timeout waiting for prompt response')
    await vi.advanceTimersByTimeAsync(30_000)

    await rejected
    expect(proc.status).toBe('idle')
    expect(proc.canSafelySuspend()).toBe(true)

    feed(child, ackFor('req_1'))
    expect(seen).toHaveLength(0)
  })

  it('refuses to prompt a session with no live process', async () => {
    const fresh = newProc({}, 'pi-dead-0001')
    await expect(fresh.sendMessage('hi')).rejects.toThrow('Session pi-dead-0001 has no active process')

    const { proc } = await startUp({}, 'pi-killed-0001')
    await proc.kill()
    await expect(proc.sendMessage('hi')).rejects.toThrow('Session pi-killed-0001 has no active process')
  })
})

describe('PiSessionProcess prompt attachments', () => {
  it('writes each image into the session upload dir and references it in the prompt', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/cfg'
    const uploadDir = path.join('/cfg', 'uploads', SESSION_ID)
    const bytes = Buffer.from('fake-png-payload')
    const { proc, child } = await startUp()

    const sending = proc.sendMessage('', [attachment('diagram v1.png', `data:image/png;base64,${bytes.toString('base64')}`)])

    expect(H.mkdirs).toEqual([uploadDir])
    expect(H.writes).toHaveLength(1)
    const savedPath = H.writes[0].path
    expect(path.dirname(savedPath)).toBe(uploadDir)
    // the sanitised original name is kept whole and the mime-derived extension is
    // appended, so "diagram v1.png" lands as "<uuid>-diagram_v1.png.png"
    expect(path.basename(savedPath)).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-diagram_v1\.png\.png$/)
    expect((H.writes[0].data as Buffer).equals(bytes)).toBe(true)
    expect(writtenFrames(child)).toEqual([
      { id: 'req_1', type: 'prompt', message: `@"${savedPath}" Please analyze the attached images.` },
    ])

    feed(child, ackFor('req_1'))
    await expect(sending).resolves.toBeUndefined()
  })

  it('reuses an existing upload dir and defaults to ~/.claude when the config dir is unset', async () => {
    const uploadDir = path.join('/home/u', '.claude', 'uploads', SESSION_ID)
    H.existing.add(uploadDir)
    const { proc, child } = await startUp()

    const sending = proc.sendMessage('describe this', [attachment('a.gif', `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`)])

    expect(H.mkdirs).toEqual([])
    expect(path.dirname(H.writes[0].path)).toBe(uploadDir)
    expect(path.basename(H.writes[0].path)).toMatch(/-a\.gif\.gif$/)
    expect(writtenFrames(child)[0].message).toBe(`@"${H.writes[0].path}" describe this`)

    feed(child, ackFor('req_1'))
    await expect(sending).resolves.toBeUndefined()
  })

  it('maps every supported mime type to its extension and defaults unknown ones to png', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/cfg'
    const b64 = Buffer.from('bytes').toString('base64')

    const cases: Array<[string, string]> = [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/gif', 'gif'],
      ['image/bmp', 'bmp'],
      ['image/webp', 'webp'],
      ['image/svg+xml', 'svg'],
      ['application/pdf', 'png'],
    ]

    for (const [mimeType, ext] of cases) {
      H.writes = []
      const { proc, child } = await startUp({}, `pi-mime-${ext}-0001`)
      const sending = proc.sendMessage('look', [attachment('file name.png', `data:${mimeType};base64,${b64}`, mimeType)])

      expect(path.basename(H.writes[0].path).endsWith(`-file_name.png.${ext}`)).toBe(true)

      feed(child, ackFor('req_1'))
      await sending
    }
  })

  it('drops an attachment with a malformed data URL but still sends the message', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/cfg'
    const good = Buffer.from('good-bytes')
    const { proc, child } = await startUp()

    const sending = proc.sendMessage('compare these', [
      attachment('ok.png', `data:image/png;base64,${good.toString('base64')}`),
      attachment('broken.png', 'not-a-data-url'),
    ])

    expect(loggerError).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining(`[${SHORT_ID}] Failed to save image: broken.png`),
      expect.objectContaining({ message: 'Invalid image data format' }),
    )
    expect(H.writes).toHaveLength(1)
    const frames = writtenFrames(child)
    expect(frames[0].message).toBe(`@"${H.writes[0].path}" compare these`)

    feed(child, ackFor('req_1'))
    await expect(sending).resolves.toBeUndefined()
  })
})
