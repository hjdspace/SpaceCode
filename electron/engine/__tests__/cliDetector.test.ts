// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'

/**
 * CLI detection layer. These suites pin the two failure modes this module was
 * rewritten around, both of which produce a *false "not installed"* in the UI:
 *
 * 1. Windows `.cmd` shims — `execFile` does not consult PATHEXT, so a bare
 *    command name ENOENTs unless the full path is used with `shell: true`.
 * 2. Lookup order — PATH (`where`/`which`) first, then `npm root -g`, then the
 *    common per-platform bin dirs. A miss in step 1 must fall through, not fail.
 *
 * `isWindows` is read at module scope, so each test imports the module fresh
 * under the platform it wants (see `loadCliDetector`). Paths are always built
 * with the host's `path.join`, so the same assertions hold on win32 and CI.
 */

type ExecResult = { stdout?: string; stderr?: string; error?: Error }
type Call = { command: string; args: string[]; options: { shell?: boolean; timeout?: number } }

const harness = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: (_call: Call): ExecResult => ({ stdout: '' }),
  existing: new Set<string>(),
  openExternal: [] as string[],
}))

vi.mock('child_process', () => ({
  execFile: (
    command: string,
    args: string[],
    options: Call['options'],
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const call: Call = { command, args, options }
    harness.calls.push(call)
    const result = harness.respond(call)
    setImmediate(() => cb(result.error ?? null, result.stdout ?? '', result.stderr ?? ''))
  },
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => harness.existing.has(String(p)),
}))

vi.mock('electron', () => ({
  shell: { openExternal: (url: string) => harness.openExternal.push(url) },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

type Detector = typeof import('../cliDetector')

const ORIGINAL_PLATFORM = process.platform

async function loadCliDetector(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
): Promise<Detector> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return await import('../cliDetector')
}

/** `where claude` / `which claude` */
function lookupResult(stdout: string | null): ExecResult {
  if (stdout === null) return { error: Object.assign(new Error('not found'), { code: 'ENOENT' }) }
  return { stdout }
}

// Windows 的 `where` 走 shell，参数被并进命令行（DEP0190 修复），所以只比对首 token。
const isLookup = (c: Call) => /^(where|which)(\s|$)/.test(c.command)
const isNpmRoot = (c: Call) => c.command === 'npm' && c.args[0] === 'root'
// shell 模式下参数已并入 command、args 为空，两种形态都要认。
const isVersionProbe = (c: Call) => c.args[0] === '--version' || /\s--version$/.test(c.command)

let detector: Detector

beforeEach(() => {
  harness.calls = []
  harness.existing.clear()
  harness.openExternal = []
  harness.respond = () => ({ stdout: '' })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('detectInstalledCli — lookup order', () => {
  it('uses the PATH hit and never touches npm root or the common-path scan', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/opt', 'claude')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { stdout: '1.2.3' }
      return { stdout: '' }
    }

    await expect(detector.detectInstalledCli()).resolves.toEqual({
      available: true,
      path: bin,
      version: '1.2.3',
      versionCompatible: true,
    })
    expect(harness.calls.some(isNpmRoot)).toBe(false)
    expect(harness.existing.size).toBe(0)
  })

  it('falls through to the npm global root when PATH lookup misses', async () => {
    detector = await loadCliDetector('linux')
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    const binLink = path.join(npmRoot, '.bin', 'claude')
    harness.existing.add(path.join(npmRoot, '@anthropic-ai', 'claude-code'))
    harness.existing.add(binLink)
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { stdout: npmRoot }
      if (isVersionProbe(c)) return { stdout: 'claude-code 1.0.45 (Claude Code)' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(binLink)
    // The semver is extracted out of a decorated version banner.
    expect(result.version).toBe('1.0.45')
    expect(result.versionCompatible).toBe(true)
    expect(harness.calls.filter(isNpmRoot)).toHaveLength(1)
  })

  it('falls through to the common-path scan when both PATH and npm global miss', async () => {
    detector = await loadCliDetector('linux')
    // scanCommonPaths resolves the home directory through os.homedir(), so the
    // expectation is built the same way on every host.
    const localBin = path.join(os.homedir(), '.local', 'bin', 'claude')
    harness.existing.add(localBin)
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { stdout: path.join('/nonexistent', 'node_modules') }
      if (isVersionProbe(c)) return { stdout: '2.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(localBin)
    expect(result.versionCompatible).toBe(true)
  })

  it('reports unavailable when every lookup strategy misses', async () => {
    detector = await loadCliDetector('linux')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult('')
      if (isNpmRoot(c)) return { error: new Error('npm not installed') }
      return { stdout: '' }
    }

    await expect(detector.detectInstalledCli()).resolves.toEqual({
      available: false,
      path: null,
      version: null,
    })
  })
})

describe('detectInstalledCli — version compatibility', () => {
  it('marks a below-minimum version incompatible', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/opt', 'claude')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { stdout: '0.9.9' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.available).toBe(true)
    expect(result.version).toBe('0.9.9')
    expect(result.versionCompatible).toBe(false)
  })

  it('marks a detected CLI with an unreadable version incompatible', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/opt', 'claude')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { error: new Error('EACCES') }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    // The path is still reported — the UI needs it to explain what it found.
    expect(result).toEqual({ available: true, path: bin, version: null, versionCompatible: false })
  })

  it('treats a non-semver version string as incompatible instead of throwing', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/opt', 'claude')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { stdout: 'command not recognized' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.version).toBe('command not recognized')
    expect(result.versionCompatible).toBe(false)
  })

  it('accepts the exact minimum version', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/opt', 'claude')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    expect((await detector.detectInstalledCli()).versionCompatible).toBe(true)
  })
})

describe('findInPath — Windows .cmd shims', () => {
  it('prefers the .cmd line over the first hit returned by `where`', async () => {
    detector = await loadCliDetector('win32', { APPDATA: undefined, LOCALAPPDATA: undefined })
    const exe = 'C:\\Program Files\\nodejs\\claude.exe'
    const cmd = 'C:\\Program Files\\nodejs\\claude.cmd'
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult([exe, cmd].join('\r\n'))
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(cmd)
    expect(result.available).toBe(true)
  })

  it('runs .cmd lookups through the shell, which is what keeps execFile from ENOENTing', async () => {
    detector = await loadCliDetector('win32')
    const cmd = path.join(process.cwd(), 'claude.cmd')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(cmd)
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    await detector.detectInstalledCli()
    const versionCall = harness.calls.find(isVersionProbe)
    expect(versionCall?.command).toBe(`${cmd} --version`)
    expect(versionCall?.options.shell).toBe(true)
    // shell 模式下 args 必须为空，否则 Node 抛 DEP0190（参数不转义直接拼接）。
    expect(versionCall?.args).toEqual([])
  })

  it('quotes a shell-routed path that contains spaces', async () => {
    detector = await loadCliDetector('win32')
    const spaced = 'C:\\Program Files\\nodejs\\npx.cmd'
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(spaced)
      if (isVersionProbe(c)) return { stdout: '10.9.2' }
      return { stdout: '' }
    }

    await detector.isCommandAvailable('npx')
    const versionCall = harness.calls.find(isVersionProbe)
    expect(versionCall?.command).toBe(`"${spaced}" --version`)
    expect(versionCall?.options.shell).toBe(true)
  })

  it('does not route a plain posix binary through the shell', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/usr', 'local', 'bin', 'claude')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    await detector.detectInstalledCli()
    const versionCall = harness.calls.find(isVersionProbe)
    expect(versionCall?.command).toBe(bin)
    expect(versionCall?.options.shell).toBe(false)
  })

  it('keeps the first `where` line when no .cmd shim exists', async () => {
    detector = await loadCliDetector('win32')
    const ps1 = path.join(process.cwd(), 'claude.ps1')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(ps1 + '\r\n' + 'C:\\other\\claude.exe')
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(ps1)
  })
})

describe('npm global and common paths', () => {
  it('resolves the bin .cmd shim on Windows, not the package name', async () => {
    detector = await loadCliDetector('win32', { APPDATA: undefined, LOCALAPPDATA: undefined })
    const npmRoot = path.join('C:\\', 'npm', 'global')
    const cmdShim = path.join(npmRoot, 'claude.cmd')
    harness.existing.add(path.join(npmRoot, '@anthropic-ai', 'claude-code'))
    harness.existing.add(cmdShim)
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { stdout: npmRoot }
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(cmdShim)
  })

  it('resolves .bin/<command> although the package directory is named differently', async () => {
    // @anthropic-ai/claude-code installs a `claude` bin. Package name and bin
    // name are separate namespaces, so the existence gate checks one and the
    // executable lookup checks the other.
    detector = await loadCliDetector('linux')
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    const binLink = path.join(npmRoot, '.bin', 'claude')
    harness.existing.add(path.join(npmRoot, '@anthropic-ai', 'claude-code'))
    harness.existing.add(binLink)
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { stdout: npmRoot }
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(binLink)
    expect(result.version).toBe('1.0.0')
  })

  it('reports unavailable when the package is installed but no bin link exists', async () => {
    // The package directory is not executable, so handing it back would report
    // "found" with a path that cannot run. Miss the bin and the caller falls
    // through to the common-path scan, then says unavailable.
    detector = await loadCliDetector('linux')
    const npmRoot = path.join('/usr', 'lib', 'node_modules')
    harness.existing.add(path.join(npmRoot, '@anthropic-ai', 'claude-code'))
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { stdout: npmRoot }
      return { error: new Error('EACCES: permission denied') }
    }

    await expect(detector.detectInstalledCli()).resolves.toEqual({
      available: false,
      path: null,
      version: null,
    })
  })

  it('scans %APPDATA%\\npm on Windows', async () => {
    const appData = path.join(process.cwd(), 'AppData', 'Roaming')
    detector = await loadCliDetector('win32', { APPDATA: appData, LOCALAPPDATA: undefined })
    const shim = path.join(appData, 'npm', 'claude.cmd')
    harness.existing.add(shim)
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { error: new Error('npm missing') }
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(shim)
  })

  it('honours NPM_CONFIG_PREFIX on posix', async () => {
    const prefix = path.join(process.cwd(), 'npm-prefix')
    detector = await loadCliDetector('linux', { NPM_CONFIG_PREFIX: prefix })
    const bin = path.join(prefix, 'bin', 'claude')
    harness.existing.add(bin)
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(null)
      if (isNpmRoot(c)) return { error: new Error('npm missing') }
      if (isVersionProbe(c)) return { stdout: '1.0.0' }
      return { stdout: '' }
    }

    const result = await detector.detectInstalledCli()
    expect(result.path).toBe(bin)
  })
})

describe('checkEnvironment / isCommandAvailable', () => {
  it('probes each dependency with the full path, never the bare command name', async () => {
    detector = await loadCliDetector('linux')
    const nodeBin = path.join('/usr', 'local', 'bin', 'node')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(c.args[0] === 'node' ? nodeBin : null)
      if (isVersionProbe(c)) return { stdout: 'v22.1.0' }
      return { stdout: '' }
    }

    const env = await detector.checkEnvironment()
    expect(env.node).toEqual({ available: true, version: 'v22.1.0', path: nodeBin })
    expect(env.npm.available).toBe(false)
    expect(env.git.available).toBe(false)
    const versionProbes = harness.calls.filter(isVersionProbe)
    expect(versionProbes.map((c) => c.command)).toContain(nodeBin)
    expect(versionProbes.map((c) => c.command)).not.toContain('node')
  })

  it('reports a missing command as unavailable without throwing', async () => {
    detector = await loadCliDetector('linux')
    harness.respond = (c) => (isLookup(c) ? lookupResult(null) : { stdout: '' })

    await expect(detector.isCommandAvailable('uvx')).resolves.toEqual({
      available: false,
      version: null,
      path: null,
    })
  })

  it('reports a command found on PATH but failing --version as unavailable', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/usr', 'bin', 'git')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { error: new Error('git: core.dump crashed') }
      return { stdout: '' }
    }

    await expect(detector.isCommandAvailable('git')).resolves.toEqual({
      available: false,
      version: null,
      path: null,
    })
  })

  it('keeps only the first output line as the reported version', async () => {
    detector = await loadCliDetector('linux')
    const bin = path.join('/usr', 'bin', 'node')
    harness.respond = (c) => {
      if (isLookup(c)) return lookupResult(bin)
      if (isVersionProbe(c)) return { stdout: 'v24.18.0\r\nextra npm hint' }
      return { stdout: '' }
    }

    const status = await detector.isCommandAvailable('node')
    expect(status.version).toBe('v24.18.0')
  })
})
