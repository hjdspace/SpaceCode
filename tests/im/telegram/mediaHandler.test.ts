import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaHandler } from '@electron/im/adapters/telegram/mediaHandler'
import type { TelegramBot, TelegramPhotoSize, TelegramDocument } from '@electron/im/adapters/telegram/telegramBot'
import * as fs from 'fs'
import * as path from 'path'

function createMockBot(): TelegramBot {
  return {
    downloadFile: vi.fn().mockResolvedValue('/tmp/photo.jpg'),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 2 }),
    getMe: vi.fn(),
    setMyCommands: vi.fn(),
    editMessageText: vi.fn(),
    answerCallbackQuery: vi.fn(),
    deleteMessage: vi.fn(),
    getUpdates: vi.fn(),
  } as unknown as TelegramBot
}

describe('MediaHandler', () => {
  let bot: TelegramBot
  let handler: MediaHandler
  const destDir = '/tmp/im-attachments-test'

  beforeEach(() => {
    bot = createMockBot()
    handler = new MediaHandler(bot, destDir)
  })

  describe('downloadPhoto', () => {
    it('should download the largest photo', async () => {
      const photos: TelegramPhotoSize[] = [
        { file_id: 'small', file_unique_id: 'u1', width: 100, height: 100, file_size: 5000 },
        { file_id: 'large', file_unique_id: 'u2', width: 800, height: 600, file_size: 50000 },
        { file_id: 'medium', file_unique_id: 'u3', width: 400, height: 300, file_size: 20000 },
      ]

      const result = await handler.downloadPhoto(photos)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('image')
      expect(result!.mimeType).toBe('image/jpeg')
      expect(bot.downloadFile).toHaveBeenCalledWith('large', destDir, expect.stringContaining('photo_'))
    })

    it('should return null for empty photos array', async () => {
      const result = await handler.downloadPhoto([])
      expect(result).toBeNull()
    })

    it('should return null for null input', async () => {
      const result = await handler.downloadPhoto(null as unknown as TelegramPhotoSize[])
      expect(result).toBeNull()
    })
  })

  describe('downloadDocument', () => {
    it('should download a document', async () => {
      const doc: TelegramDocument = {
        file_id: 'doc-123',
        file_unique_id: 'u-doc',
        file_name: 'test.txt',
        mime_type: 'text/plain',
        file_size: 1000,
      }

      const result = await handler.downloadDocument(doc)

      expect(result).not.toBeNull()
      expect(result!.fileName).toBe('test.txt')
      expect(result!.mimeType).toBe('text/plain')
      expect(result!.type).toBe('file')
    })

    it('should classify image documents as image type', async () => {
      const doc: TelegramDocument = {
        file_id: 'img-doc',
        file_unique_id: 'u-img',
        file_name: 'photo.png',
        mime_type: 'image/png',
        file_size: 50000,
      }

      const result = await handler.downloadDocument(doc)

      expect(result!.type).toBe('image')
    })
  })

  describe('toAttachmentRef', () => {
    it('should convert media to AttachmentRef', () => {
      const media = {
        path: '/tmp/photo.jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        type: 'image' as const,
      }

      const ref = handler.toAttachmentRef(media)

      expect(ref.type).toBe('image')
      expect(ref.name).toBe('photo.jpg')
      expect(ref.path).toBe('/tmp/photo.jpg')
      expect(ref.mimeType).toBe('image/jpeg')
    })
  })

  describe('uploadImage', () => {
    it('should upload image via sendPhoto', async () => {
      await handler.uploadImage(12345, '/tmp/output.png', 'Generated image')

      expect(bot.sendPhoto).toHaveBeenCalledWith(12345, '/tmp/output.png', 'Generated image')
    })

    it('should fallback to text message on error', async () => {
      ;(bot.sendPhoto as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Upload failed'))

      await handler.uploadImage(12345, '/tmp/output.png')

      expect(bot.sendMessage).toHaveBeenCalledWith(12345, expect.stringContaining('/tmp/output.png'))
    })
  })
})
