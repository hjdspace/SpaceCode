import { describe, it, expect, vi } from 'vitest'
import { FeishuBot } from '@electron/im/adapters/feishu/feishuBot'

// Mock fetch globally
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

describe('FeishuBot', () => {
  describe('getTenantAccessToken', () => {
    it('should get and cache tenant_access_token', async () => {
      const bot = new FeishuBot('app_123', 'secret_456')

      mockFetch.mockResolvedValueOnce(
        mockResponse({ code: 0, tenant_access_token: 'token_abc', expire: 7200 })
      )

      const token = await bot.getTenantAccessToken()
      expect(token).toBe('token_abc')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should throw on auth error', async () => {
      const bot = new FeishuBot('bad_app', 'bad_secret')

      mockFetch.mockResolvedValueOnce(
        mockResponse({ code: 99991661, msg: 'app_id or app_secret invalid' })
      )

      await expect(bot.getTenantAccessToken()).rejects.toThrow('Feishu auth error')
    })
  })

  describe('sendTextMessage', () => {
    it('should send a text message', async () => {
      const bot = new FeishuBot('app_123', 'secret_456')

      // Mock token fetch
      mockFetch.mockResolvedValueOnce(
        mockResponse({ code: 0, tenant_access_token: 'token_abc', expire: 7200 })
      )
      // Mock message send
      mockFetch.mockResolvedValueOnce(
        mockResponse({ code: 0, data: { message_id: 'msg_001' } })
      )

      const result = await bot.sendTextMessage('open_id', 'ou_123', 'Hello')
      expect(result.message_id).toBe('msg_001')
    })
  })

  describe('cardCreate', () => {
    it('should create a card and return card_id', async () => {
      const bot = new FeishuBot('app_123', 'secret_456')

      // Mock token fetch
      mockFetch.mockResolvedValueOnce(
        mockResponse({ code: 0, tenant_access_token: 'token_abc', expire: 7200 })
      )
      // Mock card create
      mockFetch.mockResolvedValueOnce(
        mockResponse({ code: 0, data: { card_id: 'card_abc' } })
      )

      const cardId = await bot.cardCreate([{ tag: 'markdown', content: 'test' }])
      expect(cardId).toBe('card_abc')
    })
  })
})
