import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DesignSystemPicker from '../DesignSystemPicker.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      getSystemShowcase: vi.fn().mockResolvedValue('<html>preview</html>'),
    },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('DesignSystemPicker', () => {
  const systems = [
    { id: 'agentic', name: 'Agentic', category: 'Themed & Unique', description: 'AI-first', previewPages: [{ path: 'preview/colors.html', role: 'colors', title: 'Colors' }] },
    { id: 'apple', name: 'Apple', category: 'Corporate', description: 'Apple iOS', previewPages: [] },
  ]

  beforeEach(() => {
    config.global.plugins = [i18n]
    vi.clearAllMocks()
  })

  it('打开后渲染系统列表（含不指定选项）', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    expect(w.findAll('[data-testid^="ds-option-"]')).toHaveLength(3)
  })

  it('选择系统触发 update:modelValue', async () => {
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mousedown')
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['agentic'])
  })

  it('悬停带预览的系统调用 getSystemShowcase', async () => {
    const { api } = await import('@/services/electronAPI')
    const w = mount(DesignSystemPicker, { props: { systems, modelValue: null } })
    await w.find('[data-testid="ds-picker-trigger"]').trigger('click')
    await w.find('[data-testid="ds-option-agentic"]').trigger('mouseenter')
    expect(api.design.getSystemShowcase).toHaveBeenCalledWith('agentic')
  })
})
