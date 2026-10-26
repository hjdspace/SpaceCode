// @vitest-environment node
/**
 * h5IpcHandlers 的生产契约（此前 0% 覆盖 —— H5 远程访问的安全边界）：
 *
 * 1. 注册面：8 个 h5:* channel 全部挂到 ipcMain.handle。
 * 2. h5:enable：首次调用创建 H5Server 并用 settings.fixedPort 调 start(port)，
 *    registerProjectRoot(lastKnownProjectPath) 重放；二次调用复用实例。
 * 3. h5:disable / h5:regenerateToken：有/无服务器的分支（regenerate 无服务器时
 *    返回默认 inactive 状态）。
 * 4. h5:getStatus 有/无服务器两出口；getSettings / updateSettings 透传。
 * 5. h5:setMirrorSession：projectPath 非空才更新 lastKnownProjectPath；
 *    server 存在时转发 setMirrorSession 并重放项目根。
 * 6. h5:checkBuild：existsSync(dist/index.html) 决定 { built, path }。
 * 7. 直接导出：setH5Server(server/null) 的 applyProjectRoot 行为、getH5Server、
 *    getH5AuthService。
 *
 * lastKnownProjectPath 是模块级 let，无法从外部重置 —— 每个测试用
 * vi.resetModules() + 动态 import 拿到全新模块实例，保证状态隔离。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import type * as H5IpcModule from '../h5IpcHandlers'

const DEFAULT_STATUS = { running: false, port: 0, ip: '', publicUrl: null, connectedClients: 0, sandboxPort: 0, sandboxRunning: false }

function DEFAULT_SETTINGS() {
  return { enabled: false, token: null, tokenPreview: null, publicBaseUrl: null, fixedPort: null, sandboxPort: null }
}

const probe = vi.hoisted(() => {
  const serverMethods = {
    start: vi.fn<(port?: number) => Promise<unknown>>(),
    stop: vi.fn(),
    getStatus: vi.fn(),
    setMirrorSession: vi.fn(),
    registerProjectRoot: vi.fn(),
  }
  const authMethods = {
    enable: vi.fn(),
    disable: vi.fn(),
    regenerateToken: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  }
  class H5ServerMock {
    start = serverMethods.start
    stop = serverMethods.stop
    getStatus = serverMethods.getStatus
    setMirrorSession = serverMethods.setMirrorSession
    registerProjectRoot = serverMethods.registerProjectRoot
    static instances: H5ServerMock[] = []
    constructor() {
      H5ServerMock.instances.push(this)
    }
  }
  class H5AuthServiceMock {
    enable = authMethods.enable
    disable = authMethods.disable
    regenerateToken = authMethods.regenerateToken
    getSettings = authMethods.getSettings
    updateSettings = authMethods.updateSettings
  }
  return {
    handlers: {} as Record<string, (...args: any[]) => any>,
    serverMethods,
    authMethods,
    H5Server: H5ServerMock,
    H5AuthService: H5AuthServiceMock,
    existsSync: vi.fn<(p: string) => boolean>(() => false),
    loggerInfo: vi.fn(),
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      probe.handlers[channel] = handler
    }),
  },
}))

vi.mock('fs', () => ({ existsSync: probe.existsSync }))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: probe.loggerInfo,
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../h5/h5Server', () => ({ H5Server: probe.H5Server }))
vi.mock('../../h5/h5AuthService', () => ({ H5AuthService: probe.H5AuthService }))

/** 当前测试的模块实例（beforeEach 重新导入） */
let mod: typeof H5IpcModule

/** 取已注册的 handler；未注册直接 fail */
function H(channel: string): (...args: any[]) => any {
  const fn = probe.handlers[channel]
  expect(fn, `handler ${channel} 未注册`).toBeTruthy()
  return fn
}

const ev = (): any => ({}) // 本组 handler 不使用 sender

beforeEach(async () => {
  vi.resetModules()
  probe.handlers = {}
  probe.H5Server.instances.length = 0
  for (const fn of Object.values(probe.serverMethods)) fn.mockReset()
  for (const fn of Object.values(probe.authMethods)) fn.mockReset()

  // 默认实现（每个测试可按需覆盖）
  probe.serverMethods.start.mockImplementation(async (port?: number) => ({
    running: true,
    port: port ?? 0,
    ip: '192.168.1.5',
    publicUrl: `http://192.168.1.5:${port ?? 0}`,
    connectedClients: 1,
  }))
  probe.serverMethods.getStatus.mockImplementation(() => DEFAULT_STATUS)
  probe.authMethods.enable.mockImplementation(() => ({
    settings: { enabled: true, token: 'h5_tok', tokenPreview: 'h5_tok', publicBaseUrl: null, fixedPort: null },
    token: 'h5_tok',
  }))
  probe.authMethods.disable.mockImplementation(() => ({ enabled: false }))
  probe.authMethods.regenerateToken.mockImplementation(() => ({
    settings: { enabled: true, token: 'h5_new', tokenPreview: 'h5_new', publicBaseUrl: null, fixedPort: null },
    token: 'h5_new',
  }))
  probe.authMethods.getSettings.mockImplementation(() => DEFAULT_SETTINGS())
  probe.authMethods.updateSettings.mockImplementation((input: unknown) => input)
  probe.existsSync.mockReset().mockReturnValue(false)
  probe.loggerInfo.mockClear()

  // 全新模块实例：h5Server 与 lastKnownProjectPath 均回到初始态
  mod = await import('../h5IpcHandlers')
  mod.registerH5AccessIPCHandlers()
})

describe('注册面', () => {
  it('8 个 h5:* channel 全部注册', () => {
    for (const name of [
      'h5:enable',
      'h5:disable',
      'h5:regenerateToken',
      'h5:getStatus',
      'h5:getSettings',
      'h5:updateSettings',
      'h5:setMirrorSession',
      'h5:checkBuild',
    ]) {
      expect(probe.handlers[name], name).toBeTruthy()
    }
  })
})

describe('h5:enable', () => {
  it('首次调用创建服务器，用 fixedPort 调 start，返回 { status, token }', async () => {
    probe.authMethods.enable.mockImplementation(() => ({
      settings: { enabled: true, token: 'h5_tok', tokenPreview: 'h5_tok', publicBaseUrl: null, fixedPort: 7711 },
      token: 'h5_tok',
    }))
    const status = { running: true, port: 7711, ip: '192.168.1.5', publicUrl: 'http://192.168.1.5:7711', connectedClients: 1 }
    probe.serverMethods.start.mockImplementation(async () => status)

    await expect(H('h5:enable')(ev())).resolves.toEqual({ status, token: 'h5_tok' })
    expect(probe.H5Server.instances).toHaveLength(1)
    expect(probe.serverMethods.start).toHaveBeenCalledWith(7711)
    expect(probe.loggerInfo).toHaveBeenCalled()
  })

  it('fixedPort 为 null 时 start 不带端口', async () => {
    await H('h5:enable')(ev())
    expect(probe.serverMethods.start).toHaveBeenCalledWith(undefined)
  })

  it('二次调用复用已存在的实例，不重复创建', async () => {
    await H('h5:enable')(ev())
    await H('h5:enable')(ev())
    expect(probe.H5Server.instances).toHaveLength(1)
  })

  it('enable 重放 lastKnownProjectPath（先经 setMirrorSession 建立）', async () => {
    await H('h5:setMirrorSession')(ev(), 's1', '/proj')
    await H('h5:enable')(ev())
    expect(mod.getH5Server()!.registerProjectRoot).toHaveBeenCalledWith('/proj')
  })
})

describe('h5:disable', () => {
  it('有服务器时 stop 并禁用 auth', async () => {
    await H('h5:enable')(ev())
    await expect(H('h5:disable')(ev())).resolves.toBeUndefined()
    expect(probe.serverMethods.stop).toHaveBeenCalled()
    expect(probe.authMethods.disable).toHaveBeenCalled()
  })

  it('无服务器时不抛，仍禁用 auth', async () => {
    await expect(H('h5:disable')(ev())).resolves.toBeUndefined()
    expect(probe.serverMethods.stop).not.toHaveBeenCalled()
    expect(probe.authMethods.disable).toHaveBeenCalled()
  })
})

describe('h5:regenerateToken', () => {
  it('有服务器：stop 旧实例、创建新实例并 start，返回新 token', async () => {
    await H('h5:enable')(ev())
    probe.authMethods.regenerateToken.mockImplementation(() => ({
      settings: { enabled: true, token: 'h5_new', tokenPreview: 'h5_new', publicBaseUrl: null, fixedPort: 9000 },
      token: 'h5_new',
    }))
    const status = { running: true, port: 9000, ip: 'x', publicUrl: 'http://x:9000', connectedClients: 0 }
    probe.serverMethods.start.mockImplementation(async () => status)

    await expect(H('h5:regenerateToken')(ev())).resolves.toEqual({ status, token: 'h5_new' })
    expect(probe.serverMethods.stop).toHaveBeenCalled()
    expect(probe.H5Server.instances).toHaveLength(2)
    expect(probe.serverMethods.start).toHaveBeenCalledWith(9000)
  })

  it('无服务器：不创建，返回默认 inactive 状态', async () => {
    await expect(H('h5:regenerateToken')(ev())).resolves.toEqual({ status: DEFAULT_STATUS, token: 'h5_new' })
    expect(probe.H5Server.instances).toHaveLength(0)
  })
})

describe('h5:getStatus / getSettings / updateSettings', () => {
  it('getStatus：有服务器回服务器状态，无服务器回默认（同步返回，非 Promise）', async () => {
    await expect(H('h5:getStatus')(ev())).toEqual(DEFAULT_STATUS)

    const running = { running: true, port: 7711, ip: '192.168.1.5', publicUrl: 'http://192.168.1.5:7711', connectedClients: 1 }
    probe.serverMethods.getStatus.mockImplementation(() => running)
    await H('h5:enable')(ev())
    await expect(H('h5:getStatus')(ev())).toEqual(running)
  })

  it('getSettings 透传 authService（同步返回）', () => {
    expect(H('h5:getSettings')(ev())).toEqual(DEFAULT_SETTINGS())
    expect(probe.authMethods.getSettings).toHaveBeenCalled()
  })

  it('updateSettings 透传输入并返回结果', async () => {
    const input = { fixedPort: 8888 }
    probe.authMethods.updateSettings.mockImplementation((i: unknown) => ({ ...DEFAULT_SETTINGS(), ...(i as object) }))
    await expect(H('h5:updateSettings')(ev(), input)).resolves.toEqual({ ...DEFAULT_SETTINGS(), fixedPort: 8888 })
    expect(probe.authMethods.updateSettings).toHaveBeenCalledWith(input)
  })
})

describe('h5:setMirrorSession', () => {
  it('projectPath 非空：更新 lastKnownProjectPath 并转发 setMirrorSession + 重放项目根', async () => {
    await H('h5:enable')(ev())
    await H('h5:setMirrorSession')(ev(), 's1', '/proj')
    const server = mod.getH5Server()!
    expect(server.setMirrorSession).toHaveBeenCalledWith('s1', '/proj')
    expect(server.registerProjectRoot).toHaveBeenCalledWith('/proj')
  })

  it('projectPath 为 null：不覆盖 lastKnownProjectPath，仍转发 null', async () => {
    await H('h5:enable')(ev())
    await H('h5:setMirrorSession')(ev(), 's1', '/proj')
    const server = mod.getH5Server()!
    vi.mocked(server.setMirrorSession).mockClear()
    vi.mocked(server.registerProjectRoot).mockClear()

    await H('h5:setMirrorSession')(ev(), null, null)
    expect(server.setMirrorSession).toHaveBeenCalledWith(null, null)
    expect(server.registerProjectRoot).toHaveBeenCalledWith('/proj') // 旧值保留并重放
  })

  it('无服务器时仅记录 projectPath（后续 enable 重放）', async () => {
    await H('h5:setMirrorSession')(ev(), 's1', '/proj')
    await H('h5:enable')(ev())
    expect(mod.getH5Server()!.registerProjectRoot).toHaveBeenCalledWith('/proj')
  })
})

describe('h5:checkBuild', () => {
  const distRoot = join(__dirname, '..', '..', 'dist')

  it('dist/index.html 存在 → built:true + 路径', () => {
    probe.existsSync.mockReturnValue(true)
    expect(H('h5:checkBuild')(ev())).toEqual({ built: true, path: distRoot })
  })

  it('dist/index.html 缺失 → built:false', () => {
    expect(H('h5:checkBuild')(ev())).toEqual({ built: false, path: distRoot })
  })
})

describe('直接导出', () => {
  it('getH5Server 初始为 null；setH5Server(server) 生效并对 server 重放项目根（初始 null）', () => {
    expect(mod.getH5Server()).toBeNull()
    const fake = { registerProjectRoot: vi.fn() } as any
    mod.setH5Server(fake)
    expect(mod.getH5Server()).toBe(fake)
    expect(fake.registerProjectRoot).toHaveBeenCalledWith(null) // 全新模块实例 → lastKnownProjectPath 为 null
  })

  it('setH5Server(null) 清空服务器且不抛', () => {
    const fake = { registerProjectRoot: vi.fn() } as any
    mod.setH5Server(fake)
    mod.setH5Server(null)
    expect(mod.getH5Server()).toBeNull()
  })

  it('getH5AuthService 返回模块内单例', () => {
    expect(mod.getH5AuthService()).toBeInstanceOf(probe.H5AuthService)
  })
})
