import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer.vue'

const apiMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readFileAsBase64: vi.fn(),
  openExternal: vi.fn(),
  openFile: vi.fn(),
  // 组件链路会实例化 settings/terminal store (app → chatSession → settings),
  // store 初始化调用这些 api; 缺失会产生 unhandled rejection / stderr 噪音
  loadGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminalOnExit: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: apiMocks.readFile,
    readFileAsBase64: apiMocks.readFileAsBase64,
    openExternal: apiMocks.openExternal,
    openFile: apiMocks.openFile,
    loadGuiSettings: apiMocks.loadGuiSettings,
    getEnv: apiMocks.getEnv,
    terminal: { onExit: apiMocks.terminalOnExit },
  },
}))

describe('MarkdownRenderer streaming updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMocks.readFile.mockResolvedValue(null)
    apiMocks.readFileAsBase64.mockResolvedValue('aW1hZ2U=')
    apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
    apiMocks.getEnv.mockResolvedValue(undefined)
    setActivePinia(createPinia())
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps file links rendered across streaming updates (no flicker)', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'See src/utils/helper.ts for details.' },
      global: { plugins: [createPinia()] },
    })

    for (let index = 0; index < 4; index++) {
      await wrapper.setProps({
        content: `See src/utils/helper.ts for details. Update ${index} touches src/file-${index}.ts too.`,
      })
      // 只推进到 rAF 渲染完成(0ms 定时器 + 微任务 flush), 不触发 80ms 后的尾随帧。
      // 这是旧实现(流式帧跳过 file-link 转换)渲染纯文本的时刻:
      // 若链接在此刻缺失, 说明存在 link → 纯文本 的闪烁回归。
      await vi.advanceTimersByTimeAsync(1)
      expect(wrapper.find('.file-link').exists()).toBe(true)
      // 推进超过节流间隔, 覆盖尾随帧兜底渲染 + 异步增强后的稳定态。
      await vi.advanceTimersByTimeAsync(160)
      expect(wrapper.find('.file-link').exists()).toBe(true)
    }

    const links = wrapper.findAll('.file-link')
    expect(links).toHaveLength(2)
    expect(links[1].attributes('data-file-path')).toBe('src/file-3.ts')
    wrapper.unmount()
  })

  it('keeps DOM nodes of completed blocks stable across streaming updates', async () => {
    // 注意: 路径正则的边界集合仅含 ASCII 标点, 路径后需跟空格等 ASCII 边界;
    // attachTo 让组件挂到真实文档上, isConnected 断言才有意义
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '第一段提到 src/a.ts 完成。\n\n第二段开始输出' },
      attachTo: document.body,
      global: { plugins: [createPinia()] },
    })
    // 让挂载渲染的 file-link 就位
    await nextTick()
    const linkEl = wrapper.find('.file-link').element
    expect(linkEl).toBeTruthy()

    await wrapper.setProps({ content: '第一段提到 src/a.ts 完成。\n\n第二段继续输出更多内容 src/b.ts' })
    await vi.advanceTimersByTimeAsync(100)

    // 完成块的 DOM 节点未被替换(同一元素对象仍在组件树中)
    // → hover 态/tooltip/校验标记不再因整块重建而闪烁
    expect(linkEl.isConnected).toBe(true)
    expect(wrapper.element.contains(linkEl)).toBe(true)
    expect(wrapper.findAll('.file-link')).toHaveLength(2)
    wrapper.unmount()
  })

  it('resolves local markdown images on initial render', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: {
        content: '![screenshot](./screenshots/demo.png)',
        filePath: 'D:/project/README.md',
      },
      global: { plugins: [createPinia()] },
    })

    await vi.runAllTimersAsync()

    expect(apiMocks.readFileAsBase64).toHaveBeenCalledWith('D:/project/screenshots/demo.png')
    expect(wrapper.find('img').attributes('src')).toBe('data:image/png;base64,aW1hZ2U=')
    wrapper.unmount()
  })
})
