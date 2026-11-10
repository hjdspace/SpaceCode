import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DesignSystemCreateModal from '../DesignSystemCreateModal.vue'
import zhCN from '@/i18n/locales/zh-CN'
import type { DesignSystemSummary } from '@/services/electronAPI'

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      createSystem: vi.fn(),
    },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN },
})

const created: DesignSystemSummary = {
  id: 'warm-editorial',
  name: '暖调编辑部',
  category: 'Custom',
  previewPages: [],
  source: 'user',
}

function mountModal(): VueWrapper {
  return mount(DesignSystemCreateModal, {
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

function submitButton(w: VueWrapper): HTMLButtonElement {
  return w.find('[data-testid="ds-create-submit"]').element as HTMLButtonElement
}

describe('DesignSystemCreateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('名称为空或纯空格时不给提交', async () => {
    const w = mountModal()
    expect(submitButton(w).disabled).toBe(true)
    await w.find('[data-testid="ds-create-name"]').setValue('   ')
    expect(submitButton(w).disabled).toBe(true)
    await w.find('[data-testid="ds-create-name"]').setValue('暖调编辑部')
    expect(submitButton(w).disabled).toBe(false)
  })

  it('提交时去掉首尾空白，空分类不传值让主进程兜底', async () => {
    const { api } = await import('@/services/electronAPI')
    vi.mocked(api.design.createSystem).mockResolvedValue(created)
    const w = mountModal()

    await w.find('[data-testid="ds-create-name"]').setValue('  暖调编辑部  ')
    await w.find('[data-testid="ds-create-summary"]').setValue('杂志感的暖米色排版')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(api.design.createSystem).toHaveBeenCalledWith({
      title: '暖调编辑部',
      category: undefined,
      summary: '杂志感的暖米色排版',
      accentColor: '#d66f4d',
    })
    expect(w.emitted('created')?.[0]).toEqual([created])
  })

  it('创建中禁用提交避免重复落盘', async () => {
    const { api } = await import('@/services/electronAPI')
    let release: (value: DesignSystemSummary) => void = () => {}
    vi.mocked(api.design.createSystem).mockReturnValue(
      new Promise<DesignSystemSummary>((resolve) => { release = resolve }),
    )
    const w = mountModal()
    await w.find('[data-testid="ds-create-name"]').setValue('Slow')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(submitButton(w).disabled).toBe(true)
    await w.find('form').trigger('submit')
    expect(api.design.createSystem).toHaveBeenCalledTimes(1)

    release(created)
    await flushPromises()
    expect(w.emitted('created')).toBeTruthy()
  })

  it('失败时留在弹窗里报错并保留已填内容', async () => {
    const { api } = await import('@/services/electronAPI')
    vi.mocked(api.design.createSystem).mockRejectedValue(new Error('EACCES'))
    const w = mountModal()
    await w.find('[data-testid="ds-create-name"]').setValue('暖调编辑部')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(w.find('[data-testid="ds-create-error"]').text()).toContain('创建失败')
    expect(w.emitted('created')).toBeFalsy()
    expect((w.find('[data-testid="ds-create-name"]').element as HTMLInputElement).value).toBe('暖调编辑部')
    expect(submitButton(w).disabled).toBe(false)
  })

  it('取消与 Esc 都抛 cancel，不碰创建接口', async () => {
    const { api } = await import('@/services/electronAPI')
    const w = mountModal()
    await w.find('[data-testid="ds-create-close"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(api.design.createSystem).not.toHaveBeenCalled()
  })
})
