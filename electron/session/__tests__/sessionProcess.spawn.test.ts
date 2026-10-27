// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * Process launch orchestration in `start()`.
 *
 * Beyond "does it call spawn", the contract that actually bites in production:
 *   - the child is spawned with pipe stdio, a real cwd, and the assembled CLI
 *     args;
 *   - a non-existent cwd is created first (Windows otherwise throws a misleading
 *     ENOENT pointing at the executable), and a failure to create it must not
 *     abort the launch;
 *   - on Windows a `.cmd` launcher needs `shell: true`, everything else does not;
 *   - a packaged build whose *bundled bun* vanished (spawn ENOENT) silently
 *     retries exactly once via Electron-as-Node before giving up — but only when
 *     the desktop bundle actually exists on disk;
 *   - any other spawn error (or ENOENT in dev) rejects `start()`, flips status to
 *     `exited`, and emits `error` so the pool can evict the dead session.
 *
 * `buildEnv` is stubbed to keep this file about launch mechanics (the env
 * itself has its own test).
 */

const runtime = vi.hoisted(() => ({ isPackaged: false }))
const cp = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[]; opts: any }>,
  plan: [] as Array<'spawn' | { err: NodeJS.ErrnoException }>,
}))
const fsp = vi.hoisted(() => ({
  exists: (() => false) as (p: string) => boolean,
  mkdir: [] as string[],
  mkdirThrows: false,
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const { EventEmitter } = await import('events')
  return {
    ...actual,
    spawn: (command: string, args: string[], opts: any) => {
      const child: any = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.stdin = new EventEmitter()
      child.stdin.writable = true
      child.pid = 55000 + cp.calls.length
      child.killed = false
      child.kill = vi.fn(() => true)
      cp.calls.push({ command, args, opts })
      const action = cp.plan[cp.calls.length - 1] ?? 'spawn'
      queueMicrotask(() => {
        if (action === 'spawn') child.emit('spawn')
        else child.emit('error', action.err)
      })
      return child
    },
  }
})

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsp.exists(String(p)),
  mkdirSync: (p: unknown) => {
    if (fsp.mkdirThrows) throw new Error('EACCES: cannot mkdir')
    fsp.mkdir.push(String(p))
  },
  writeFileSync: vi.fn(),
  readFileSync: () => '{}',
  readdirSync: () => [],
  realpathSync: (p: unknown) => String(p),
  statSync: () => ({ isFile: () => true, size: 1_000_000 }),
  copyFileSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('os', () => ({ homedir: () => '/home/u', tmpdir: () => '/tmp' }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtime.isPackaged
    },
    getPath: vi.fn(() => '/home/u'),
  },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  processRaw: vi.fn(), sdkMessage: vi.fn(), setSessionLogPath: vi.fn(), traceEvent: vi.fn(),
}))

vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getProxyUrl: vi.fn(() => null), start: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))
vi.mock('../../tools/mcpConfigStore', () => ({ buildEnabledMcpConfig: vi.fn(() => null) }))
// 机器探测（注册表 PATH / Git Bash）有自己的测试；这里 stub 掉，避免在 Windows
// 开发机上跑单测时真去起 reg query 子进程。
vi.mock('../spawnEnvironment', () => ({
  getSpawnEnvironment: vi.fn(async () => ({ path: null, gitBashPath: null })),
}))
vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
  syncInstalledOfficeCli: vi.fn(() => ({ copied: false, reason: 'up-to-date', bundledVersion: null, installedVersion: null })),
}))
vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk/bin') },
}))
vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

const CLI_ROOT = '/engine-root'
const DESKTOP_CLI = path.join(CLI_ROOT, 'dist-desktop/cli.js')
const originalPlatform = process.platform

function makeProc(overrides: Partial<SessionConfig> = {}): SessionProcess {
  const config: SessionConfig = {
    cwd: '/tmp/ws',
    provider: 'anthropic',
    permissionMode: 'default',
    engineSource: 'installed',
    installedCliPath: '/claude/claude',
    ...overrides,
  }
  const proc = new SessionProcess('sess-spawn-0001', config) as any
  vi.spyOn(proc, 'buildEnv').mockResolvedValue({})
  return proc
}

function planSpawn() {
  cp.plan.push('spawn')
}
function planError(code: string, message = code) {
  cp.plan.push({ err: Object.assign(new Error(message), { code }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  cp.calls = []
  cp.plan = []
  fsp.exists = () => false
  fsp.mkdir = []
  fsp.mkdirThrows = false
  runtime.isPackaged = false
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

describe('start — successful spawn', () => {
  it('launches the installed CLI with pipe stdio and the assembled args, then flips to active', async () => {
    const proc = makeProc()
    planSpawn()

    await proc.start()

    expect(cp.calls).toHaveLength(1)
    const call = cp.calls[0]
    expect(call.command).toBe('/claude/claude')
    expect(call.args).toEqual(expect.arrayContaining(['--print', '--output-format', 'stream-json', '--session-id', 'sess-spawn-0001']))
    expect(call.opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(call.opts.cwd).toBe('/tmp/ws')
    expect(call.opts.shell).toBe(false)
    expect(call.opts.windowsHide).toBe(true)
    expect(proc.status).toBe('active')
    expect(proc.process).not.toBeNull()
    proc.removeAllListeners()
  })

  it('runs a .cmd launcher through the shell on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const proc = makeProc({ installedCliPath: 'C:\\tools\\claude.cmd' })
    planSpawn()

    await proc.start()

    expect(cp.calls[0].opts.shell).toBe(true)
    proc.removeAllListeners()
  })

  it('creates a missing cwd directory before spawning', async () => {
    fsp.exists = (p) => p !== '/tmp/ws' // cwd reported absent, everything else present
    const proc = makeProc({ cwd: '/tmp/ws' })
    planSpawn()

    await proc.start()

    expect(fsp.mkdir).toContain('/tmp/ws')
    expect(cp.calls).toHaveLength(1)
    proc.removeAllListeners()
  })

  it('still launches when the cwd cannot be created', async () => {
    fsp.mkdirThrows = true
    const proc = makeProc({ cwd: '/tmp/ws' })
    planSpawn()

    await proc.start()

    expect(cp.calls).toHaveLength(1)
    expect(proc.status).toBe('active')
    proc.removeAllListeners()
  })
})

describe('start — packaged ENOENT retry', () => {
  it('retries exactly once via Electron-as-Node when the bundled bun vanished', async () => {
    runtime.isPackaged = true
    fsp.exists = (p) => p.replace(/\\/g, '/') === DESKTOP_CLI.replace(/\\/g, '/')
    const proc = makeProc()
    planError('ENOENT', 'spawn /claude/claude ENOENT')
    planSpawn()

    await proc.start()

    expect(cp.calls).toHaveLength(2)
    expect(cp.calls[0].command).toBe('/claude/claude')
    expect(cp.calls[1].command).toBe(process.execPath)
    expect(cp.calls[1].args[0]).toBe(DESKTOP_CLI)
    expect(cp.calls[1].opts.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(proc.status).toBe('active')
    proc.removeAllListeners()
  })

  it('gives up without retrying when the desktop bundle is not on disk', async () => {
    runtime.isPackaged = true
    fsp.exists = () => false // dist-desktop/cli.js missing → retry disabled
    const proc = makeProc()
    planError('ENOENT', 'spawn ENOENT')

    await expect(proc.start()).rejects.toThrow('ENOENT')

    expect(cp.calls).toHaveLength(1)
    expect(proc.status).toBe('exited')
    proc.removeAllListeners()
  })

  it('gives up on ENOENT in a dev build, which never has a packaged fallback', async () => {
    runtime.isPackaged = false
    const proc = makeProc()
    planError('ENOENT', 'spawn ENOENT')

    await expect(proc.start()).rejects.toThrow('ENOENT')

    expect(cp.calls).toHaveLength(1)
    proc.removeAllListeners()
  })
})

describe('start — non-ENOENT failures', () => {
  it('rejects, emits error and marks the session exited for an access error', async () => {
    const proc = makeProc()
    const seen: Error[] = []
    proc.on('error', (e: Error) => seen.push(e))
    planError('EACCES', 'permission denied')

    await expect(proc.start()).rejects.toThrow('permission denied')

    expect(cp.calls).toHaveLength(1)
    expect(proc.status).toBe('exited')
    expect(seen).toHaveLength(1)
    expect(seen[0].message).toBe('permission denied')
    proc.removeAllListeners()
  })

  it('does not spin a second attempt just because the first errored', async () => {
    const proc = makeProc()
    planError('ENOENT', 'first')
    planError('ENOENT', 'second') // would be consumed if it looped past the guard
    runtime.isPackaged = false

    await expect(proc.start()).rejects.toThrow('first')

    expect(cp.calls).toHaveLength(1)
    proc.removeAllListeners()
  })
})

describe('resume', () => {
  it('refuses to resume without a remembered engine session id', async () => {
    const proc = makeProc()
    await expect(proc.resume()).rejects.toThrow('Cannot resume: no engineSessionId')
    proc.removeAllListeners()
  })

  it('re-runs start once the engine id is known', async () => {
    const proc = makeProc()
    proc.engineSessionId = 'engine-prev'
    planSpawn()
    const startSpy = vi.spyOn(proc, 'start').mockResolvedValue(undefined)

    await proc.resume()

    expect(startSpy).toHaveBeenCalledTimes(1)
    proc.removeAllListeners()
  })
})
