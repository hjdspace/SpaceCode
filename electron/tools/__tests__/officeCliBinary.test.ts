// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'

/**
 * Bundled OfficeCLI binary resolution. The three-level order (bundled →
 * user install → system PATH) decides whether the doc viewer works, and the
 * packaged case must *not* fall through to a system binary — a stray
 * `officecli` on PATH would shadow the version the app was tested with.
 *
 * `process.platform` / `process.arch` are read per call here, so each test
 * stubs them directly instead of reloading the module.
 */

const runtime = vi.hoisted(() => ({
  isPackaged: false,
  appPath: '',
  files: new Set<string>(),
}))

const cp = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawnSync: cp.spawnSync,
  spawn: cp.spawn,
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtime.isPackaged
    },
    getAppPath: () => runtime.appPath,
    getPath: (name: string) => path.join(os.homedir(), name),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {},
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => runtime.files.has(String(p)),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import {
  getOfficeCliBinaryPath,
  getOfficeCliInstallDir,
  getOfficeCliInstalledBinary,
  resolveOfficeCliBinary,
} from '../officeCliService'

const ORIGINAL = {
  platform: process.platform,
  arch: process.arch,
  resourcesPath: (process as { resourcesPath?: string }).resourcesPath,
}

function useRuntime(options: {
  platform: NodeJS.Platform
  arch?: string
  packaged?: boolean
  resourcesPath?: string
  appPath?: string
}): void {
  Object.defineProperty(process, 'platform', { value: options.platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: options.arch ?? 'x64', configurable: true })
  runtime.isPackaged = options.packaged ?? false
  runtime.appPath = options.appPath ?? path.join(process.cwd(), 'app')
  if (options.resourcesPath !== undefined) {
    ;(process as { resourcesPath?: string }).resourcesPath = options.resourcesPath
  }
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL.platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: ORIGINAL.arch, configurable: true })
  ;(process as { resourcesPath?: string }).resourcesPath = ORIGINAL.resourcesPath
})

beforeEach(() => {
  runtime.files.clear()
  cp.spawnSync.mockReset().mockReturnValue({ status: null, stdout: '' })
})

describe('getOfficeCliBinaryPath', () => {
  it('names the win32 binary with an .exe suffix under the dev app path', () => {
    useRuntime({ platform: 'win32', arch: 'x64', appPath: path.join(process.cwd(), 'app') })

    expect(getOfficeCliBinaryPath()).toBe(
      path.join(process.cwd(), 'app', 'resources', 'officecli', 'officecli-win-x64.exe'),
    )
  })

  it('reads from process.resourcesPath when packaged, without the app path', () => {
    const resources = path.join(process.cwd(), 'packed-resources')
    useRuntime({ platform: 'darwin', arch: 'arm64', packaged: true, resourcesPath: resources })

    expect(getOfficeCliBinaryPath()).toBe(path.join(resources, 'officecli', 'officecli-mac-arm64'))
  })

  it('maps any other platform onto the linux naming', () => {
    useRuntime({ platform: 'freebsd', arch: 'x64' })

    expect(path.basename(getOfficeCliBinaryPath())).toBe('officecli-linux-x64')
  })
})

describe('getOfficeCliInstallDir / getOfficeCliInstalledBinary', () => {
  it('places the user-level install under ~/.officecli/bin', () => {
    useRuntime({ platform: 'linux' })

    expect(getOfficeCliInstallDir()).toBe(path.join(os.homedir(), '.officecli', 'bin'))
    expect(getOfficeCliInstalledBinary()).toBe(path.join(os.homedir(), '.officecli', 'bin', 'officecli'))
  })

  it('appends .exe to the user-level binary on Windows only', () => {
    useRuntime({ platform: 'win32' })

    expect(path.basename(getOfficeCliInstalledBinary())).toBe('officecli.exe')
  })
})

describe('resolveOfficeCliBinary', () => {
  it('prefers the bundled binary over a user install', () => {
    useRuntime({ platform: 'linux' })
    const bundled = getOfficeCliBinaryPath()
    runtime.files.add(bundled)
    runtime.files.add(getOfficeCliInstalledBinary())

    expect(resolveOfficeCliBinary()).toBe(bundled)
  })

  it('falls back to the user-level install when the bundle is absent', () => {
    useRuntime({ platform: 'linux' })
    const installed = getOfficeCliInstalledBinary()
    runtime.files.add(installed)

    expect(resolveOfficeCliBinary()).toBe(installed)
  })

  it('skips the system-PATH probe when packaged, so a stray binary cannot shadow the bundle', () => {
    useRuntime({ platform: 'linux', packaged: true, resourcesPath: path.join(process.cwd(), 'packed-resources') })

    // No bundled file and no user install. A dev build would now shell out to
    // find `officecli` on PATH; a packaged build must return null instead.
    expect(resolveOfficeCliBinary()).toBeNull()
    expect(cp.spawnSync).not.toHaveBeenCalled()
  })

  it('probes the system PATH with the platform exe name in dev mode', () => {
    useRuntime({ platform: 'win32' })
    cp.spawnSync.mockReturnValue({ status: 0, stdout: 'officecli 1.2.3' })

    expect(resolveOfficeCliBinary()).toBe('officecli.exe')
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'officecli.exe',
      ['--version'],
      expect.objectContaining({ windowsHide: true, encoding: 'utf-8' }),
    )
  })

  it('rejects a PATH hit whose --version does not exit cleanly', () => {
    useRuntime({ platform: 'linux' })
    cp.spawnSync.mockReturnValue({ status: 1, stdout: 'unknown command' })

    expect(resolveOfficeCliBinary()).toBeNull()
  })

  it('treats a spawn failure during the PATH probe as not found', () => {
    useRuntime({ platform: 'linux' })
    cp.spawnSync.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync officecli ENOENT'), { code: 'ENOENT' })
    })

    expect(resolveOfficeCliBinary()).toBeNull()
  })
})
