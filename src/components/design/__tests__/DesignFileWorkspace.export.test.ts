// @vitest-environment jsdom
/**
 * 导出条 — 票 08：zip/pdf 必须给出真实结果，非 HTML 产物与无 preload 环境不得假成功。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignStore } from '@/stores/design'

const { exportArtifactSpy, urlFor } = vi.hoisted(() => {
  const urlFor = (filePath: string): string =>
    `spacecode-preview://artifact/TOKEN/${filePath.split(/[\\/]/).pop()}`
  return {
    exportArtifactSpy: vi.fn(
      async (): Promise<{ ok: true; path: string } | { ok: false; error: string }> => ({
        ok: true,
        path: '/workspace/index.zip',
      }),
    ),
    urlFor,
  }
})

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      onFileChanged: () => () => {},
      exportArtifact: exportArtifactSpy,
    },
    readFile: vi.fn(async (filePath: string) => `<html><body>${filePath}</body></html>`),
    preview: { getFrameUrl: vi.fn(async (filePath: string) => urlFor(filePath)) },
  },
}))

// t(key, params) 原样回显 key 与插值，便于断言展示的是哪个文案与哪个路径
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

// 组件在「新产物」时会请求弹开右侧面板；本文件只测导出条，给它一个空壳
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ openDesignPreview: vi.fn() }),
}))

vi.mock('../DesignPreview.vue', () => ({
  default: { name: 'DesignPreviewStub', template: '<div />' },
}))
vi.mock('../WorkspaceTabsBar.vue', () => ({
  default: { name: 'WorkspaceTabsBarStub', template: '<div />' },
}))

import DesignFileWorkspace from '../DesignFileWorkspace.vue'

function openHtmlTab(store: ReturnType<typeof useDesignStore>) {
  store.designWorkspace = '/workspace'
  store.addTab({ name: 'index.html', path: '/workspace/index.html', updatedAt: 0 })
}

function exportButtons(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.export-bar button')
}

function statusText(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.export-status').exists()
    ? wrapper.find('.export-status').text()
    : ''
}

describe('DesignFileWorkspace — 导出条', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    exportArtifactSpy.mockResolvedValue({ ok: true, path: '/workspace/index.zip' })
  })

  it('HTML 产物时三个导出按钮都可用', async () => {
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    const buttons = exportButtons(wrapper)
    expect(buttons).toHaveLength(3)
    expect(buttons.every(b => !b.attributes('disabled'))).toBe(true)
  })

  it('活动 tab 是 CSS 时按钮禁用并说明原因', async () => {
    const store = useDesignStore()
    store.designWorkspace = '/workspace'
    store.addTab({ name: 'style.css', path: '/workspace/style.css', updatedAt: 0 })
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    const buttons = exportButtons(wrapper)
    expect(buttons.every(b => b.attributes('disabled') !== undefined)).toBe(true)
    expect(buttons[1].attributes('title')).toBe('design.export.htmlOnly')

    await buttons[1].trigger('click')
    expect(exportArtifactSpy).not.toHaveBeenCalled()
  })

  it('导出 ZIP 带上活动文件与工作区根', async () => {
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    await exportButtons(wrapper)[1].trigger('click')

    expect(exportArtifactSpy).toHaveBeenCalledWith({
      filePath: '/workspace/index.html',
      format: 'zip',
      workspaceRoot: '/workspace',
    })
    expect(statusText(wrapper)).toContain('/workspace/index.zip')
  })

  it('导出 PDF 成功后显示产物路径', async () => {
    exportArtifactSpy.mockResolvedValue({ ok: true, path: '/workspace/index.pdf' })
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    await exportButtons(wrapper)[2].trigger('click')

    expect(statusText(wrapper)).toContain('/workspace/index.pdf')
  })

  it('导出失败时显示失败原因', async () => {
    exportArtifactSpy.mockResolvedValue({ ok: false, error: 'Artifact not found: /ws/index.html' })
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    await exportButtons(wrapper)[2].trigger('click')

    expect(statusText(wrapper)).toContain('design.export.failed')
    expect(statusText(wrapper)).toContain('Artifact not found')
  })

  it('无桌面端 API 时提示未支持，而不是回显内部哨兵或假装成功', async () => {
    exportArtifactSpy.mockResolvedValue({
      ok: false,
      error: 'unsupported:electron-api-unavailable',
    })
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    await exportButtons(wrapper)[1].trigger('click')

    expect(statusText(wrapper)).toBe('design.export.unavailable')
  })

  it('导出进行中重复点击不会并发发起第二次', async () => {
    let release: ((v: { ok: true; path: string }) => void) | null = null
    exportArtifactSpy.mockImplementation(
      () => new Promise<{ ok: true; path: string }>(resolve => { release = resolve }),
    )
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    await exportButtons(wrapper)[1].trigger('click')
    expect(exportButtons(wrapper)[1].attributes('disabled')).toBeDefined()

    await exportButtons(wrapper)[1].trigger('click')
    expect(exportArtifactSpy).toHaveBeenCalledOnce()

    release!({ ok: true, path: '/workspace/index.zip' })
    await vi.waitFor(() => {
      expect(statusText(wrapper)).toContain('/workspace/index.zip')
    })
    expect(exportButtons(wrapper)[1].attributes('disabled')).toBeUndefined()
  })

  it('换 tab 后清空上一次的导出结果', async () => {
    const store = useDesignStore()
    openHtmlTab(store)
    const wrapper = mount(DesignFileWorkspace)
    await wrapper.vm.$nextTick()

    await exportButtons(wrapper)[1].trigger('click')
    expect(statusText(wrapper)).toContain('index.zip')

    store.addTab({ name: 'second.html', path: '/workspace/second.html', updatedAt: 0 })
    await wrapper.vm.$nextTick()

    expect(statusText(wrapper)).toBe('')
  })
})
