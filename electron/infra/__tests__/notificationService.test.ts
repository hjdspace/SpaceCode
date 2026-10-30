// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: unknown, options: unknown) => void>,
  latest: null as {
    on: (event: string, callback: () => void) => void
    emit: (event: string) => void
  } | null,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  ipcMain: {
    on: vi.fn((channel: string, handler: (event: unknown, options: unknown) => void) => {
      state.handlers[channel] = handler
    }),
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  nativeTheme: { shouldUseDarkColors: false },
  Notification: class {
    private listeners = new Map<string, () => void>()

    static isSupported(): boolean {
      return true
    }

    constructor(_options: unknown) {
      state.latest = this
    }

    on(event: string, callback: () => void): void {
      this.listeners.set(event, callback)
    }

    emit(event: string): void {
      this.listeners.get(event)?.()
    }

    show(): void {}
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
}))

vi.mock('child_process', () => ({ spawn: vi.fn() }))
vi.mock('../logger', () => ({ info: vi.fn(), warn: vi.fn() }))

import { registerNotificationIPCHandlers } from '../notificationService'

describe('notification click routing', () => {
  it('returns the waiting session id to the renderer when the toast is clicked', () => {
    const send = vi.fn()
    const target = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isFocused: () => true,
      isVisible: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      flashFrame: vi.fn(),
      webContents: { send },
    }
    registerNotificationIPCHandlers(() => target as never)

    state.handlers['app:showNotification']?.({}, {
      title: 'Waiting',
      message: 'Approve the tool call',
      sessionId: 'sess-1',
    })
    state.latest?.emit('click')

    expect(target.focus).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('app:notificationClicked', { sessionId: 'sess-1' })
  })
})
