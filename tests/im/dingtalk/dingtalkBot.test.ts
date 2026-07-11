import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DingtalkBot } from '@electron/im/adapters/dingtalk/dingtalkBot'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: Record<string, unknown>, ok = true): Response {
  return {
    ok,
    json: async () => data,
    status: ok ? 200 : 400,
  } as Response
}

describe('DingtalkBot', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('getAccessToken', () => {
    it('should get and cache access token', async () => {
      const bot = new DingtalkBot('client_123', 'secret_456')

      mockFetch.mockResolvedValueOnce(
        mockResponse({ accessToken: 'token_xyz', expireIn: 7200 })
      )

      const token = await bot.getAccessToken()
      expect(token).toBe('token_xyz')
    })
  })

  describe('sendTextMessage', () => {
    it('should send text via sessionWebhook', async () => {
      const bot = new DingtalkBot('client_123', 'secret_456')

      // sendTextMessage calls sendViaWebhook directly (no token needed)
      mockFetch.mockResolvedValueOnce(
        mockResponse({ errcode: 0 })
      )

      await bot.sendTextMessage('https://oapi.dingtalk.com/webhook/xxx', 'Hello')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('sendAiCardMessage', () => {
    it('should send AI card and return processQueryKey', async () => {
      const bot = new DingtalkBot('client_123', 'secret_456')

      // Mock webhook card send (sendViaWebhook calls fetch directly, no token needed)
      mockFetch.mockResolvedValueOnce(
        mockResponse({ errcode: 0, processQueryKey: 'pqk_001', messageId: 'msg_001' })
      )

      const result = await bot.sendAiCardMessage(
        'https://oapi.dingtalk.com/webhook/xxx',
        'template_001',
        { content: 'test' }
      )

      expect(result.processQueryKey).toBe('pqk_001')
    })
  })
})
