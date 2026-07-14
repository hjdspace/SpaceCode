// src/services/h5Adapter.ts
// H5 适配器 — 实现 claudeCode 接口，将 IPC 调用替换为 HTTP REST + WebSocket

import { h5ApiClient } from './h5ApiClient'
import { h5WebSocketClient } from './h5WebSocketClient'
import type { ElectronClaudeCodeAPI } from '@/types/electron'

type EventCallback = (data: { sessionId: string; data: any }) => void

/**
 * 创建 H5 适配器对象，结构与 preload.ts 中的 claudeCode 一致。
 * Stores 通过 api.claudeCode.xxx() 调用这些方法，
 * 在 H5 模式下会被替换为此适配器。
 */
export function createH5Adapter() {
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

    // H5 MVP: 挂起/恢复不常用，提供 stub
    suspendSession: (_sessionId: string) => Promise.resolve(),
    resumeSession: (_sessionId: string) => Promise.resolve(),

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

    // H5 MVP: 权限模式切换暂不支持
    setPermissionMode: (_sessionId: string, _mode: any) => Promise.resolve(),
    setModel: (_sessionId: string, _model: string | undefined) => Promise.resolve(),

    // H5 MVP: MCP/Context 查询暂不支持
    getMcpStatus: (_sessionId: string) => Promise.resolve(undefined),
    getContextUsage: (_sessionId: string) => Promise.resolve(undefined),
    getSettings: (_sessionId: string) => Promise.resolve(undefined),
    stopEngineTask: (_sessionId: string, _taskId: string) => Promise.resolve(),
    getPendingPermissionRequestIds: (_sessionId: string) => Promise.resolve([]),

    // ── 会话历史 ──
    listProjectSessions: (cwd: string) =>
      h5ApiClient.listProjectSessions(cwd),

    listAllSessions: () =>
      h5ApiClient.getActiveSessions(),

    getFullSession: (projectPath: string, sessionId: string) =>
      h5ApiClient.restoreSession(sessionId, projectPath),

    restoreSession: (sessionId: string, projectPath: string) =>
      h5ApiClient.restoreSession(sessionId, projectPath),

    // H5 MVP: Agent 相关 stub
    listAgents: (_cwd?: string, _engineType?: string) => Promise.resolve([]),
    isEngineAvailable: (_engineType: string) => Promise.resolve(true),
    installPiSdk: () => Promise.resolve({ success: false, error: 'Not supported in H5 mode' }),
    updateThinkingLevel: (_sessionId: string, _enabled: boolean) => Promise.resolve(),

    // H5 MVP: CLI 相关 stub
    detectInstalledCli: () => Promise.resolve(null),
    checkEnvironment: () => Promise.resolve(null),
    installCli: () => Promise.resolve(null),
    onInstallProgress: (_callback: (progress: any) => void) => () => {},

    // H5 MVP: 代理相关 stub
    getProxyStatus: () => Promise.resolve(null),
    isProxyRunning: () => Promise.resolve(false),
    notifyEngineSourceChanged: (_source: string) => Promise.resolve(),

    // H5 MVP: Agent transcript 暂不支持
    resolveAgentTranscriptPath: (_projectPath: string, _sessionId: string, _agentId: string) =>
      Promise.resolve(null),

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
