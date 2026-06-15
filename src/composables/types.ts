/**
 * Shared types for ChatInput composables
 */

export interface ImageAttachment {
  id: string
  name: string
  type: 'image'
  mimeType: string
  previewUrl: string
  data: string // Base64 encoded image data
}

export interface Attachment {
  name: string
  path: string
  isFolder: boolean
}

export interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}

export interface SendOptions {
  displayLabel?: string
}
