/**
 * useDragDrop - Drag-and-drop logic extracted from ChatInput.vue
 *
 * Manages:
 * - Drag content detection
 * - Drop data extraction
 * - Drag state
 */
import { ref } from 'vue'

// ── Pure logic (exported for testing) ──────────────────────────

/** Check if a drag event has droppable content */
export function hasDragContent(dataTransferTypes: string[], files: Array<{ type: string }>): boolean {
  if (dataTransferTypes.includes('application/x-claude-path')) return true
  if (dataTransferTypes.includes('Files')) {
    return files.some(file => file.type.startsWith('image/'))
  }
  return false
}

/** Extract dropped data from a drop event */
export function extractDropData(dataTransfer: {
  getData: (type: string) => string
  files: Array<{ type: string; name: string }>
}): { type: 'tree-path'; path: string; isFolder: boolean; name: string } | { type: 'image-files'; files: Array<{ type: string; name: string }> } | null {
  const claudePath = dataTransfer.getData('application/x-claude-path')
  if (claudePath) {
    const nodeType = dataTransfer.getData('application/x-claude-type')
    const name = claudePath.split(/[/\\]/).pop() || claudePath
    return {
      type: 'tree-path',
      path: claudePath,
      isFolder: nodeType === 'directory',
      name,
    }
  }

  const imageFiles = Array.from(dataTransfer.files).filter(f => f.type.startsWith('image/'))
  if (imageFiles.length > 0) {
    return { type: 'image-files', files: imageFiles }
  }

  return null
}

// ── Composable ─────────────────────────────────────────────────

export function useDragDrop() {
  const isDragging = ref(false)

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer && hasDragContent(
      Array.from(e.dataTransfer.types),
      Array.from(e.dataTransfer.files || [])
    )) {
      isDragging.value = true
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer && hasDragContent(
      Array.from(e.dataTransfer.types),
      Array.from(e.dataTransfer.files || [])
    )) {
      isDragging.value = true
    }
  }

  function handleDragLeave(e: DragEvent, containerRect: DOMRect) {
    e.preventDefault()
    e.stopPropagation()
    const x = e.clientX
    const y = e.clientY
    if (x < containerRect.left || x > containerRect.right || y < containerRect.top || y > containerRect.bottom) {
      isDragging.value = false
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    isDragging.value = false

    if (!e.dataTransfer) return null
    return extractDropData({
      getData: (type: string) => e.dataTransfer!.getData(type),
      files: Array.from(e.dataTransfer.files || []),
    })
  }

  return {
    isDragging,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    hasDragContent,
    extractDropData,
  }
}
