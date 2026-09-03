/**
 * Drag-to-resize splitter between the SCM changes section and graph section.
 * Moved verbatim from the original ScmPanel.vue (flex-ratio based).
 */
import { ref, onUnmounted } from 'vue'

export function useScmSplit() {
  const isResizing = ref(false)
  const changesFlex = ref(2)
  const graphFlex = ref(1)
  let removeResizeListeners: (() => void) | null = null

  function startResize(e: MouseEvent): void {
    e.preventDefault()
    isResizing.value = true

    const panel = (e.currentTarget as HTMLElement).closest('.scm-panel') as HTMLElement
    if (!panel) return

    const changesEl = panel.querySelector('.changes-container') as HTMLElement
    const graphEl = panel.querySelector('.graph-section') as HTMLElement
    if (!changesEl || !graphEl) return

    const startY = e.clientY
    const startChangesHeight = changesEl.getBoundingClientRect().height
    const startGraphHeight = graphEl.getBoundingClientRect().height

    function onMouseMove(moveEvent: MouseEvent): void {
      const deltaY = moveEvent.clientY - startY
      const newChangesHeight = Math.max(80, startChangesHeight + deltaY)
      const newGraphHeight = Math.max(80, startGraphHeight - deltaY)
      const total = newChangesHeight + newGraphHeight
      changesFlex.value = newChangesHeight / total
      graphFlex.value = newGraphHeight / total
    }

    function onMouseUp(): void {
      isResizing.value = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      removeResizeListeners = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    removeResizeListeners = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      isResizing.value = false
    }

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  onUnmounted(() => {
    if (removeResizeListeners) removeResizeListeners()
  })

  return { isResizing, changesFlex, graphFlex, startResize }
}
