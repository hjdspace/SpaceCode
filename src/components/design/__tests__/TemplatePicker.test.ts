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

// 菜单 Teleport 到 body 后不在 wrapper 子树内，交互用例把 teleport stub 掉就地渲染
function mountPicker(props: { modelValue: string | null; inline?: boolean }) {
  return mount(TemplatePicker, { props, global: { stubs: { teleport: true } } })
}

describe('TemplatePicker', () => {
  beforeEach(() => {
    config.global.plugins = [i18n, createPinia()]
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('点击触发按钮后打开浮层并渲染 10 个卡片', async () => {
    const w = mountPicker({ modelValue: null })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    expect(w.find('[data-testid="template-picker-menu"]').exists()).toBe(true)
    expect(w.findAll('[data-testid^="template-card-"]')).toHaveLength(10)
  })

  it('搜索过滤模板', async () => {
    const w = mountPicker({ modelValue: null })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    const input = w.find('[data-testid="template-picker-search"]')
    await input.setValue('幻灯片')
    expect(w.findAll('[data-testid^="template-card-"]')).toHaveLength(1)
  })

  it('选择模板触发 update:modelValue', async () => {
    const w = mountPicker({ modelValue: null })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')
    await w.find('[data-testid="template-card-deck"]').trigger('click')
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['deck'])
  })

  it('选择模板时若 defaultSkillId 不同则自动切换 skill', async () => {
    const w = mountPicker({ modelValue: null })
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

  it('浮层 Teleport 到 body 并用视口坐标定位（躲开中心栏裁剪与右侧面板遮挡）', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')

    const menu = document.querySelector<HTMLElement>('[data-testid="template-picker-menu"]')
    expect(menu).toBeTruthy()
    expect(menu!.parentElement).toBe(document.body)
    expect(menu!.style.position).toBe('fixed')
    expect(menu!.style.left).toContain('px')
    w.unmount()
  })

  it('点击浮层内的搜索框不会关闭浮层', async () => {
    const w = mount(TemplatePicker, { props: { modelValue: null } })
    await w.find('[data-testid="template-picker-trigger"]').trigger('click')

    const search = document.querySelector('[data-testid="template-picker-search"]')
    expect(search).toBeTruthy()
    search!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()

    expect(document.querySelector('[data-testid="template-picker-menu"]')).toBeTruthy()
    w.unmount()
  })
})
