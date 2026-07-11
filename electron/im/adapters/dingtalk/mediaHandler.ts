/**
 * MediaHandler — DingTalk media download
 *
 * DingTalk doesn't support media upload (❌ per spec),
 * but supports downloading files from messages.
 */

import type { DingtalkBot } from './dingtalkBot'
import { validateAttachment } from '../common/attachment/attachment-limits'
import type { AttachmentRef } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('DingtalkMediaHandler')

export interface DownloadedMedia {
  path: string
  fileName: string
  mimeType: string
  type: 'image' | 'file'
}

export class DingtalkMediaHandler {
  private bot: DingtalkBot
  private destDir: string

  constructor(bot: DingtalkBot, destDir: string) {
    this.bot = bot
    this.destDir = destDir
  }

  /** Download a file from DingTalk. */
  async downloadFile(downloadUrl: string, fileName: string): Promise<DownloadedMedia | null> {
    try {
      const localPath = await this.bot.downloadFile(downloadUrl, this.destDir, fileName)
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

  /** Convert to AttachmentRef. */
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
    }
    return mimeMap[ext] ?? 'application/octet-stream'
  }
}
