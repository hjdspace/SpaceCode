/**
 * 健康面板文案键映射（T13 #83）：
 *  - 已知类别 → superAgent.health.categories.<category>；
 *  - 未知类别回退 superAgent.health.unknownCategory；
 *  - 错误码文案键由主进程给出（codeI18nKey），未知 code 已回退 superAgent.errors.unknown。
 * 纯函数：只算 i18n 键，不触碰 t()。
 */
import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/locales/en-US/superAgent'
import zhCN from '@/i18n/locales/zh-CN/superAgent'
import { SUPER_AGENT_HEALTH_CATEGORIES } from '@/shared/channels/superAgent'
import { healthCategoryI18nKey } from '../healthText'

describe('healthCategoryI18nKey', () => {
  it('maps every known category to its locale key', () => {
    for (const category of SUPER_AGENT_HEALTH_CATEGORIES) {
      expect(healthCategoryI18nKey(category)).toBe(`superAgent.health.categories.${category}`)
    }
  })

  it('falls back to the generic category key for an unknown category', () => {
    expect(healthCategoryI18nKey('effect:telemetry')).toBe('superAgent.health.unknownCategory')
  })
})

describe('health locale skeleton', () => {
  it('defines every known category in zh-CN and en-US', () => {
    for (const category of SUPER_AGENT_HEALTH_CATEGORIES) {
      expect(zhCN.health.categories).toHaveProperty(category)
      expect(enUS.health.categories).toHaveProperty(category)
      expect((zhCN.health.categories as Record<string, string>)[category]).toBeTruthy()
      expect((enUS.health.categories as Record<string, string>)[category]).toBeTruthy()
    }
  })

  it('keeps the same set of health keys across locales', () => {
    expect(Object.keys(zhCN.health).sort()).toEqual(Object.keys(enUS.health).sort())
    expect(Object.keys(zhCN.health.categories).sort()).toEqual(Object.keys(enUS.health.categories).sort())
  })
})
