// src/composables/usePetDrag.ts
import { ref, onUnmounted } from 'vue'

interface UsePetDragOptions {
  mode: 'embedded' | 'desktop'
  onDragEnd: (pos: { x: number; y: number }) => void
}

export function usePetDrag(options: UsePetDragOptions) {
  const isDragging = ref(false)
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging.value) return
    const dx = e.screenX - startX
    const dy = e.screenY - startY

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
    if (!isDragging.value) return
    isDragging.value = false
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

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
    isDragging.value = true
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
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  onUnmounted(() => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
  })

  return { isDragging, onPointerDown }
}
