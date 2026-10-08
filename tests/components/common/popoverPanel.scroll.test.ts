/**
 * PopoverPanel 的滚动跟随测试 — 只有关键路径：面板内部的滚动不能触发重定位。
 * 重定位会读 getBoundingClientRect/offsetHeight 并写 top/left，
 * 挪动含滚动器的面板会打断正在进行的滚动（时间滚轮的手感就毁在这里）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import PopoverPanel from '@/components/common/PopoverPanel.vue'

enableAutoUnmount(afterEach)

let anchor: HTMLElement

beforeEach(() => {
  anchor = document.createElement('button')
  document.body.appendChild(anchor)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function mountPanel() {
  const wrapper = mount(PopoverPanel, {
    props: { open: false, anchor: null as unknown as HTMLElement },
    global: { stubs: { Teleport: true } },
    slots: { default: '<div class="inner-scroller" />' },
    attachTo: document.body,
  })
  // 监听器挂在 open 的 watch 上，必须经历 false → true 才注册
  return wrapper
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

describe('PopoverPanel 滚动跟随', () => {
  it('面板内部滚动不重定位，面板外的滚动才重定位', async () => {
    const wrapper = mountPanel()
    await wrapper.setProps({ open: true, anchor })
    await flushPromises()
    await nextFrame()

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rectSpy.mockClear()

    const panel = wrapper.find('.popover-panel').element
    const inner = panel.querySelector('.inner-scroller') as HTMLElement
    inner.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(rectSpy).not.toHaveBeenCalled()

    // 页面/宿主容器滚动时锚点会移动，这时必须重新定位
    document.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(rectSpy).toHaveBeenCalled()
  })

  it('同一帧内的多次滚动只重定位一次', async () => {
    const wrapper = mountPanel()
    await wrapper.setProps({ open: true, anchor })
    await flushPromises()
    await nextFrame()

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rectSpy.mockClear()

    document.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(rectSpy).toHaveBeenCalledTimes(1)
  })
})
