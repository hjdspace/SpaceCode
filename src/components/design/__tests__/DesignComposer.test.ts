import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import DesignComposer from '../DesignComposer.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: { listSystems: vi.fn().mockResolvedValue([]) },
    selectFolder: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: false, data: null }),
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('DesignComposer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    config.global.plugins = [i18n]
  })

  it('渲染 + 按钮、模板选择器、发送按钮', () => {
    const w = mount(DesignComposer)
    expect(w.find('[data-testid="composer-plus-btn"]').exists()).toBe(true)
    expect(w.find('[data-testid="template-picker-trigger"]').exists()).toBe(true)
    expect(w.find('[data-testid="composer-send-btn"]').exists()).toBe(true)
  })

  it('底部渲染设计系统选择器和工作目录选择器', () => {
    const w = mount(DesignComposer)
    expect(w.find('[data-testid="ds-picker-trigger"]').exists()).toBe(true)
    expect(w.find('[data-testid="working-dir-trigger"]').exists()).toBe(true)
  })

  it('点击 + 按钮展开更多功能菜单', async () => {
    const w = mount(DesignComposer)
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(false)
    await w.find('[data-testid="composer-plus-btn"]').trigger('click')
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(true)
  })

  it('点击外部区域关闭更多功能菜单', async () => {
    const w = mount(DesignComposer)
    await w.find('[data-testid="composer-plus-btn"]').trigger('click')
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(true)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(false)
  })

  it('按 Escape 关闭更多功能菜单', async () => {
    const w = mount(DesignComposer)
    await w.find('[data-testid="composer-plus-btn"]').trigger('click')
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.find('[data-testid="composer-plus-menu"]').exists()).toBe(false)
  })

  it('输入内容后点击发送触发 send 事件', async () => {
    const w = mount(DesignComposer)
    const textarea = w.find('textarea')
    await textarea.setValue('hello')
    await w.find('[data-testid="composer-send-btn"]').trigger('click')
    expect(w.emitted('send')).toBeTruthy()
    expect(w.emitted('send')![0]).toEqual(['hello'])
  })
})
