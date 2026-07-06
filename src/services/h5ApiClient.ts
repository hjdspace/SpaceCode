// src/services/h5ApiClient.ts
// H5 模式下的 HTTP REST 客户端 — 替代 Electron IPC 调用

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
    throw new Error(errBody.error || `HTTP ${res.status}`)
  }

  return res.json()
}

export const h5ApiClient = {
  // ── 会话操作 ──
  startSession: (sessionId: string, config: any) =>
    h5Fetch('/api/session/start', { method: 'POST', body: { sessionId, config } }),

  sendMessage: (sessionId: string, content: string, images?: any[]) =>
    h5Fetch('/api/session/send', { method: 'POST', body: { sessionId, content, images } }),

  abort: (sessionId: string) =>
    h5Fetch('/api/session/abort', { method: 'POST', body: { sessionId } }),

  stop: (sessionId: string) =>
    h5Fetch('/api/session/stop', { method: 'POST', body: { sessionId } }),

  submitToolAnswer: (sessionId: string, toolCallId: string, answers: Record<string, string>) =>
    h5Fetch('/api/session/tool-answer', { method: 'POST', body: { sessionId, toolCallId, answers } }),

  skipToolAnswer: (sessionId: string, toolCallId: string) =>
    h5Fetch('/api/session/tool-skip', { method: 'POST', body: { sessionId, toolCallId } }),

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
}
