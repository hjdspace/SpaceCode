/**
 * useVoiceShortcut —— 把主进程的 Alt+V 事件接到跨输入框目标注册表上。
 *
 * 派发规则在 voiceTargetRegistry.dispatchVoiceShortcut 里：录音中停止当前目标，
 * 否则启动最近聚焦的目标，没有可用目标时由这里给出可见提示。
 */
import { onScopeDispose } from 'vue'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { i18n } from '@/i18n'
import { ErrorCategory } from '@/types'
import {
  dispatchVoiceShortcut,
  voiceTargetRegistry,
  type VoiceTargetRegistry,
} from '@/lib/voice/voiceTargetRegistry'
import type { VoiceShortcutPayload } from '@/shared/channels/voice'

export const VOICE_NO_TARGET_TOAST_MS = 4_000

export interface UseVoiceShortcutOptions {
  registry?: VoiceTargetRegistry
  /** 事件订阅接缝；默认走 voice 命名空间的 shortcut-toggle 事件。 */
  subscribe?: (handler: (payload: VoiceShortcutPayload) => void) => () => void
  /** 没有可用输入框时的可见提示接缝。 */
  notifyNoTarget?: () => void
}

function showNoTargetHint(): void {
  errorHandler.pushToast({
    id: crypto.randomUUID(),
    category: ErrorCategory.CONFIG_ERROR,
    title: i18n.global.t('chatInput.voiceNoTargetTitle'),
    message: i18n.global.t('chatInput.voiceNoTarget'),
    autoDismiss: true,
    dismissAfter: VOICE_NO_TARGET_TOAST_MS,
    createdAt: Date.now(),
  })
}

export function useVoiceShortcut(options: UseVoiceShortcutOptions = {}) {
  const registry = options.registry ?? voiceTargetRegistry
  const notifyNoTarget = options.notifyNoTarget ?? showNoTargetHint
  const subscribe = options.subscribe
    ?? ((handler) => api.voice?.onShortcutToggle?.(handler) ?? (() => {}))

  let pending = false

  const unsubscribe = subscribe(async () => {
    // 启动/停止是异步的：连按 Alt+V 不叠加第二次派发。
    if (pending) return
    pending = true
    try {
      const outcome = await dispatchVoiceShortcut(registry)
      if (outcome.kind === 'no-target') notifyNoTarget()
    } finally {
      pending = false
    }
  })

  onScopeDispose(unsubscribe)
}
