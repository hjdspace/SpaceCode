/**
 * Trace system type definitions — fully replicated from cc-haha
 * 后端 trace 数据的 TypeScript 类型定义
 */

/** 请求/响应体快照 */
export type TraceBodySnapshot = {
  contentType: 'json' | 'text' | 'empty'
  bytes: number
  sha256: string
  preview: string
  truncated: boolean
}

/** Provider 信息 */
export type TraceProviderInfo = {
  id: string | null
  name: string
  format: string
}

/** 调用状态 */
export type TraceCallStatus = 'pending' | 'ok' | 'error'
export type TraceEventSeverity = 'info' | 'warning' | 'error'

/** Token 用量 */
export type TraceCallUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

/** 单次 API 调用记录 */
export type TraceCallRecord = {
  id: string
  sessionId: string
  source: 'anthropic' | 'proxy'
  querySource?: string
  provider?: TraceProviderInfo
  model?: string
  status?: TraceCallStatus
  startedAt: string
  completedAt?: string
  durationMs?: number
  usage?: TraceCallUsage
  metadata?: Record<string, unknown>
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body: TraceBodySnapshot
  }
  response?: {
    status: number
    headers: Record<string, string>
    body: TraceBodySnapshot
  }
  error?: {
    name: string
    message: string
    code?: string
    stack?: string
    cause?: string
  }
}

/** 事件记录 */
export type TraceEventRecord = {
  id: string
  sessionId: string
  timestamp: string
  phase: string
  severity: TraceEventSeverity
  callId?: string
  source?: TraceCallRecord['source']
  provider?: TraceProviderInfo
  model?: string
  title?: string
  message?: string
  metadata?: Record<string, unknown>
}

/** 会话统计摘要 */
export type TraceSessionSummary = {
  apiCalls: number
  failedCalls: number
  totalDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  models: Array<{ model: string; calls: number }>
  updatedAt: string | null
}

/** 会话级 Trace 数据 */
export type TraceSession = {
  sessionId: string
  session?: {
    id: string
    title: string
    projectPath: string
    workDir: string | null
  } | null
  summary: TraceSessionSummary
  calls: TraceCallRecord[]
  events?: TraceEventRecord[]
}

/** Trace 采集设置 */
export type TraceCaptureSettings = {
  enabled: boolean
  storageDir: string
}

/** Trace 会话列表项 */
export type TraceSessionListItem = {
  sessionId: string
  session: {
    id: string
    title: string
    projectPath: string
    workDir: string | null
  } | null
  summary: TraceSessionSummary
  fileSize: number
  fileUpdatedAt: string
}

/** Trace 会话列表 */
export type TraceSessionList = {
  traces: TraceSessionListItem[]
  total: number
  storageDir: string
  settings: TraceCaptureSettings
}
