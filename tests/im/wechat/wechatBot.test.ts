import { describe, it, expect, vi } from 'vitest'
import { WechatBot } from '@electron/im/adapters/wechat/wechatBot'

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

describe('WechatBot', () => {
  describe('getBotInfo', () => {
    it('should get bot info', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')

      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: { account_id: 'wx_123', user_id: 'user_789' } })
      )

      const info = await bot.getBotInfo()
      expect(info.account_id).toBe('wx_123')
    })
  })

  describe('sendTextMessage', () => {
    it('should send a text message and store context token', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')

      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: { msg_id: 'msg_001', context_token: 'ctx_abc' } })
      )

      const result = await bot.sendTextMessage('user_target', 'Hello')
      expect(result.msgId).toBe('msg_001')
      expect(result.contextToken).toBe('ctx_abc')
      expect(bot.getContextToken()).toBe('ctx_abc')
    })
  })

  describe('sendTyping', () => {
    it('should send typing indicator without throwing', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')

      mockFetch.mockResolvedValueOnce(
        mockResponse({ data: {} })
      )

      await bot.sendTyping('user_target')
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should not throw on typing error', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      // Should not throw
      await bot.sendTyping('user_target')
    })
  })

  describe('setContextToken', () => {
    it('should set context token', () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')
      bot.setContextToken('new_ctx')
      expect(bot.getContextToken()).toBe('new_ctx')
    })

    it('should not set empty token', () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')
      bot.setContextToken('first')
      bot.setContextToken('')
      expect(bot.getContextToken()).toBe('first')
    })
  })
})
