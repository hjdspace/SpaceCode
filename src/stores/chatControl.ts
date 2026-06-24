import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'
import { useSettingsStore } from './settings'
import { api } from '@/services/electronAPI'
import {
  permissionService,
  type PermissionRequest,
} from '@/services/permissionService'
import { useChatSessionStore } from './chatSession'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'

// 权限模式类型定义
type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

// ============================================================
// Renderer Logger (control store local copy)
// ============================================================
const logger = {
  debug: (scope: string, message: string, data?: any) => {
    console.debug(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'debug', data } })
  },
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

export const useChatControlStore = defineStore('chatControl', () => {
  const settingsStore = useSettingsStore()

  // ── 权限请求状态 ──
  // outer key = sessionId, inner key = toolUseId
  const pendingPermissions = ref<Map<string, Map<string, PermissionRequest>>>(new Map())

  // ── 权限模式状态 ──
  const currentPermissionMode = ref<PermissionMode>(
    (settingsStore.permissionMode as PermissionMode) || 'default'
  )

  // ────────────────────────────────────────────────────────────────────
  // 权限请求订阅（control_request: can_use_tool）
  // ────────────────────────────────────────────────────────────────────
  if (api.claudeCode?.onPermissionRequest) {
    api.claudeCode.onPermissionRequest((evt: { sessionId: string; data: PermissionRequest }) => {
      const sid = evt.sessionId
      const req = evt.data
      if (!req?.toolUseId) {
        logger.warn('ChatStore', `permission_request without toolUseId | sessionId=${sid.slice(0, 8)} | requestId=${req?.requestId}`)
        return
      }
      logger.info('ChatStore', `permission_request | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | toolUseId=${req.toolUseId.slice(0, 8)} | requestId=${req.requestId.slice(0, 8)}`)
      permissionService.addPermissionRequest(sid, { ...req, sessionId: sid })
      pendingPermissions.value = new Map(permissionService.getPendingPermissions())
    })
  }
  if (api.claudeCode?.onPermissionRequestCancelled) {
    api.claudeCode.onPermissionRequestCancelled((evt: { sessionId: string; data: { requestId: string; reason?: string } }) => {
      const sid = evt.sessionId
      const cancelledRequestId = evt.data?.requestId
      if (!cancelledRequestId) return
      logger.info('ChatStore', `permission_request_cancelled | sessionId=${sid.slice(0, 8)} | requestId=${cancelledRequestId.slice(0, 8)} | reason=${evt.data?.reason || '(none)'}`)
      permissionService.removePermissionByRequestId(sid, cancelledRequestId)
      pendingPermissions.value = new Map(permissionService.getPendingPermissions())
    })
  }

  function getPendingPermissionForToolUse(toolUseId: string, sessionId?: string): PermissionRequest | undefined {
    const sessionStore = useChatSessionStore()
    const sid = sessionId ?? sessionStore.currentSessionId
    if (!sid) return undefined
    return pendingPermissions.value.get(sid)?.get(toolUseId)
  }

  function hasPendingPermissionForToolUse(toolUseId: string, sessionId?: string): boolean {
    return !!getPendingPermissionForToolUse(toolUseId, sessionId)
  }

  function consumePermissionFor(toolUseId: string, sessionId: string): PermissionRequest | undefined {
    const req = permissionService.consumePermissionFor(toolUseId, sessionId)
    pendingPermissions.value = new Map(permissionService.getPendingPermissions())
    return req
  }

  async function allowPermission(
    messageId: string,
    toolUseId: string,
    updatedInput: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): Promise<void> {
    const sessionStore = useChatSessionStore()
    const sid = sessionStore.currentSessionId
    if (!sid) return
    const claudeCode = api.claudeCode
    if (!claudeCode?.allowPermission) {
      logger.error('ChatStore', 'allowPermission: claudeCode.allowPermission not available')
      return
    }
    const req = consumePermissionFor(toolUseId, sid)
    if (!req) {
      logger.warn('ChatStore', `allowPermission: no pending request | sessionId=${sid.slice(0, 8)} | toolUseId=${toolUseId.slice(0, 8)}`)
      return
    }
    logger.info('ChatStore', `allowPermission | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)}`)
    try {
      const safeInput = JSON.parse(JSON.stringify(updatedInput)) as Record<string, unknown>
      await claudeCode.allowPermission(sid, req.requestId, safeInput, decisionClassification)
      sessionStore.updateToolCall(messageId, toolUseId, 'completed')
    } catch (error) {
      logger.error('ChatStore', 'allowPermission failed', { error: String(error) })
      throw error
    }
  }

  async function denyPermission(
    messageId: string,
    toolUseId: string,
    message: string = 'User denied',
    options: { interrupt?: boolean } = {},
  ): Promise<void> {
    const sessionStore = useChatSessionStore()
    const sid = sessionStore.currentSessionId
    if (!sid) return
    const claudeCode = api.claudeCode
    if (!claudeCode?.denyPermission) {
      logger.error('ChatStore', 'denyPermission: claudeCode.denyPermission not available')
      return
    }
    const req = consumePermissionFor(toolUseId, sid)
    if (!req) {
      logger.warn('ChatStore', `denyPermission: no pending request | sessionId=${sid.slice(0, 8)} | toolUseId=${toolUseId.slice(0, 8)}`)
      return
    }
    logger.info('ChatStore', `denyPermission | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)} | interrupt=${!!options.interrupt}`)
    try {
      await claudeCode.denyPermission(sid, req.requestId, message, options)
      sessionStore.updateToolCall(messageId, toolUseId, 'completed')
    } catch (error) {
      logger.error('ChatStore', 'denyPermission failed', { error: String(error) })
      throw error
    }
  }

  async function setPermissionMode(mode: PermissionMode): Promise<void> {
    const sessionStore = useChatSessionStore()
    const claudeCode = api.claudeCode
    const sid = sessionStore.currentSessionId
    const previousMode = currentPermissionMode.value

    currentPermissionMode.value = mode

    try {
      settingsStore.permissionMode = mode
      settingsStore.saveSettings()
    } catch (e) {
      logger.warn('ChatStore', 'setPermissionMode: failed to persist preference', { error: String(e) })
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
      logger.warn('ChatStore', 'setPermissionMode: failed to write defaultMode to settings.json', { error: String(e) })
    }

    if (sid && claudeCode?.setPermissionMode) {
      try {
        logger.info('ChatStore', `setPermissionMode | sessionId=${sid.slice(0, 8)} | mode=${mode}`)
        await claudeCode.setPermissionMode(sid, mode)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        logger.error('ChatStore', 'setPermissionMode: backend rejected mode switch, reverting UI', { error, previousMode })
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
      logger.warn('ChatStore', `setPermissionMode: IPC not available, updating local state only | mode=${mode}`)
    }
  }

  return {
    pendingPermissions,
    currentPermissionMode: readonly(currentPermissionMode),
    getPendingPermissionForToolUse,
    hasPendingPermissionForToolUse,
    consumePermissionFor,
    allowPermission,
    denyPermission,
    setPermissionMode,
  }
})
