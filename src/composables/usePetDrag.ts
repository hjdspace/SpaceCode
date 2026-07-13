// src/composables/usePetDrag.ts
import { ref, onUnmounted } from 'vue'

interface UsePetDragOptions {
  mode: 'embedded' | 'desktop'
  onDragEnd: (pos: { x: number; y: number }) => void
}

// 移动超过此阈值（像素）才认定为 drag，否则视为 click（避免微小抖动导致宠物漂移）
const DRAG_THRESHOLD = 4

export function usePetDrag(options: UsePetDragOptions) {
  const isDragging = ref(false)
  // 内部状态：pointer 已按下但还未达到 drag 阈值
  let isPointerDown = false
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0

  function handlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return
    const dx = e.screenX - startX
    const dy = e.screenY - startY

    // 未达到 drag 阈值时不移动，让浏览器正常触发 click
    if (!isDragging.value) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
        return
      }
      // 超过阈值，正式进入 drag 状态
      isDragging.value = true
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement | null
      if (el) {
        el.style.left = `${originLeft + dx}px`
        el.style.top = `${originTop + dy}px`
      }
    }
    // desktop 模式由独立窗口的 petWindowAPI 处理
  }

  function handlePointerUp() {
    if (!isPointerDown) return
    isPointerDown = false
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // 只有真正发生 drag 时才保存位置；否则视为 click，让 @click 正常触发
    if (!isDragging.value) return
    isDragging.value = false

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        const x = (rect.left + rect.width / 2) / window.innerWidth
        const y = (rect.top + rect.height / 2) / window.innerHeight
        options.onDragEnd({ x, y })
      }
    } else {
      options.onDragEnd({ x: 0, y: 0 })
    }
  }

  function onPointerDown(e: PointerEvent) {
    isPointerDown = true
    startX = e.screenX
    startY = e.screenY

    if (options.mode === 'embedded') {
      const el = document.querySelector('.pet-embedded-widget') as HTMLElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        originLeft = rect.left
        originTop = rect.top
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  onUnmounted(() => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  return { isDragging, onPointerDown }
}
