import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DesignPreview from '../DesignPreview.vue'

// DesignPreview 只用 api 做通知/外链跳转，与本轮资源加载无关
vi.mock('@/services/electronAPI', () => ({
  api: {
    showNotification: vi.fn(),
    shell: { openExternal: vi.fn() },
  },
}))

const URL_A = 'http://127.0.0.1:54321/3f9a01c2/index.html'
const URL_B = 'http://127.0.0.1:54321/3f9a01c2/pages/other.html'
const HTML = '<html><body><h1>already generated</h1></body></html>'

function mountPreview(props: Record<string, unknown> = {}) {
  return mount(DesignPreview, {
    props: {
      html: HTML,
      title: 'index.html',
      sessionId: 'sess-1',
      previewUrl: null,
      reloadToken: 0,
      ...props,
    },
  })
}

function frame(wrapper: ReturnType<typeof mountPreview>): HTMLIFrameElement {
  return wrapper.find('iframe.preview-iframe').element as HTMLIFrameElement
}

describe('DesignPreview — 多文件设计的资源加载', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('拿到预览 URL 时用 iframe.src 加载，页面内相对 CSS/JS 才能命中产物目录', () => {
    const wrapper = mountPreview({ previewUrl: URL_A })
    const el = frame(wrapper)

    expect(el.getAttribute('src')).toBe(`${URL_A}?rev=0`)
    // srcdoc 文档的相对 URL 相对宿主页面解析，必须不再走这条路
    expect(el.getAttribute('srcdoc')).toBeNull()
  })

  it('沙箱边界保持不变：不放开 allow-same-origin', () => {
    const wrapper = mountPreview({ previewUrl: URL_A })
    const sandbox = frame(wrapper).getAttribute('sandbox') || ''

    expect(sandbox).toBe('allow-scripts allow-popups allow-downloads')
    expect(sandbox).not.toContain('allow-same-origin')
  })

  it('reloadToken 递增后重新导航，CSS/JS 改动会被重新取回', async () => {
    const wrapper = mountPreview({ previewUrl: URL_A })

    await wrapper.setProps({ reloadToken: 3 })

    expect(frame(wrapper).getAttribute('src')).toBe(`${URL_A}?rev=3`)
  })

  it('切换活动文件时导航到新 URL', async () => {
    const wrapper = mountPreview({ previewUrl: URL_A, reloadToken: 2 })

    await wrapper.setProps({ previewUrl: URL_B })

    expect(frame(wrapper).getAttribute('src')).toBe(`${URL_B}?rev=2`)
  })

  it('无预览 URL（H5 模式 / 服务器未就绪）时回退 srcdoc，且挂载即渲染已有 HTML', () => {
    const wrapper = mountPreview({ previewUrl: null })
    const srcdoc = frame(wrapper).getAttribute('srcdoc') || ''

    expect(srcdoc).toContain('<h1>already generated</h1>')
    expect(srcdoc).toContain('od-transport-bridge')
  })

  it('回退路径下 HTML 继续变化时更新 srcdoc', async () => {
    const wrapper = mountPreview({ previewUrl: null })

    await wrapper.setProps({ html: '<html><body>second version</body></html>' })

    expect(frame(wrapper).getAttribute('srcdoc')).toContain('second version')
  })
})
