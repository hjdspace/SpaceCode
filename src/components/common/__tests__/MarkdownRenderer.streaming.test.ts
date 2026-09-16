import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer.vue'

const apiMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readFileAsBase64: vi.fn(),
  openExternal: vi.fn(),
  openFile: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: apiMocks.readFile,
    readFileAsBase64: apiMocks.readFileAsBase64,
    openExternal: apiMocks.openExternal,
    openFile: apiMocks.openFile,
  },
}))

describe('MarkdownRenderer streaming updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMocks.readFile.mockResolvedValue(null)
    apiMocks.readFileAsBase64.mockResolvedValue('aW1hZ2U=')
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
