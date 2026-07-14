/**
 * MediaHandler — WhatsApp media download/upload
 *
 * Supports downloading images/videos/documents from WhatsApp messages
 * and uploading images via sendMediaMessage.
 */

import type { WhatsappBot } from './whatsappBot'
import { validateAttachment } from '../common/attachment/attachment-limits'
import type { AttachmentRef } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('WhatsappMediaHandler')

export interface DownloadedMedia {
  path: string
  fileName: string
  mimeType: string
  type: 'image' | 'file'
}

export class WhatsappMediaHandler {
  private bot: WhatsappBot
  private destDir: string

  constructor(bot: WhatsappBot, destDir: string) {
    this.bot = bot
    this.destDir = destDir
  }

  /** Download an image from a WhatsApp message. */
  async downloadImage(url: string, mimeType: string): Promise<DownloadedMedia | null> {
    try {
      const fileName = `whatsapp_img_${Date.now()}.${this.getExtension(mimeType)}`
      const localPath = await this.bot.downloadMedia(url, this.destDir, fileName)

      const result: DownloadedMedia = {
        path: localPath,
        fileName,
        mimeType,
        type: 'image',
      }

      log.info('downloadImage', `Downloaded: ${localPath}`)
      return result
    } catch (err) {
      log.error('downloadImage', `Failed: ${String(err)}`)
      return null
    }
  }

  /** Download a document from a WhatsApp message. */
  async downloadDocument(url: string, fileName: string, mimeType: string): Promise<DownloadedMedia | null> {
    try {
      const localPath = await this.bot.downloadMedia(url, this.destDir, fileName)

      const result: DownloadedMedia = {
        path: localPath,
        fileName,
        mimeType,
        type: this.isImageMime(mimeType) ? 'image' : 'file',
      }

      log.info('downloadDocument', `Downloaded: ${localPath}`)
      return result
    } catch (err) {
      log.error('downloadDocument', `Failed: ${String(err)}`)
      return null
    }
  }

  /** Convert to AttachmentRef. */
  toAttachmentRef(media: DownloadedMedia): AttachmentRef {
    const validation = validateAttachment(media.type, media.mimeType, 0)

    if (!validation.valid) {
      log.warn('toAttachmentRef', `Validation failed: ${validation.error ?? 'unknown'}`)
    }

    return {
      type: media.type,
      name: media.fileName,
      path: media.path,
      mimeType: media.mimeType,
    }
  }

  /** Upload an image to WhatsApp chat. */
  async uploadImage(to: string, imagePath: string, caption?: string): Promise<void> {
    try {
      await this.bot.sendMediaMessage(to, imagePath, 'image', caption)
      log.info('uploadImage', `Uploaded to ${to}: ${imagePath}`)
    } catch (err) {
      log.error('uploadImage', `Failed: ${String(err)}`)
      // Fallback: text
      try {
        await this.bot.sendTextMessage(to, `📎 Image generated: ${imagePath}`)
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

  private getExtension(mimeType: string): string {
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }
    return extMap[mimeType] ?? 'bin'
  }
}
