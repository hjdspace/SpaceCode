/**
 * 引擎会话的模型解析。
 *
 * 同一个模型值在两种引擎上的语义不同：
 * - claude-code 走内置代理，代理只按 haiku/sonnet/opus 三个槽位路由（见
 *   sessionProcess 的 PROXY_*_MODEL 分支），所以设置里存的真实名（如 kimi-k3）
 *   必须反查成别名，否则静默落回 sonnet 路由。
 * - pi 的 --model 直接交给上游（见 PiSessionProcess.buildArgs），别名在它眼里
 *   是个不存在的模型，必须保留真实模型 id。
 */
export interface ProviderModelSlots {
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

export function resolveModelAliasForEngine(
  modelValue: string,
  slots: ProviderModelSlots | null | undefined,
  engineType?: 'claude-code' | 'pi',
): string {
  if (engineType === 'pi') return modelValue
  if (!slots) return modelValue

  if (slots.haikuModel && slots.haikuModel === modelValue) return 'haiku'
  if (slots.sonnetModel && slots.sonnetModel === modelValue) return 'sonnet'
  if (slots.opusModel && slots.opusModel === modelValue) return 'opus'

  return modelValue
}
