// src/services/h5Adapter.ts
// H5 适配器 — 实现 claudeCode 接口，将 IPC 调用替换为 HTTP REST + WebSocket

import { h5ApiClient } from './h5ApiClient'
import { h5WebSocketClient } from './h5WebSocketClient'
import type { ElectronClaudeCodeAPI } from '@/types/electron'

type EventCallback = (data: { sessionId: string; data: any }) => void

/** 显式提示但不中断：桌面端专属能力（H5 无对应入口），调用方为 fire-and-forget */
function h5DesktopOnly(feature: string): Promise<void> {
  console.warn(`该功能仅桌面端支持（H5 调用已忽略）：${feature}`)
  return Promise.resolve()
}

/**
 * 创建 H5 适配器对象，结构与 preload.ts 中的 claudeCode 一致。
 * Stores 通过 api.claudeCode.xxx() 调用这些方法，
 * 在 H5 模式下会被替换为此适配器。
 */
export function createH5Adapter(): ElectronClaudeCodeAPI {
  return {
    // ── 会话生命周期 ──
    startSession: (sessionId: string, config: any) =>
      h5ApiClient.startSession(sessionId, config),

    sendMessage: (
      sessionId: string,
      content: string,
      images?: any[],
      meta?: { clientMessageId?: string; displayContent?: string },
    ) =>
      h5ApiClient.sendMessage(sessionId, content, images, meta),

    abort: (sessionId: string) =>
      h5ApiClient.abort(sessionId),

    stop: (sessionId: string) =>
      h5ApiClient.stop(sessionId),

    // H5: 挂起/恢复走真实引擎（与桌面端共用同一进程池）
    suspendSession: (sessionId: string) => h5ApiClient.suspendSession(sessionId),
    resumeSession: (sessionId: string) => h5ApiClient.resumeSession(sessionId).then(() => undefined),

    // ── 查询 ──
    getSessionStatus: (sessionId: string) =>
      h5ApiClient.getSessionStatus(sessionId),

    getActiveSessions: () =>
      h5ApiClient.getActiveSessions(),

    isSessionActive: async (sessionId?: string) => {
      if (!sessionId) {
        const sessions = await h5ApiClient.getActiveSessions()
        return sessions.length > 0
      }
      const status = await h5ApiClient.getSessionStatus(sessionId)
      return status?.isRunning ?? false
    },

    // ── 工具/权限 ──
    submitToolAnswer: (sessionId: string, toolCallId: string, answers: Record<string, string>) =>
      h5ApiClient.submitToolAnswer(sessionId, toolCallId, answers),

    skipToolAnswer: (sessionId: string, toolCallId: string) =>
      h5ApiClient.skipToolAnswer(sessionId, toolCallId),

    allowPermission: (
      sessionId: string,
      requestId: string,
      updatedInput?: Record<string, unknown>,
      decisionClassification?: 'user_temporary' | 'user_permanent',
    ) =>
      h5ApiClient.allowPermission(sessionId, requestId, updatedInput, decisionClassification),

    denyPermission: (
      sessionId: string,
      requestId: string,
      message?: string,
      options?: { interrupt?: boolean },
    ) =>
      h5ApiClient.denyPermission(sessionId, requestId, message, options),

    // H5 MVP: control_request 协议的 respondPermission 映射到 allow/deny
    respondPermission: async (
      sessionId: string,
      requestId: string,
      decision: any,
    ) => {
      if (decision?.behavior === 'allow') {
        return h5ApiClient.allowPermission(
          sessionId,
          requestId,
          decision.updatedInput,
          decision.decisionClassification,
        )
      } else {
        return h5ApiClient.denyPermission(
          sessionId,
          requestId,
          decision?.message || 'Denied',
          decision?.interrupt ? { interrupt: true } : undefined,
        )
      }
    },

    // H5: 权限模式/模型/思考等级换挡走真实引擎 control_request
    setPermissionMode: (sessionId: string, mode: any) =>
      h5ApiClient.setPermissionMode(sessionId, mode),
    setModel: (sessionId: string, model: string | undefined) =>
      h5ApiClient.setModel(sessionId, model),
    updateThinkingLevel: (sessionId: string, enabled: boolean) =>
      h5ApiClient.updateThinkingLevel(sessionId, enabled),

    // H5: 查询型方法直接取自引擎真实状态
    getMcpStatus: (sessionId: string) => h5ApiClient.getMcpStatus(sessionId),
    getContextUsage: (sessionId: string) => h5ApiClient.getContextUsage(sessionId),
    getSettings: (sessionId: string) => h5ApiClient.getSettings(sessionId),
    stopEngineTask: (sessionId: string, taskId: string) =>
      h5ApiClient.stopEngineTask(sessionId, taskId),
    getPendingPermissionRequestIds: (sessionId: string) =>
      h5ApiClient.getPendingPermissionRequestIds(sessionId),

    // ── 会话历史 ──
    listProjectSessions: (cwd: string) =>
      h5ApiClient.listProjectSessions(cwd),

    listAllSessions: () =>
      h5ApiClient.getActiveSessions(),

    getFullSession: (projectPath: string, sessionId: string) =>
      h5ApiClient.restoreSession(sessionId, projectPath),

    restoreSession: (sessionId: string, projectPath: string) =>
      h5ApiClient.restoreSession(sessionId, projectPath),

    // H5: Agent 相关走服务端真实实现
    listAgents: (cwd?: string, engineType?: string) =>
      h5ApiClient.listAgents(cwd, engineType),
    isEngineAvailable: (engineType: string) =>
      h5ApiClient.isEngineAvailable(engineType).then(r => r.available),
    installPiSdk: () => Promise.resolve({ success: false, error: '该功能暂不支持 H5 模式：installPiSdk' }),

    // H5: CLI 安装/探测是桌面端能力（在桌面宿主上执行），H5 端不做降级假报
    detectInstalledCli: () => Promise.resolve(null),
    checkEnvironment: () => Promise.resolve(null),
    installCli: () => Promise.resolve(null),
    onInstallProgress: (_callback: (progress: any) => void) => () => {},

    // H5: 代理开关 / 引擎来源切换属桌面端设置（H5 下设置面板不渲染）
    getProxyStatus: () => Promise.resolve(null),
    isProxyRunning: () => Promise.resolve(false),
    notifyEngineSourceChanged: (_source: string) => h5DesktopOnly('notifyEngineSourceChanged'),

    // H5: 子代理 transcript 路径由服务端解析
    resolveAgentTranscriptPath: (projectPath: string, sessionId: string, agentId: string) =>
      h5ApiClient.resolveAgentTranscriptPath(projectPath, sessionId, agentId),

    // ── 事件监听（通过 WebSocket）──
    onAssistant: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('assistant', callback),

    onUser: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('user', callback),

    onSystem: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('system', callback),

    onToolUse: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('tool_use', callback),

    onToolResult: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('tool_result', callback),

    onResult: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('result', callback),

    onStreamEvent: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('stream_event', callback),

    onLog: (callback: (data: { sessionId: string; data: string }) => void) =>
      h5WebSocketClient.on('log', callback as EventCallback),

    onExit: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('exit', callback),

    onSuspended: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('suspended', callback),

    onEvictionBlocked: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('eviction_blocked', callback),

    onPermissionRequest: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('permission_request', callback),

    onPermissionRequestCancelled: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('permission_request_cancelled', callback),

    onElicitationRequest: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('elicitation_request', callback),

    onError: (callback: (data: { sessionId: string; data: any }) => void) =>
      h5WebSocketClient.on('error', callback),
  } satisfies ElectronClaudeCodeAPI
}
