<template>
  <Teleport to="body">
    <Transition name="popover">
      <div
        v-if="open"
        ref="panelRef"
        class="popover-panel"
        :class="{ 'is-anchored': anchored }"
        :style="panelStyle"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { isInsideAnyPopover, isInsidePopoverOpenedAfter, isTopmostPopover, pushPopover, removePopover } from './popoverStack'

const props = withDefaults(defineProps<{
  open: boolean
  /** 触发元素：面板贴着它定位，点它本身不算「点击外部」 */
  anchor: HTMLElement | null
  zIndex?: number
}>(), {
  zIndex: 1200,
})

const emit = defineEmits<{
  close: []
}>()

const EDGE_MARGIN = 8
const ANCHOR_GAP = 6

const panelRef = ref<HTMLElement | null>(null)
const anchored = ref(false)
const top = ref(0)
const left = ref(0)

/**
 * 宿主弹窗（如定时任务弹窗）的 overlay 是 z-index 1000，这里必须盖过它；
 * 同时宿主内部再弹出的选择器要靠更大的 zIndex 叠在上面。
 */
const panelStyle = computed<CSSProperties>(() => ({
  position: 'fixed',
  top: `${top.value}px`,
  left: `${left.value}px`,
  zIndex: props.zIndex,
}))

/**
 * 已打开的面板栈见 ./popoverStack.ts —— 共享状态必须放在真正的模块作用域，
 * 放在这里（<script setup> 内）会变成每个实例一份，嵌套浮层会被父层误关。
 * stackedEl 记住自己推进栈的那个元素：卸载钩子触发时模板 ref 可能已被置空，
 * 再读 panelRef 会漏掉出栈，让栈顶停在一个已失效的面板上。
 */
let stackedEl: HTMLElement | null = null

function stackSelf() {
  const el = panelRef.value
  if (!el || el === stackedEl) return
  stackedEl = el
  pushPopover(el)
}

function unstackSelf() {
  if (!stackedEl) return
  removePopover(stackedEl)
  stackedEl = null
}

function place() {
  const anchor = props.anchor
  const panel = panelRef.value
  if (!anchor || !panel) return

  const a = anchor.getBoundingClientRect()
  const h = panel.offsetHeight
  const w = panel.offsetWidth
  const spaceBelow = window.innerHeight - a.bottom - ANCHOR_GAP - EDGE_MARGIN
  const spaceAbove = a.top - ANCHOR_GAP - EDGE_MARGIN
  const flipUp = h > spaceBelow && spaceAbove > spaceBelow

  const desiredTop = flipUp ? a.top - ANCHOR_GAP - h : a.bottom + ANCHOR_GAP

  const nextTop = Math.max(EDGE_MARGIN, Math.min(desiredTop, window.innerHeight - h - EDGE_MARGIN))
  const nextLeft = Math.max(EDGE_MARGIN, Math.min(a.left, window.innerWidth - w - EDGE_MARGIN))
  // 值没变就不写 style：挪动含滚动器的面板会打断正在进行的滚动
  if (nextTop !== top.value || nextLeft !== left.value) {
    top.value = nextTop
    left.value = nextLeft
  }
  anchored.value = true
}

/**
 * 重定位合并到每帧一次：滚动期间反复强制布局 + 挪面板，滚动动量会被不断打断，
 * 面板里放滚动条类控件（时间滚轮）时尤其明显。
 */
let placeFrame = 0

function requestPlace() {
  if (placeFrame) return
  placeFrame = requestAnimationFrame(() => {
    placeFrame = 0
    place()
  })
}

function onScroll(e: Event) {
  // 捕获阶段的 scroll 会收到文档内任何滚动容器的滚动（含本面板内部），
  // 那些与锚点位置无关，直接跳过
  const source = e.target as Node | null
  if (source && (panelRef.value?.contains(source) || props.anchor?.contains(source))) return
  // 嵌套浮层（如排期面板里的时间滚轮）teleport 到 body 后不在本面板 DOM 里，
  // 但它内部的滚动同样动不了本面板的锚点。不跳过的话，宿主面板对着滚轮列
  // 每滚一格都 place() 一次 —— getBoundingClientRect/offsetHeight 是强制同步
  // 布局，这些工作攒在滚轮手势期间的主线程上就是肉眼可见的卡顿。
  if (source && panelRef.value && isInsidePopoverOpenedAfter(source, panelRef.value)) return
  requestPlace()
}

function onPointerDown(e: PointerEvent) {
  const target = e.target as Node | null
  if (!target) return
  if (isInsideAnyPopover(target)) return
  if (props.anchor?.contains(target)) return
  emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // 嵌套面板只关最上面一层；捕获阶段拦下，避免同一按键把宿主弹窗一起关掉
  if (!isTopmostPopover(panelRef.value)) return
  e.stopPropagation()
  emit('close')
}

function addListeners() {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
}

function removeListeners() {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeyDown, true)
  if (placeFrame) {
    cancelAnimationFrame(placeFrame)
    placeFrame = 0
  }
  unstackSelf()
}

watch(() => props.open, async (isOpen) => {
  removeListeners()
  anchored.value = false
  if (!isOpen) return
  await nextTick()
  stackSelf()
  place()
  addListeners()
})

onUnmounted(removeListeners)
</script>

<style lang="scss" scoped>
.popover-panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  // 定位完成前隐藏，避免固定面板先闪在视口左上角
  visibility: hidden;

  &.is-anchored {
    visibility: visible;
  }
}

.popover-enter-active,
.popover-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
