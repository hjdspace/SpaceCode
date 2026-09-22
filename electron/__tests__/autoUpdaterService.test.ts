// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ── mock electron-updater ──
const { autoUpdaterMock, CancellationTokenMock, ipcHandlers, sendToRendererMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    autoDownload: undefined as boolean | undefined,
    autoInstallOnAppQuit: undefined as boolean | undefined,
    disableDifferentialDownload: undefined as boolean | undefined,
    allowPrerelease: undefined as boolean | undefined,
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

/** 触发 download-progress 事件（重置当前下载尝试的停滞窗口） */
function fireDownloadProgress() {
  const handlers = autoUpdaterMock.on.mock.calls.filter(([event]) => event === 'download-progress')
  expect(handlers.length).toBeGreaterThan(0)
  for (const [, handler] of handlers) {
    ;(handler as (progress: unknown) => void)({ percent: 10, transferred: 10, total: 100, bytesPerSecond: 1 })
  }
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
  it('差量优先：允许差量下载（小版本只传增量块），并由下载链路在失败时自行回退全量', () => {
    initAutoUpdater(createWindowMock(), 'fake-token')
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(false)
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
  })

  it('显式固定 allowPrerelease=false：避免 prerelease 版本被钉死在 rc channel 收不到稳定版', () => {
    initAutoUpdater(createWindowMock(), 'fake-token')
    expect(autoUpdaterMock.allowPrerelease).toBe(false)
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

/** 可手动结算的 pending promise：用于在测试结束时让链路收尾，避免 downloadChain 泄漏 */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

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

  it('差量尝试 60 秒无进度即取消，置 disableDifferentialDownload 并在 30 秒后回退全量重试', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    const tokens: Array<{ cancel: () => void }> = []
    const attempt2 = createDeferred()
    autoUpdaterMock.downloadUpdate
      .mockImplementationOnce((token?: { cancel: () => void }) => {
        tokens.push(token!)
        return new Promise(() => {}) // 差量尝试挂起
      })
      .mockImplementationOnce(() => attempt2.promise)

    fireUpdateAvailable()

    // 差量尝试挂起：60 秒停滞窗口到点取消
    await vi.advanceTimersByTimeAsync(60_000)
    expect(tokens[0]!.cancel).toHaveBeenCalled()
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(true)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)

    // 30 秒重试间隔后以全量模式重试
    await vi.advanceTimersByTimeAsync(30_000)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2)

    // 收尾：结算链路，避免 downloadChain 泄漏到后续测试
    attempt2.resolve()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('全量尝试 5 分钟无进度取消重试（停滞窗口仅由 download-progress 重置）', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    const tokens: Array<{ cancel: () => void }> = []
    const attempt2 = createDeferred()
    const attempt3 = createDeferred()
    autoUpdaterMock.downloadUpdate
      .mockImplementationOnce(() => Promise.reject(new Error('differential failed')))
      .mockImplementationOnce((token?: { cancel: () => void }) => {
        tokens.push(token!)
        return attempt2.promise
      })
      .mockImplementationOnce(() => attempt3.promise)

    fireUpdateAvailable()

    // 第一次（差量）立即报错 → 回退全量
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(true)

    // 30 秒后开始全量重试（挂起）
    await vi.advanceTimersByTimeAsync(30_000)
    expect(tokens[0]).toBeDefined()

    // 全量停滞窗口 5 分钟：窗口内有 progress 事件 → 计时被重置，不取消
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    fireDownloadProgress()
    await vi.advanceTimersByTimeAsync(59 * 1000)
    expect(tokens[0]!.cancel).not.toHaveBeenCalled()

    // 此后 5 分钟无任何进度 → 取消并进入下一次重试
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(tokens[0]!.cancel).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(3)

    // 收尾
    attempt3.resolve()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('下载正常推进时停滞窗口不断被重置，下载不会被误判为停滞', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    const attempt1 = createDeferred()
    autoUpdaterMock.downloadUpdate.mockImplementation(() => attempt1.promise)

    fireUpdateAvailable()

    // 每 30 秒一个进度事件，持续 5 分钟远超 60 秒窗口也不取消
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_000)
      fireDownloadProgress()
    }
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)

    // 收尾
    attempt1.resolve()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('上一条链路回退全量后，新的下载链路重新尝试差量', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    const differentialFlags: Array<boolean | undefined> = []
    autoUpdaterMock.downloadUpdate.mockImplementation(() => {
      differentialFlags.push(!autoUpdaterMock.disableDifferentialDownload)
      return Promise.reject(new Error('failed'))
    })

    fireUpdateAvailable()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(differentialFlags).toEqual([true, false, false])
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(true)

    // 新链路（如发现下一个新版本）重新从差量开始
    fireUpdateAvailable('0.8.3')
    await vi.advanceTimersByTimeAsync(0)
    expect(differentialFlags[3]).toBe(true)

    // 收尾：推进到第二条链 3 次尝试全部失败，downloadChain 清空，避免泄漏
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(6)
  })
})

describe('update:check handler', () => {
  it('手动检查 15 秒竞速超时后返回失败，不再等 GitHub 挂起连接', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))

    const pending = getHandler('update:check')()
    await vi.advanceTimersByTimeAsync(15_000)

    const result = await pending
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('timed out')
  })

  it('手动检查正常完成返回成功', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    autoUpdaterMock.checkForUpdates.mockResolvedValue(null)

    const result = await getHandler('update:check')()
    expect(result).toEqual({ success: true })
  })

  it('自动检查超时保持静默：不向渲染端发 update:error', async () => {
    vi.useFakeTimers()
    initAutoUpdater(createWindowMock(), 'fake-token')
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}))

    // 启动 30 秒后首次自动检查，8 秒竞速超时
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(8_000)

    const errorSends = sendToRendererMock.mock.calls.filter(([ch]) => ch === 'update:error')
    expect(errorSends).toHaveLength(0)
  })
})
