import { describe, it, expect, vi } from 'vitest'
import { WhatsappMediaHandler } from '@electron/im/adapters/whatsapp/mediaHandler'
import type { WhatsappBot } from '@electron/im/adapters/whatsapp/whatsappBot'

function createMockBot(): WhatsappBot {
  return {
    downloadMedia: vi.fn().mockResolvedValue('/tmp/downloaded_file.png'),
    sendMediaMessage: vi.fn().mockResolvedValue({ key: { id: 'msg_001', remoteJid: 'test@s.whatsapp.net' } }),
    sendTextMessage: vi.fn().mockResolvedValue({ key: { id: 'msg_002', remoteJid: 'test@s.whatsapp.net' } }),
  } as unknown as WhatsappBot
}

describe('WhatsappMediaHandler', () => {
  it('should download an image', async () => {
    const bot = createMockBot()
    const handler = new WhatsappMediaHandler(bot, '/tmp/downloads')

    const result = await handler.downloadImage('http://example.com/img.png', 'image/png')

    expect(result).not.toBeNull()
    expect(result!.type).toBe('image')
    expect(result!.mimeType).toBe('image/png')
  })

  it('should download a document', async () => {
    const bot = createMockBot()
    const handler = new WhatsappMediaHandler(bot, '/tmp/downloads')

    const result = await handler.downloadDocument('http://example.com/doc.pdf', 'doc.pdf', 'application/pdf')

    expect(result).not.toBeNull()
    expect(result!.type).toBe('file')
    expect(result!.fileName).toBe('doc.pdf')
  })

  it('should convert to AttachmentRef', async () => {
    const bot = createMockBot()
    const handler = new WhatsappMediaHandler(bot, '/tmp/downloads')

    const media = await handler.downloadImage('http://example.com/img.png', 'image/png')
    const ref = handler.toAttachmentRef(media!)

    expect(ref.type).toBe('image')
    expect(ref.mimeType).toBe('image/png')
  })

  it('should upload an image', async () => {
    const bot = createMockBot()
    const handler = new WhatsappMediaHandler(bot, '/tmp/downloads')

    await handler.uploadImage('target@s.whatsapp.net', '/tmp/image.png', 'caption')

    expect(bot.sendMediaMessage).toHaveBeenCalledWith(
      'target@s.whatsapp.net',
      '/tmp/image.png',
      'image',
      'caption'
    )
  })

  it('should fallback to text on upload error', async () => {
    const bot = {
      ...createMockBot(),
      sendMediaMessage: vi.fn().mockRejectedValue(new Error('Upload failed')),
    } as unknown as WhatsappBot

    const handler = new WhatsappMediaHandler(bot, '/tmp/downloads')

    await handler.uploadImage('target@s.whatsapp.net', '/tmp/image.png')

    expect(bot.sendTextMessage).toHaveBeenCalled()
  })
})
