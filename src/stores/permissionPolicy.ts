import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useSettingsStore } from './settings'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'
import { useChatSessionStore } from './chatSession'
import type { PermissionMode } from '@/shared/channels/claudeCode'

// ============================================================
// Renderer Logger (permissionPolicy store local copy)
// ============================================================
const logger = {
  info: (scope: string, message: string, data?: any) => {
    console.log(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'info', data } })
  },
  warn: (scope: string, message: string, data?: any) => {
    console.warn(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'warn', data } })
  },
  error: (scope: string, message: string, data?: any) => {
    console.error(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'error', data } })
  },
}

export const usePermissionPolicyStore = defineStore('permissionPolicy', () => {
  const settingsStore = useSettingsStore()
  const sessionStore = useChatSessionStore()

  // ── 权限模式状态 ──
  // 真源挂在 Session 上（session.permissionMode），这里只是读写入口 —— 一个会话切模式
  // 不得改写另一个会话正在跑的模式，也不得决定另一个会话下次起来时的模式。
  // settings.permissionMode 退为「会话自己没切过时的初值」。
  const defaultPermissionMode = computed<PermissionMode>(
    () => (settingsStore.permissionMode as PermissionMode) || 'default'
  )

  function getPermissionMode(sessionId?: string | null): PermissionMode {
    return sessionStore.getSession(sessionId)?.permissionMode ?? defaultPermissionMode.value
  }

  async function setPermissionMode(
    sessionId: string | null | undefined,
    mode: PermissionMode,
  ): Promise<void> {
    const claudeCode = api.claudeCode
    const session = sessionStore.getSession(sessionId)

    // 无会话归属（欢迎页、还没建会话）：这只决定后续新会话的初值，打不到任何进程。
    if (!session) {
      if (mode === defaultPermissionMode.value) return
      settingsStore.permissionMode = mode
      try {
        await settingsStore.saveSettings()
      } catch (e) {
        logger.warn('PermissionPolicy', 'setPermissionMode: failed to persist default mode', { error: String(e) })
      }
      return
    }

    // 引擎拒绝时要连「该会话从没主动切过模式」这个状态一起还原。
    const previousMode = session.permissionMode
    session.permissionMode = mode
    sessionStore.saveToStorage()

    if (!claudeCode?.setPermissionMode) {
      logger.warn('PermissionPolicy', `setPermissionMode: IPC not available, updated local state only | mode=${mode}`)
      return
    }

    try {
      logger.info('PermissionPolicy', `setPermissionMode | sessionId=${session.id.slice(0, 8)} | mode=${mode}`)
      await claudeCode.setPermissionMode(session.id, mode)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logger.error('PermissionPolicy', 'setPermissionMode: backend rejected mode switch, reverting UI', { error, previousMode })
      session.permissionMode = previousMode
      sessionStore.saveToStorage()
      if (errMsg.includes('not launched with --dangerously-skip-permissions')) {
        errorHandler.pushToast({
          id: crypto.randomUUID(),
          category: ErrorCategory.CONFIG_ERROR,
          title: '无法切换到完全信任模式',
          message: '当前会话启动时未开启 bypass 权限支持，请新建会话后再试。',
          autoDismiss: true,
          dismissAfter: 5000,
          createdAt: Date.now(),
        })
      }
    }
  }

  return {
    defaultPermissionMode,
    getPermissionMode,
    setPermissionMode,
  }
})
