/**
 * Alt+V 全局热键（issue 04）—— 主进程侧只负责把窗口唤到前台并通知渲染层。
 *
 * 目标输入框的选择完全在渲染层：主进程不读系统前台窗口，也不决定写进哪个输入框。
 */
import { globalShortcut } from 'electron'
import { eventChannels } from '@/shared/channelMap'
import { voiceNamespace, type VoiceShortcutPayload } from '@/shared/channels/voice'

export const VOICE_SHORTCUT_ACCELERATOR = 'Alt+V'

export const VOICE_SHORTCUT_EVENT_CHANNEL =
  eventChannels(voiceNamespace.events, 'voice:').onShortcutToggle

export interface VoiceShortcutWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  isVisible(): boolean
  show(): void
  focus(): void
  webContents: { send(channel: string, ...args: unknown[]): void }
}

/** 先显示、还原并聚焦主窗口，再通知渲染层切换语音输入。 */
function revealAndNotify(win: VoiceShortcutWindow | null): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()

  const payload: VoiceShortcutPayload = { source: 'shortcut' }
  win.webContents.send(VOICE_SHORTCUT_EVENT_CHANNEL, payload)
  return true
}

/** 应用就绪时调用；返回是否成功占用快捷键。 */
export function registerVoiceShortcut(getWindow: () => VoiceShortcutWindow | null): boolean {
  return globalShortcut.register(VOICE_SHORTCUT_ACCELERATOR, () => {
    revealAndNotify(getWindow())
  })
}

/** 退出时调用，与注册成对。 */
export function unregisterVoiceShortcut(): void {
  globalShortcut.unregister(VOICE_SHORTCUT_ACCELERATOR)
}
