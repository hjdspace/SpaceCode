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

  it('defers the expensive file-link render until the stream becomes idle', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: 'Starting response' },
      global: { plugins: [createPinia()] },
    })

    for (let index = 0; index < 6; index++) {
      await wrapper.setProps({ content: `Streaming chunk ${index} references src/file-${index}.ts` })
      await vi.advanceTimersByTimeAsync(20)
    }

    expect(wrapper.find('.file-link').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(80)

    expect(wrapper.find('.file-link').exists()).toBe(true)
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
