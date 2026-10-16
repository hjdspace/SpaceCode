// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import { expectDeclaredInExtraResources, expectPopulatedByReleaseJob, expectScriptProduces } from './packagingContract'

/**
 * cua-driver binary detection. Five levels compete for priority, and the order
 * is the product contract: a user's own install must beat the copy shipped with
 * SpaceCode, while an override that no longer exists must not win.
 *
 *   1. CUA_DRIVER_CMD env override
 *   2. system PATH (where / which)
 *   3. official installer locations (~/.cua-driver/packages/current, plus the
 *      per-platform link dir) — needed because Electron caches PATH at startup,
 *      so a just-installed binary is invisible to `where`/`which`
 *   4. <userData>/bin (copy of the bundled binary)
 *   5. bundled under resources
 *
 * `CUA_DRIVER_BIN` is a module-scope `process.platform` read, so every test
 * loads the module fresh under the platform it wants.
 */

const probe = vi.hoisted(() => ({
  existing: new Set<string>(),
  which: new Map<string, string>(),
  realpaths: new Map<string, string>(),
  versionStdout: new Map<string, string>(),
  versionThrows: new Set<string>(),
  calls: [] as Array<{ cmd: string; args: string[]; options?: unknown }>,
}))

const runtime = vi.hoisted(() => ({
  isPackaged: false,
  userData: '',
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: (cmd: string, args: string[]) => {
    probe.calls.push({ cmd, args })
    const found = probe.which.get(args[0])
    if (!found) throw Object.assign(new Error(`INFO: could not find ${args[0]}`), { status: 1 })
    return found + '\n'
  },
  execFile: (cmd: string, args: string[], options: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    probe.calls.push({ cmd, args, options })
    const err = probe.versionThrows.has(cmd) ? new Error('cua-driver exited with status 1') : null
    setImmediate(() => cb(err, probe.versionStdout.get(cmd) ?? '', ''))
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => probe.existing.has(String(p)),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  realpathSync: (p: string) => {
    const mapped = probe.realpaths.get(String(p))
    if (!mapped) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return mapped
  },
}))

vi.mock('os', () => ({
  homedir: () => path.join(process.cwd(), 'home'),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtime.isPackaged
    },
    getPath: () => runtime.userData,
    getAppPath: () => process.cwd(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => [])
  },
}))

vi.mock('../cuaDriverMcpClient', () => ({
  CuaDriverMcpClient: class {},
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const HOME = path.join(process.cwd(), 'home')
const USER_DATA = path.join(process.cwd(), 'userdata')
const RESOURCES = path.join(process.cwd(), 'packed', 'resources')

const ORIGINAL_PLATFORM = process.platform
const ORIGINAL_RESOURCES = (process as { resourcesPath?: string }).resourcesPath
const ENV_KEYS = ['CUA_DRIVER_CMD', 'LOCALAPPDATA', 'APPDATA'] as const
const savedEnv: Record<string, string | undefined> = {}

type Service = typeof import('../cuaDriverService')

async function loadService(platform: NodeJS.Platform, env: Record<string, string> = {}): Promise<Service> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  return (await import('../cuaDriverService')) as Service
}

/** The module's own bin name for the active platform. */
function binName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
}

function lookupCalls(): Array<{ cmd: string; args: string[] }> {
  return probe.calls.filter((c) => c.cmd === 'where' || c.cmd === 'which')
}

beforeEach(() => {
  probe.existing.clear()
  probe.which.clear()
  probe.realpaths.clear()
  probe.versionStdout.clear()
  probe.versionThrows.clear()
  probe.calls = []
  runtime.isPackaged = false
  runtime.userData = USER_DATA
  // Electron injects process.resourcesPath; under node it is undefined and the
  // packaged branch joins against it.
  ;(process as { resourcesPath?: string }).resourcesPath = RESOURCES
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  ;(process as { resourcesPath?: string }).resourcesPath = ORIGINAL_RESOURCES
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('findCuaDriverBinary — priority', () => {
  it('honours the CUA_DRIVER_CMD override and skips every other strategy', async () => {
    const custom = path.join(process.cwd(), 'tools', 'cua-driver')
    const svc = await loadService('linux', { CUA_DRIVER_CMD: custom })
    probe.existing.add(custom)
    probe.which.set('cua-driver', path.join('/usr', 'bin', 'cua-driver'))

    expect(svc.findCuaDriverBinary()).toBe(custom)
    expect(lookupCalls()).toHaveLength(0)
  })

  it('drops an override that points at a deleted binary instead of trusting it', async () => {
    const svc = await loadService('linux', { CUA_DRIVER_CMD: path.join(process.cwd(), 'gone') })
    const onPath = path.join('/usr', 'local', 'bin', 'cua-driver')
    probe.which.set('cua-driver', onPath)
    probe.existing.add(onPath)

    expect(svc.findCuaDriverBinary()).toBe(onPath)
  })

  it('prefers a PATH hit over the official installer location', async () => {
    const svc = await loadService('linux')
    const onPath = path.join('/usr', 'bin', 'cua-driver')
    const installed = path.join(HOME, '.cua-driver', 'packages', 'current', 'cua-driver')
    probe.which.set('cua-driver', onPath)
    probe.existing.add(onPath)
    probe.existing.add(installed)

    expect(svc.findCuaDriverBinary()).toBe(onPath)
  })

  it('finds a just-installed binary through the installer location when PATH is stale', async () => {
    const svc = await loadService('linux')
    const installed = path.join(HOME, '.cua-driver', 'packages', 'current', 'cua-driver')
    probe.existing.add(installed)

    expect(svc.findCuaDriverBinary()).toBe(installed)
    expect(lookupCalls()).toHaveLength(1)
  })

  it('falls back from a PATH hit that no longer resolves on disk', async () => {
    const svc = await loadService('linux')
    const stale = path.join('/usr', 'bin', 'cua-driver')
    probe.which.set('cua-driver', stale)
    const installed = path.join(HOME, '.cua-driver', 'packages', 'current', 'cua-driver')
    probe.existing.add(installed)

    expect(svc.findCuaDriverBinary()).toBe(installed)
    expect(probe.existing.has(stale)).toBe(false)
  })

  it('checks <userData>/bin before the bundled copy', async () => {
    const svc = await loadService('linux')
    const userBin = path.join(USER_DATA, 'bin', 'cua-driver')
    probe.existing.add(userBin)
    runtime.isPackaged = true
    probe.existing.add(path.join(RESOURCES, 'cua-driver', 'cua-driver'))

    expect(svc.findCuaDriverBinary()).toBe(userBin)
  })

  it('returns null when no strategy finds anything', async () => {
    const svc = await loadService('linux')

    expect(svc.findCuaDriverBinary()).toBeNull()
  })
})

describe('findCuaDriverBinary — per-platform locations', () => {
  it('asks `where` for the .exe name on Windows', async () => {
    const svc = await loadService('win32')
    const onPath = path.join('C:\\', 'tools', 'cua-driver.exe')
    probe.which.set('cua-driver.exe', onPath)
    probe.existing.add(onPath)

    expect(svc.findCuaDriverBinary()).toBe(onPath)
    expect(lookupCalls()).toEqual([{ cmd: 'where', args: ['cua-driver.exe'] }])
  })

  it('uses the installer link dir under %LOCALAPPDATA%\\Programs\\Cua on Windows', async () => {
    const localAppData = path.join(process.cwd(), 'LocalAppData')
    const svc = await loadService('win32', { LOCALAPPDATA: localAppData })
    const link = path.join(localAppData, 'Programs', 'Cua', 'cua-driver', 'bin', binName('win32'))
    probe.existing.add(link)

    expect(svc.findCuaDriverBinary()).toBe(link)
  })

  it('asks `which` for the bare name on posix', async () => {
    const svc = await loadService('linux')
    const onPath = path.join('/opt', 'bin', 'cua-driver')
    probe.which.set('cua-driver', onPath)
    probe.existing.add(onPath)

    expect(svc.findCuaDriverBinary()).toBe(onPath)
    expect(lookupCalls()).toEqual([{ cmd: 'which', args: ['cua-driver'] }])
  })

  /**
   * macOS 走另一套规则：TCC 授权按 CFBundleIdentifier 归属，裸 Mach-O 没有身份。
   * 所以只认标准安装目录里的 CuaDriver.app。退回裸二进制会装出一个永远提示
   * 「未授权」的 Computer Use —— 用户已经在系统设置里把勾打上也不会变绿，
   * 因为那份授权算的是宿主应用，不是驱动。
   */
  describe('macOS resolves only a bundle-resident driver', () => {
    const appBin = path.join('/Applications', 'CuaDriver.app', 'Contents', 'MacOS', 'cua-driver')

    it('uses the driver inside /Applications/CuaDriver.app', async () => {
      const svc = await loadService('darwin')
      probe.existing.add(appBin)

      expect(svc.findCuaDriverBinary()).toBe(appBin)
    })

    it('refuses a bare binary even when PATH and the installer dirs offer one', async () => {
      const svc = await loadService('darwin')
      probe.which.set('cua-driver', path.join('/usr', 'local', 'bin', 'cua-driver'))
      probe.existing.add(path.join(HOME, '.cua-driver', 'packages', 'current', 'cua-driver'))
      runtime.isPackaged = true
      probe.existing.add(path.join(RESOURCES, 'cua-driver', 'cua-driver'))

      expect(svc.findCuaDriverBinary()).toBeNull()
    })

    it('falls back to ~/Applications when /Applications has no bundle', async () => {
      const svc = await loadService('darwin')
      const userApp = path.join(HOME, 'Applications', 'CuaDriver.app', 'Contents', 'MacOS', 'cua-driver')
      probe.existing.add(userApp)

      expect(svc.findCuaDriverBinary()).toBe(userApp)
    })

    it('accepts the ~/.local/bin link because it resolves into the bundle', async () => {
      const svc = await loadService('darwin')
      const link = path.join(HOME, '.local', 'bin', 'cua-driver')
      probe.existing.add(link)
      probe.existing.add(appBin)
      probe.realpaths.set(link, appBin)

      expect(svc.findCuaDriverBinary()).toBe(appBin)
    })

    it('rejects a ~/.local/bin entry that resolves outside any bundle', async () => {
      const svc = await loadService('darwin')
      const link = path.join(HOME, '.local', 'bin', 'cua-driver')
      probe.existing.add(link)
      probe.realpaths.set(link, path.join('/opt', 'tools', 'cua-driver'))

      expect(svc.findCuaDriverBinary()).toBeNull()
    })

    it('still honours an explicit CUA_DRIVER_CMD override verbatim', async () => {
      const custom = path.join(process.cwd(), 'my', 'cua-driver')
      const svc = await loadService('darwin', { CUA_DRIVER_CMD: custom })
      probe.existing.add(custom)

      expect(svc.findCuaDriverBinary()).toBe(custom)
    })
  })

  it('knows the Linux link dir under ~/.local/bin', async () => {
    const svc = await loadService('linux')
    const link = path.join(HOME, '.local', 'bin', 'cua-driver')
    probe.existing.add(link)

    expect(svc.findCuaDriverBinary()).toBe(link)
  })

  it('reads the bundled binary from process.resourcesPath when packaged', async () => {
    const svc = await loadService('linux')
    runtime.isPackaged = true
    const bundled = path.join(RESOURCES, 'cua-driver', 'bin', 'cua-driver')
    probe.existing.add(bundled)

    expect(svc.findCuaDriverBinary()).toBe(bundled)
  })

  it('ships the bundled dir the packaged lookup points at', async () => {
    // A packaged lookup only ever sees process.resourcesPath, so that dir exists in
    // the installer solely because build.extraResources copies it — and the binary is
    // gitignored (*.exe*), so the release workflow has to download it first. A dev run
    // shows neither link: resources/cua-driver is already populated locally.
    const svc = await loadService('linux')
    runtime.isPackaged = true
    const bundled = path.join(RESOURCES, 'cua-driver', 'cua-driver')
    probe.existing.add(bundled)

    const shippedDir = path.relative(RESOURCES, path.dirname(svc.findCuaDriverBinary()!))

    const entry = await expectDeclaredInExtraResources(shippedDir)
    await expectPopulatedByReleaseJob(entry, 'download-cua-driver.mjs')
  })

  it('ships a CuaDriver.app for the macOS bundle lookup to resolve inside', async () => {
    // The darwin lookup only ever accepts <dir>/CuaDriver.app/Contents/MacOS/cua-driver.
    // A dir that merely "is not empty" is how the last release shipped a bare Mach-O:
    // no CFBundleIdentifier, so TCC never attributes the grant to the driver and
    // Computer Use stays red no matter what the user ticks in System Settings.
    const svc = await loadService('linux')
    runtime.isPackaged = true
    const bundled = path.join(RESOURCES, 'cua-driver', 'cua-driver')
    probe.existing.add(bundled)

    const shippedDir = path.relative(RESOURCES, path.dirname(svc.findCuaDriverBinary()!))
    const entry = await expectDeclaredInExtraResources(shippedDir)

    await expectScriptProduces(
      path.join('scripts', 'download-cua-driver.mjs'),
      "appBundle: 'CuaDriver.app'",
    )
    await expectScriptProduces(
      path.join('scripts', 'download-cua-driver.mjs'),
      'bundleOnly: true',
    )
    await expectPopulatedByReleaseJob(entry, 'download-cua-driver.mjs')
  })
})

describe('getCuaDriverVersion', () => {
  const binary = path.join('/opt', 'bin', 'cua-driver')

  it('extracts the semver from the version banner', async () => {
    const svc = await loadService('linux')
    probe.versionStdout.set(binary, 'cua-driver 0.9.4 (rust release)\n')

    await expect(svc.getCuaDriverVersion(binary)).resolves.toBe('0.9.4')
  })

  it('keeps a non-semver banner verbatim rather than reporting null', async () => {
    const svc = await loadService('linux')
    probe.versionStdout.set(binary, 'cua-driver dev-build\n')

    await expect(svc.getCuaDriverVersion(binary)).resolves.toBe('cua-driver dev-build')
  })

  it('reports null for empty output', async () => {
    const svc = await loadService('linux')
    probe.versionStdout.set(binary, '   \n')

    await expect(svc.getCuaDriverVersion(binary)).resolves.toBeNull()
  })

  it('reports null when the binary fails to answer', async () => {
    const svc = await loadService('linux')
    probe.versionThrows.add(binary)

    await expect(svc.getCuaDriverVersion(binary)).resolves.toBeNull()
  })

  it('disables telemetry for the version probe', async () => {
    const svc = await loadService('linux')
    probe.versionStdout.set(binary, '1.0.0\n')

    await svc.getCuaDriverVersion(binary)
    const call = probe.calls.find((c) => c.cmd === binary)
    const options = call?.options as { env: Record<string, string>; timeout: number }

    expect(options.env.CUA_DRIVER_RS_TELEMETRY_ENABLED).toBe('0')
    expect(options.timeout).toBe(8_000)
  })
})
