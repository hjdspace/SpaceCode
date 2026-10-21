/**
 * 主进程拦下用户操作时的机器可读原因码 (issue #55)。
 *
 * 用户可见文案一律由渲染层按 i18n 渲染：主进程只给 reason + 结构化上下文，
 * `detail` 仅供日志 / trace / 技术详情，不得直接当作提示。
 */

export const ENGINE_BLOCKED_REASONS = [
  'permission-mode-not-applied',
  'plan-mode-not-enforced',
  'session-not-active',
  'engine-unavailable',
] as const

export type EngineBlockedReason = (typeof ENGINE_BLOCKED_REASONS)[number]

export interface EngineBlockedContext {
  engine?: string
  intent?: string
  reported?: string | null
  extensionLoaded?: boolean
  availabilityReason?: string
  version?: string | null
  operation?: string
}

/** `error` 事件 data 的结构化形状；没有 `message` —— 人类可读的那句在渲染层。 */
export interface EngineBlockedPayload {
  reason: EngineBlockedReason
  detail: string
  context?: EngineBlockedContext
}

export const ENGINE_BLOCKED_MARKER = 'ENGINE_BLOCKED'

function isEngineBlockedReason(value: unknown): value is EngineBlockedReason {
  return typeof value === 'string'
    && (ENGINE_BLOCKED_REASONS as readonly string[]).includes(value)
}

export function isEngineBlockedPayload(value: unknown): value is EngineBlockedPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { reason?: unknown; detail?: unknown }
  return isEngineBlockedReason(candidate.reason) && typeof candidate.detail === 'string'
}

/**
 * Electron 的 invoke 拒绝只把 message 带过进程边界，自定义字段会被丢掉 ——
 * 原因码必须编进 message，渲染层才能对 IPC 拒绝这条路径同样给出本地化文案。
 */
export function engineBlockedError(sessionId: string, payload: EngineBlockedPayload): Error {
  const err = new Error(
    `Session ${sessionId} blocked: ${ENGINE_BLOCKED_MARKER}[${payload.reason}] ${payload.detail}`,
  )
  // 同进程消费者（H5 server 的广播）可以直接拿到完整结构化数据。
  return Object.assign(err, { engineBlocked: payload })
}

/** 从 IPC / HTTP 传回来的错误 message 里还原 reason 与原始 detail。 */
export function parseEngineBlockedError(error: unknown): EngineBlockedPayload | null {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : ''
  if (!message) return null

  // invoke 拒绝会被 Electron 加上 "Error invoking remote method ..." 前缀，不能锚定行首。
  const markerAt = message.indexOf(`${ENGINE_BLOCKED_MARKER}[`)
  if (markerAt < 0) return null
  const rest = message.slice(markerAt + ENGINE_BLOCKED_MARKER.length + 1)
  const close = rest.indexOf(']')
  if (close < 0) return null
  const reason = rest.slice(0, close)
  if (!isEngineBlockedReason(reason)) return null

  return {
    reason,
    detail: rest.slice(close + 1).trim() || message,
  }
}
