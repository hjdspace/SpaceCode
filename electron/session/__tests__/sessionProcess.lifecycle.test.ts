// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * Lifecycle guards and the permission round-trip.
 *
 * Every user-facing method on a session assumes a live, writable child. The
 * whole class of "session died / was suspended but the UI still thinks it is
 * running" bugs is caught by these guards, so each one is a real branch:
 *   - imperative calls (send / answer / respond / elicit) must *throw* rather
 *     than write to a closed stdin,
 *   - query calls (getMcpStatus / getContextUsage / getSettings / setModel /
 *     setPermissionMode / stopTask) must *reject* their promise, not throw
 *     synchronously, so callers awaiting them see a rejected Future,
 *   - suspend keeps the process handle alive-but-null and only reports
 *     `suspended` when there really was a child,
 *   - kill must delegate to the shared tree-killer so Windows orphans die too,
 *   - canSafelySuspend refuses to evict a session with an in-flight tool or an
 *     active turn,
 *   - permission allow/deny round-trips must actually clear the pending id so
 *     the pool never leaks a stuck approval card.
 */

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/home/u') } }))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  processRaw: vi.fn(), sdkMessage: vi.fn(), setSessionLogPath: vi.fn(), traceEvent: vi.fn(),
}))
vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getProxyUrl: vi.fn(() => null), start: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))
vi.mock('../../tools/mcpConfigStore', () => ({ buildEnabledMcpConfig: vi.fn(() => null) }))
vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliBinaryPath: vi.fn(() => '/bundle/officecli'),
  getOfficeCliInstalledBinary: vi.fn(() => '/office/bin/officecli'),
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
}))
vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk/bin') },
}))

const eng = vi.hoisted(() => ({ killTree: vi.fn() }))
vi.mock('../engineChildProcess', () => ({
  killTree: (...a: unknown[]) => eng.killTree(...(a as [])),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

function baseConfig(o: Partial<SessionConfig> = {}): SessionConfig {
  return { cwd: '/tmp/ws', provider: 'anthropic', permissionMode: 'default', ...o }
}

function newProc(o: Partial<SessionConfig> = {}, id = 'sess-life-0000'): SessionProcess {
  return new SessionProcess(id, baseConfig(o))
}

interface Wired {
  proc: any
  stdinWrite: ReturnType<typeof vi.fn>
  child: any
  stdout: EventEmitter
  stderr: EventEmitter
}

function wired(o: Partial<SessionConfig> = {}): Wired {
  const proc = newProc(o) as any
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const stdinWrite = vi.fn()
  const child = new EventEmitter() as any
  child.stdout = stdout
  child.stderr = stderr
  child.stdin = { writable: true, write: stdinWrite }
  child.pid = 1000
  child.killed = false
  child.kill = vi.fn(() => true)
  proc.process = child
  proc.attachProcessListeners(child)
  return { proc, stdinWrite, child, stdout, stderr }
}

function lastWrite(w: Wired): any {
  const raw = String(w.stdinWrite.mock.calls[w.stdinWrite.mock.calls.length - 1][0])
  return JSON.parse(raw)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {})

describe('guards — imperative methods throw without a live stdin', () => {
  it('sendMessage refuses to write to a dead process', () => {
    const proc = newProc()
    expect(() => proc.sendMessage('hi')).toThrow('No active process')
    proc.removeAllListeners()
  })

  it('submitToolAnswer / skipToolAnswer throw when the process is gone', () => {
    const proc = newProc()
    expect(() => proc.submitToolAnswer('tu-1', { a: 'b' })).toThrow('No active process')
    expect(() => proc.skipToolAnswer('tu-1')).toThrow('No active process')
    proc.removeAllListeners()
  })

  it('respondPermission / allowPermission / denyPermission throw when stdin is not writable', () => {
    const proc = newProc() as any
    proc.process = { stdin: { writable: false }, pid: 1, kill: vi.fn() }
    expect(() => proc.respondPermission('r', { behavior: 'allow', updatedInput: {} })).toThrow('No active process')
    expect(() => proc.allowPermission('r')).toThrow('No active process')
    expect(() => proc.denyPermission('r')).toThrow('No active process')
    proc.removeAllListeners()
  })

  it('respondElicitation throws without a writable stdin', () => {
    const proc = newProc()
    expect(() => proc.respondElicitation('r', { action: 'accept' })).toThrow('No active process')
    proc.removeAllListeners()
  })
})

describe('guards — query methods reject their promise (never throw synchronously)', () => {
  const cases: Array<[string, (p: SessionProcess) => Promise<unknown>]> = [
    ['setPermissionMode', (p) => p.setPermissionMode('plan')],
    ['setModel', (p) => p.setModel('claude-x')],
    ['getMcpStatus', (p) => p.getMcpStatus()],
    ['getContextUsage', (p) => p.getContextUsage()],
    ['getSettings', (p) => p.getSettings()],
    ['stopTask', (p) => p.stopTask('task-1')],
  ]

  it.each(cases)('%s rejects with No active process when the child is gone', async (_name, call) => {
    const proc = newProc()
    await expect(call(proc)).rejects.toThrow('No active process')
    proc.removeAllListeners()
  })
})

describe('suspend / kill', () => {
  it('suspend is a no-op when there is no process to suspend', () => {
    const proc = newProc() as any
    proc.suspend()
    expect(proc.status).toBe('starting')
    proc.removeAllListeners()
  })

  it('suspend marks the session suspended, kills the child and drops the handle', () => {
    const proc = newProc() as any
    const child = { pid: 777, kill: vi.fn(() => true) }
    proc.process = child

    proc.suspend()

    expect(proc.status).toBe('suspended')
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(proc.process).toBeNull()
    proc.removeAllListeners()
  })

  it('kill delegates to the shared tree-killer so Windows children do not orphan', () => {
    const proc = newProc() as any
    const child = { pid: 888, kill: vi.fn() }
    proc.process = child

    proc.kill()

    expect(eng.killTree).toHaveBeenCalledWith(child, 'SessionProcess')
    expect(proc.process).toBeNull()
    expect(proc.status).toBe('exited')
    proc.removeAllListeners()
  })

  it('kill with no process still parks the status at exited', () => {
    const proc = newProc() as any
    proc.kill()
    expect(proc.status).toBe('exited')
    expect(eng.killTree).not.toHaveBeenCalled()
    proc.removeAllListeners()
  })
})

describe('canSafelySuspend / pending accounting', () => {
  it('refuses to evict a session with an in-flight tool call', () => {
    const proc = newProc() as any
    proc.pendingToolCalls.add('tu-x')
    expect(proc.canSafelySuspend()).toBe(false)
    expect(proc.getPendingToolCount()).toBe(1)
    proc.removeAllListeners()
  })

  it('refuses to evict an active turn that is still processing', () => {
    const proc = newProc() as any
    proc.isProcessing = true
    proc.status = 'active'
    expect(proc.canSafelySuspend()).toBe(false)
    proc.removeAllListeners()
  })

  it('permits eviction of an idle session with nothing pending', () => {
    const proc = newProc() as any
    proc.status = 'idle'
    expect(proc.canSafelySuspend()).toBe(true)
    proc.removeAllListeners()
  })
})

describe('abort — interrupt control_request', () => {
  it('sends an interrupt over the control protocol when stdin is writable', () => {
    const w = wired()

    w.proc.abort()

    const written = lastWrite(w)
    expect(written).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } })
    w.proc.removeAllListeners()
  })

  it('is inert when the process is already gone', () => {
    const proc = newProc() as any
    expect(() => proc.abort()).not.toThrow()
    proc.removeAllListeners()
  })
})

describe('permission round-trip clears the pending id', () => {
  it('allow writes the allow response and forgets the request', () => {
    const w = wired()
    w.stdout.emit('data', Buffer.from(
      '{"type":"control_request","request_id":"req-a","request":{"subtype":"can_use_tool","tool_name":"Bash","tool_use_id":"tu-a","input":{"cmd":"ls"}}}\n',
      'utf8',
    ))
    expect(w.proc.getPendingPermissionRequestIds()).toEqual(['req-a'])

    w.proc.allowPermission('req-a', { cmd: 'ls -la' }, 'user_temporary')

    const written = lastWrite(w)
    expect(written.response.response).toEqual({
      behavior: 'allow',
      updatedInput: { cmd: 'ls -la' },
      decisionClassification: 'user_temporary',
    })
    expect(w.proc.getPendingPermissionRequestIds()).toEqual([])
    w.proc.removeAllListeners()
  })

  it('deny writes the deny message with the reject classification', () => {
    const w = wired()
    w.stdout.emit('data', Buffer.from(
      '{"type":"control_request","request_id":"req-d","request":{"subtype":"can_use_tool","tool_name":"Write","tool_use_id":"tu-d","input":{}}}\n',
      'utf8',
    ))

    w.proc.denyPermission('req-d', 'not allowed', { interrupt: true })

    const written = lastWrite(w)
    expect(written.response.response).toEqual({
      behavior: 'deny',
      message: 'not allowed',
      interrupt: true,
      decisionClassification: 'user_reject',
    })
    expect(w.proc.getPendingPermissionRequestIds()).toEqual([])
    w.proc.removeAllListeners()
  })

  it('throws when answering a request id the engine never asked about', () => {
    const w = wired()
    expect(() => w.proc.allowPermission('ghost')).toThrow('No pending permission request')
    w.proc.removeAllListeners()
  })
})

describe('tool answers reach stdin as tool_result frames', () => {
  it('submitToolAnswer wraps the answers JSON in a tool_result block', () => {
    const w = wired()

    w.proc.submitToolAnswer('tu-42', { choice: 'A' })

    const written = lastWrite(w)
    expect(written.message.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu-42',
      content: JSON.stringify({ answers: { choice: 'A' } }),
    })
    w.proc.removeAllListeners()
  })

  it('skipToolAnswer sends an empty non-error tool_result', () => {
    const w = wired()

    w.proc.skipToolAnswer('tu-43')

    const written = lastWrite(w)
    expect(written.message.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu-43',
      content: '',
      is_error: false,
    })
    w.proc.removeAllListeners()
  })

  it('rethrows a stdin write failure instead of silently dropping the message', () => {
    const w = wired()
    w.stdinWrite.mockImplementation(() => {
      throw new Error('EPIPE')
    })
    expect(() => w.proc.submitToolAnswer('tu-9', {})).toThrow('EPIPE')
    w.proc.removeAllListeners()
  })
})
