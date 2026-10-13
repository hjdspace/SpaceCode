/**
 * useFileAttachments - File attachment operations extracted from ChatInput.vue
 *
 * Manages:
 * - Attached files state
 * - Attachment menu state
 * - Duplicate detection
 * - Native dialog fallback ("浏览文件...")
 */
import { ref } from 'vue'
import { api } from '@/services/electronAPI'
import type { Attachment } from '@/composables/types'

// ── Pure logic (exported for testing) ──────────────────────────

/** Build relative path from working directory and full path */
export function buildRelativePath(workingDirectory: string | undefined, filePath: string): string {
  if (!workingDirectory) return filePath.split(/[/\\]/).pop() || filePath
  return filePath.replace(workingDirectory, '').replace(/^[/\\]/, '')
}

/** Check if file is already attached */
export function isDuplicateAttachment(files: Attachment[], path: string): boolean {
  return files.some(f => f.path === path)
}

// ── Composable ─────────────────────────────────────────────────

export function useFileAttachments(options?: {
  workingDirectory?: () => string
  onInsertChip?: (name: string, path: string, isFolder: boolean) => void
}) {
  const attachedFiles = ref<Attachment[]>([])
  const showAttachmentMenu = ref(false)

  function addFile(name: string, path: string, isFolder: boolean): boolean {
    if (isDuplicateAttachment(attachedFiles.value, path)) return false
    attachedFiles.value.push({ name, path, isFolder })
    options?.onInsertChip?.(name, path, isFolder)
    return true
  }

  function clearFiles() {
    attachedFiles.value = []
  }

  function handleAddClick() {
    showAttachmentMenu.value = !showAttachmentMenu.value
  }

  function closeAttachmentMenu() {
    showAttachmentMenu.value = false
  }

  async function handleBrowseFiles() {
    try {
      const result = await api.selectFiles()
      if (!result.canceled && result.filePaths.length > 0) {
        const wd = options?.workingDirectory?.()
        for (const filePath of result.filePaths) {
          const name = buildRelativePath(wd, filePath)
          addFile(name, filePath, false)
        }
      }
    } catch (error) {
      console.error('Failed to browse files:', error)
    }
  }

  return {
    attachedFiles,
    showAttachmentMenu,
    addFile,
    clearFiles,
    handleAddClick,
    closeAttachmentMenu,
    handleBrowseFiles,
  }
}
