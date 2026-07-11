/**
 * MediaHandler — Feishu media download/upload
 *
 * Handles:
 * 1. Downloading images/files from Feishu messages → local file
 * 2. Uploading generated images (from engine tool results) → Feishu
 * 3. Converting Feishu message content to AttachmentRef
 */

import type { FeishuBot } from './feishuBot'
import { validateAttachment } from '../common/attachment/attachment-limits'
import type { AttachmentRef } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('FeishuMediaHandler')

export interface DownloadedMedia {
  path: string
  fileName: string
  mimeType: string
  type: 'image' | 'file'
}

export class FeishuMediaHandler {
  private bot: FeishuBot
  private destDir: string

  constructor(bot: FeishuBot, destDir: string) {
    this.bot = bot
    this.destDir = destDir
  }

  /**
   * Download an image from a Feishu message.
   * @param messageId The Feishu message ID containing the image
   * @param fileKey The file key from the message content
   */
  async downloadImage(messageId: string, fileKey: string): Promise<DownloadedMedia | null> {
    try {
      const fileName = `feishu_img_${Date.now()}.png`
      const localPath = await this.bot.downloadMessageResource(
        messageId,
        fileKey,
        this.destDir,
        fileName
      )

      const result: DownloadedMedia = {
        path: localPath,
        fileName,
        mimeType: 'image/png',
        type: 'image',
      }

      log.info('downloadImage', `Downloaded image: ${localPath}`)
      return result
    } catch (err) {
      log.error('downloadImage', `Failed to download image: ${String(err)}`)
      return null
    }
  }

  /**
   * Download a file from a Feishu message.
   * @param messageId The Feishu message ID containing the file
   * @param fileKey The file key from the message content
   * @param fileName Original file name
   */
  async downloadFile(messageId: string, fileKey: string, fileName: string): Promise<DownloadedMedia | null> {
    try {
      const localPath = await this.bot.downloadMessageResource(
        messageId,
        fileKey,
        this.destDir,
        fileName
      )

      const mimeType = this.guessMimeType(fileName)

      const result: DownloadedMedia = {
        path: localPath,
        fileName,
        mimeType,
        type: this.isImageMime(mimeType) ? 'image' : 'file',
      }

      log.info('downloadFile', `Downloaded file: ${localPath}`)
      return result
    } catch (err) {
      log.error('downloadFile', `Failed to download file: ${String(err)}`)
      return null
    }
  }

  /** Convert a downloaded media to an AttachmentRef for the engine. */
  toAttachmentRef(media: DownloadedMedia): AttachmentRef {
    const validation = validateAttachment(media.type, media.mimeType, 0)

    if (!validation.valid) {
      log.warn('toAttachmentRef', `Attachment validation failed: ${validation.error ?? 'unknown'}`)
    }

    return {
      type: media.type,
      name: media.fileName,
      path: media.path,
      mimeType: media.mimeType,
    }
  }

  /**
   * Upload a generated image to Feishu chat.
   * Called when the engine produces image output via tool results.
   */
  async uploadImage(receiveId: string, receiveIdType: string, imagePath: string): Promise<void> {
    try {
      const imageKey = await this.bot.uploadImage(imagePath)
      await this.bot.sendImageMessage(receiveIdType, receiveId, imageKey)
      log.info('uploadImage', `Uploaded image to ${receiveId}: ${imagePath}`)
    } catch (err) {
      log.error('uploadImage', `Failed to upload image: ${String(err)}`)
      // Fallback: send text message with the path
      try {
        await this.bot.sendTextMessage(receiveIdType, receiveId, `📎 图片已生成: ${imagePath}`)
      } catch {
        // Give up
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private isImageMime(mime: string): boolean {
    return mime.startsWith('image/')
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
      txt: 'text/plain',
      json: 'application/json',
      md: 'text/markdown',
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    return mimeMap[ext] ?? 'application/octet-stream'
  }
}
