import { describe, it, expect, vi } from 'vitest'
import { WhatsappBot } from '@electron/im/adapters/whatsapp/whatsappBot'
import * as fs from 'fs'

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: Record<string, unknown>, ok = true): Response {
  return {
    ok,
    json: async () => data,
    arrayBuffer: async () => new ArrayBuffer(0),
    status: ok ? 200 : 400,
  } as Response
}

describe('WhatsappBot', () => {
  describe('isAuthStateExists', () => {
    it('should return false when no auth state', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })
      expect(bot.isAuthStateExists()).toBe(false)
    })

    it('should return true when auth state exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })
      expect(bot.isAuthStateExists()).toBe(true)
    })
  })

  describe('start', () => {
    it('should connect when auth state exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined)

      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })
      await bot.start()

      expect(bot.isConnected()).toBe(true)
    })

    it('should not connect when no auth state', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined)

      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })
      await bot.start()

      expect(bot.isConnected()).toBe(false)
    })
  })

  describe('sendTextMessage', () => {
    it('should send a text message', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })

      mockFetch.mockResolvedValueOnce(
        mockResponse({ key: { id: 'msg_001', remoteJid: 'target@s.whatsapp.net' } })
      )

      const result = await bot.sendTextMessage('target@s.whatsapp.net', 'Hello')
      expect(result.key.id).toBe('msg_001')
    })
  })

  describe('sendPresence', () => {
    it('should send presence without throwing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })

      mockFetch.mockResolvedValueOnce(mockResponse({}))

      await bot.sendPresence('target@s.whatsapp.net', 'composing')
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('onMessage', () => {
    it('should register and call message callback', () => {
      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })

      const callback = vi.fn()
      bot.onMessage(callback)

      const mockMsg = {
        key: { remoteJid: 'test@s.whatsapp.net', fromMe: false, id: 'msg_001' },
        message: { conversation: 'Hello' },
        messageTimestamp: Date.now(),
      }

      bot.simulateMessage(mockMsg)
      expect(callback).toHaveBeenCalledWith(mockMsg)
    })
  })

  describe('getQrCode', () => {
    it('should return null when auth state exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })
      const qr = await bot.getQrCode()
      expect(qr).toBeNull()
    })

    it('should return QR code when no auth state', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const bot = new WhatsappBot('test@s.whatsapp.net', { authDir: '/tmp/auth' })
      const qr = await bot.getQrCode()
      expect(qr).not.toBeNull()
      expect(qr!.qr).toBeTruthy()
    })
  })
})
