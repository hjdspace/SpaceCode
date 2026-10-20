import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted 让 mock 工厂在 resetModules 后重放时仍返回同一个 fn 实例，
// 测试里对 getH5Config 的编排才能作用到新导入的 h5Bootstrap 身上。
const h5ApiMocks = vi.hoisted(() => ({
  getH5Config: vi.fn<() => { baseUrl: string; token: string } | null>(),
}))

vi.mock('../h5ApiClient', () => h5ApiMocks)

type BootstrapModule = typeof import('../h5Bootstrap')

const DESKTOP_CONFIG = {
  guiSettings: '{"theme":"dark"}',
  mirrorSessionId: 'mirror-1',
  mirrorProjectPath: '/proj',
  activeSessions: [],
}

describe('h5Bootstrap', () => {
  let mod: BootstrapModule
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mod = await import('../h5Bootstrap')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('H5 未配置时直接返回 null，不发起请求', async () => {
    h5ApiMocks.getH5Config.mockReturnValue(null)

    await expect(mod.fetchDesktopConfig()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mod.getCachedDesktopConfig()).toBeNull()
    expect(mod.getMirrorSession()).toEqual({ sessionId: null, projectPath: null })
  })

  it('响应非 ok 时返回 null 并记错误日志', async () => {
    h5ApiMocks.getH5Config.mockReturnValue({ baseUrl: 'http://x:1', token: 't' })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(mod.fetchDesktopConfig()).resolves.toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      '[H5Bootstrap] Failed to fetch desktop config:',
      500,
    )
    expect(mod.getCachedDesktopConfig()).toBeNull()
  })

  it('成功时缓存配置并注入 guiSettings 到 localStorage', async () => {
    h5ApiMocks.getH5Config.mockReturnValue({ baseUrl: 'http://x:1', token: 't' })
    const config = { ...DESKTOP_CONFIG }
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(config) })

    await expect(mod.fetchDesktopConfig()).resolves.toBe(config)

    expect(fetchMock).toHaveBeenCalledWith('http://x:1/api/desktop-config', {
      headers: { Authorization: 'Bearer t' },
    })
    expect(mod.getCachedDesktopConfig()).toBe(config)
    expect(localStorage.getItem('claude_desktop_settings')).toBe(config.guiSettings)
    expect(mod.getMirrorSession()).toEqual({
      sessionId: 'mirror-1',
      projectPath: '/proj',
    })
  })

  it('guiSettings 缺失时不写 localStorage，其余缓存照常', async () => {
    h5ApiMocks.getH5Config.mockReturnValue({ baseUrl: 'http://x:1', token: 't' })
    const config = { ...DESKTOP_CONFIG, guiSettings: null }
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(config) })

    await expect(mod.fetchDesktopConfig()).resolves.toBe(config)

    expect(localStorage.getItem('claude_desktop_settings')).toBeNull()
    expect(mod.getCachedDesktopConfig()).toBe(config)
    expect(mod.getMirrorSession()).toEqual({ sessionId: 'mirror-1', projectPath: '/proj' })
  })

  it('fetch reject 时返回 null 不抛出', async () => {
    h5ApiMocks.getH5Config.mockReturnValue({ baseUrl: 'http://x:1', token: 't' })
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    await expect(mod.fetchDesktopConfig()).resolves.toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      '[H5Bootstrap] Error fetching desktop config:',
      expect.any(Error),
    )
  })

  it('getMirrorSession 无缓存时返回空镜像', async () => {
    expect(mod.getMirrorSession()).toEqual({ sessionId: null, projectPath: null })
  })
})
