import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TelegramBot } from '@electron/im/adapters/telegram/telegramBot'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('TelegramBot', () => {
  let bot: TelegramBot

  beforeEach(() => {
    bot = new TelegramBot('test-token', { apiBase: 'https://api.test' })
    mockFetch.mockReset()
  })

  function mockResponse(ok: boolean, result: unknown, description?: string) {
    return {
      ok,
      result,
      description,
      json: async () => ({ ok, result, description }),
    }
  }

  describe('getMe', () => {
    it('should return bot user info', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, {
        id: 123456789,
        is_bot: true,
        first_name: 'TestBot',
        username: 'testbot',
      }))

      const me = await bot.getMe()

      expect(me.id).toBe(123456789)
      expect(me.username).toBe('testbot')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test/bottest-token/getMe',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockResponse(false, null, 'Unauthorized'))

      await expect(bot.getMe()).rejects.toThrow('Unauthorized')
    })
  })

  describe('sendMessage', () => {
    it('should send a message and return message_id', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, { message_id: 42 }))

      const result = await bot.sendMessage(12345, 'Hello')

      expect(result.message_id).toBe(42)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.chat_id).toBe(12345)
      expect(body.text).toBe('Hello')
    })

    it('should pass optional parameters', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, { message_id: 43 }))

      await bot.sendMessage(12345, 'Formatted', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] },
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.parse_mode).toBe('HTML')
      expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('ok')
    })
  })

  describe('editMessageText', () => {
    it('should edit an existing message', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, true))

      await bot.editMessageText(12345, 42, 'Updated text')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.chat_id).toBe(12345)
      expect(body.message_id).toBe(42)
      expect(body.text).toBe('Updated text')
    })

    it('should silently ignore "not modified" errors', async () => {
      mockFetch.mockResolvedValue(mockResponse(false, null, 'Bad Request: message is not modified'))

      await expect(bot.editMessageText(12345, 42, 'Same text')).resolves.toBeUndefined()
    })

    it('should rethrow non-"not modified" errors', async () => {
      mockFetch.mockResolvedValue(mockResponse(false, null, 'Bad Request: message not found'))

      await expect(bot.editMessageText(12345, 42, 'text')).rejects.toThrow('message not found')
    })
  })

  describe('answerCallbackQuery', () => {
    it('should answer callback query', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, true))

      await bot.answerCallbackQuery('cb-123', 'Approved')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.callback_query_id).toBe('cb-123')
      expect(body.text).toBe('Approved')
    })
  })

  describe('setMyCommands', () => {
    it('should set bot commands', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, true))

      await bot.setMyCommands([
        { command: 'new', description: 'New session' },
        { command: 'help', description: 'Show help' },
      ])

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.commands).toHaveLength(2)
      expect(body.commands[0].command).toBe('new')
    })
  })

  describe('getUpdates', () => {
    it('should return updates and advance offset', async () => {
      const updates = [
        { update_id: 100, message: { message_id: 1, chat: { id: 1, type: 'private' as const } } },
        { update_id: 101, message: { message_id: 2, chat: { id: 1, type: 'private' as const } } },
      ]
      mockFetch.mockResolvedValue(mockResponse(true, updates))

      const result = await bot.getUpdates(30)

      expect(result).toHaveLength(2)
      expect(result[0].update_id).toBe(100)
    })

    it('should advance offset after getUpdates', async () => {
      // First call returns updates
      mockFetch.mockResolvedValueOnce(mockResponse(true, [
        { update_id: 200, message: { message_id: 1, chat: { id: 1, type: 'private' as const } } },
      ]))

      await bot.getUpdates()
      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body1.offset).toBe(0) // Initial offset

      // Second call should have offset = 201
      mockFetch.mockResolvedValueOnce(mockResponse(true, []))
      await bot.getUpdates()
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(body2.offset).toBe(201) // 200 + 1
    })

    it('should return empty array when no updates', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, []))

      const result = await bot.getUpdates()
      expect(result).toEqual([])
    })
  })

  describe('deleteMessage', () => {
    it('should delete a message', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, true))

      await bot.deleteMessage(12345, 42)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.chat_id).toBe(12345)
      expect(body.message_id).toBe(42)
    })
  })
})
