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

/** 引用文本附件（选中文本浮条"添加到对话"），发送时序列化为 blockquote */
export interface TextQuoteAttachment {
  id: string
  text: string
}

export interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}

export interface SendOptions {
  displayLabel?: string
}
