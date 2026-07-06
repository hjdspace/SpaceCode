import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { setActivePinia, createPinia } from 'pinia'
import TemplatePicker from '../TemplatePicker.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const switchToolboxSkillSpy = vi.fn().mockResolvedValue(undefined)

vi.mock('@/composables/useDesignSession', () => ({
  useDesignSession: () => ({ switchToolboxSkill: switchToolboxSkillSpy }),
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n, createPinia()]

describe('TemplatePicker', () => {
  beforeEach(() => {
    config.global.plugins = [i18n, createPinia()]
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('点击触发按钮后打开浮层并渲染 10 个卡片', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    expect(w.find('[data-testid="template-picker-menu"]').exists()).toBe(true)
    expect(w.findAll('[data-testid^="template-card-"]')).toHaveLength(10)
  })

  it('搜索过滤模板', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    const input = w.find('[data-testid="template-picker-search"]')
    await input.setValue('幻灯片')
    expect(w.findAll('[data-testid^="template-card-"]')).toHaveLength(1)
  })

  it('选择模板触发 update:modelValue', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    await w.find('[data-testid="template-card-deck"]').trigger('click')
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['deck'])
  })

  it('选择模板时若 defaultSkillId 不同则自动切换 skill', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    await w.find('[data-testid="template-card-deck"]').trigger('click')
    expect(switchToolboxSkillSpy).toHaveBeenCalledWith('html-ppt-skill')
  })

  it('inline 模式下触发器使用透明背景样式', () => {
    const w = mount(TemplatePicker, { props: { modelValue: null, inline: true } })
    expect(w.find('.template-picker-trigger.is-inline').exists()).toBe(true)
  })

  it('默认模式下触发器没有 is-inline 类', () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    expect(w.find('.template-picker-trigger.is-inline').exists()).toBe(false)
  })
})
