// @vitest-environment node
/**
 * dev 启动闸门。`dist-electron/` 由 dev 与 `npm run build` 共用，正在开机的 dev
 * 实例可能正好撞上 preload.js 不在磁盘上的窗口。沙箱渲染进程对缺失的 preload 只
 * 在 console 报 ENOENT，窗口照样显示 —— 结果是界面没有 contextBridge 却看似加载
 * 成功。这里钉住：Vite 已应答但 preload 缺席时不许导航；文件回来后只导航一次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'

type Mode = 'response' | 'error'

const harness = vi.hoisted(() => ({
  mode: 'response' as Mode,
  requests: 0,
}))

vi.mock('electron', () => {
  class FakeRequest {
    private handlers = new Map<string, Array<() => void>>()

    on(event: string, cb: () => void) {
      const list = this.handlers.get(event) ?? []
      list.push(cb)
      this.handlers.set(event, list)
      return this
    }

    end() {
      harness.requests++
      for (const cb of this.handlers.get(harness.mode) ?? []) cb()
    }
  }

  return {
    app: { isPackaged: false, getPath: () => tmpdir(), on: vi.fn(), whenReady: () => Promise.resolve() },
    BrowserWindow: class {},
    net: { request: () => new FakeRequest() },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
  }
})

const URL = 'http://127.0.0.1:5173'
const INTERVAL = 200

function fakeWindow() {
  const loadURL = vi.fn(() => Promise.resolve())
  return { loadURL, window: { loadURL } as unknown as BrowserWindow }
}

describe('waitForViteAndLoad', () => {
  let dir = ''
  let preloadFile = ''

  beforeEach(() => {
    vi.useFakeTimers()
    harness.mode = 'response'
    harness.requests = 0
    dir = mkdtempSync(join(tmpdir(), 'spacecode-devboot-'))
    preloadFile = join(dir, 'preload.js')
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('navigates at once when the dev server answers and preload exists', async () => {
    writeFileSync(preloadFile, 'module.exports = {}')
    const { waitForViteAndLoad } = await import('../mainWindow')
    const { loadURL, window } = fakeWindow()

    waitForViteAndLoad(window, URL, preloadFile, INTERVAL)

    expect(loadURL).toHaveBeenCalledTimes(1)
    expect(loadURL).toHaveBeenCalledWith(URL)
  })

  it('does not navigate while preload.js is missing, even though Vite answers', async () => {
    const { waitForViteAndLoad } = await import('../mainWindow')
    const { loadURL, window } = fakeWindow()

    waitForViteAndLoad(window, URL, preloadFile, INTERVAL)

    expect(loadURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(INTERVAL)
    expect(harness.requests).toBe(2)
    expect(loadURL).not.toHaveBeenCalled()
  })

  it('navigates once the preload reappears, then stops polling', async () => {
    const { waitForViteAndLoad } = await import('../mainWindow')
    const { loadURL, window } = fakeWindow()

    waitForViteAndLoad(window, URL, preloadFile, INTERVAL)
    expect(loadURL).not.toHaveBeenCalled()

    writeFileSync(preloadFile, 'module.exports = {}')
    vi.advanceTimersByTime(INTERVAL)

    expect(loadURL).toHaveBeenCalledTimes(1)
    const polls = harness.requests
    vi.advanceTimersByTime(INTERVAL * 5)
    expect(harness.requests).toBe(polls)
  })

  it('keeps polling while the dev server is down, then loads in one go', async () => {
    harness.mode = 'error'
    const { waitForViteAndLoad } = await import('../mainWindow')
    const { loadURL, window } = fakeWindow()

    waitForViteAndLoad(window, URL, preloadFile, INTERVAL)
    vi.advanceTimersByTime(INTERVAL * 3)
    expect(loadURL).not.toHaveBeenCalled()
    expect(harness.requests).toBe(4)

    harness.mode = 'response'
    writeFileSync(preloadFile, 'module.exports = {}')
    vi.advanceTimersByTime(INTERVAL)

    expect(loadURL).toHaveBeenCalledTimes(1)
    expect(loadURL).toHaveBeenCalledWith(URL)
  })
})
