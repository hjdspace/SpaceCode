/**
 * pi 引擎级重试预算的投影配置。
 *
 * pi 默认只重试 3 次（2s→4s→8s），对 tpm/rpm 这类按分钟限速根本跨不过窗口：
 * 引擎很快放弃、以 `agent_end`(stopReason='error') 收场，渲染层随即用 abort+重发
 * 硬撞限速，最终把"重试耗尽"的错误卡片顶到会话中间。这里把预算提到与 claude-code
 * CLI 内部重试相当的 10 次，并把退避基数放慢 —— pi 的退避无上限
 * （`baseDelayMs * 2^(n-1)`），基数 500ms 的序列是 0.5s/1/2/4/8/16/32/64/128/256s：
 * 前几次吃瞬时抖动，后几次的等待跨过 60s 的限速窗口。
 *
 * pi 没有 per-session 的 RPC 能改这两个值（`set_auto_retry` 只能开关），
 * `~/.pi/agent/settings.json` 是唯一入口 —— 与 models.json / mcp.json 的全局投影同一先例。
 */

/** 对齐 claude-code CLI 的内部重试次数：10 次都失败才值得把失败卡片亮给用户。 */
export const PI_RETRY_MAX_RETRIES = 10

/** 退避基数（毫秒）。见上方说明：无上限指数退避，末次等待约 4 分钟。 */
export const PI_RETRY_BASE_DELAY_MS = 500

/**
 * 把引擎级重试预算合并进用户已有的 settings.json 内容（纯函数，不做 IO）。
 *
 * 保守合并规则：
 * - 用户显式 `retry.enabled === false` 时不碰 enabled（尊重用户关闭重试的意图），
 *   未配置时写 true，防御上游默认翻转；
 * - `maxRetries` 只升不降：用户配了更大预算就按用户的来，配小了按引擎预算提升；
 * - `baseDelayMs` 只补缺：这是本仓库调优的值，用户已配就不再动。
 *
 * 其余字段原样保留，输入不是对象时安全起步。
 */
export function mergeRetrySettings(existing: unknown): Record<string, unknown> {
  const root: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}

  const rawRetry =
    root.retry && typeof root.retry === 'object' && !Array.isArray(root.retry)
      ? (root.retry as Record<string, unknown>)
      : {}
  const retry: Record<string, unknown> = { ...rawRetry }

  if (typeof retry.enabled !== 'boolean') retry.enabled = true

  const configured =
    typeof retry.maxRetries === 'number' && Number.isFinite(retry.maxRetries)
      ? retry.maxRetries
      : undefined
  if (configured === undefined || configured < PI_RETRY_MAX_RETRIES) {
    retry.maxRetries = PI_RETRY_MAX_RETRIES
  }

  if (typeof retry.baseDelayMs !== 'number' || !Number.isFinite(retry.baseDelayMs)) {
    retry.baseDelayMs = PI_RETRY_BASE_DELAY_MS
  }

  root.retry = retry
  return root
}
