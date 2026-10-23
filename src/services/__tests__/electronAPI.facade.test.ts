// @vitest-environment jsdom
/**
 * api 门面三路分发契约（src/services/electronAPI.ts）。
 *
 * `api` 的扁平方法遵循「electronAPI 直通 → _isH5Mode 时委托 h5ApiClient（部分
 * 方法落 localStorage）→ 静默兜底空值」的三路分发，共 55 处。全部按代码形状分
 * 6 个变体，每个变体选代表方法钉住契约，同构方法用 it.each 批量断言兜底值。
 *
 * _context.ts 在模块加载瞬间冻结 window.electronAPI 与 _isH5Mode，且 H5 开启时
 * 有模块级副作用（initH5Connection + createH5Adapter），因此每个用例「先布好
 * window/flag 状态，再动态 import」拿新鲜模块（importFresh），禁止静态 import
 * 被测模块。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initH5Connection } from '@/services/h5ApiClient'

const H = vi.hoisted(() => ({
  h5Flag: false,
  initH5Connection: vi.fn(),
  adapter: {
    updateThinkingLevel: vi.fn(),
    getContextUsage: vi.fn(),
    detectInstalledCli: vi.fn(),
    checkEnvironment: vi.fn(),
    installCli: vi.fn(),
    onInstallProgress: vi.fn(),
    getProxyStatus: vi.fn(),
    isProxyRunning: vi.fn(),
    notifyEngineSourceChanged: vi.fn(),
  },
  h5Mock: {
    readDir: vi.fn(),
    readFile: vi.fn(),
    readFileAsBase64: vi.fn(),
    stat: vi.fn(),
    searchFiles: vi.fn(),
    httpFetch: vi.fn(),
  },
}))

vi.mock('@/services/h5ApiClient', () => ({
  // 真实 isH5Mode 读 URL token 参数且要求非 Electron 环境；测试用 flag 直接
  // 控制，与真实实现的对应关系由用例自担。
  h5ApiClient: H.h5Mock,
  isH5Mode: () => H.h5Flag,
  initH5Connection: H.initH5Connection,
}))
vi.mock('@/services/h5Adapter', () => ({
  // 不 mock 会执行真实 createH5Adapter 的 WebSocket/定时器副作用。
  createH5Adapter: () => H.adapter,
}))

type ApiModule = typeof import('../electronAPI')

function installElectronAPI(overrides: Record<string, unknown> = {}) {
  const electronAPI = { ...overrides }
  ;(window as any).electronAPI = electronAPI
  return electronAPI as any
}

async function importFresh(): Promise<ApiModule> {
  vi.resetModules()
  return await import('../electronAPI')
}

beforeEach(() => {
  vi.resetAllMocks()
  H.h5Flag = false
  delete (window as any).electronAPI
  localStorage.clear()
})

describe('api 三路分发（if-return 直通 / H5 委托 / 静默兜底）', () => {
  it('electronAPI 在场时 readDir 直通并透传参数', async () => {
    const sentinel = [{ name: 'a', path: '/a', isDirectory: false, isFile: true }]
    const electronAPI = installElectronAPI({
      readDir: vi.fn().mockResolvedValue(sentinel),
    })
    const { api } = await importFresh()

    await expect(api.readDir('/w')).resolves.toBe(sentinel)
    expect(electronAPI.readDir).toHaveBeenCalledWith('/w')
  })

  it('electronAPI 在场但方法缺失时仍落入 H5 分支（方法级存在性检查）', async () => {
    installElectronAPI({})
    H.h5Flag = true
    const h5Entry = [{ name: 'h5', path: '/h5', isDirectory: false, isFile: true }]
    H.h5Mock.readDir.mockResolvedValue(h5Entry)
    const { api } = await importFresh()

    await expect(api.readDir('/w')).resolves.toEqual(h5Entry)
    expect(H.initH5Connection).toHaveBeenCalledTimes(1)
  })

  it('双无（无 electronAPI、非 H5）时 readDir 返回空数组', async () => {
    const { api } = await importFresh()
    await expect(api.readDir('/w')).resolves.toEqual([])
  })

  it.each([
    ['readFile', null],
    ['readFileAsBase64', null],
    ['stat', null],
    ['searchFiles', []],
    ['httpFetch', null],
  ] as const)('同构家族 %s 双无时返回兜底值', async (method, expected) => {
    const { api } = await importFresh()
    await expect((api as any)[method]('/a')).resolves.toEqual(expected)
  })

  it.each([
    ['readFile', 'H5-TEXT'],
    ['readFileAsBase64', 'H5-BASE64'],
    ['stat', { size: 1, isDirectory: false, isFile: true, mtime: 1 }],
    ['searchFiles', [{ name: 'x', path: '/x', relativePath: 'x', isDirectory: false, isFile: true }]],
    ['httpFetch', { ok: true, status: 200, data: '' }],
  ] as const)('同构家族 %s H5 模式委托 h5ApiClient', async (method, resolved) => {
    H.h5Flag = true
    H.h5Mock[method].mockResolvedValue(resolved)
    const { api } = await importFresh()

    await expect((api as any)[method]('/a')).resolves.toEqual(resolved)
    expect(H.h5Mock[method]).toHaveBeenCalledTimes(1)
  })
})

describe('api || 兜底式（存在但返回 falsy 仍走兜底）', () => {
  it('sendMessage 直通', async () => {
    const electronAPI = installElectronAPI({
      sendMessage: vi.fn().mockResolvedValue('SENT'),
    })
    const { api } = await importFresh()

    await expect(api.sendMessage('hi')).resolves.toBe('SENT')
    expect(electronAPI.sendMessage).toHaveBeenCalledWith('hi')
  })

  it('sendMessage 缺失时返回 { success: false }', async () => {
    const { api } = await importFresh()
    await expect(api.sendMessage('hi')).resolves.toEqual({ success: false })
  })

  it('sendMessage 返回 falsy 时仍走兜底（钉住 || 语义）', async () => {
    installElectronAPI({ sendMessage: vi.fn() }) // vi.fn() 默认返回 undefined
    const { api } = await importFresh()

    await expect(api.sendMessage('hi')).resolves.toEqual({ success: false })
  })

  it('getAppState 直通', async () => {
    const state = { sessions: ['s'], currentSessionId: 's', theme: 'light' }
    installElectronAPI({ getAppState: vi.fn().mockResolvedValue(state) })
    const { api } = await importFresh()

    await expect(api.getAppState()).resolves.toEqual(state)
  })

  it('getAppState 缺失时返回默认 state', async () => {
    const { api } = await importFresh()
    await expect(api.getAppState()).resolves.toEqual({
      sessions: [],
      currentSessionId: null,
      theme: 'dark',
    })
  })

  it('writeFile 直通', async () => {
    const electronAPI = installElectronAPI({
      writeFile: vi.fn().mockResolvedValue({ success: true }),
    })
    const { api } = await importFresh()

    await expect(api.writeFile('/f', 'c')).resolves.toEqual({ success: true })
    expect(electronAPI.writeFile).toHaveBeenCalledWith('/f', 'c')
  })

  it.each([
    ['writeFile', ['/f', 'c'], { success: false, error: 'writeFile not available' }],
    ['copyFile', ['/a', '/b'], { success: false, error: 'copyFile not available' }],
    ['moveFile', ['/a', '/b'], { success: false, error: 'moveFile not available' }],
    ['renameFile', ['/f', 'n'], { success: false, error: 'renameFile not available' }],
    ['deleteFile', ['/f'], { success: false, error: 'deleteFile not available' }],
  ] as const)('%s 缺失时返回 not-available 兜底', async (method, args, expected) => {
    const { api } = await importFresh()
    await expect((api as any)[method](...args)).resolves.toEqual(expected)
  })
})

describe('api 两路兜底（无 H5 分支的 if-return 家族）', () => {
  it('getAppVersion 直通', async () => {
    installElectronAPI({ getAppVersion: vi.fn().mockResolvedValue('1.2.3') })
    const { api } = await importFresh()

    await expect(api.getAppVersion()).resolves.toBe('1.2.3')
  })

  it.each([
    ['getAppVersion', [], '0.0.0'],
    ['getCwd', [], '/'],
    ['getEnv', ['HOME'], undefined],
    ['ensureDir', ['/d'], false],
    ['ensureDefaultWorkspace', [], ''],
    ['selectFolder', [], { canceled: true, filePaths: [] }],
    ['selectFiles', [], { canceled: true, filePaths: [] }],
    ['openInEditor', ['vscode', '/f'], { success: false, error: 'openInEditor not available' }],
    ['injectGuiModelsToSettings', [{ primaryModel: 'm' }], { success: false, error: 'injectGuiModelsToSettings not available' }],
    ['optimizePrompt', ['p'], { success: false, error: 'Prompt optimizer not available' }],
    ['loadHooksSettings', [], { success: false, data: null, error: 'loadHooksSettings not available' }],
    ['saveHooksSettings', ['{}'], { success: false, error: 'saveHooksSettings not available' }],
    ['getBuiltinHooksRoot', [], { success: false, error: 'getBuiltinHooksRoot not available' }],
    ['checkNode', [], { success: false, error: 'checkNode not available' }],
    ['getTokenUsageStats', [], { success: false, error: 'getTokenUsageStats not available' }],
    ['saveGuiSettings', ['{}'], { success: false, error: 'saveGuiSettings not available' }],
    ['loadGuiSettings', [], { success: false, data: null, error: 'loadGuiSettings not available' }],
    ['profilesLoad', [], { success: false, data: null, error: 'profilesLoad not available' }],
    ['profilesSave', ['{}'], { success: false, error: 'profilesSave not available' }],
  ] as const)('%s 无 electronAPI 时返回兜底值', async (method, args, expected) => {
    const { api } = await importFresh()
    await expect((api as any)[method](...args)).resolves.toEqual(expected)
  })

  it('onMessage 在场时注册回调，缺失时静默返回 undefined', async () => {
    const cb = vi.fn()
    const electronAPI = installElectronAPI({ onMessage: vi.fn() })
    const { api } = await importFresh()

    api.onMessage(cb)
    expect(electronAPI.onMessage).toHaveBeenCalledWith(cb)

    delete (window as any).electronAPI
    const fresh = await importFresh()
    expect(fresh.api.onMessage(cb)).toBeUndefined()
  })
})

describe('api H5 localStorage 分支', () => {
  it('H5 下 saveGuiSettings 写入 claude_desktop_settings 并返回 success', async () => {
    H.h5Flag = true
    const { api } = await importFresh()

    await expect(api.saveGuiSettings('{"k":1}')).resolves.toEqual({ success: true })
    expect(localStorage.getItem('claude_desktop_settings')).toBe('{"k":1}')
  })

  it('H5 下 loadGuiSettings 读取 localStorage，无数据时 data 为 null', async () => {
    H.h5Flag = true
    const { api } = await importFresh()

    await expect(api.loadGuiSettings()).resolves.toEqual({ success: true, data: null })

    localStorage.setItem('claude_desktop_settings', 'seeded')
    await expect(api.loadGuiSettings()).resolves.toEqual({ success: true, data: 'seeded' })
  })

  it('H5 下 profilesSave/profilesLoad 走 spacecode_profiles 往返', async () => {
    H.h5Flag = true
    const { api } = await importFresh()

    await expect(api.profilesSave('{"profiles":[]}')).resolves.toEqual({ success: true })
    await expect(api.profilesLoad()).resolves.toEqual({ success: true, data: '{"profiles":[]}' })
  })

  it('H5 下 profilesBackupCorrupt 跳过备份并返回 success', async () => {
    H.h5Flag = true
    const { api } = await importFresh()

    await expect(api.profilesBackupCorrupt('corrupt')).resolves.toEqual({ success: true })
    expect(localStorage.getItem('spacecode_profiles')).toBeNull()
  })
})

describe('api 嵌套命名空间（electronAPI.claudeCode.*）兜底', () => {
  it.each([
    ['updateThinkingLevel', ['s1', true], 'now'],
    ['getContextUsage', ['s1'], undefined],
    ['detectInstalledCli', [], null],
    ['checkEnvironment', [], null],
    ['installCli', [], null],
    ['getCliUpdateState', [], null],
    ['checkCliUpdate', [], null],
    ['updateCli', [], null],
    ['getProxyStatus', [], null],
    ['isProxyRunning', [], false],
    ['notifyEngineSourceChanged', ['claude'], undefined],
  ] as const)('%s 无 electronAPI 时返回兜底值', async (method, args, expected) => {
    const { api } = await importFresh()
    await expect((api as any)[method](...args)).resolves.toEqual(expected)
  })

  it('claudeCode 桥接在场时 getContextUsage 直通', async () => {
    const getContextUsage = vi.fn().mockResolvedValue({ used: 1 })
    installElectronAPI({ claudeCode: { getContextUsage } })
    const { api } = await importFresh()

    await expect(api.getContextUsage('s1')).resolves.toEqual({ used: 1 })
    expect(getContextUsage).toHaveBeenCalledWith('s1')
  })

  it('onInstallProgress 缺失时返回 noop unsubscribe', async () => {
    const { api } = await importFresh()

    const off = api.onInstallProgress(vi.fn())
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
  })

  it('onInstallProgress 在场时透传回调并委托 unsubscribe', async () => {
    const innerOff = vi.fn()
    const onInstallProgress = vi.fn(() => innerOff)
    installElectronAPI({ claudeCode: { onInstallProgress } })
    const { api } = await importFresh()

    const cb = vi.fn()
    const off = api.onInstallProgress(cb)

    expect(onInstallProgress).toHaveBeenCalledWith(cb)
    expect(off).toBe(innerOff)
  })

  it('preview.getUrl 缺失时返回 null，在场时直通', async () => {
    const { api } = await importFresh()
    await expect(api.preview.getUrl('/f')).resolves.toBeNull()

    installElectronAPI({ preview: { getUrl: vi.fn().mockResolvedValue('http://127.0.0.1:1') } })
    const fresh = await importFresh()
    await expect(fresh.api.preview.getUrl('/f')).resolves.toBe('http://127.0.0.1:1')
  })
})

describe('api getter', () => {
  it('claudeCode：无 electronAPI 且非 H5 时为 null', async () => {
    const { api } = await importFresh()
    expect(api.claudeCode).toBeNull()
  })

  it('claudeCode：非 H5 时返回 electronAPI.claudeCode', async () => {
    const cc = { getContextUsage: vi.fn() }
    installElectronAPI({ claudeCode: cc })
    const { api } = await importFresh()

    expect(api.claudeCode).toBe(cc)
  })

  it('claudeCode：H5 模式返回 h5Adapter 且触发一次 initH5Connection', async () => {
    H.h5Flag = true
    const { api } = await importFresh()

    expect(api.claudeCode).toBe(H.adapter)
    expect(H.initH5Connection).toHaveBeenCalledTimes(1)
  })

  it('claudeCode：H5 与 electronAPI 同时在场时 h5Adapter 优先', async () => {
    const cc = { getContextUsage: vi.fn() }
    installElectronAPI({ claudeCode: cc })
    H.h5Flag = true
    const { api } = await importFresh()

    expect(api.claudeCode).toBe(H.adapter)
  })

  it.each([
    ['image', { readImage: vi.fn() }],
    ['logger', { log: vi.fn() }],
    ['skillManagerV2', { list: vi.fn() }],
  ] as const)('getter %s 在场时直通，缺失时为 null', async (getter, value) => {
    const { api } = await importFresh()
    expect((api as any)[getter]).toBeNull()

    installElectronAPI({ [getter]: value })
    const fresh = await importFresh()
    expect((fresh.api as any)[getter]).toBe(value)
  })
})
