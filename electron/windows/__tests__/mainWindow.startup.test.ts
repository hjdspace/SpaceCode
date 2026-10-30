// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeWebContents {
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  session = { setPermissionRequestHandler: vi.fn() }
  send = vi.fn()
  openDevTools = vi.fn()
  reload = vi.fn()

  on(event: string, callback: (...args: unknown[]) => void): this {
    const callbacks = this.handlers.get(event) ?? []
    callbacks.push(callback)
    this.handlers.set(event, callbacks)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const callback of this.handlers.get(event) ?? []) callback(...args)
  }
}

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  options: Electron.BrowserWindowConstructorOptions
  webContents = new FakeWebContents()
  show = vi.fn(() => { this.visible = true })
  focus = vi.fn()
  setIcon = vi.fn()
  loadFile = vi.fn()
  loadURL = vi.fn((_url: string) => {})
  close = vi.fn(() => { this.emit('closed') })
  isDestroyed = vi.fn(() => false)
  isVisible = vi.fn(() => this.visible)
  private visible = false
  private handlers = new Map<string, Array<() => void>>()

  constructor(options: Electron.BrowserWindowConstructorOptions) {
    this.options = options
    FakeBrowserWindow.instances.push(this)
  }

  on(event: string, callback: () => void): this {
    const callbacks = this.handlers.get(event) ?? []
    callbacks.push(callback)
    this.handlers.set(event, callbacks)
    return this
  }

  once(event: string, callback: () => void): this {
    const wrapped = () => {
      const callbacks = this.handlers.get(event) ?? []
      this.handlers.set(event, callbacks.filter(item => item !== wrapped))
      callback()
    }
    return this.on(event, wrapped)
  }

  emit(event: string): void {
    for (const callback of [...(this.handlers.get(event) ?? [])]) callback()
  }
}

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: FakeBrowserWindow,
  net: { request: vi.fn() },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  isDebugMode: () => false,
}))

vi.mock('../../infra/appLifecycle', () => ({
  isQuitting: () => false,
  shouldHideOnWindowClose: () => false,
}))

vi.mock('../iconUtils', () => ({
  getWindowIconPath: () => '/tmp/icon.png',
  loadIconImage: () => ({ isEmpty: () => true }),
}))

vi.mock('../../engine/claudeCodeIPC', () => ({
  setMainWindow: vi.fn(),
  getPool: () => null,
}))

vi.mock('../../genui/sandboxFrameGuard', () => ({
  attachGenuiFrameGuard: () => vi.fn(),
}))

let mainWindow: typeof import('../mainWindow')

beforeAll(async () => {
  mainWindow = await import('../mainWindow')
})

beforeEach(() => {
  FakeBrowserWindow.instances.length = 0
  vi.clearAllMocks()
})

describe('production startup rendering', () => {
  it('keeps the main window hidden after load until its first frame is ready', () => {
    mainWindow.createWindow({ killAll: vi.fn() } as never, vi.fn())
    const window = FakeBrowserWindow.instances[0]

    window.webContents.emit('did-finish-load')
    expect(window.show).not.toHaveBeenCalled()

    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('shows a real loading window in packaged mode', () => {
    mainWindow.createSplashScreen()

    const splash = FakeBrowserWindow.instances[0]
    expect(splash.options.show).toBe(true)
    expect(splash.loadURL).toHaveBeenCalledOnce()
    expect(decodeURIComponent(splash.loadURL.mock.calls[0][0])).toContain('Loading...')
  })
})
