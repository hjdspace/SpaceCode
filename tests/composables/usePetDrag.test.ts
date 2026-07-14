/**
 * usePetDrag composable tests
 *
 * Tests pointer-based drag logic for the desktop pet widget:
 * - drag state toggles when pointer moves past threshold
 * - body cursor/userSelect are set during drag and cleared on pointer up
 * - body styles are cleaned up even if component unmounts before pointer up
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { usePetDrag } from '@/composables/usePetDrag'

function renderTestComponent(options: { mode: 'embedded' | 'desktop'; onDragEnd?: (pos: { x: number; y: number }) => void } = { mode: 'embedded' }) {
  const TestComponent = defineComponent({
    template: '<div ref="el" class="pet-embedded-widget" style="position:fixed;left:10px;top:20px;" @pointerdown="onPointerDown" />',
    setup() {
      const { isDragging, onPointerDown } = usePetDrag({
        mode: options.mode,
        onDragEnd: options.onDragEnd || (() => {}),
      })
      return { isDragging, onPointerDown }
    },
  })

  return mount(TestComponent, { attachTo: document.body })
}

describe('usePetDrag', () => {
  beforeEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('进入拖拽状态时设置 body cursor 和 userSelect', () => {
    const wrapper = renderTestComponent()
    const el = wrapper.element as HTMLElement

    let moveFired = false
    let upFired = false
    window.addEventListener('pointermove', () => { moveFired = true }, { once: true })
    window.addEventListener('pointerup', () => { upFired = true }, { once: true })

    el.dispatchEvent(new PointerEvent('pointerdown', { screenX: 100, screenY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { screenX: 110, screenY: 110, bubbles: true }))

    expect(moveFired).toBe(true)
    expect(document.body.style.cursor).toBe('grabbing')
    expect(document.body.style.userSelect).toBe('none')

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    expect(upFired).toBe(true)
    wrapper.unmount()
  })

  it('pointerup 时清除 body 样式', () => {
    const wrapper = renderTestComponent()
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(new PointerEvent('pointerdown', { screenX: 100, screenY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { screenX: 110, screenY: 110, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    wrapper.unmount()
  })

  it('组件卸载时即使未触发 pointerup 也清除 body 样式', () => {
    const wrapper = renderTestComponent()
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(new PointerEvent('pointerdown', { screenX: 100, screenY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { screenX: 110, screenY: 110, bubbles: true }))

    expect(document.body.style.cursor).toBe('grabbing')
    expect(document.body.style.userSelect).toBe('none')

    wrapper.unmount()

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('未超过拖拽阈值时不设置拖拽样式', () => {
    const wrapper = renderTestComponent()
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(new PointerEvent('pointerdown', { screenX: 100, screenY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { screenX: 102, screenY: 102, bubbles: true }))

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    wrapper.unmount()
  })
})
