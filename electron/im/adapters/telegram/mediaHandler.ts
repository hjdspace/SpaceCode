/**
 * MediaHandler — Telegram media download/upload
 *
 * Handles:
 * 1. Downloading photos/documents from Telegram → local file
 * 2. Uploading generated images (from engine tool results) → Telegram
 * 3. Converting Telegram photo sizes to AttachmentRef
 */

import type { TelegramBot, TelegramPhotoSize, TelegramDocument } from './telegramBot'
import { validateAttachment } from '../common/attachment/attachment-limits'
import type { AttachmentRef } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('MediaHandler')

export interface DownloadedMedia {
  path: string
  fileName: string
  mimeType: string
  type: 'image' | 'file'
}

export class MediaHandler {
  private bot: TelegramBot
  private destDir: string

  constructor(bot: TelegramBot, destDir: string) {
    this.bot = bot
    this.destDir = destDir
  }

  /**
   * Download a photo from Telegram.
   * Selects the largest photo size available.
   */
  async downloadPhoto(photos: TelegramPhotoSize[]): Promise<DownloadedMedia | null> {
    if (!photos || photos.length === 0) return null

    // Select the largest photo size
    const largest = photos.reduce((prev, current) =>
      current.file_size && prev.file_size ? (current.file_size > prev.file_size ? current : prev) : current
    )

    try {
      const localPath = await this.bot.downloadFile(
        largest.file_id,
        this.destDir,
        `photo_${Date.now()}.jpg`
      )

      const result: DownloadedMedia = {
        path: localPath,
        fileName: `photo_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        type: 'image',
      }

      log.info('downloadPhoto', `Downloaded photo: ${localPath}`)
      return result
    } catch (err) {
      log.error('downloadPhoto', `Failed to download photo: ${String(err)}`)
      return null
    }
  }

  /**
   * Download a document from Telegram.
   */
  async downloadDocument(doc: TelegramDocument): Promise<DownloadedMedia | null> {
    try {
      const fileName = doc.file_name ?? `document_${Date.now()}`
      const localPath = await this.bot.downloadFile(
        doc.file_id,
        this.destDir,
        fileName
      )

      const result: DownloadedMedia = {
        path: localPath,
        fileName,
        mimeType: doc.mime_type ?? 'application/octet-stream',
        type: this.isImageMime(doc.mime_type) ? 'image' : 'file',
      }

      log.info('downloadDocument', `Downloaded document: ${localPath}`)
      return result
    } catch (err) {
      log.error('downloadDocument', `Failed to download document: ${String(err)}`)
      return null
    }
  }

  /**
   * Convert a downloaded media to an AttachmentRef for the engine.
   */
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
   * Upload a generated image to Telegram chat.
   * Called when the engine produces image output via tool results.
   */
  async uploadImage(chatId: number, imagePath: string, caption?: string): Promise<void> {
    try {
      await this.bot.sendPhoto(chatId, imagePath, caption)
      log.info('uploadImage', `Uploaded image to chat ${chatId}: ${imagePath}`)
    } catch (err) {
      log.error('uploadImage', `Failed to upload image: ${String(err)}`)
      // Fallback: send text message with the path
      try {
        await this.bot.sendMessage(chatId, `📎 图片已生成: ${imagePath}`)
      } catch {
        // Give up
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private isImageMime(mime?: string): boolean {
    if (!mime) return false
    return mime.startsWith('image/')
  }
}
