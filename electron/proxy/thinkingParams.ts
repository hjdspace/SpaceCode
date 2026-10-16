/**
 * 思考（extended thinking）参数按网关族映射。
 *
 * Anthropic 的 `thinking: { type: 'enabled' }` 在 OpenAI 兼容协议里没有标准位置，
 * 各家自有一套：DeepSeek 官方吃 `thinking`，vLLM/自部署系吃 `chat_template_kwargs`
 * 或顶层 `enable_thinking`。原先的做法是三套齐发、"让每家取自己认的那一套"，
 * 但会做参数校验的代理（LiteLLM）不认未知参数，直接
 * `400 UnsupportedParamsError: openai does not support parameters: ['thinking']` ——
 * 那是确定性 400，重发多少次结果都一样。
 *
 * 所以认得出家族就只发那一族认得的写法；认不出的一律按老行为三套齐发
 * （那些网关历史上就是"忽略不认识"的一批，收窄它们只会造成回归）。
 */

/** 已知会拒绝 Anthropic 式 `thinking`、只认 vLLM/ChatML 一系写法的模型族。 */
const CHAT_TEMPLATE_FAMILIES = /qwen|pangu|mimo|deepseek-r1/i

export function isChatTemplateThinkingModel(model: unknown): boolean {
  return typeof model === 'string' && CHAT_TEMPLATE_FAMILIES.test(model)
}

/**
 * 客户端这次到底要不要思考。
 *
 * CLI 的 `--thinking` 只在 spawn 时读一次，落到 API 层就是 Anthropic 请求里的
 * `thinking` 字段：没请求时它是缺省的（type 'disabled' 也按未请求处理）。这个判断
 * 同时决定"往上游发哪种思考参数"和"上游回来的 reasoning_content 要不要当思考呈现"，
 * 两处必须用同一个口径 —— 否则用户关了开关却还能看到推理过程。
 */
export function isThinkingRequested(thinking: unknown): boolean {
  const type = (thinking as { type?: unknown } | undefined)?.type
  return type === 'enabled' || type === 'adaptive'
}

/**
 * 返回要并入 OpenAI 请求体的思考参数。`enabled` 为 false 时返回空对象 ——
 * 与历史行为一致：不请求思考就不发任何私有参数。
 */
export function resolveThinkingParams(
  model: unknown,
  enabled: boolean,
): Record<string, unknown> {
  if (!enabled) return {}
  if (isChatTemplateThinkingModel(model)) {
    return {
      enable_thinking: true,
      chat_template_kwargs: { thinking: true, enable_thinking: true },
    }
  }
  return {
    thinking: { type: 'enabled' },
    enable_thinking: true,
    chat_template_kwargs: { thinking: true, enable_thinking: true },
  }
}
