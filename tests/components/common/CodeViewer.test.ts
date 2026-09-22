/**
 * CodeViewer 组件测试 — 全屏切换、复制、编辑/保存。
 * Seam: appStore 状态 + navigator.clipboard + api.writeFile。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const mockWriteFile = vi.fn()
vi.mock('@/services/electronAPI', () => ({
  api: {
    loadGuiSettings: vi.fn(() => Promise.resolve({ success: true, data: null })),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}))

vi.mock('@/composables/useSelectionActions', () => ({
  registerSelectionHost: vi.fn(() => vi.fn()),
}))

vi.mock('highlight.js', () => ({
  default: {
    getLanguage: vi.fn(() => false),
    highlight: vi.fn(() => ''),
  },
}))

import CodeViewer from '@/components/common/CodeViewer.vue'
import { useAppStore } from '@/stores/app'
import { errorHandler } from '@/services/errorHandler'
import { useDialog } from '@/composables/useDialog'

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  globalInjection: true,
})

function openFileTab(appStore: ReturnType<typeof useAppStore>, overrides: Partial<{ path: string; name: string; content: string; language: string }> = {}) {
  const file = {
    path: '/repo/a.ts',
    name: 'a.ts',
    content: 'const a = 1\nconst b = 2',
    language: 'typescript',
    ...overrides,
  }
  appStore.openInfoTab({
    id: `file::${file.path}`,
    type: 'file',
    title: file.name,
    icon: null,
    data: file,
    closeable: true,
  })
  return file
}

function mountViewer() {
  return mount(CodeViewer, {
    global: {
      plugins: [i18n],
    },
  })
}

// jsdom 未实现 clipboard.writeText
function stubClipboard(impl: () => Promise<void>) {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(impl) },
  })
}

describe('CodeViewer — fullscreen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubClipboard(() => Promise.resolve())
  })

  it('全屏按钮切换 appStore.infoPanelFullscreen', async () => {
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    expect(appStore.infoPanelFullscreen).toBe(false)
    const btns = wrapper.findAll('.search-toggle-btn')
    await btns[btns.length - 1].trigger('click')
    expect(appStore.infoPanelFullscreen).toBe(true)
    await btns[btns.length - 1].trigger('click')
    expect(appStore.infoPanelFullscreen).toBe(false)
  })
})

describe('CodeViewer — copy', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubClipboard(() => Promise.resolve())
  })

  it('点击复制按钮写入剪贴板并显示成功状态', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard(writeText)
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const copyBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Copy'))
    expect(copyBtn).toBeTruthy()
    await copyBtn!.trigger('click')
    expect(writeText).toHaveBeenCalledWith('const a = 1\nconst b = 2')
    expect(copyBtn!.find('.copy-check').exists()).toBe(true)
  })

  it('复制失败时弹 toast', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const copyBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Copy'))
    await copyBtn!.trigger('click')
    await flushPromises()
    // toast 渲染在 ToastNotification（不在本组件内），断言 errorHandler 状态
    expect(errorHandler.toasts.value.some(t => t.title.includes('Copy failed'))).toBe(true)
  })

  it('二进制文件复制按钮禁用', () => {
    const appStore = useAppStore()
    openFileTab(appStore, { path: '/repo/logo.png', name: 'logo.png', content: 'binary', language: 'plaintext' })
    const wrapper = mountViewer()

    const copyBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Binary'))
    expect(copyBtn).toBeTruthy()
    expect(copyBtn!.attributes('disabled')).toBeDefined()
  })
})

describe('CodeViewer — edit & save', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubClipboard(() => Promise.resolve())
    mockWriteFile.mockReset()
  })

  it('进入编辑模式显示 textarea，修改后出现未保存标识', async () => {
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const editBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Edit'))
    await editBtn!.trigger('click')

    const textarea = wrapper.find('.edit-textarea')
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe('const a = 1\nconst b = 2')

    textarea.setValue('const a = 2')
    await flushPromises()
    expect(appStore.fileEditDirtyPath).toBe('/repo/a.ts')
    expect(wrapper.find('.unsaved-dot').exists()).toBe(true)
  })

  it('保存成功：调用 api.writeFile 并同步 store 内容', async () => {
    mockWriteFile.mockResolvedValue({ success: true })
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const editBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Edit'))
    await editBtn!.trigger('click')
    await wrapper.find('.edit-textarea').setValue('new content')

    const saveBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Save'))
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(mockWriteFile).toHaveBeenCalledWith('/repo/a.ts', 'new content')
    expect(appStore.currentFile?.content).toBe('new content')
    expect(appStore.fileEditDirtyPath).toBeNull()
  })

  it('保存失败：弹 toast 且保持脏状态', async () => {
    mockWriteFile.mockResolvedValue({ success: false, error: 'EACCES: permission denied' })
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const editBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Edit'))
    await editBtn!.trigger('click')
    await wrapper.find('.edit-textarea').setValue('new content')

    const saveBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Save'))
    await saveBtn!.trigger('click')
    await flushPromises()

    // toast 渲染在 ToastNotification（不在本组件内），断言 errorHandler 状态
    expect(errorHandler.toasts.value.some(t => t.title.includes('Save failed'))).toBe(true)
    expect(appStore.fileEditDirtyPath).toBe('/repo/a.ts')
  })

  it('Ctrl+S 触发保存', async () => {
    mockWriteFile.mockResolvedValue({ success: true })
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const editBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Edit'))
    await editBtn!.trigger('click')
    await wrapper.find('.edit-textarea').setValue('saved via shortcut')

    await wrapper.find('.edit-textarea').trigger('keydown', { key: 's', ctrlKey: true })
    await flushPromises()

    expect(mockWriteFile).toHaveBeenCalledWith('/repo/a.ts', 'saved via shortcut')
  })

  it('二进制文件不显示编辑按钮', () => {
    const appStore = useAppStore()
    openFileTab(appStore, { path: '/repo/logo.png', name: 'logo.png', content: 'binary', language: 'plaintext' })
    const wrapper = mountViewer()

    const editBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Edit'))
    expect(editBtn).toBeUndefined()
  })

  it('切换文件时有未保存修改：确认后允许切换', async () => {
    const appStore = useAppStore()
    openFileTab(appStore)
    const wrapper = mountViewer()

    const editBtn = wrapper.findAll('.search-toggle-btn').find(b => b.attributes('title')?.includes('Edit'))
    await editBtn!.trigger('click')
    await wrapper.find('.edit-textarea').setValue('modified')

    // 打开第二个文件并切换
    appStore.openInfoTab({
      id: 'file::/repo/b.ts',
      type: 'file',
      title: 'b.ts',
      icon: null,
      data: { path: '/repo/b.ts', name: 'b.ts', content: 'other', language: 'typescript' },
      closeable: true,
    })
    appStore.activeInfoTabId = 'file::/repo/b.ts'
    await flushPromises()

    // 确认对话框渲染在 DialogProvider（不在本组件内），断言 useDialog 状态并模拟确认
    const { confirmDialogState, closeConfirm } = useDialog()
    expect(confirmDialogState.value.visible).toBe(true)
    closeConfirm(true)
    await flushPromises()

    expect(appStore.activeInfoTabId).toBe('file::/repo/b.ts')
    expect(appStore.fileEditDirtyPath).toBeNull()
  })
})
