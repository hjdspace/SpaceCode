/**
 * useImageHandler - Image attachment logic extracted from ChatInput.vue
 *
 * Manages:
 * - Image file detection
 * - Image attachment creation
 * - File reading as data URL
 * - Duplicate detection
 */
import { ref } from 'vue'
import { api } from '@/services/electronAPI'
import type { ImageAttachment, Attachment } from '@/composables/types'
import { getMimeTypeFromFileName } from '@/composables/useContentEditor'

// ── Pure logic (exported for testing) ──────────────────────────

/** Check if a file is an image based on MIME type */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/** Create an image attachment object */
export function createImageAttachment(file: { name: string; type: string }, dataUrl: string, id: string): ImageAttachment {
  return {
    id,
    name: file.name,
    type: 'image',
    mimeType: file.type,
    previewUrl: dataUrl,
    data: dataUrl,
  }
}

/** Check if an image already exists in the list */
export function isDuplicateImage(images: ImageAttachment[], id: string): boolean {
  return images.some(img => img.id === id)
}

/** Check if a file already exists in the attachments */
export function isDuplicateFile(files: Attachment[], path: string): boolean {
  return files.some(f => f.path === path)
}

// ── Composable ─────────────────────────────────────────────────

export function useImageHandler() {
  const attachedImages = ref<ImageAttachment[]>([])

  /** Read an image file as data URL */
  function readImageAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /** Handle a single image file */
  async function handleImageFile(file: File, onInsertChip: (image: ImageAttachment) => void) {
    if (!isImageFile(file.type)) return

    try {
      const dataUrl = await readImageAsDataUrl(file)
      const imageAttachment = createImageAttachment(file, dataUrl, crypto.randomUUID())
      attachedImages.value.push(imageAttachment)
      onInsertChip(imageAttachment)
    } catch (error) {
      console.error('Failed to read image file:', error)
    }
  }

  /** Read a local image file as data URL via Electron API */
  async function readLocalImageAsDataUrl(filePath: string): Promise<string> {
    try {
      const fileData = await api.readFileAsBase64(filePath)
      if (fileData) {
        const mimeType = getMimeTypeFromFileName(filePath)
        return `data:${mimeType};base64,${fileData}`
      }
    } catch (e) {
      console.warn('Could not use API to read file, falling back')
    }
    throw new Error('Need File object')
  }

  /** Add an image from a local file path */
  async function addImageFromPath(filePath: string, onInsertChip: (image: ImageAttachment) => void) {
    const name = filePath.split(/[/\\]/).pop() || filePath
    try {
      const dataUrl = await readLocalImageAsDataUrl(filePath)
      const mimeType = getMimeTypeFromFileName(filePath)
      const imageAttachment: ImageAttachment = {
        id: crypto.randomUUID(),
        name,
        type: 'image',
        mimeType,
        previewUrl: dataUrl,
        data: dataUrl,
      }
      attachedImages.value.push(imageAttachment)
      onInsertChip(imageAttachment)
    } catch (error) {
      console.error('Failed to read local image:', error)
    }
  }

  function clearImages() {
    attachedImages.value = []
  }

  return {
    attachedImages,
    readImageAsDataUrl,
    handleImageFile,
    readLocalImageAsDataUrl,
    addImageFromPath,
    clearImages,
    isImageFile,
    createImageAttachment,
    isDuplicateImage,
    isDuplicateFile,
  }
}
