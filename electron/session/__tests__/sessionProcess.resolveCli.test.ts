// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

const requireFromHere = createRequire(import.meta.url)

/**
 * CLI launcher resolution. Which command/args we spawn with decides whether the
 * session runs the *bundled* engine, the *installed* official `claude`, or the
 * source tree via bun — and a wrong pick here is an instant ENOENT at launch.
 *
 * The precedence the code implements (and that must not regress):
 *   1. installed CLI path wins outright when the caller supplied one — on Windows a
 *      `.cmd` shim is first swapped for the native exe it forwards to
 *   2. the single-file `dist-desktop/cli.js` bundle, in dev and packaged alike,
 *      preferring the bundled bun and falling back to Electron-as-Node when bun
 *      looks unusable
 *   3. the split `dist/cli.js` build
 *   4. a bare global `claude` command as a last resort
 *
 * There is deliberately no source-tree launch (`bun run … src/entrypoints/cli.tsx`).
 * It cannot work: Bun resolves the engine's `src/*` tsconfig path aliases from the
 * *process* cwd, while the CLI also takes the session's workspace from
 * `process.cwd()` — the two cwd requirements are mutually exclusive, so any session
 * opened on a real project died with `Cannot find module 'src/bootstrap/state.js'`.
 * The engine has no `--cwd` to relocate the workspace either (`--workspace` only
 * defaults cwd for sessions that omit it). MACRO defines and feature flags are
 * therefore baked in by scripts/build-engine-desktop.cjs, not passed per spawn.
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

  it('runs the desktop bundle in dev even when the engine source tree is present', () => {
    exists.add(SRC)
    exists.add(PRELOAD)
    exists.add(ENVFILE)
    exists.add(DESKTOP)
    bun.packagedDesktop = '/engine-root/bin/bun'

    const r = resolve()

    expect(r).toEqual({ command: '/engine-root/bin/bun', args: ['run', path.join('/engine-root', 'dist-desktop/cli.js')] })
    // 源码启动的三类参数一并消失。-d 尤其不能回来：值未经 JSON 编码时 Bun 会把它
    // 写进内部的 defines.json 并在解析期当场崩（`Unexpected 2.1.888-dev`），侥幸不崩
    // 的版本也只是把 MACRO.VERSION 静默截成数字 2.1。
    expect(r.args).not.toContain('-d')
    expect(r.args).not.toContain('--feature')
    expect(r.args).not.toContain('--preload')
  })

  it('does not launch the source tree when no compiled artifact exists', () => {
    exists.add(SRC)
    exists.add(PRELOAD)
    exists.add(ENVFILE)

    expect(resolve()).toEqual({ command: 'claude', args: [] })
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

  it('falls back to a global claude command when nothing on disk is found', () => {
    runtime.isPackaged = true

    expect(resolve()).toEqual({ command: 'claude', args: [] })
  })
})

/**
 * Feature flags are baked into the bundle at build time now, so the client's only lever is
 * the FEATURE_* set injected by scripts/build-engine-desktop.cjs. CONTEXT_COLLAPSE ships in
 * the engine as an empty stub — `initContextCollapse()` only flips a boolean while every
 * collapse fn returns zeros — yet `shouldAutoCompact` returns false whenever that boolean is
 * set, so re-lighting it leaves a long context with neither collapsing nor auto-compaction.
 * Every flag the engine comments out carries a recorded disable reason, which is why the
 * client's opt-ins are checked against the engine file rather than against someone's memory.
 * `engine/` is read-only (AGENTS.md); reading it here mutates nothing.
 */
const ENGINE_DEFINES = fileURLToPath(new URL('../../../engine/scripts/defines.ts', import.meta.url))

/**
 * Read the opt-in list and its injection off the build script itself. Asserting against a
 * copy here would let the guard and the flags that actually ship drift apart — a hand-copied
 * list drifting from the engine's authoritative one is exactly the failure this file exists
 * to catch.
 */
const { CLIENT_ONLY_FEATURES, withClientFeatureEnv } = requireFromHere('../../../scripts/build-engine-desktop.cjs') as {
  CLIENT_ONLY_FEATURES: string[]
  withClientFeatureEnv: (base: Record<string, string>) => Record<string, string>
}

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

describe('engine build — feature opt-ins', () => {
  it('stays inside the engine default list and never re-lights a disabled flag', async () => {
    const { enabled, disabled } = await readEngineFeatures()

    // guards the guard: a parser that silently matched nothing would pass every assertion below
    expect(enabled).toContain('BUDDY')
    expect(disabled).toContain('CONTEXT_COLLAPSE')

    expect(CLIENT_ONLY_FEATURES.length).toBeGreaterThan(0)
    expect(CLIENT_ONLY_FEATURES.filter((f) => disabled.includes(f))).toEqual([])
    // an opt-in the engine has since adopted by default hides real drift — keep it honest
    expect(CLIENT_ONLY_FEATURES.filter((f) => enabled.includes(f))).toEqual([])
  })

  it('injects every opt-in as FEATURE_* env — the only channel build-desktop.ts reads', () => {
    const env = withClientFeatureEnv({ PATH: '/bin' })

    // 只声明不注入，bundle 里对应的代码会被整段裁掉 —— 名单和构建产物就此脱节。
    expect(env.PATH).toBe('/bin')
    expect(CLIENT_ONLY_FEATURES.length).toBeGreaterThan(0)
    for (const feature of CLIENT_ONLY_FEATURES) {
      expect(env[`FEATURE_${feature}`]).toBe('1')
    }
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
