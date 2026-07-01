<template>
  <div
    class="pane-divider"
    :class="[direction, { active: dragging }]"
    @mousedown.prevent="onDown"
    role="separator"
    :aria-orientation="direction === 'row' ? 'vertical' : 'horizontal'"
  />
</template>

<script setup lang="ts">
/**
 * PaneDivider — 拖拽调整 split 比例
 *
 * 实现要点：
 *  - 用 mousedown 注册 window 级别的 mousemove/mouseup，避免拖出元素丢失事件。
 *  - 起始时缓存父 split 的 boundingClientRect；用 mouse 当前位置除以总长度算 ratio。
 *  - ratio clamp 在 [0.1, 0.9]，与 store.setSplitRatio 内部约束一致。
 */
import { ref } from 'vue'
import { useSplitLayoutStore } from '@/stores/splitLayout'

const props = defineProps<{
  splitId: string
  direction: 'row' | 'column'
  /** 拖拽起点参考的容器（split 节点自身的 DOM） */
  containerRef: HTMLElement | null
}>()

const splitLayout = useSplitLayoutStore()
const dragging = ref(false)

let startRect: DOMRect | null = null

function onMove(e: MouseEvent) {
  if (!dragging.value || !startRect) return
  let ratio: number
  if (props.direction === 'row') {
    const x = e.clientX - startRect.left
    ratio = x / startRect.width
  } else {
    const y = e.clientY - startRect.top
    ratio = y / startRect.height
  }
  splitLayout.setSplitRatio(props.splitId, ratio)
}

function onUp() {
  dragging.value = false
  startRect = null
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function onDown() {
  if (!props.containerRef) return
  dragging.value = true
  startRect = props.containerRef.getBoundingClientRect()
  document.body.style.cursor = props.direction === 'row' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<style lang="scss" scoped>
.pane-divider {
  background: var(--surface-border, transparent);
  transition: background 0.15s ease;
  position: relative;
  z-index: 5;

  &.row {
    cursor: col-resize;
    width: 4px;
    // 加一个不可见的命中扩展区，更易拖拽
    &::after {
      content: '';
      position: absolute;
      top: 0; bottom: 0;
      left: -3px; right: -3px;
    }
  }
  &.column {
    cursor: row-resize;
    height: 4px;
    &::after {
      content: '';
      position: absolute;
      left: 0; right: 0;
      top: -3px; bottom: -3px;
    }
  }

  &:hover,
  &.active {
    background: var(--accent-primary, #3b82f6);
  }
}
</style>
