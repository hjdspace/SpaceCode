import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DesignPreview from '../DesignPreview.vue'
import { PREVIEW_BRIDGE_READY_TIMEOUT_MS } from '@/lib/artifacts/previewBridge'
import { api } from '@/services/electronAPI'

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

/** jsdom 的 iframe 内容窗口不确定，安全用例自己钉一个可比较的对象。 */
function stubFrameWindow(el: HTMLIFrameElement): Window {
  const win = {} as Window
  Object.defineProperty(el, 'contentWindow', { configurable: true, get: () => win })
  return win
}

/** 从 srcdoc 里取本实例写进去的桥密钥。 */
function nonceOf(el: HTMLIFrameElement): string {
  const match = (el.getAttribute('srcdoc') || '').match(/var NONCE = "([^"]+)"/)
  if (!match) throw new Error('nonce missing from srcdoc')
  return match[1]
}

function messageEvent(data: unknown, source: unknown, ports: MessagePort[] = []): MessageEvent {
  const event = new MessageEvent('message', { data })
  Object.defineProperty(event, 'source', { value: source })
  Object.defineProperty(event, 'ports', { value: ports })
  return event
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

  it('sandbox 收紧到实际所需：保留 scripts / popups，不放同源与下载', () => {
    const wrapper = mountPreview({ previewUrl: URL_A })
    const sandbox = frame(wrapper).getAttribute('sandbox') || ''

    expect(sandbox).toBe('allow-scripts allow-popups')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-downloads')
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

  it('桥未就绪时先缓存最新内容，超时确认不可用后退回整文档重载', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountPreview({ previewUrl: null })
      const el = frame(wrapper)
      const initial = el.getAttribute('srcdoc')

      await wrapper.setProps({ html: '<html><body>second version</body></html>' })
      // ready 没来：不整文档重载，避免闪烁
      expect(el.getAttribute('srcdoc')).toBe(initial)

      vi.advanceTimersByTime(PREVIEW_BRIDGE_READY_TIMEOUT_MS)
      expect(el.getAttribute('srcdoc')).toContain('second version')

      await wrapper.setProps({ html: '<html><body>third version</body></html>' })
      expect(el.getAttribute('srcdoc')).toContain('third version')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DesignPreview — 桥的来源与密钥闸门', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('非本 frame 的消息（弹窗、其他 iframe）即使密钥正确也被丢弃', () => {
    const wrapper = mountPreview({ previewUrl: null })
    const el = frame(wrapper)
    stubFrameWindow(el)

    window.dispatchEvent(messageEvent(
      { type: 'od:sandbox:open', nonce: nonceOf(el), url: 'https://evil.test' },
      { notTheFrame: true },
    ))

    expect(api.shell.openExternal).not.toHaveBeenCalled()
  })

  it('缺少或错误密钥的消息不触发任何动作', () => {
    const wrapper = mountPreview({ previewUrl: null })
    const el = frame(wrapper)
    const win = stubFrameWindow(el)

    window.dispatchEvent(messageEvent({ type: 'od:sandbox:open', url: 'https://evil.test' }, win))
    window.dispatchEvent(messageEvent({ type: 'od:sandbox:open', nonce: 'other', url: 'https://evil.test' }, win))
    window.dispatchEvent(messageEvent({ type: 'od:sandbox:alert', nonce: 'other', message: 'spoof' }, win))

    expect(api.shell.openExternal).not.toHaveBeenCalled()
    expect(api.showNotification).not.toHaveBeenCalled()
  })

  it('未知 type 不落任何通用 IPC', () => {
    const wrapper = mountPreview({ previewUrl: null })
    const el = frame(wrapper)
    const win = stubFrameWindow(el)

    window.dispatchEvent(messageEvent({ type: 'od:unknown', nonce: nonceOf(el), url: 'file:///C:/x.exe' }, win))
    window.dispatchEvent(messageEvent({ type: 'genui:action', nonce: nonceOf(el) }, win))

    expect(api.shell.openExternal).not.toHaveBeenCalled()
    expect(api.showNotification).not.toHaveBeenCalled()
  })

  it('外链只放行 http/https，file 与自定义 scheme 不进系统 Shell', () => {
    const wrapper = mountPreview({ previewUrl: null })
    const el = frame(wrapper)
    const win = stubFrameWindow(el)
    const nonce = nonceOf(el)

    for (const url of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-settings:']) {
      window.dispatchEvent(messageEvent({ type: 'od:sandbox:open', nonce, url }, win))
    }
    expect(api.shell.openExternal).not.toHaveBeenCalled()

    window.dispatchEvent(messageEvent({ type: 'od:sandbox:open', nonce, url: 'https://example.com/a' }, win))
    expect(api.shell.openExternal).toHaveBeenCalledWith('https://example.com/a')
  })

  it('ready 带来端口后，HTML 更新走端口而不是整文档重载', async () => {
    const wrapper = mountPreview({ previewUrl: null })
    const el = frame(wrapper)
    const win = stubFrameWindow(el)
    const nonce = nonceOf(el)
    const port = { postMessage: vi.fn(), close: vi.fn() } as unknown as MessagePort

    window.dispatchEvent(messageEvent({ type: 'od:sandbox:ready', nonce }, win, [port]))

    const before = el.getAttribute('srcdoc')
    await wrapper.setProps({ html: '<html><body>streamed</body></html>' })

    expect(el.getAttribute('srcdoc')).toBe(before)
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'od:srcdoc-transport-activate',
      nonce,
      html: expect.stringContaining('streamed'),
    })
  })

  it('切到预览服务器路径后，迟到的桥消息不再被处理', async () => {
    const wrapper = mountPreview({ previewUrl: null })
    const el = frame(wrapper)
    const win = stubFrameWindow(el)
    const nonce = nonceOf(el)

    await wrapper.setProps({ previewUrl: URL_A })
    window.dispatchEvent(messageEvent({ type: 'od:sandbox:open', nonce, url: 'https://example.com' }, win))

    expect(api.shell.openExternal).not.toHaveBeenCalled()
  })

  it('每个预览实例的桥密钥都不同', () => {
    const first = mountPreview({ previewUrl: null })
    const second = mountPreview({ previewUrl: null })

    expect(nonceOf(frame(first))).not.toBe(nonceOf(frame(second)))
  })
})

/**
 * 票 09（原审计第 5 项）：源码/预览切换会让本组件整体卸载重挂，重挂时 props 早已备好，
 * watch 不会再触发。审计当时的表现就是初始 `iframe.srcdoc` 是空字符串，必须再 setProps
 * 一次才出内容（首屏白屏）。现在渲染挪到 onMounted，这两条钉住"挂载即渲染"的契约 ——
 * 谁把 onMounted 里的 renderPreview 挪回 watch，这里就会红。
 */
describe('DesignPreview — 卸载重挂后首屏即渲染', () => {
  it('预览 URL 已就位：重挂载当场导航，不再等下一次 props 变化', () => {
    mountPreview({ previewUrl: URL_A, reloadToken: 1 }).unmount()

    const again = mountPreview({ previewUrl: URL_A, reloadToken: 1 })

    expect(frame(again).getAttribute('src')).toBe(`${URL_A}?rev=1`)
    expect(frame(again).getAttribute('srcdoc')).toBeNull()
  })

  it('只有 HTML（回退路径）：重挂载当场写入 srcdoc，首屏不白屏', () => {
    mountPreview({ previewUrl: null }).unmount()

    const again = mountPreview({ previewUrl: null })

    expect(frame(again).getAttribute('srcdoc')).toContain('<h1>already generated</h1>')
  })
})
