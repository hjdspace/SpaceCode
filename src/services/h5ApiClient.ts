// src/services/h5ApiClient.ts
// H5 模式下的 HTTP REST 客户端 — 替代 Electron IPC 调用

import type { EngineAvailability, ExtensionDialogAnswer, ThinkingUpdateTiming } from '@/shared/channels/claudeCode'
import type { EffortLevel } from '@/shared/effort'
import { isEngineBlockedPayload } from '@/shared/engineErrors'

/** H5 连接配置（从 URL query params 解析） */
export interface H5ConnectionConfig {
  baseUrl: string // e.g. http://192.168.1.100:34567
  token: string // h5_xxxx
}

let connectionConfig: H5ConnectionConfig | null = null

/** 从当前 URL 解析 H5 连接配置 */
export function initH5Connection(): H5ConnectionConfig | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (!token) return null

  const protocol = window.location.protocol
  const host = window.location.host
  const baseUrl = `${protocol}//${host}`

  connectionConfig = { baseUrl, token }
  return connectionConfig
}

export function getH5Config(): H5ConnectionConfig | null {
  if (!connectionConfig && typeof window !== 'undefined') {
    initH5Connection()
  }
  return connectionConfig
}

export function isH5Mode(): boolean {
  if (typeof window === 'undefined') return false
  // H5 模式判定：URL 中有 token 参数，且不在 Electron 环境中
  if (window.electronAPI) return false
  return new URLSearchParams(window.location.search).has('token')
}

async function h5Fetch(path: string, options?: {
  method?: string
  body?: Record<string, unknown>
}): Promise<any> {
  const config = getH5Config()
  if (!config) throw new Error('H5 connection not initialized')

  const url = `${config.baseUrl}${path}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.token}`,
  }
  let body: string | undefined
  if (options?.body) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const res = await fetch(url, {
    method: options?.method || 'GET',
    headers,
    body,
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }))
    const message = errBody.error || `HTTP ${res.status}`
    const err = new Error(message)
    // 服务端拦下操作时给的是 reason code（issue #55），带上它才能走 i18n 文案。
    const blocked = { reason: errBody.reason, detail: message }
    if (isEngineBlockedPayload(blocked)) {
      Object.assign(err, { engineBlocked: blocked })
    }
    throw err
  }

  return res.json()
}

export const h5ApiClient = {
  // ── 会话操作 ──
  startSession: (sessionId: string, config: any) =>
    h5Fetch('/api/session/start', { method: 'POST', body: { sessionId, config } }),

  sendMessage: (
    sessionId: string,
    content: string,
    images?: any[],
    meta?: { clientMessageId?: string; displayContent?: string },
  ) =>
    h5Fetch('/api/session/send', {
      method: 'POST',
      body: { sessionId, content, images, ...(meta || {}) },
    }),

  abort: (sessionId: string) =>
    h5Fetch('/api/session/abort', { method: 'POST', body: { sessionId } }),

  stop: (sessionId: string) =>
    h5Fetch('/api/session/stop', { method: 'POST', body: { sessionId } }),

  submitToolAnswer: (sessionId: string, toolCallId: string, answers: Record<string, string>) =>
    h5Fetch('/api/session/tool-answer', { method: 'POST', body: { sessionId, toolCallId, answers } }),

  skipToolAnswer: (sessionId: string, toolCallId: string) =>
    h5Fetch('/api/session/tool-skip', { method: 'POST', body: { sessionId, toolCallId } }),

  respondExtensionDialog: (sessionId: string, dialogId: string, answer: ExtensionDialogAnswer) =>
    h5Fetch('/api/session/extension-dialog/respond', { method: 'POST', body: { sessionId, dialogId, answer } }),

  allowPermission: (
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ) =>
    h5Fetch('/api/session/permission/allow', {
      method: 'POST',
      body: { sessionId, requestId, updatedInput, decisionClassification },
    }),

  denyPermission: (
    sessionId: string,
    requestId: string,
    message?: string,
    options?: { interrupt?: boolean },
  ) =>
    h5Fetch('/api/session/permission/deny', {
      method: 'POST',
      body: { sessionId, requestId, message, options },
    }),

  // ── 挂起 / 恢复（与桌面端共用同一进程池）──
  suspendSession: (sessionId: string) =>
    h5Fetch('/api/session/suspend', { method: 'POST', body: { sessionId } }),

  resumeSession: (sessionId: string): Promise<{ status: unknown }> =>
    h5Fetch('/api/session/resume', { method: 'POST', body: { sessionId } }),

  // ── 会话控制 ──
  setPermissionMode: (sessionId: string, mode: string) =>
    h5Fetch('/api/session/permission-mode', { method: 'POST', body: { sessionId, mode } }),

  setModel: (sessionId: string, model: string | undefined) =>
    h5Fetch('/api/session/model', { method: 'POST', body: { sessionId, model } }),

  updateThinkingLevel: (sessionId: string, enabled: boolean): Promise<{ ok: true; timing: ThinkingUpdateTiming }> =>
    h5Fetch('/api/session/thinking-level', { method: 'POST', body: { sessionId, enabled } }),

  updateEffortLevel: (sessionId: string, level: EffortLevel): Promise<{ ok: true; timing: ThinkingUpdateTiming }> =>
    h5Fetch('/api/session/effort-level', { method: 'POST', body: { sessionId, level } }),

  stopEngineTask: (sessionId: string, taskId: string) =>
    h5Fetch('/api/session/task-stop', { method: 'POST', body: { sessionId, taskId } }),

  // ── 查询 ──
  getMcpStatus: (sessionId: string) =>
    h5Fetch('/api/session/mcp-status', { method: 'POST', body: { sessionId } }),

  getContextUsage: (sessionId: string) =>
    h5Fetch('/api/session/context-usage', { method: 'POST', body: { sessionId } }),

  getSettings: (sessionId: string) =>
    h5Fetch('/api/session/settings', { method: 'POST', body: { sessionId } }),

  getPendingPermissionRequestIds: (sessionId: string): Promise<string[]> =>
    h5Fetch('/api/session/pending-permissions', { method: 'POST', body: { sessionId } }),

  resolveAgentTranscriptPath: (projectPath: string, sessionId: string, agentId: string): Promise<string | null> =>
    h5Fetch('/api/session/agent-transcript', {
      method: 'POST',
      body: { projectPath, sessionId, agentId },
    }),

  findAgentTranscriptByToolUse: (projectPath: string, sessionId: string, toolUseId: string): Promise<string | null> =>
    h5Fetch('/api/session/agent-transcript-by-tool-use', {
      method: 'POST',
      body: { projectPath, sessionId, toolUseId },
    }),

  listAgents: (cwd?: string, engineType?: string) =>
    h5Fetch('/api/agents/list', { method: 'POST', body: { cwd, engineType } }),

  isEngineAvailable: (engineType: string): Promise<EngineAvailability> =>
    h5Fetch('/api/engine/available', { method: 'POST', body: { engineType } }),

  // ── 查询 ──
  getSessionStatus: (sessionId: string) =>
    h5Fetch('/api/session/status', { method: 'POST', body: { sessionId } }),

  getActiveSessions: () =>
    h5Fetch('/api/sessions/active'),

  listProjectSessions: (cwd: string) =>
    h5Fetch(`/api/sessions/list?projectPath=${encodeURIComponent(cwd)}`),

  restoreSession: (sessionId: string, projectPath: string) =>
    h5Fetch(`/api/sessions/history?projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`),

  // ── 镜像会话通知 ──
  setMirrorSession: (sessionId: string | null, projectPath: string | null) =>
    h5Fetch('/api/mirror-session', { method: 'POST', body: { sessionId, projectPath } }),

  httpFetch: (
    url: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: string; error?: string } | null> =>
    h5Fetch('/api/http/fetch', { method: 'POST', body: { url, options } }),

  readDir: (path: string) =>
    h5Fetch('/api/fs/read-dir', { method: 'POST', body: { path } }),

  readFile: (path: string): Promise<string | null> =>
    h5Fetch('/api/fs/read-file', { method: 'POST', body: { path } }),

  readFileAsBase64: (path: string): Promise<string | null> =>
    h5Fetch('/api/fs/read-file-base64', { method: 'POST', body: { path } }),

  /**
   * 设计预览专用源的 URL。由服务端签发：端口 +1 在反向代理 / 隧道下会算错；
   * 失败（无权限、第二源未启用）返回 null，让预览落回 srcdoc 而不是空白 iframe。
   */
  getPreviewFrameUrl: async (filePath: string): Promise<string | null> => {
    try {
      const res = await h5Fetch('/api/preview/grant', { method: 'POST', body: { filePath } })
      return typeof res?.url === 'string' ? res.url : null
    } catch {
      return null
    }
  },

  stat: (path: string) =>
    h5Fetch('/api/fs/stat', { method: 'POST', body: { path } }),

  searchFiles: (path: string, query: string, options?: { maxResults?: number }) =>
    h5Fetch('/api/fs/search-files', { method: 'POST', body: { path, query, options } }),
}
