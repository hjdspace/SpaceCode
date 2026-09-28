// @vitest-environment node
// electron/infra/notificationService 的单元测试。
// electron 模块通过 vi.mock 注入 fake 实现（node 环境下不可用），
// 验证：图标平台解析、通知弹出参数、点击聚焦行为、IPC 注册与参数校验。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const electronMock = vi.hoisted(() => {
  const notificationInstances: Array<{
    opts: Record<string, unknown>
    show: ReturnType<typeof vi.fn>
    on: (event: string, cb: () => void) => void
    emitClick: () => void
  }> = []

  const fakeNotification = vi.fn(function (this: unknown, opts: Record<string, unknown>) {
    let clickHandler: (() => void) | null = null
    const instance = {
      opts,
      show: vi.fn(),
      on: vi.fn((_event: string, cb: () => void) => { clickHandler = cb }),
      emitClick: () => { clickHandler?.() },
    }
    notificationInstances.push(instance)
    return instance
  })
  ;(fakeNotification as any).isSupported = vi.fn(() => true)

  return {
    Notification: fakeNotification,
    notificationInstances,
    nativeImage: {
      createFromPath: vi.fn().mockImplementation((p: string) =>
        p.includes('missing') ? { isEmpty: () => true } : { isEmpty: () => false }
      ),
    },
    BrowserWindow: vi.fn(),
    ipcMain: { on: vi.fn() },
    app: { isPackaged: false },
  }
})

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
}))
const hostPlatform = process.platform

vi.mock('electron', () => ({ default: electronMock, ...electronMock }))
vi.mock('child_process', () => childProcessMock)

// logger 通过 electron 的 app（initLogger）写文件；测试中 mock 掉避免副作用。
vi.mock('@electron/infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// notificationService 用 existsSync 探测图标文件；node 测试环境下项目图标
// 不在 mock 的 __dirname 路径上，统一视为存在，由 nativeImage mock 控制加载成败。
vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }))

import {
  getNotificationIconPath,
  resolveNotificationIconPath,
  showSystemNotification,
  registerNotificationIPCHandlers,
} from '@electron/infra/notificationService'

describe('notificationService', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    electronMock.notificationInstances.length = 0
    electronMock.Notification.mockClear()
    ;(electronMock.Notification as any).isSupported.mockClear().mockImplementation(() => true)
    electronMock.nativeImage.createFromPath.mockClear().mockImplementation((p: string) =>
      p.includes('missing') ? { isEmpty: () => true } : { isEmpty: () => false }
    )
    electronMock.app.isPackaged = false
    vi.mocked(electronMock.ipcMain.on).mockClear()
    childProcessMock.spawn.mockReset()
  })

  describe('getNotificationIconPath', () => {
    it('dev mode resolves to project-root icons/icon.ico', () => {
      // __dirname = electron/infra → ../icons/icon.ico（vite-node 按模块注入各自 __dirname，
      // 不同模块不同值，故只断言平台无关的尾段）。
      expect(getNotificationIconPath().endsWith(join('icons', 'icon.ico'))).toBe(true)
    })

    it('packaged mode resolves to resources/icons/icon.ico', () => {
      const originalResourcesPath = (process as any).resourcesPath
      ;(process as any).resourcesPath = join('/fake', 'resources')
      try {
        electronMock.app.isPackaged = true
        expect(getNotificationIconPath()).toBe(join('/fake', 'resources', 'icons', 'icon.ico'))
      } finally {
        ;(process as any).resourcesPath = originalResourcesPath
      }
    })
  })

  describe('resolveNotificationIconPath', () => {
    it('returns the ico path when it loads as a valid image', () => {
      // Linux 上候选顺序为 [png, ico]；确保只有 .ico 能加载为有效图片，
      // 这样无论运行平台如何，都应返回 .ico 路径。
      electronMock.nativeImage.createFromPath.mockImplementation((p: string) =>
        p.endsWith('.ico') ? { isEmpty: () => false } : { isEmpty: () => true }
      )
      expect(resolveNotificationIconPath()).toBe(getNotificationIconPath())
    })

    it('falls back to undefined when no icon loads (system default icon)', () => {
      electronMock.nativeImage.createFromPath.mockImplementation(() => ({ isEmpty: () => true }))
      expect(resolveNotificationIconPath()).toBeUndefined()
    })
  })

  describe('showSystemNotification', () => {
    it('creates a notification with title/body and app icon', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      const ok = showSystemNotification({ title: 'T', message: 'M' })

      try {
        expect(ok).toBe(true)
        expect(electronMock.Notification).toHaveBeenCalledTimes(1)
        const inst = electronMock.notificationInstances[0]
        expect(inst.opts.title).toBe('T')
        expect(inst.opts.body).toBe('M')
        expect(inst.opts.icon).toBeDefined()
        expect(inst.show).toHaveBeenCalledTimes(1)
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      }
    })

    it('omits icon when no valid icon file resolves', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      electronMock.nativeImage.createFromPath.mockImplementation(() => ({ isEmpty: () => true }))

      try {
        showSystemNotification({ title: 'T', message: 'M' })

        const opts = electronMock.notificationInstances[0].opts
        expect(opts.icon).toBeUndefined()
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      }
    })

    it('returns false when notifications are not supported', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      ;(electronMock.Notification as any).isSupported.mockImplementation(() => false)
      try {
        expect(showSystemNotification({ title: 'T', message: 'M' })).toBe(false)
        expect(electronMock.Notification).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      }
    })

    it('falls back to notify-send on Linux when Electron notifications are unavailable', () => {
      const originalPlatform = hostPlatform
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
      childProcessMock.spawn.mockImplementation((_command: string, _args: string[], _options: unknown) => ({
        once: (_event: string, callback: (code?: number) => void) => {
          if (_event === 'exit') callback(0)
          return undefined
        },
      }))

      try {
        expect(showSystemNotification({ title: 'T', message: 'M' })).toBe(true)
        expect(childProcessMock.spawn).toHaveBeenCalledWith(
          'notify-send',
          expect.arrayContaining(['T', 'M']),
          expect.objectContaining({ stdio: 'ignore' }),
        )
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      }
    })

    it('falls back to gdbus when notify-send is unavailable', async () => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
      const children: Array<{ command: string; emit: (event: string, value?: unknown) => void; once: (event: string, cb: (value?: unknown) => void) => void; kill: ReturnType<typeof vi.fn> }> = []
      childProcessMock.spawn.mockImplementation((command: string) => {
        const listeners = new Map<string, (value?: unknown) => void>()
        const child = {
          command,
          emit: (event: string, value?: unknown) => listeners.get(event)?.(value),
          once: (event: string, cb: (value?: unknown) => void) => { listeners.set(event, cb) },
          kill: vi.fn(),
        }
        children.push(child)
        if (command === 'notify-send') queueMicrotask(() => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })))
        else queueMicrotask(() => child.emit('exit', 0))
        return child
      })

      try {
        expect(showSystemNotification({ title: 'T', message: 'M' })).toBe(true)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(childProcessMock.spawn).toHaveBeenCalledWith('gdbus', expect.any(Array), expect.objectContaining({ stdio: 'ignore' }))
        expect(children.map((child) => child.command)).toEqual(['notify-send', 'gdbus'])
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: hostPlatform })
      }
    })

    it('restores, shows and focuses the window on click', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      const win = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }

      try {
        showSystemNotification({ title: 'T', message: 'M', window: win as any })
        electronMock.notificationInstances[0].emitClick()

        expect(win.restore).toHaveBeenCalledTimes(1)
        expect(win.show).toHaveBeenCalledTimes(1)
        expect(win.focus).toHaveBeenCalledTimes(1)
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      }
    })

    it('skips a destroyed window on click', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      const win = { isDestroyed: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }

      try {
        showSystemNotification({ title: 'T', message: 'M', window: win as any })
        electronMock.notificationInstances[0].emitClick()

        expect(win.show).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
      }
    })
  })

  describe('registerNotificationIPCHandlers', () => {
    it('registers the app:showNotification channel and dispatches valid payloads', () => {
      const getWindow = vi.fn(() => null)
      registerNotificationIPCHandlers(getWindow)

      expect(electronMock.ipcMain.on).toHaveBeenCalledWith('app:showNotification', expect.any(Function))
      const handler = vi.mocked(electronMock.ipcMain.on).mock.calls[0][1] as (e: unknown, o: unknown) => void

      handler({}, { title: 'Hello', message: 'World' })
      expect(electronMock.Notification).toHaveBeenCalledTimes(1)
      expect(electronMock.notificationInstances[0].opts.title).toBe('Hello')
      expect(electronMock.notificationInstances[0].opts.body).toBe('World')
    })

    it('ignores malformed payloads', () => {
      registerNotificationIPCHandlers(() => null)
      const handler = vi.mocked(electronMock.ipcMain.on).mock.calls[0][1] as (e: unknown, o: unknown) => void

      handler({}, null)
      handler({}, { title: 123, message: 'x' })
      handler({}, { title: 'x', message: 456 })

      expect(electronMock.Notification).not.toHaveBeenCalled()
    })
  })
})
