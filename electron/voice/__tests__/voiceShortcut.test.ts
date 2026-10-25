// @vitest-environment node
/**
 * Alt+V 全局热键：注册/注销成对，触发时先把主窗口显示、还原并聚焦，
 * 之后才向渲染层发 voice 命名空间的切换事件。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const shortcutMock = vi.hoisted(() => ({
  register: vi.fn<(accelerator: string, handler: () => void) => boolean>(),
  unregister: vi.fn<(accelerator: string) => void>(),
}))

vi.mock('electron', () => ({ globalShortcut: shortcutMock }))

import {
  VOICE_SHORTCUT_ACCELERATOR,
  registerVoiceShortcut,
  unregisterVoiceShortcut,
} from '../voiceShortcut'
import { VOICE_SHORTCUT_EVENT_CHANNEL } from '../voiceShortcut'

interface FakeWindow {
  isDestroyed: Mock<() => boolean>
  isMinimized: Mock<() => boolean>
  restore: Mock<() => void>
  isVisible: Mock<() => boolean>
  show: Mock<() => void>
  focus: Mock<() => void>
  webContents: { send: Mock<(channel: string, ...args: unknown[]) => void> }
}

function fakeWindow(state: {
  destroyed?: boolean
  minimized?: boolean
  visible?: boolean
  order: string[]
}): FakeWindow {
  return {
    isDestroyed: vi.fn<() => boolean>(() => state.destroyed ?? false),
    isMinimized: vi.fn<() => boolean>(() => state.minimized ?? false),
    restore: vi.fn<() => void>(() => {
      state.order.push('restore')
    }),
    isVisible: vi.fn<() => boolean>(() => state.visible ?? true),
    show: vi.fn<() => void>(() => {
      state.order.push('show')
    }),
    focus: vi.fn<() => void>(() => {
      state.order.push('focus')
    }),
    webContents: {
      send: vi.fn<(channel: string, ...args: unknown[]) => void>(() => {
        state.order.push('send')
      }),
    },
  }
}

beforeEach(() => {
  shortcutMock.register.mockReset().mockReturnValue(true)
  shortcutMock.unregister.mockReset()
})

describe('registerVoiceShortcut', () => {
  it('registers Alt+V and unregisters on demand', () => {
    const shortcut = registerVoiceShortcut(() => null)

    expect(shortcut).toBe(true)
    expect(shortcutMock.register).toHaveBeenCalledWith(VOICE_SHORTCUT_ACCELERATOR, expect.any(Function))

    unregisterVoiceShortcut()
    expect(shortcutMock.unregister).toHaveBeenCalledWith(VOICE_SHORTCUT_ACCELERATOR)
  })

  it('restores, shows and focuses a minimized window before notifying the renderer', () => {
    const state = { minimized: true, visible: false, order: [] as string[] }
    const win = fakeWindow(state)

    registerVoiceShortcut(() => win)
    shortcutMock.register.mock.calls[0][1]()

    expect(state.order).toEqual(['restore', 'show', 'focus', 'send'])
    expect(win.webContents.send).toHaveBeenCalledWith(VOICE_SHORTCUT_EVENT_CHANNEL, {
      source: 'shortcut',
    })
  })

  it('only shows a hidden but not minimized window', () => {
    const state = { minimized: false, visible: false, order: [] as string[] }
    const win = fakeWindow(state)
    registerVoiceShortcut(() => win)
    shortcutMock.register.mock.calls[0][1]()

    expect(win.restore).not.toHaveBeenCalled()
    expect(state.order).toEqual(['show', 'focus', 'send'])
  })

  it('does not notify the renderer when the main window is gone', () => {
    const state = { destroyed: true, order: [] as string[] }
    const win = fakeWindow(state)
    registerVoiceShortcut(() => win)
    shortcutMock.register.mock.calls[0][1]()

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(state.order).toEqual([])
  })
})
