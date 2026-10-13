import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import WorkspaceFilePicker from '../WorkspaceFilePicker.vue'
import { api } from '@/services/electronAPI'
import zhCN from '@/i18n/locales/zh-CN'

vi.mock('@/services/electronAPI', () => ({
  api: {
    readDir: vi.fn(),
    searchFiles: vi.fn(),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: false, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN },
})

const dir = (name: string, path: string) => ({ name, path, isDirectory: true, isFile: false })
const file = (name: string, path: string) => ({ name, path, isDirectory: false, isFile: true })

async function mountPicker() {
  const w = mount(WorkspaceFilePicker, {
    props: { rootDir: '/proj' },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return w
}

describe('WorkspaceFilePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    vi.mocked(api.readDir).mockResolvedValue([
      dir('src', '/proj/src'),
      file('README.md', '/proj/README.md'),
    ])
  })

  it('挂载即列出根目录内容', async () => {
    const w = await mountPicker()
    expect(api.readDir).toHaveBeenCalledWith('/proj')
    const rows = w.findAll('[data-testid="workspace-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('src')
    expect(rows[1].text()).toContain('README.md')
    expect(w.find('[data-testid="workspace-back"]').exists()).toBe(false)
  })

  it('点击目录行进入下一级并出现返回入口', async () => {
    vi.mocked(api.readDir).mockResolvedValueOnce([dir('src', '/proj/src')])
    const w = await mountPicker()

    await w.findAll('[data-testid="workspace-row"]')[0].trigger('click')
    await flushPromises()

    expect(api.readDir).toHaveBeenLastCalledWith('/proj/src')
    expect(w.emitted('add')).toBeFalsy()
    expect(w.find('[data-testid="workspace-back"]').exists()).toBe(true)
  })

  it('目录行的加号添加目录并关闭选择器', async () => {
    vi.mocked(api.readDir).mockResolvedValueOnce([dir('src', '/proj/src')])
    const w = await mountPicker()

    await w.find('[data-testid="workspace-add"]').trigger('click')
    await flushPromises()

    expect(api.readDir).toHaveBeenCalledTimes(1)
    expect(w.emitted('add')![0]).toEqual([{
      name: 'src',
      path: '/proj/src',
      relativePath: 'src',
      isDirectory: true,
    }])
    expect(w.emitted('close')).toBeTruthy()
  })

  it('点击文件行添加文件并关闭', async () => {
    vi.mocked(api.readDir).mockResolvedValueOnce([dir('src', '/proj/src')])
    const w = await mountPicker()

    await w.findAll('[data-testid="workspace-row"]')[0].trigger('click')
    await flushPromises()
    vi.mocked(api.readDir).mockResolvedValueOnce([
      dir('src', '/proj/src'),
      file('README.md', '/proj/README.md'),
    ])
    await w.find('[data-testid="workspace-back"]').trigger('click')
    await flushPromises()

    const fileRow = w.findAll('[data-testid="workspace-row"]')[1]
    expect(fileRow.find('[data-testid="workspace-add"]').exists()).toBe(false)
    await fileRow.trigger('click')

    expect(w.emitted('add')![0][0]).toMatchObject({ name: 'README.md', isDirectory: false })
    expect(w.emitted('close')).toBeTruthy()
  })
})
