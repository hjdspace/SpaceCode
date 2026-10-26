import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignStore } from '@/stores/design'

// ── Hoisted spies: accessible both in mock factory and test body ──
const { onFileChangedSpy, readFileSpy, getFrameUrlSpy, urlFor, fileChangedCallback, appStoreProbe } = vi.hoisted(() => {
  let cb: ((event: { sessionId: string; filepath: string }) => void) | null = null
  // 模拟票 06 的 preview:getUrl：返回带 token 的、已登记工作区的预览 URL
  const urlFor = (filePath: string): string | null =>
    `spacecode-preview://artifact/TOKEN/${filePath.split(/[\\/]/).pop()}`
  return {
    onFileChangedSpy: vi.fn((callback: (event: { sessionId: string; filepath: string }) => void) => {
      cb = callback
      return () => { cb = null }
    }),
    // app store 只承担「弹开右侧面板」这一个动作；真实显隐语义在
    // stores/__tests__/app.panelTabs.test.ts 钉住
    appStoreProbe: { openDesignPreview: vi.fn() },
    readFileSpy: vi.fn().mockResolvedValue('<html><body>mock</body></html>'),
    getFrameUrlSpy: vi.fn(async (filePath: string, _workspaceRoot?: string): Promise<string | null> =>
      urlFor(filePath),
    ),
    urlFor,
    fileChangedCallback: {
      get current() { return cb },
      trigger(event: { sessionId: string; filepath: string }) {
        cb?.(event)
      },
    },
  }
})

vi.mock('@/services/electronAPI', () => ({
  api: {
    design: {
      onFileChanged: onFileChangedSpy,
      exportArtifact: vi.fn(),
    },
    readFile: readFileSpy,
    preview: { getFrameUrl: getFrameUrlSpy },
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => appStoreProbe,
}))

// Stub child components to avoid mounting their dependencies
vi.mock('../DesignPreview.vue', () => ({
  default: {
    name: 'DesignPreviewStub',
    props: {
      html: { type: String, default: '' },
      title: { type: String, default: '' },
      sessionId: { type: String, default: '' },
      previewUrl: { type: String, default: null as unknown as string | null },
      reloadToken: { type: Number, default: 0 },
    },
    template: '<div class="design-preview-stub" />',
  },
}))
vi.mock('../WorkspaceTabsBar.vue', () => ({
  default: { template: '<div class="tabs-bar-stub" />' },
}))

import DesignFileWorkspace from '../DesignFileWorkspace.vue'

/** 读取当前渲染中的预览组件入参；未渲染时返回 null */
function previewProps(wrapper: ReturnType<typeof mount>) {
  const stub = wrapper.findComponent({ name: 'DesignPreviewStub' })
  return stub.exists() ? (stub.props() as Record<string, unknown>) : null
}

describe('DesignFileWorkspace — onFileChanged regression', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Reset spy defaults (clearAllMocks 只清调用记录，不清 mockResolvedValue)
    readFileSpy.mockResolvedValue('<html><body>mock</body></html>')
    getFrameUrlSpy.mockImplementation(async (filePath: string) => urlFor(filePath))
  })

  it('挂载时注册 onFileChanged 监听器', () => {
    mount(DesignFileWorkspace)
    expect(onFileChangedSpy).toHaveBeenCalledOnce()
  })

  it('HTML 文件变更：更新 artifactFiles 并自动打开 tab', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)

    // 模拟 LLM 写入 index.html
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    expect(store.artifactFiles[0].name).toBe('index.html')
    expect(store.artifactFiles[0].path).toBe('/workspace/index.html')
    // 自动打开 tab
    expect(store.openTabs).toHaveLength(1)
    expect(store.activeTabPath).toBe('/workspace/index.html')
  })

  it('CSS 文件变更：更新 artifactFiles 但不自动打开 tab', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)

    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/style.css' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    expect(store.artifactFiles[0].name).toBe('style.css')
    // CSS 不自动开 tab
    expect(store.openTabs).toHaveLength(0)
    expect(store.activeTabPath).toBeNull()
  })

  it('不同 sessionId 的事件被忽略', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)

    fileChangedCallback.trigger({ sessionId: 'other-session', filepath: '/workspace/index.html' })
    // 给 async handler 一点时间确保不执行
    await new Promise(r => setTimeout(r, 50))

    expect(store.artifactFiles).toHaveLength(0)
    expect(store.openTabs).toHaveLength(0)
  })

  it('已打开 tab 的 HTML 文件被修改时刷新预览内容', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    // 预设已打开的 tab
    store.addTab({ name: 'index.html', path: '/workspace/index.html', updatedAt: 0 })

    readFileSpy.mockResolvedValue('<html><body>updated</body></html>')

    mount(DesignFileWorkspace)

    // 触发同一文件的修改事件
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.previewHtml).toBe('<html><body>updated</body></html>')
    })

    // 不应重复添加 tab
    expect(store.openTabs).toHaveLength(1)
    // artifactFiles 应有该文件
    expect(store.artifactFiles).toHaveLength(1)
  })

  it('卸载时注销 onFileChanged 监听器', () => {
    const wrapper = mount(DesignFileWorkspace)
    expect(fileChangedCallback.current).not.toBeNull()

    wrapper.unmount()
    expect(fileChangedCallback.current).toBeNull()
  })
})

describe('DesignFileWorkspace — 新产物弹开右侧面板的请求', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    readFileSpy.mockResolvedValue('<html><body>mock</body></html>')
    getFrameUrlSpy.mockImplementation(async (filePath: string) => urlFor(filePath))
  })

  it('新 HTML 产物：请求弹开右侧面板', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    expect(appStoreProbe.openDesignPreview).toHaveBeenCalledOnce()
  })

  it('新 CSS 产物不请求弹开：css/js 只是 HTML 的配套资源', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/style.css' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    expect(appStoreProbe.openDesignPreview).not.toHaveBeenCalled()
  })

  it('同一产物的后续改写不再请求；另一份新 HTML 仍请求（不因用户收起过而抑制）', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'

    mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })
    appStoreProbe.openDesignPreview.mockClear()

    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await new Promise(r => setTimeout(r, 50))
    expect(appStoreProbe.openDesignPreview).not.toHaveBeenCalled()

    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/page-two.html' })
    await vi.waitFor(() => {
      expect(appStoreProbe.openDesignPreview).toHaveBeenCalledOnce()
    })
    expect(store.artifactFiles).toHaveLength(2)
  })
})

describe('DesignFileWorkspace — 多文件设计的相对资源加载', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    readFileSpy.mockResolvedValue('<html><body>mock</body></html>')
    getFrameUrlSpy.mockImplementation(async (filePath: string) => urlFor(filePath))
  })

  it('活动 HTML tab 以工作区根登记预览 URL 并交给预览组件', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })

    await vi.waitFor(() => {
      expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
    })
    expect(getFrameUrlSpy).toHaveBeenCalledWith('/workspace/index.html', '/workspace')
  })

  it('CSS 变更后活动 HTML 预览自动重载：reloadToken 递增且 URL 不变', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
    })
    const before = Number(previewProps(wrapper)?.reloadToken)

    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/style.css' })
    await vi.waitFor(() => {
      expect(Number(previewProps(wrapper)?.reloadToken)).toBe(before + 1)
    })

    expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
  })

  it('JS 变更后同样重载，并且不重复读取 HTML 内容', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
    })
    readFileSpy.mockClear()

    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/app.js' })
    await vi.waitFor(() => {
      expect(Number(previewProps(wrapper)?.reloadToken)).toBe(1)
    })

    expect(readFileSpy).not.toHaveBeenCalled()
  })

  it('HTML 自身变更只刷新内容，不再递增 reloadToken（内容走桥注入而非整页导航）', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
    })

    readFileSpy.mockResolvedValue('<html><body>v2</body></html>')
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(store.previewHtml).toBe('<html><body>v2</body></html>')
    })

    expect(Number(previewProps(wrapper)?.reloadToken)).toBe(0)
  })

  it('激活的是 CSS tab 时，其他资源变更不触发预览重载', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/style.css' })
    await vi.waitFor(() => {
      expect(store.artifactFiles).toHaveLength(1)
    })

    // 用户手动打开 CSS 文件（源码视图），预览组件未渲染
    store.addTab({ name: 'style.css', path: '/workspace/style.css', updatedAt: 0 })
    await wrapper.vm.$nextTick()
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/app.js' })
    await new Promise(r => setTimeout(r, 30))

    expect(getFrameUrlSpy).not.toHaveBeenCalled()
    expect(previewProps(wrapper)).toBeNull()
  })

  it('InfoPanel 重挂载后已有活动 tab 也会登记预览 URL', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'
    store.addTab({ name: 'index.html', path: '/workspace/index.html', updatedAt: 0 })

    mount(DesignFileWorkspace)

    await vi.waitFor(() => {
      expect(getFrameUrlSpy).toHaveBeenCalledWith('/workspace/index.html', '/workspace')
    })
  })

  it('快速连续切 tab 时，晚到的旧读取不覆盖新文件的预览状态', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    let releaseStale: ((v: string) => void) | null = null
    readFileSpy.mockImplementation((filePath: string) => {
      if (filePath === '/workspace/index.html') {
        return new Promise<string>((resolve) => { releaseStale = resolve })
      }
      return Promise.resolve(`<html><body>${filePath}</body></html>`)
    })

    const wrapper = mount(DesignFileWorkspace)
    // 第一个文件的读取挂起，待它真的在途之后再切到第二个（快速返回）
    store.addTab({ name: 'index.html', path: '/workspace/index.html', updatedAt: 0 })
    await vi.waitFor(() => {
      expect(releaseStale).not.toBeNull()
    })
    store.addTab({ name: 'second.html', path: '/workspace/second.html', updatedAt: 0 })
    await vi.waitFor(() => {
      expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/second.html')
    })

    releaseStale!('<html><body>stale</body></html>')
    await new Promise(r => setTimeout(r, 30))

    expect(store.previewHtml).toBe('<html><body>/workspace/second.html</body></html>')
    expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/second.html')
  })

  it('非 Electron 环境拿不到预览 URL 时回退到原有 srcdoc 管线', async () => {
    getFrameUrlSpy.mockResolvedValue(null)
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })

    await vi.waitFor(() => {
      expect(previewProps(wrapper)).not.toBeNull()
    })
    expect(previewProps(wrapper)?.previewUrl).toBeFalsy()
    expect(store.previewHtml).toBe('<html><body>mock</body></html>')
  })

  /**
   * 票 09（原审计第 5 项）的条件渲染那一半：预览组件挂在 `v-else-if="viewMode === 'preview'"`
   * 上，切到源码就整体卸载。切回来时它是一次全新挂载，没有第二次 watch 触发，所以父层必须
   * 把 html 与 URL **成对**备好 —— 子组件才能在 onMounted 当场渲染，不再白屏等下一次变更。
   */
  it('源码切回预览会重挂载预览组件，且重挂时就拿到成对的 html 与预览 URL', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'sess-1'
    store.designWorkspace = '/workspace'

    const wrapper = mount(DesignFileWorkspace)
    fileChangedCallback.trigger({ sessionId: 'sess-1', filepath: '/workspace/index.html' })
    await vi.waitFor(() => {
      expect(previewProps(wrapper)?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
    })

    const [previewBtn, sourceBtn] = wrapper.findAll('.ws-toolbar button')
    await sourceBtn.trigger('click')
    expect(previewProps(wrapper)).toBeNull()

    await previewBtn.trigger('click')
    const props = previewProps(wrapper)
    expect(props?.previewUrl).toBe('spacecode-preview://artifact/TOKEN/index.html')
    expect(props?.html).toBe('<html><body>mock</body></html>')
  })
})
