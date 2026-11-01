/**
 * 引擎失败的可恢复判定与退避策略。
 *
 * 主聊天（渲染层自动重发）与流水线阶段（主进程重跑回合）共用同一套口径：
 * 同一条 429 不应该在聊天里能恢复、在流水线里却被判死。两边的「重试动作」
 * 不同（渲染层 abort→重发，主进程直接再发一轮），但「能不能重试」「等多久」
 * 必须一致。
 */

export const MAX_RETRIES = 5
export const INITIAL_RETRY_DELAY_MS = 2_000
export const MAX_RETRY_DELAY_MS = 60_000
export const RETRY_JITTER_MS = 1_000

/**
 * HTTP 状态码识别：结构化字段优先，文本兜底只认带上下文的四种写法 —— 行首裸码、
 * 状态字段（`API Error: 429`）、赋值（`"code":429`）、原因短语（`401 Unauthorized`）。
 * 裸 `includes('429')` 会被模型名、端口和 token 数命中，不能用于重试判定。
 */
const STATUS_LEADING = /^[\s[("]*(\d{3})(?!\d)/i
const STATUS_FIELD = /\b(?:api[\s_]?error|http[\s_]?(?:error|status)|http|error[\s_]?code|status[\s_]?code|response[\s_]?status|status)[^A-Za-z0-9]{0,4}(\d{3})(?!\d)/i
const STATUS_ASSIGNMENT = /\bcode["']?\s*[:=]\s*["']?(\d{3})(?!\d)/i
const STATUS_REASON = /\b(\d{3})\s+(?:too many requests|unauthorized|forbidden|bad request|internal server error|bad gateway|service unavailable|gateway time(?:d )?out)/i
const STATUS_TEXT_PATTERNS: readonly RegExp[] = [STATUS_LEADING, STATUS_FIELD, STATUS_ASSIGNMENT, STATUS_REASON]

function toHttpStatus(raw: unknown): number | undefined {
  const value = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^\d{3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return value >= 100 && value <= 599 ? value : undefined
}

export function readHttpStatus(msg: string, error?: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
    const structured = toHttpStatus(status) ?? toHttpStatus(statusCode)
    if (structured !== undefined) return structured
  }
  let earliest: { code: number; index: number } | undefined
  for (const pattern of STATUS_TEXT_PATTERNS) {
    const hit = pattern.exec(msg)
    if (!hit) continue
    const code = toHttpStatus(hit[1])
    if (code !== undefined && (earliest === undefined || hit.index < earliest.index)) {
      earliest = { code, index: hit.index }
    }
  }
  return earliest?.code
}

export function extractRetryAfterMs(msg: string, error?: unknown): number | undefined {
  const match = msg.match(/retry[_-]?after[:\s]+(\d+)/i)
  if (match) return parseInt(match[1], 10) * 1000
  if (error && typeof error === 'object' && 'headers' in error) {
    const headers = (error as { headers?: { get?: (name: string) => string | null } }).headers
    if (headers?.get) {
      const val = headers.get('retry-after')
      if (val) return parseInt(val, 10) * 1000
    }
  }
  return undefined
}

export interface RetryDelayOptions {
  /** 服务端给的 Retry-After（毫秒），优先于指数退避。 */
  hintMs?: number
  initialDelayMs?: number
  maxDelayMs?: number
  jitterMs?: number
  random?: () => number
}

export function computeRetryDelayMs(attempt: number, options: RetryDelayOptions = {}): number {
  const maxDelayMs = options.maxDelayMs ?? MAX_RETRY_DELAY_MS
  if (options.hintMs && options.hintMs > 0) {
    return Math.min(options.hintMs, maxDelayMs)
  }
  const initialDelayMs = options.initialDelayMs ?? INITIAL_RETRY_DELAY_MS
  const jitterMs = options.jitterMs ?? RETRY_JITTER_MS
  const exponential = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)
  const jitter = (options.random ?? Math.random)() * jitterMs
  return Math.round(exponential + jitter)
}

/**
 * 流水线阶段能否靠「再发一轮」恢复。
 *
 * 只认显式可恢复的失败：429、5xx、网络、超时、上下文超限（下次尝试会让引擎先压缩）。
 * 鉴权/配置/请求体被拒（400）重发同一份历史必然复现；进程退出也不在这里 ——
 * 阶段会话没有 resume id，进程死了重启也接不回上下文，交给既有 blocked 路径。
 */
export function isRetryableAgentFailure(message: string): boolean {
  const lowerMsg = message.toLowerCase()
  const status = readHttpStatus(message)
  const isContextOverflow = /prompt is too long|prompt_too_long|exceed context limit/i.test(message)
  const isRequestRejected = !isContextOverflow && (
    status === 400 ||
    lowerMsg.includes('invalid_request_error') ||
    lowerMsg.includes('badrequesterror') ||
    lowerMsg.includes('unsupportedparamserror') ||
    lowerMsg.includes('does not support parameters') ||
    lowerMsg.includes('unsupported_params')
  )
  if (isRequestRejected) return false
  if (isContextOverflow) return true
  if (status === 429 || lowerMsg.includes('rate_limit') || lowerMsg.includes('rate limit') || lowerMsg.includes('rpm limit') || lowerMsg.includes('tpm limit')) {
    return true
  }
  if ((status !== undefined && status >= 500 && status < 600) || lowerMsg.includes('server error') || lowerMsg.includes('internal server')) {
    return true
  }
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('network error') || lowerMsg.includes('fetch failed') || lowerMsg.includes('net::err') || lowerMsg.includes('网络连接')) {
    return true
  }
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('超时')) {
    return true
  }
  return false
}
