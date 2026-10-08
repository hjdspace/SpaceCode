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

  /**
   * 嵌套浮层：宿主面板的 slot 里长出锚点，子面板真 Teleport 到 body（不能 stub，
   * 否则子面板落在宿主 DOM 里，「宿主 own-panel 跳过」会掩盖要测的栈序分支）。
   */
  async function mountNestedPair() {
    const host = mount(PopoverPanel, {
      props: { open: false, anchor },
      global: { stubs: { Teleport: true } },
      slots: {
        default: '<div class="inner-scroller"><div id="nest-point"><button id="nest-anchor" /></div></div>',
      },
      attachTo: document.body,
    })
    await host.setProps({ open: true })
    await flushPromises()
    await nextFrame()

    const nestAnchor = document.getElementById('nest-anchor') as HTMLElement
    const nestPoint = document.getElementById('nest-point') as HTMLElement
    const nested = mount(PopoverPanel, {
      props: { open: false, anchor: nestAnchor },
      slots: { default: '<div class="nested-scroller" />' },
      attachTo: nestPoint,
    })
    await nested.setProps({ open: true })
    await flushPromises()
    await nextFrame()
    return { host, nested }
  }

  it('嵌套浮层内部滚动不触发宿主重定位（teleport 后不在宿主 DOM 里）', async () => {
    await mountNestedPair()

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rectSpy.mockClear()

    // 子面板（时间滚轮等）内部的滚动：宿主跳过（栈序规则），子面板自己跳过（own-panel）
    const nestedScroller = document.querySelector('.nested-scroller') as HTMLElement
    nestedScroller.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(rectSpy).not.toHaveBeenCalled()
  })

  it('宿主面板内容滚动时嵌套浮层仍跟随锚点重定位', async () => {
    await mountNestedPair()

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rectSpy.mockClear()

    // 宿主内容滚动会移动嵌套浮层的锚点 —— 嵌套那层必须重定位，宿主自己跳过
    const hostScroller = document.querySelector('.inner-scroller') as HTMLElement
    hostScroller.dispatchEvent(new Event('scroll'))
    await nextFrame()
    expect(rectSpy).toHaveBeenCalledTimes(1)
  })
})
