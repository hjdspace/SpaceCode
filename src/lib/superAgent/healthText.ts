/**
 * 健康面板文案键映射（T13 #83）。
 *
 * 健康项类别是开放字符串（未知错误码会累计到自定义类别），渲染层不能假设
 * 每个类别都有词条：已知类别用专属键，未知类别回退通用文案，不把原始
 * 类别名直接显示给用户。
 */
import { SUPER_AGENT_HEALTH_CATEGORIES } from '@/shared/channels/superAgent'

const KNOWN_CATEGORIES: readonly string[] = SUPER_AGENT_HEALTH_CATEGORIES

/** 已知类别 → superAgent.health.categories.<category>；未知类别 → 通用键。 */
export function healthCategoryI18nKey(category: string): string {
  return KNOWN_CATEGORIES.includes(category)
    ? `superAgent.health.categories.${category}`
    : 'superAgent.health.unknownCategory'
}
