import type { Directive, DirectiveBinding } from 'vue'

/**
 * 应用内 hover/focus 气泡。用挂到 body 的 fixed 元素，而不是 CSS ::after ——
 * 工具栏在多层 overflow 容器里，::after 会被裁掉；native title 又延迟约 1 秒、
 * 中文长句换行不可控。
 *
 * 值为空时不渲染，所以调用方可以无脑传「提示文案或空串」。
 */
const CLASS_NAME = 'app-hint-bubble'
const GAP = 8
const EDGE = 8

interface HintElement extends HTMLElement {
  _hintText?: string
  _hintBound?: boolean
}

let current: HTMLElement | null = null

function destroy() {
  current?.remove()
  current = null
}

function show(el: HintElement) {
  const text = el._hintText
  if (!text) return
  destroy()

  const bubble = document.createElement('div')
  bubble.className = CLASS_NAME
  bubble.setAttribute('role', 'tooltip')
  bubble.textContent = text
  bubble.style.visibility = 'hidden'
  document.body.appendChild(bubble)

  const anchor = el.getBoundingClientRect()
  const { width, height } = bubble.getBoundingClientRect()

  let top = anchor.top - height - GAP
  if (top < EDGE) top = Math.min(anchor.bottom + GAP, window.innerHeight - height - EDGE)
  let left = anchor.left + anchor.width / 2 - width / 2
  left = Math.min(Math.max(left, EDGE), window.innerWidth - width - EDGE)

  bubble.style.top = `${Math.round(top)}px`
  bubble.style.left = `${Math.round(left)}px`
  bubble.style.visibility = ''
  current = bubble
}

export const vHint: Directive<HintElement, string | undefined> = {
  mounted(el, binding: DirectiveBinding<string | undefined>) {
    el._hintText = binding.value || ''
    if (el._hintBound) return
    el._hintBound = true
    el.addEventListener('mouseenter', () => show(el))
    el.addEventListener('mouseleave', destroy)
    el.addEventListener('focusin', () => show(el))
    el.addEventListener('focusout', destroy)
  },
  updated(el, binding: DirectiveBinding<string | undefined>) {
    el._hintText = binding.value || ''
  },
  unmounted() {
    destroy()
  },
}

window.addEventListener('scroll', destroy, true)
window.addEventListener('resize', destroy)
