import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'
import { useSettingsStore } from './settings'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'
import { useChatSessionStore } from './chatSession'

type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

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
  const currentPermissionMode = ref<PermissionMode>(
    (settingsStore.permissionMode as PermissionMode) || 'default'
  )

  async function setPermissionMode(mode: PermissionMode): Promise<void> {
    const claudeCode = api.claudeCode
    const sid = sessionStore.currentSessionId
    const previousMode = currentPermissionMode.value

    currentPermissionMode.value = mode

    try {
      settingsStore.permissionMode = mode
      settingsStore.saveSettings()
    } catch (e) {
      logger.warn('PermissionPolicy', 'setPermissionMode: failed to persist preference', { error: String(e) })
    }

    try {
      await api.injectGuiModelsToSettings({
        primaryModel: settingsStore.getPrimaryModel() || '',
        haikuModel: settingsStore.getHaikuModel(),
        sonnetModel: settingsStore.getSonnetModel(),
        opusModel: settingsStore.getOpusModel(),
        permissionMode: mode,
      })
    } catch (e) {
      logger.warn('PermissionPolicy', 'setPermissionMode: failed to write defaultMode to settings.json', { error: String(e) })
    }

    if (sid && claudeCode?.setPermissionMode) {
      try {
        logger.info('PermissionPolicy', `setPermissionMode | sessionId=${sid.slice(0, 8)} | mode=${mode}`)
        await claudeCode.setPermissionMode(sid, mode)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        logger.error('PermissionPolicy', 'setPermissionMode: backend rejected mode switch, reverting UI', { error, previousMode })
        currentPermissionMode.value = previousMode
        try {
          settingsStore.permissionMode = previousMode
          settingsStore.saveSettings()
        } catch {}
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
    } else if (sid) {
      logger.warn('PermissionPolicy', `setPermissionMode: IPC not available, updating local state only | mode=${mode}`)
    }
  }

  return {
    currentPermissionMode: readonly(currentPermissionMode),
    setPermissionMode,
  }
})
