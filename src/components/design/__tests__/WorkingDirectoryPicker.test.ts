import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import WorkingDirectoryPicker from '../WorkingDirectoryPicker.vue'
import { api } from '@/services/electronAPI'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/electronAPI', () => ({
  api: {
    selectFolder: vi.fn(),
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

describe('WorkingDirectoryPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.selectFolder).mockResolvedValue({ canceled: false, filePaths: ['/new/project'] })
  })

  it('渲染当前目录名', () => {
    const w = mount(WorkingDirectoryPicker, { props: { modelValue: '/users/project' } })
    expect(w.find('[data-testid="working-dir-trigger"]').text()).toContain('project')
  })

  it('空路径时显示国际化占位文案', () => {
    const w = mount(WorkingDirectoryPicker, { props: { modelValue: '' } })
    expect(w.find('[data-testid="working-dir-trigger"]').text()).toContain('选择工作目录')
  })

  it('点击选择目录菜单项触发 selectFolder 并回传路径', async () => {
    const w = mount(WorkingDirectoryPicker, { props: { modelValue: '' } })

    await w.find('[data-testid="working-dir-trigger"]').trigger('click')
    expect(w.find('[data-testid="working-dir-panel"]').exists()).toBe(true)
    await w.find('[data-testid="working-dir-pick"]').trigger('click')
    await flushPromises()

    expect(api.selectFolder).toHaveBeenCalledTimes(1)
    const events = w.emitted('update:modelValue')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['/new/project'])
  })

  it('取消选择时不触发 update:modelValue', async () => {
    vi.mocked(api.selectFolder).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const w = mount(WorkingDirectoryPicker, { props: { modelValue: '' } })
    await w.find('[data-testid="working-dir-trigger"]').trigger('click')
    await w.find('[data-testid="working-dir-pick"]').trigger('click')
    await flushPromises()

    expect(api.selectFolder).toHaveBeenCalledTimes(1)
    expect(w.emitted('update:modelValue')).toBeFalsy()
  })
})
