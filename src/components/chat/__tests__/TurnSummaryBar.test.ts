import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TurnSummaryBar from '../TurnSummaryBar.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})

function mountSummary(totalDurationMs: number, reasoningDurationMs?: number) {
  return mount(TurnSummaryBar, {
    props: {
      metadata: { model: 'GLM-5.3-Flash', inputTokens: 100, outputTokens: 200, duration: totalDurationMs },
      totalDurationMs,
      reasoningDurationMs,
      loading: false,
    },
    global: { plugins: [i18n] },
  })
}

describe('TurnSummaryBar 用时展示', () => {
  it('总用时按分钟归一，不再显示 3431.6s', () => {
    const wrapper = mountSummary(3_431_600)

    expect(wrapper.find('.total-duration .ts-value').text()).toBe('57m 12s')
  })

  it('亚分钟的读数保持一位小数', () => {
    const wrapper = mountSummary(12_400)

    expect(wrapper.find('.total-duration .ts-value').text()).toBe('12.4s')
  })

  it('思考耗时与总用时用同一档位', () => {
    const wrapper = mountSummary(3_431_600, 95_000)
    const values = wrapper.findAll('.ts-value').map(node => node.text())

    expect(values[0]).toBe('57m 12s')
    expect(values[1]).toBe('1m 35s')
  })
})
