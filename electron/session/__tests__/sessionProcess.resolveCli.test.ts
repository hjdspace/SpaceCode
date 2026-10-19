// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * CLI launcher resolution. Which command/args we spawn with decides whether the
 * session runs the *bundled* engine, the *installed* official `claude`, or the
 * source tree via bun — and a wrong pick here is an instant ENOENT at launch.
 *
 * The precedence the code implements (and that must not regress):
 *   1. installed CLI path wins outright when the caller supplied one — on Windows a
 *      `.cmd` shim is first swapped for the native exe it forwards to
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
  readFileSync: (p: unknown) => contents.get(norm(String(p))) ?? '{}',
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
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
  syncInstalledOfficeCli: vi.fn(() => ({ copied: false, reason: 'up-to-date', bundledVersion: null, installedVersion: null })),
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
const contents = new Map<string, string>()
const originalPlatform = process.platform

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

const enabledFeatures = (args: string[]) =>
  args.filter((_, i) => args[i - 1] === '--feature')

beforeEach(() => {
  vi.clearAllMocks()
  exists.clear()
  contents.clear()
  runtime.isPackaged = false
  bun.dev = 'bun'
  bun.packagedDesktop = null
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

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

/**
 * CONTEXT_COLLAPSE ships in the engine as an empty stub — `initContextCollapse()` only
 * flips a boolean while every collapse fn returns zeros — yet `shouldAutoCompact` returns
 * false whenever that boolean is set. Spawning the engine with the flag therefore leaves a
 * long context with neither collapsing nor auto-compaction, which is why the engine's own
 * default build keeps it commented out (engine/scripts/defines.ts). The two source-launch
 * paths must not re-enable it.
 *
 * The same file is the authoritative ceiling for the whole hand-copied list: every flag the
 * engine comments out carries a recorded disable reason, and `getFeatureArgs()` re-lighting
 * one reproduces the CONTEXT_COLLAPSE failure mode — silent, discovered only by users. So the
 * copy is checked against the engine rather than against someone's memory. `engine/` is
 * read-only (AGENTS.md); reading it here mutates nothing.
 */
const ENGINE_DEFINES = fileURLToPath(new URL('../../../engine/scripts/defines.ts', import.meta.url))

/** Client-only opt-ins: engine defaults exclude them, product code depends on them. */
const CLIENT_ONLY_FEATURES: string[] = [
  // src/lib/tool-registry.ts advertises the WebBrowser tool on this flag; the engine's tool is a
  // self-contained fetch reader with no Bun-only dependency, so it works under both launchers.
  'WEB_BROWSER_TOOL',
  // electron/skills/skillsService.ts exposes the bundled `claude-api` skill, which the engine
  // registers only under this flag (src/skills/bundled/index.ts).
  'BUILDING_CLAUDE_APPS',
]

function parseDefaultBuildFeatures(source: string): { enabled: string[]; disabled: string[] } {
  const declared = source.slice(source.indexOf('export const DEFAULT_BUILD_FEATURES'))
  const body = declared.slice(declared.indexOf('[') + 1, declared.indexOf(']'))
  const enabled: string[] = []
  const disabled: string[] = []
  for (const line of body.split('\n')) {
    const names = [...line.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1])
    if (/^\s*\/\//.test(line)) disabled.push(...names)
    else enabled.push(...names)
  }
  return { enabled, disabled }
}

async function readEngineFeatures() {
  // 'fs' is mocked away for the launcher under test, so the engine file needs the real one.
  const { readFileSync } = await vi.importActual<typeof import('fs')>('node:fs')
  return parseDefaultBuildFeatures(readFileSync(ENGINE_DEFINES, 'utf8'))
}

describe('resolveCliCommand — feature args', () => {
  it.each([
    { label: 'dev source path', isPackaged: false },
    { label: 'packaged src-fallback path', isPackaged: true },
  ])('omits CONTEXT_COLLAPSE on the $label', ({ isPackaged }) => {
    runtime.isPackaged = isPackaged
    exists.add(SRC)

    const features = enabledFeatures(resolve().args)

    expect(features).toContain('BUDDY')
    expect(features).not.toContain('CONTEXT_COLLAPSE')
  })

  it.each([
    { label: 'dev source path', isPackaged: false },
    { label: 'packaged src-fallback path', isPackaged: true },
  ])('keeps the $label feature list inside the engine default list', async ({ isPackaged }) => {
    runtime.isPackaged = isPackaged
    exists.add(SRC)

    const features = enabledFeatures(resolve().args)
    const { enabled, disabled } = await readEngineFeatures()

    // guards the guard: a parser that silently matched nothing would pass every assertion below
    expect(enabled).toContain('BUDDY')
    expect(disabled).toContain('CONTEXT_COLLAPSE')

    expect(features.filter((f) => disabled.includes(f))).toEqual([])
    expect(features.filter((f) => !enabled.includes(f) && !CLIENT_ONLY_FEATURES.includes(f))).toEqual([])
    // an allowlist entry the engine has since adopted hides real drift — keep it honest
    expect(CLIENT_ONLY_FEATURES.filter((f) => enabled.includes(f))).toEqual([])
  })
})

/**
 * On Windows the installed CLI is npm's `claude.cmd` shim, which can only be spawned
 * through a shell — and a shell *concatenates* args without escaping them, so the
 * multiline `--append-system-prompt` ends the command line at its first newline and
 * every flag after it (`--session-id`, `--resume`, `--mcp-config`, `--thinking`) is
 * silently dropped. The engine then opens a brand-new session on every spawn and no
 * chat ever resumes its history. The shim's real `claude.exe` must be spawned directly.
 */
describe('resolveCliCommand — Windows .cmd launcher', () => {
  const SHIM = 'C:\\tools\\npm\\claude.cmd'
  const EXE = 'C:\\tools\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
  const NPM_SHIM_BODY = [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    `"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*`,
    '',
  ].join('\r\n')

  function resolveInstalled(installedCliPath: string) {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const proc = new SessionProcess('sess-win', {
      cwd: '/tmp/ws',
      engineSource: 'installed',
      installedCliPath,
    } as SessionConfig) as any
    try {
      return proc.resolveCliCommand()
    } finally {
      proc.removeAllListeners()
    }
  }

  it('swaps the npm shim for the native exe it forwards to', () => {
    exists.add(norm(SHIM))
    exists.add(norm(EXE))
    contents.set(norm(SHIM), NPM_SHIM_BODY)

    expect(resolveInstalled(SHIM)).toEqual({ command: EXE, args: [] })
  })

  it('keeps the shim when the exe it forwards to is not actually on disk', () => {
    exists.add(norm(SHIM))
    contents.set(norm(SHIM), NPM_SHIM_BODY)

    expect(resolveInstalled(SHIM)).toEqual({ command: SHIM, args: [] })
  })

  it('keeps the shim when its body does not forward to an exe', () => {
    exists.add(norm(SHIM))
    contents.set(norm(SHIM), '@ECHO off\r\nnode "%~dp0\\cli.js" %*\r\n')

    expect(resolveInstalled(SHIM)).toEqual({ command: SHIM, args: [] })
  })

  it('does not touch a non-shim installed path', () => {
    const exe = 'C:\\tools\\claude.exe'
    exists.add(norm(exe))

    expect(resolveInstalled(exe)).toEqual({ command: exe, args: [] })
  })
})
