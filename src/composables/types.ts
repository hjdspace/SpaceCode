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
  /** 上传/粘贴的附件在输入框/消息里渲染为卡片；工作区内联 chip 不带此标记 */
  source?: 'workspace' | 'upload' | 'paste'
  /** 粘贴长文本的卡片标题（首行摘要）；缺省时卡片用 name */
  title?: string
  /** 粘贴长文本的 UTF-8 字节数，卡片副标题展示大小 */
  sizeBytes?: number
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
