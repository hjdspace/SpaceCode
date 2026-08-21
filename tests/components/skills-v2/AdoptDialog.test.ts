import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import AdoptDialog from '@/components/skills-v2/AdoptDialog.vue'

const storeMocks = vi.hoisted(() => ({
  previewAdopt: vi.fn(),
  executeAdopt: vi.fn(),
}))

vi.mock('@/stores/skillManagerStore', () => ({
  useSkillManagerStore: () => ({
    error: null,
    previewAdopt: storeMocks.previewAdopt,
    executeAdopt: storeMocks.executeAdopt,
  }),
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
})

describe('AdoptDialog', () => {
  it('loads the adoption preview when mounted visible', async () => {
    storeMocks.previewAdopt.mockResolvedValue({
      agentId: 'claude-code',
      unmanagedId: 'unmanaged-1',
      inferredSkillId: 'ask-matt',
      centerHasSameName: false,
      centerSkillId: null,
      options: ['import_link'],
      conflictReason: null,
    })

    const wrapper = mount(AdoptDialog, {
      props: {
        visible: true,
        agentId: 'claude-code',
        unmanagedId: 'unmanaged-1',
        skillPath: 'C:\\Users\\tester\\.claude\\skills\\ask-matt',
      },
      global: { plugins: [i18n] },
    })

    await flushPromises()

    expect(storeMocks.previewAdopt).toHaveBeenCalledWith('claude-code', 'unmanaged-1')
    expect(wrapper.text()).toContain('接管 ask-matt')
    expect(wrapper.text()).toContain('导入中心库，并替换为链接')
    expect(wrapper.text()).not.toContain('加载中')
  })
})
