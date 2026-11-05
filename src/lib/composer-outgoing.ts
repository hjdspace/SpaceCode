/**
 * 发送正文的组装（T04 #74）——「编辑器提交」到「引擎正文」的唯一映射。
 *
 * 从 ChatPanel.handleSend 原样抽出：主聊天与 Super Agent Router 等任何宿主共用同一份，
 * 保证 @"绝对路径" 引用、[File:...]/[Folder:...]/[Image:...] 摘要块与 displayLabel
 * 语义在所有宿主逐字一致（零副本）。纯函数，不做 DOM/store 操作。
 */
import type { AllAttachments, SendOptions } from '@/composables/types'

export interface OutgoingMessage {
  /** 发给引擎的正文（含 @"路径" 引用与附件摘要块） */
  messageContent: string
  /** 气泡展示正文；与引擎正文同源相同时为 undefined（沿用 chatSession 的既有约定） */
  userContent?: string
}

export function buildOutgoingMessage(
  content: string,
  attachments: AllAttachments,
  options?: SendOptions,
): OutgoingMessage {
  const userTyped = content.trim()
  let messageContent = userTyped

  // 上传/粘贴的附件用引擎认识的 @"绝对路径" 引用写进正文，模型才能真正读到文件内容；
  // 展示用的气泡正文不包含这些引用（见下方 displayLabel）。
  const engineReferencedFiles = attachments.files.filter(
    att => att.source === 'upload' || att.source === 'paste'
  )
  if (engineReferencedFiles.length > 0) {
    const fileRefs = engineReferencedFiles.map(att => `@"${att.path}"`).join(' ')
    messageContent = messageContent ? `${fileRefs} ${messageContent}` : fileRefs
  }

  if (attachments.files.length > 0) {
    const attachmentInfo = attachments.files.map(att =>
      att.isFolder ? `[Folder: ${att.name}]` : `[File: ${att.name}]`
    ).join(', ')

    if (messageContent) {
      messageContent += `\n\nAttachments: ${attachmentInfo}`
    } else {
      messageContent = `Attachments: ${attachmentInfo}`
    }
  }

  if (attachments.images.length > 0) {
    const imageInfo = attachments.images.map(img => `[Image: ${img.name}]`).join(', ')
    if (messageContent) {
      messageContent += `\n\nImages: ${imageInfo}`
    } else {
      messageContent = `Images: ${imageInfo}`
    }
  }

  const displayLabel = options?.displayLabel && options.displayLabel !== messageContent
    ? options.displayLabel
    : userTyped
  const userContent = displayLabel !== messageContent ? displayLabel : undefined

  return { messageContent, userContent }
}
