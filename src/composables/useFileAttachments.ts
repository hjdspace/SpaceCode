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

  /**
   * 上传的附件不再写进编辑器（不插内联 chip），由输入框上方的卡片区承载。
   * name 取 basename，卡片只展示文件名。
   */
  function addUploadedFile(path: string): boolean {
    if (isDuplicateAttachment(attachedFiles.value, path)) return false
    attachedFiles.value.push({
      name: buildRelativePath(undefined, path),
      path,
      isFolder: false,
      source: 'upload',
    })
    return true
  }

  async function addUploadedFilesFromDialog(): Promise<number> {
    try {
      const result = await api.selectFiles()
      if (result.canceled) return 0
      let added = 0
      for (const filePath of result.filePaths) {
        if (addUploadedFile(filePath)) added++
      }
      return added
    } catch (error) {
      console.error('Failed to select upload attachments:', error)
      return 0
    }
  }

  function removeFile(path: string) {
    attachedFiles.value = attachedFiles.value.filter(f => f.path !== path)
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
    addUploadedFile,
    addUploadedFilesFromDialog,
    removeFile,
    clearFiles,
    handleAddClick,
    closeAttachmentMenu,
    handleBrowseFiles,
  }
}
