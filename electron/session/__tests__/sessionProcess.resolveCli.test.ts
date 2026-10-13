// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * CLI launcher resolution. Which command/args we spawn with decides whether the
 * session runs the *bundled* engine, the *installed* official `claude`, or the
 * source tree via bun — and a wrong pick here is an instant ENOENT at launch.
 *
 * The precedence the code implements (and that must not regress):
 *   1. installed CLI path wins outright when the caller supplied one
 *   2. in dev, `bun run … src/entrypoints/cli.tsx` with macro defines, feature
 *      flags and an optional preload/.env
 *   3. packaged: the single-file `dist-desktop/cli.js` bundle, preferring the
 *      bundled bun, falling back to Electron-as-Node when bun looks unusable
 *   4. the split `dist/cli.js` build
 *   5. the source tree again (packaged but no build artifacts)
 *   6. a bare global `claude` command as a last resort
 */

const runtime = vi.hoisted(() => ({ isPackaged: false }))
const bun = vi.hoisted(() => ({ dev: 'bun', packagedDesktop: null as string | null }))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => exists.has(norm(String(p))),
  mkdirSync: vi.fn(),
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
vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliBinaryPath: vi.fn(() => '/bundle/officecli'),
  getOfficeCliInstalledBinary: vi.fn(() => '/office/bin/officecli'),
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
}))
vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk/bin') },
}))
vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: () => bun.dev,
  resolveBunPathForPackagedDesktop: () => bun.packagedDesktop,
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

const norm = (p: string) => p.replace(/\\/g, '/')
const exists = new Set<string>()

const SRC = norm(path.join('/engine-root', 'src/entrypoints/cli.tsx'))
const PRELOAD = norm(path.join('/engine-root', 'preload.ts'))
const ENVFILE = norm(path.join('/engine-root', '.env'))
const DESKTOP = norm(path.join('/engine-root', 'dist-desktop/cli.js'))
const DIST = norm(path.join('/engine-root', 'dist/cli.js'))

function resolve(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
  const proc = new SessionProcess('sess-resolve-1', { cwd: '/tmp/ws', provider: 'anthropic' } as SessionConfig) as any
  try {
    return proc.resolveCliCommand()
  } finally {
    proc.removeAllListeners()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  exists.clear()
  runtime.isPackaged = false
  bun.dev = 'bun'
  bun.packagedDesktop = null
})

afterEach(() => {})

describe('resolveCliCommand — precedence', () => {
  it('short-circuits to an installed CLI path with no wrapper args', () => {
    const proc = new SessionProcess('sess-installed', {
      cwd: '/tmp/ws',
      engineSource: 'installed',
      installedCliPath: '/opt/claude',
    } as SessionConfig) as any
    expect(proc.resolveCliCommand()).toEqual({ command: '/opt/claude', args: [] })
    proc.removeAllListeners()
  })

  it('runs the source tree through bun in dev, with macros, features, preload and env-file', () => {
    exists.add(SRC)
    exists.add(PRELOAD)
    exists.add(ENVFILE)

    const r = resolve()

    expect(r.command).toBe('bun')
    expect(r.args[0]).toBe('run')
    expect(r.args).toEqual(expect.arrayContaining(['-d', 'MACRO.VERSION:2.1.888-dev', '--feature', 'BUDDY']))
    expect(r.args).toContain('--preload')
    expect(norm(r.args[r.args.indexOf('--preload') + 1])).toBe(PRELOAD)
    expect(r.args).toContainEqual('--env-file=' + path.join('/engine-root', '.env'))
    expect(norm(r.args[r.args.length - 1])).toBe(SRC)
  })

  it('omits the preload/env-file flags when those files are absent', () => {
    exists.add(SRC)

    const r = resolve()

    expect(r.args).not.toContain('--preload')
    expect(norm(r.args[r.args.length - 1])).toBe(SRC)
  })

  it('prefers the packaged desktop bundle through the bundled bun when it is usable', () => {
    runtime.isPackaged = true
    exists.add(DESKTOP)
    bun.packagedDesktop = '/engine-root/bin/bun'

    const r = resolve()

    expect(r).toEqual({ command: '/engine-root/bin/bun', args: ['run', path.join('/engine-root', 'dist-desktop/cli.js')] })
  })

  it('falls back to Electron-as-Node when the packaged desktop bundle exists but bun does not', () => {
    runtime.isPackaged = true
    exists.add(DESKTOP)
    bun.packagedDesktop = null

    const r = resolve()

    expect(r.command).toBe(process.execPath)
    expect(r.args).toEqual([path.join('/engine-root', 'dist-desktop/cli.js')])
    expect(r.launcherEnv).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('uses the split dist build when there is no desktop bundle', () => {
    runtime.isPackaged = true
    exists.add(DIST)
    bun.dev = '/engine-root/bin/bun'

    const r = resolve()

    expect(r).toEqual({ command: '/engine-root/bin/bun', args: ['run', path.join('/engine-root', 'dist/cli.js')] })
  })

  it('resorts to the source tree in a packaged build missing every compiled artifact', () => {
    runtime.isPackaged = true
    exists.add(SRC)

    const r = resolve()

    expect(r.command).toBe('bun')
    expect(norm(r.args[r.args.length - 1])).toBe(SRC)
  })

  it('falls back to a global claude command when nothing on disk is found', () => {
    runtime.isPackaged = true

    expect(resolve()).toEqual({ command: 'claude', args: [] })
  })
})
