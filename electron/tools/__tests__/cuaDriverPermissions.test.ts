// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * macOS TCC 读数与就绪聚合。
 *
 * 这两处曾把「读不到」和「被拒绝」压成同一个值，于是用户在系统设置里勾完授权、
 * 回到面板仍然全红 —— 因为驱动跑在没有 CFBundleIdentifier 的裸二进制上，
 * 那份授权算的是宿主应用而不是它。现在：
 *
 * - getPermissionsStatus 透传 CLI 的 screen_recording_capturable 与 source，
 *   source 说明这两个布尔值反映的是谁的身份；解析失败要留下 readError，
 *   不能只给一排 null。
 * - getComputerUseStatus 的 ready 保持三态，null 一路传到 UI 的灰色横幅。
 * - 内置副本的判定用 process.resourcesPath 前缀比对，而不是字面量
 *   'resources/cua-driver' —— 后者只在 Windows 的小写路径上碰巧成立。
 */

const probe = vi.hoisted(() => ({
  existing: new Set<string>(),
  realpaths: new Map<string, string>(),
  /** execFile 的 stdout，按子命令前两个 token 取 */
  stdout: new Map<string, string>(),
  /** 让某个子命令以 err 结束 */
  throws: new Set<string>(),
  calls: [] as Array<{ cmd: string; args: string[] }>,
  /** MCP 客户端被 start/stop 的次数，用来验证「授权后换进程」 */
  started: [] as string[],
  stopped: { count: 0 },
  /** health_report 的 structuredContent：overall 决定 ok，不是 ok 本身 */
  health: { overall: 'ok', checks: [] as unknown[] },
}))

function key(args: string[]): string {
  return args.slice(0, 2).join(' ')
}

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: (cmd: string, args: string[]) => {
    probe.calls.push({ cmd, args })
    throw Object.assign(new Error(`not found: ${args[0]}`), { status: 1 })
  },
  execFile: (
    cmd: string,
    args: string[],
    _options: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    probe.calls.push({ cmd, args })
    const k = key(args)
    const err = probe.throws.has(k) ? new Error(`${k} exited with status 1`) : null
    setImmediate(() => cb(err, probe.stdout.get(k) ?? '', ''))
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
    getPath: () => path.join(process.cwd(), 'userdata'),
    getAppPath: () => process.cwd(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => [])
  },
}))

const runtime = vi.hoisted(() => ({ isPackaged: false }))

vi.mock('../cuaDriverMcpClient', () => ({
  CuaDriverMcpClient: class {
    started = false
    start(binaryPath: string) {
      probe.started.push(binaryPath)
      this.started = true
      return Promise.resolve()
    }
    callTool() {
      return Promise.resolve({ structuredContent: probe.health, data: undefined, isError: false })
    }
    stop() {
      probe.stopped.count += 1
      this.started = false
      return Promise.resolve()
    }
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const HOME = path.join(process.cwd(), 'home')
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

/** macOS 上唯一可接受的驱动位置 */
const APP_BIN = path.join('/Applications', 'CuaDriver.app', 'Contents', 'MacOS', 'cua-driver')

const GRANTED = JSON.stringify({
  accessibility: true,
  screen_recording: true,
  screen_recording_capturable: true,
  source: 'driver-daemon',
})

beforeEach(() => {
  probe.existing.clear()
  probe.realpaths.clear()
  probe.stdout.clear()
  probe.throws.clear()
  probe.calls = []
  probe.started = []
  probe.stopped.count = 0
  probe.health = { overall: 'ok', checks: [] }
  runtime.isPackaged = false
  ;(process as { resourcesPath?: string }).resourcesPath = path.join(process.cwd(), 'packed', 'resources')
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  ;(process as { resourcesPath?: string }).resourcesPath = ORIGINAL_RESOURCES
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('getPermissionsStatus', () => {
  it('carries the live capture probe and the identity the booleans describe', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('permissions status', JSON.stringify({
      accessibility: false,
      screen_recording: true,
      screen_recording_capturable: false,
      source: 'launching-app',
    }))

    const perms = await svc.getPermissionsStatus()

    expect(perms).toEqual({
      accessibility: false,
      screenRecording: true,
      screenRecordingCapturable: false,
      attribution: 'launching-app',
      readError: null,
    })
  })

  it('asks the driver bundle, never a bare binary', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('permissions status', GRANTED)

    await svc.getPermissionsStatus()
    const call = probe.calls.find((c) => key(c.args) === 'permissions status')

    expect(call?.cmd).toBe(APP_BIN)
  })

  it('reports a reason instead of a silent row of nulls when the payload is unreadable', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('permissions status', 'Accessibility: granted\n')

    const perms = await svc.getPermissionsStatus()

    expect(perms.accessibility).toBeNull()
    expect(perms.readError).toBeTruthy()
  })

  it('reports a reason when the command itself fails', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.throws.add('permissions status')

    const perms = await svc.getPermissionsStatus()

    expect(perms.screenRecording).toBeNull()
    expect(perms.readError).toContain('exited with status 1')
  })

  it('stays empty off macOS, where there is no TCC model to read', async () => {
    const svc = await loadService('linux')

    await expect(svc.getPermissionsStatus()).resolves.toEqual({
      accessibility: null,
      screenRecording: null,
      screenRecordingCapturable: null,
      attribution: null,
      readError: null,
    })
  })
})

describe('getComputerUseStatus — ready', () => {
  it('is null, not false, when the grant state could not be read', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('--version undefined', 'cua-driver 0.6.8\n')
    probe.stdout.set('permissions status', 'not json')

    const status = await svc.getComputerUseStatus()

    // false 会被渲染成「未就绪，请去系统设置」，而用户已经去过了 ——
    // 区分这两件事正是这次修复的全部意义。
    expect(status.ready).toBeNull()
  })

  it('is true when both grants hold and health is ok', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('permissions status', GRANTED)

    const status = await svc.getComputerUseStatus()

    expect(status.ready).toBe(true)
  })

  it('is false when the preflight grant belongs to another process', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('permissions status', JSON.stringify({
      accessibility: true,
      screen_recording: true,
      screen_recording_capturable: false,
      source: 'launching-app',
    }))

    const status = await svc.getComputerUseStatus()

    expect(status.ready).toBe(false)
    expect(status.permissions.screenRecordingCapturable).toBe(false)
  })

  it('says the bundle is missing rather than "binary not found"', async () => {
    const svc = await loadService('darwin')

    const status = await svc.getComputerUseStatus()

    expect(status.installed).toBe(false)
    expect(status.error).toContain('CuaDriver.app')
  })
})

describe('grantPermissions', () => {
  /**
   * macOS 的 TCC 判定按进程缓存。授权完成后不换进程，面板就会一直红着——
   * 用户明明勾了开关，看到的还是「请前往系统设置中授权」。这是本次故障里
   * 光靠 bundle 修不掉的那一半。
   */
  it('drops the driver process afterwards so the new grant is read', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.stdout.set('permissions status', GRANTED)
    await svc.getComputerUseStatus()
    expect(probe.started).toHaveLength(1)
    probe.stopped.count = 0

    const result = await svc.grantPermissions()

    expect(result.success).toBe(true)
    expect(probe.stopped.count).toBe(1)
  })

  it('keeps the running process when the grant command failed', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    probe.throws.add('permissions grant')
    await svc.getComputerUseStatus()
    probe.stopped.count = 0

    const result = await svc.grantPermissions()

    expect(result.success).toBe(false)
    expect(probe.stopped.count).toBe(0)
  })
})

describe('runHealthReport', () => {
  it('reuses one process across probes by default', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)

    await svc.runHealthReport()
    await svc.runHealthReport()

    expect(probe.started).toHaveLength(1)
  })

  it('starts a fresh process when asked, which is what the 运行诊断 button does', async () => {
    const svc = await loadService('darwin')
    probe.existing.add(APP_BIN)
    await svc.runHealthReport()

    await svc.runHealthReport({ fresh: true })

    expect(probe.started).toHaveLength(2)
    expect(probe.stopped.count).toBe(1)
  })
})

describe('getBinarySource', () => {
  it('recognises the packaged copy under a capital-R Resources dir', async () => {
    // macOS 的磁盘布局是 Contents/Resources。旧代码比的是字面量
    // join('resources','cua-driver')，小写，只在 Windows 上碰巧对得上，
    // 于是 mac 包里的内置副本被标成「系统」，看着像用户自己装的那份。
    const svc = await loadService('linux')
    runtime.isPackaged = true
    const resources = path.join(process.cwd(), 'SpaceCode.app', 'Contents', 'Resources')
    ;(process as { resourcesPath?: string }).resourcesPath = resources
    const bundled = path.join(resources, 'cua-driver', 'cua-driver')
    probe.existing.add(bundled)
    probe.stdout.set('--version undefined', 'cua-driver 0.6.8\n')

    const status = await svc.getComputerUseStatus()

    expect(status.binaryPath).toBe(bundled)
    expect(status.source).toBe('bundled')
  })

  it('marks the staged macOS bundle as a standalone install', async () => {
    const svc = await loadService('darwin')
    runtime.isPackaged = true
    probe.existing.add(APP_BIN)
    probe.stdout.set('--version undefined', 'cua-driver 0.6.8\n')

    const status = await svc.getComputerUseStatus()

    expect(status.source).toBe('system')
  })
})
