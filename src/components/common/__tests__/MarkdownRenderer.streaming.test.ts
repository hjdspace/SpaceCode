import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer.vue'

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn(),
    openFile: vi.fn(),
  },
}))

describe('MarkdownRenderer streaming updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0))
  })

  afterEach(() => {
    vi.useRealTimers()
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
})
