// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ── mock electron-updater ──
const { autoUpdaterMock, CancellationTokenMock, ipcHandlers, sendToRendererMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    autoDownload: undefined as boolean | undefined,
    autoInstallOnAppQuit: undefined as boolean | undefined,
    disableDifferentialDownload: undefined as boolean | undefined,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
  CancellationTokenMock: class {
    cancel = vi.fn()
  },
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
  sendToRendererMock: vi.fn(),
}))

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
  CancellationToken: CancellationTokenMock,
}))

// ── mock electron ──
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: vi.fn(() => '0.8.1') },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  BrowserWindow: class {},
}))

vi.mock('../logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  initLogger: vi.fn(),
}))

import { initAutoUpdater, registerAutoUpdaterIPC } from '../infra/autoUpdaterService'

function createWindowMock() {
  return {
    isDestroyed: () => false,
    webContents: { send: sendToRendererMock },
  } as any
}

function getHandler(channel: string) {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`IPC handler not registered: ${channel}`)
  return handler
}

/** 触发 update-available 事件（启动自动下载链路） */
function fireUpdateAvailable(version = '0.8.2') {
  const call = autoUpdaterMock.on.mock.calls.find(([event]) => event === 'update-available')
  expect(call).toBeDefined()
  ;(call![1] as (info: unknown) => void)({ version })
}

beforeEach(() => {
  vi.clearAllMocks()
  ipcHandlers.clear()
  registerAutoUpdaterIPC()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('initAutoUpdater', () => {
  it('禁用差量下载：blockmap 多 range 请求不产生 download-progress 事件且 RTT-bound，会导致转圈无进度', () => {
    initAutoUpdater(createWindowMock(), 'fake-token')
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(true)
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('仓库已公开：不调用 setFeedURL，即使环境变量中存在 GH_TOKEN 也不传给 electron-updater', () => {
    initAutoUpdater(createWindowMock(), 'some-expired-token')
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  })

  it('无 token 时也不调用 setFeedURL，回退到 app-update.yml', () => {
    initAutoUpdater(createWindowMock(), null)
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  })
})

describe('update:download handler', () => {
  it('自动下载进行中手动点击下载：失败传播为 { success: false, error }，不再假成功', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    autoUpdaterMock.downloadUpdate.mockRejectedValue(new Error('network unreachable'))

    fireUpdateAvailable()
    // 自动下载进行中 → 用户点击下载按钮
    const pending = getHandler('update:download')()

    // 走完 3 次尝试 + 2 次 30s 重试间隔
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    // 旧代码在这里立即返回 { success: true }，渲染端取消超时保护后无限转圈
    expect(await pending).toEqual({ success: false, error: 'network unreachable' })
  })

  it('下载进行中再次调用复用同一条链路，不会并发发起第二次 downloadUpdate', async () => {
    initAutoUpdater(createWindowMock(), 'fake-token')
    let resolveDownload!: (v: string[]) => void
    autoUpdaterMock.downloadUpdate.mockImplementation(
      () => new Promise((resolve) => { resolveDownload = resolve }),
    )

    const handler = getHandler('update:download')
    const first = handler()
    const second = handler()

    resolveDownload!([])
    const [r1, r2] = await Promise.all([first, second])

    expect(r1).toEqual({ success: true })
    expect(r2).toEqual({ success: true })
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('失败后自动重试，重试成功则不向渲染端报错', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    autoUpdaterMock.downloadUpdate
      .mockRejectedValueOnce(new Error('attempt 1 failed'))
      .mockRejectedValueOnce(new Error('attempt 2 failed'))
      .mockResolvedValueOnce(['/path/to/setup.exe'])

    fireUpdateAvailable()

    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    // 第一次失败 → 等待 30s 后重试
    await vi.advanceTimersByTimeAsync(30_000)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(3)

    const errorSends = sendToRendererMock.mock.calls.filter(([ch]) => ch === 'update:error')
    expect(errorSends).toHaveLength(0)
  })

  it('所有重试失败后向渲染端发 update:error 事件', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    autoUpdaterMock.downloadUpdate.mockRejectedValue(new Error('always failing'))

    fireUpdateAvailable()

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(3)
    const errorSends = sendToRendererMock.mock.calls.filter(([ch]) => ch === 'update:error')
    expect(errorSends.length).toBeGreaterThan(0)
    expect(errorSends[errorSends.length - 1][1]).toContain('always failing')
  })

  it('下载停滞时 5 分钟超时后取消停滞请求并进入重试', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    const tokens: Array<{ cancel: () => void }> = []
    autoUpdaterMock.downloadUpdate.mockImplementation((token?: { cancel: () => void }) => {
      tokens.push(token!)
      return new Promise(() => {})
    })

    fireUpdateAvailable()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    // 超时触发了取消，但重试还没开始
    expect(tokens[0]!.cancel).toHaveBeenCalled()
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2)
  })
})
