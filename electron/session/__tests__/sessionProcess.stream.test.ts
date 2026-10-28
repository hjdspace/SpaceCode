// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * The stdout seam: how a stream of bytes from the engine turns into state,
 * events, and pending-tool bookkeeping.
 *
 * The engine speaks JSONL on stdout, but the OS hands us arbitrary chunks — a
 * single message can be split across several chunks, several messages can be
 * glued into one chunk, and stderr can interleave. The contract this file
 * pins down:
 *   - framing must be order-preserving and idempotent across chunk boundaries
 *     (half a message carries over; it is never parsed twice or dropped)
 *   - a garbage line must not take the stream down — it is logged and skipped,
 *     everything after it still parses
 *   - the state machine (starting/active/idle/exited/suspended) transitions on
 *     message type, and tool_use / tool_result drive the pending set that
 *     gates safe suspension
 *   - on process exit the pending control requests are cancelled so the UI
 *     never sits on a dead permission prompt, and the status stays `suspended`
 *     if the user suspended it (rather than being overwritten to `exited`)
 *
 * Everything here drives the *real* ControlProtocolHandler wired up in the
 * constructor — we only fake the child process's stdio event emitters.
 */

const engineRoot = vi.hoisted(() => '/engine-root')

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/home/u'),
  },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  processRaw: vi.fn(),
  sdkMessage: vi.fn(),
  setSessionLogPath: vi.fn(),
  traceEvent: vi.fn(),
}))

vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getProxyUrl: vi.fn(() => null), start: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))

vi.mock('../../tools/mcpConfigStore', () => ({
  buildEnabledMcpConfig: vi.fn(() => null),
}))

vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
  syncInstalledOfficeCli: vi.fn(() => ({ copied: false, reason: 'up-to-date', bundledVersion: null, installedVersion: null })),
}))

vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk') },
}))

vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => engineRoot),
}))

import { warn as loggerWarn } from '../../infra/logger'

function baseConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return { cwd: '/tmp/ws', provider: 'anthropic', permissionMode: 'default', ...overrides }
}

interface FakeChild {
  child: any
  stdout: EventEmitter
  stderr: EventEmitter
  stdinWrite: ReturnType<typeof vi.fn>
}

function makeChild(): FakeChild {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const stdinWrite = vi.fn()
  const child = new EventEmitter() as any
  child.stdout = stdout
  child.stderr = stderr
  child.stdin = { writable: true, write: stdinWrite }
  child.pid = 4242
  child.killed = false
  child.kill = vi.fn(() => true)
  return { child, stdout, stderr, stdinWrite }
}

/** Wire a fresh SessionProcess to a fake child and return the plumbing. */
function wired(config: Partial<SessionConfig> = {}, sessionId = 'sess-stream-0001'): SessionProcess & { _child: FakeChild } {
  const proc = new SessionProcess(sessionId, baseConfig(config)) as any
  const fakes = makeChild()
  proc.process = fakes.child
  proc._child = fakes
  proc.attachProcessListeners(fakes.child, [])
  return proc
}

function feed(proc: any, chunk: string): void {
  proc._child.stdout.emit('data', Buffer.from(chunk, 'utf8'))
}

function lastWrite(proc: any): any {
  const write = proc._child.stdinWrite as ReturnType<typeof vi.fn>
  const raw = String(write.mock.calls[write.mock.calls.length - 1][0])
  return JSON.parse(raw)
}

let proc: any

beforeEach(() => {
  proc = undefined
  vi.clearAllMocks()
})

afterEach(() => {
  if (proc) proc.removeAllListeners()
})

describe('SessionProcess stdout framing — chunks are not messages', () => {
  it('carries a message split across two chunks and parses it exactly once', () => {
    proc = wired()
    const seen: any[] = []
    proc.on('message', (m: any) => seen.push(m))

    feed(proc, '{"type":"assistant","message":')
    expect(seen).toHaveLength(0) // half a line is buffered, not dispatched
    feed(proc, '{"content":"hi"}}\n')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ type: 'assistant', message: { content: 'hi' } })
  })

  it('dispatches several messages glued into one chunk, in order', () => {
    proc = wired()
    const seen: string[] = []
    proc.on('message', (m: any) => seen.push(m.type))

    feed(proc, '{"type":"assistant","message":{"content":"a"}}\n{"type":"result","result":"ok"}\n')

    expect(seen).toEqual(['assistant', 'result'])
    // result drives the idle state after assistant drove active
    expect(proc.status).toBe('idle')
  })

  it('skips blank lines but keeps parsing the messages around them', () => {
    proc = wired()
    const seen: string[] = []
    proc.on('message', (m: any) => seen.push(m.type))

    feed(proc, '\n\n{"type":"system","subtype":"init","session_id":"eng-1"}\n\n')

    expect(seen).toEqual(['system'])
    expect(proc.engineSessionId).toBe('eng-1')
  })

  it('logs and drops a garbage line instead of derailing the stream', () => {
    proc = wired()
    const seen: string[] = []
    proc.on('message', (m: any) => seen.push(m.type))

    feed(proc, 'this is not json\n{"type":"result","result":"after garbage"}\n')

    // the malformed line is reported...
    expect(loggerWarn).toHaveBeenCalledWith(
      'SessionProcess',
      expect.stringContaining('Failed to parse SDK message'),
      expect.anything(),
    )
    // ...and the valid line after it still reaches the handler
    expect(seen).toEqual(['result'])
  })
})

describe('SessionProcess state machine — message type drives status & pending tools', () => {
  it('marks the session active and opens a pending tool on a tool_use block', () => {
    proc = wired()
    expect(proc.canSafelySuspend()).toBe(true) // idle, nothing pending

    feed(proc, '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu-9","name":"Bash","input":{"cmd":"ls"}}]}}\n')

    expect(proc.status).toBe('active')
    expect(proc.getPendingToolCount()).toBe(1)
    expect(proc.canSafelySuspend()).toBe(false) // an in-flight tool blocks suspension
  })

  it('tracks a top-level tool_use message and clears it on tool_result', () => {
    proc = wired()

    feed(proc, '{"type":"tool_use","id":"tu-1","name":"Read","input":{}}\n')
    expect(proc.getPendingToolCount()).toBe(1)

    feed(proc, '{"type":"tool_result","tool_use_id":"tu-1"}\n')
    expect(proc.getPendingToolCount()).toBe(0)
  })

  it('treats an errored tool_result as a completed round-trip that still clears pending', () => {
    proc = wired()

    feed(proc, '{"type":"tool_use","id":"tu-2","name":"Bash","input":{}}\n')
    feed(proc, '{"type":"tool_result","tool_use_id":"tu-2","is_error":true}\n')

    expect(proc.getPendingToolCount()).toBe(0)
  })

  it('settles to idle on a result message, even mid-turn', () => {
    proc = wired()

    feed(proc, '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu-3","name":"X","input":{}}]}}\n')
    feed(proc, '{"type":"result","result":"done","num_turns":3}\n')

    expect(proc.status).toBe('idle')
    // result alone does NOT clear the pending set — only a tool_result frame does,
    // so a turn that ended without its tool_result keeps the tool in-flight.
    expect(proc.getPendingToolCount()).toBe(1)
  })

  it('adopts the engine session id from a system/init frame', () => {
    proc = wired()
    expect(proc.engineSessionId).toBeNull()

    feed(proc, '{"type":"system","subtype":"init","session_id":"engine-abc","tools":["Bash"]}\n')

    expect(proc.engineSessionId).toBe('engine-abc')
  })

  it('ignores an init frame without a session id rather than clearing it', () => {
    proc = wired()
    feed(proc, '{"type":"system","subtype":"init","session_id":"keep-me"}\n')

    feed(proc, '{"type":"system","subtype":"init"}\n')

    expect(proc.engineSessionId).toBe('keep-me')
  })
})

describe('SessionProcess permission routing on the stdout seam', () => {
  it('surfaces a can_use_tool prompt to the renderer with the tool payload', () => {
    proc = wired({ permissionMode: 'default' })
    const requests: any[] = []
    proc.on('permission_request', (p: any) => requests.push(p))

    feed(proc, '{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Bash","tool_use_id":"tu-5","input":{"cmd":"rm -rf /"},"description":"delete"}}\n')

    expect(proc._child.stdinWrite).not.toHaveBeenCalled() // host did NOT auto-answer
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      sessionId: 'sess-stream-0001',
      requestId: 'req-1',
      toolName: 'Bash',
      toolUseId: 'tu-5',
      input: { cmd: 'rm -rf /' },
      description: 'delete',
    })
  })

  it('silently auto-approves ExitPlanMode under bypassPermissions and never opens a prompt', () => {
    proc = wired()
    proc.currentPermissionMode = 'bypassPermissions'
    const prompts: any[] = []
    proc.on('permission_request', (p: any) => prompts.push(p))

    feed(proc, '{"type":"control_request","request_id":"req-2","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","tool_use_id":"tu-6","input":{"plan":"do it"}}}\n')

    expect(prompts).toHaveLength(0) // no approval card is shown
    const written = lastWrite(proc)
    expect(written).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-2',
        response: {
          behavior: 'allow',
          updatedInput: { plan: 'do it' },
          decisionClassification: 'user_permanent',
        },
      },
    })
  })

  it('still prompts for AskUserQuestion under bypass — auto-approval is limited to mode switches', () => {
    proc = wired()
    proc.currentPermissionMode = 'bypassPermissions'
    const prompts: any[] = []
    proc.on('permission_request', (p: any) => prompts.push(p))

    feed(proc, '{"type":"control_request","request_id":"req-3","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","tool_use_id":"tu-7","input":{}}}\n')

    expect(prompts).toHaveLength(1)
    expect(proc._child.stdinWrite).not.toHaveBeenCalled()
  })

  it('relays an MCP elicitation request to the renderer', () => {
    proc = wired()
    const elicitations: any[] = []
    proc.on('elicitation_request', (e: any) => elicitations.push(e))

    feed(proc, '{"type":"control_request","request_id":"req-4","request":{"subtype":"elicitation","mcp_server_name":"github","message":"log in","mode":"url","url":"https://x"}}\n')

    expect(elicitations).toHaveLength(1)
    expect(elicitations[0]).toMatchObject({
      sessionId: 'sess-stream-0001',
      requestId: 'req-4',
      mcpServerName: 'github',
      message: 'log in',
      mode: 'url',
      url: 'https://x',
    })
  })

  it('refuses a hook_callback so the engine does not hang waiting for a host handler', () => {
    proc = wired()

    feed(proc, '{"type":"control_request","request_id":"req-5","request":{"subtype":"hook_callback","callback_id":"cb-1","input":{}}}\n')

    const written = lastWrite(proc)
    expect(written.response.subtype).toBe('error')
    expect(written.response.request_id).toBe('req-5')
    expect(written.response.error).toContain('No hook callbacks registered')
  })
})

/**
 * 引擎在 system/init 里回报它自己认定的权限模式 —— 宿主据此判断"用户意图是否真的落地"，
 * 进程池再决定重试下发或按意图重启（见 claudeCodeProcessPool.permissionMode.test.ts）。
 * waitForInit 也可由 initialize 控制应答就绪，不要求提前发送用户消息。
 */
describe('SessionProcess permission truth from system/init', () => {
  it('records the engine-reported mode and whether it matches the intent', () => {
    proc = wired({ permissionMode: 'plan' })

    feed(proc, '{"type":"system","subtype":"init","session_id":"eng-2","permissionMode":"plan"}\n')

    expect(proc.reportedPermissionMode).toBe('plan')
    expect(proc.permissionModeVerified).toBe(true)
  })

  it('marks the intent as unverified when the engine reports a wider mode than intended', () => {
    proc = wired({ permissionMode: 'plan' })

    feed(proc, '{"type":"system","subtype":"init","session_id":"eng-3","permissionMode":"bypassPermissions"}\n')

    expect(proc.reportedPermissionMode).toBe('bypassPermissions')
    expect(proc.permissionModeVerified).toBe(false)
  })

  it('leaves verification unknown (not failed) when this CLI build reports no mode', () => {
    proc = wired({ permissionMode: 'plan' })

    feed(proc, '{"type":"system","subtype":"init","session_id":"eng-4"}\n')

    expect(proc.reportedPermissionMode).toBeNull()
    expect(proc.permissionModeVerified).toBeNull()
  })

  it('waitForInit resolves once system/init arrives', async () => {
    proc = wired()

    const ready = proc.waitForInit(5_000)
    feed(proc, '{"type":"system","subtype":"init","session_id":"eng-5","permissionMode":"default"}\n')

    await expect(ready).resolves.toBe(true)
    // 已经就绪之后再问就立刻返回，不再挂起调用方。
    await expect(proc.waitForInit(5_000)).resolves.toBe(true)
  })

  it('waitForInit resolves false when the process dies before initializing', async () => {
    proc = wired()

    const ready = proc.waitForInit(30_000)
    proc._child.child.emit('exit', null, 'SIGKILL')

    await expect(ready).resolves.toBe(false)
  })
})

describe('SessionProcess exit cleanup', () => {  it('cancels an open permission prompt and reports the exit payload to the UI', () => {
    proc = wired({ permissionMode: 'default' })
    const cancelled: any[] = []
    const exits: any[] = []
    proc.on('permission_request_cancelled', (p: any) => cancelled.push(p))
    proc.on('exit', (p: any) => exits.push(p))

    feed(proc, '{"type":"control_request","request_id":"req-6","request":{"subtype":"can_use_tool","tool_name":"Write","tool_use_id":"tu-8","input":{}}}\n')
    proc._child.stderr.emit('data', Buffer.from('disk full\n', 'utf8'))

    proc._child.child.emit('exit', 1, null)

    expect(proc.status).toBe('exited')
    expect(proc.process).toBeNull()
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]).toMatchObject({ sessionId: 'sess-stream-0001', requestId: 'req-6' })
    expect(exits).toHaveLength(1)
    expect(exits[0]).toMatchObject({ code: 1, signal: null })
    expect(exits[0].stderr).toContain('disk full')
  })

  it('keeps a suspended session marked suspended after its child exits', () => {
    proc = wired()
    proc.status = 'suspended'

    proc._child.child.emit('exit', null, 'SIGTERM')

    expect(proc.status).toBe('suspended')
    expect(proc.process).toBeNull()
  })

  it('surfaces a runtime error event as exited status and an error emission', () => {
    proc = wired()
    const errors: Error[] = []
    proc.on('error', (e: Error) => errors.push(e))

    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    proc._child.child.emit('error', err)

    expect(proc.status).toBe('exited')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('EACCES')
  })

  it('rejects a pending setModel control request when the process dies before answering', async () => {
    proc = wired()

    const pending = proc.setModel('claude-x')
    // drain the microtask so the outbound request is registered
    await Promise.resolve()

    proc._child.child.emit('exit', null, 'SIGKILL')

    await expect(pending).rejects.toThrow(/Process exited before control_request/)
  })
})
