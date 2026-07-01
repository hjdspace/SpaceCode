/**
 * useResizablePanel — 通用面板拖拽缩放 composable
 *
 * 从 App.vue 中抽取的左右面板、终端面板拖拽逻辑，封装为可复用的 composable。
 * 支持 horizontal / vertical 两种方向，支持 reverse（右面板/终端向上拖增大），
 * 支持动态 max（右面板最大宽度依赖左面板宽度）。
 */
import { ref, onUnmounted, type Ref } from 'vue'

export interface UseResizablePanelOptions {
  /** 初始尺寸（像素） */
  initial: number
  /** 最小尺寸（像素） */
  min: number
  /** 最大尺寸（像素），可为静态值或动态函数 */
  max: number | (() => number)
  /** 拖拽方向 */
  direction: 'horizontal' | 'vertical'
  /** 为 true 时，向负方向拖拽增大尺寸（右面板、底部终端） */
  reverse?: boolean
  /** 拖拽过程中尺寸更新的回调（用于同步外部 store） */
  onUpdate?: (size: number) => void
}

export interface UseResizablePanelReturn {
  /** 当前尺寸 */
  size: Ref<number>
  /** 是否正在拖拽 */
  isResizing: Ref<boolean>
  /** 绑定到 mousedown 事件的启动函数 */
  onMousedown: (e: MouseEvent) => void
}

export function useResizablePanel(options: UseResizablePanelOptions): UseResizablePanelReturn {
  const size = ref(options.initial)
  const isResizing = ref(false)

  let startPos = 0
  let startSize = 0

  function handleMousemove(e: MouseEvent) {
    if (!isResizing.value) return

    const currentPos = options.direction === 'horizontal' ? e.clientX : e.clientY
    let diff = currentPos - startPos
    if (options.reverse) diff = -diff

    const maxSize = typeof options.max === 'function' ? options.max() : options.max
    const newSize = Math.min(Math.max(startSize + diff, options.min), maxSize)

    size.value = newSize
    options.onUpdate?.(newSize)
  }

  function handleMouseup() {
    isResizing.value = false
    document.removeEventListener('mousemove', handleMousemove)
    document.removeEventListener('mouseup', handleMouseup)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function onMousedown(e: MouseEvent) {
    isResizing.value = true
    startPos = options.direction === 'horizontal' ? e.clientX : e.clientY
    startSize = size.value

    document.addEventListener('mousemove', handleMousemove)
    document.addEventListener('mouseup', handleMouseup)
    document.body.style.cursor = options.direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMousemove)
    document.removeEventListener('mouseup', handleMouseup)
  })

  return { size, isResizing, onMousedown }
}
