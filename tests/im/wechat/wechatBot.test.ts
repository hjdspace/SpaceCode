import { beforeEach, describe, it, expect, vi } from 'vitest'
import { WechatBot } from '@electron/im/adapters/wechat/wechatBot'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: Record<string, unknown>, ok = true): Response {
  const jsonStr = JSON.stringify(data)
  return {
    ok,
    json: async () => data,
    text: async () => jsonStr,
    arrayBuffer: async () => new ArrayBuffer(0),
    status: ok ? 200 : 404,
    statusText: ok ? 'OK' : 'Not Found',
  } as Response
}

describe('WechatBot', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('sendTextMessage', () => {
    it('should send a text message using the iLink gateway contract', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789', {
        baseUrl: 'https://gateway.example.com',
      })
      bot.setContextToken('ctx_abc')

      let requestBody: Record<string, unknown> | undefined
      mockFetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        if (
          String(input) !== 'https://gateway.example.com/ilink/bot/sendmessage' ||
          init?.method !== 'POST' ||
          headers.Authorization !== 'Bearer token_456' ||
          headers.AuthorizationType !== 'ilink_bot_token'
        ) {
          return mockResponse({ message: 'Not Found' }, false)
        }

        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return mockResponse({ ret: 0 })
      })

      const result = await bot.sendTextMessage('user_target', 'Hello')
      expect(result.msgId).toBeTruthy()
      expect(bot.getContextToken()).toBe('ctx_abc')
      expect(requestBody).toMatchObject({
        msg: {
          from_user_id: '',
          to_user_id: 'user_target',
          client_id: expect.any(String),
          message_type: 2,
          message_state: 2,
          context_token: 'ctx_abc',
          item_list: [{ type: 1, text_item: { text: 'Hello' } }],
        },
        base_info: { channel_version: expect.any(String) },
      })
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

  describe('getMessages', () => {
    it('should poll and parse messages using the iLink gateway contract', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789', {
        baseUrl: 'https://gateway.example.com',
      })

      const requestBodies: Record<string, unknown>[] = []
      mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        if (
          String(input) !== 'https://gateway.example.com/ilink/bot/getupdates' ||
          init?.method !== 'POST' ||
          headers.Authorization !== 'Bearer token_456' ||
          headers.AuthorizationType !== 'ilink_bot_token' ||
          typeof headers['X-WECHAT-UIN'] !== 'string'
        ) {
          return mockResponse({ message: 'Not Found' }, false)
        }

        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        if (requestBodies.length === 1) {
          return mockResponse({
            ret: 0,
            get_updates_buf: 'cursor_1',
            msgs: [
              {
                from_user_id: 'user_a',
                to_user_id: 'wx_123',
                message_id: 1001,
                message_type: 1,
                context_token: 'ctx_abc',
                create_time_ms: 1700000000000,
                item_list: [{ type: 1, text_item: { text: 'hello' } }],
              },
            ],
          })
        }

        return mockResponse({ ret: 0, get_updates_buf: 'cursor_2', msgs: [] })
      })

      const msgs = await bot.getMessages()
      expect(msgs).toHaveLength(1)
      expect(msgs[0].fromUserId).toBe('user_a')
      expect(msgs[0].content).toBe('hello')
      expect(msgs[0].contextToken).toBe('ctx_abc')
      expect(msgs[0].msgId).toBe('1001')
      expect(requestBodies[0]).toMatchObject({
        get_updates_buf: '',
        base_info: { channel_version: expect.any(String) },
      })

      await bot.getMessages()
      expect(requestBodies[1]).toMatchObject({ get_updates_buf: 'cursor_1' })
    })

    it('should throw on API error (not swallow)', async () => {
      const bot = new WechatBot('wx_123', 'token_456', 'user_789')

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => JSON.stringify({ message: 'Not Found' }),
        json: async () => ({ message: 'Not Found' }),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response)

      await expect(bot.getMessages()).rejects.toThrow('WeChat API HTTP 404')
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
