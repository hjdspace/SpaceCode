import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * 轮询文案池 —— 顺序即用户看到的顺序。
 *
 * 回合在跑但没有具体可报的动作时（等下一轮、纯推理），用这一串表明「还在动」，
 * 避免静止的时间线被读成任务已经结束。
 */
const ACTIVITY_LABEL_KEYS = [
  'chat.turnActivity.pool.thinking',
  'chat.turnActivity.pool.reasoning',
  'chat.turnActivity.pool.organizing',
  'chat.turnActivity.pool.clarifying',
  'chat.turnActivity.pool.reviewing',
] as const

export function useActivityLabels(): ComputedRef<string[]> {
  const { t } = useI18n()
  return computed(() => ACTIVITY_LABEL_KEYS.map(key => t(key)))
}
