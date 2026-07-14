import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StreamingMessage } from '@electron/im/adapters/telegram/streamingMessage'
import type { TelegramBot } from '@electron/im/adapters/telegram/telegramBot'

function createMockBot(): TelegramBot {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    getMe: vi.fn(),
    setMyCommands: vi.fn(),
    sendPhoto: vi.fn(),
    answerCallbackQuery: vi.fn(),
    deleteMessage: vi.fn(),
    downloadFile: vi.fn(),
    getUpdates: vi.fn(),
  } as unknown as TelegramBot
}

describe('StreamingMessage', () => {
  let bot: TelegramBot
  let sm: StreamingMessage

  beforeEach(() => {
    bot = createMockBot()
    sm = new StreamingMessage(bot, 12345)
  })

  afterEach(() => {
    sm.reset()
  })

  it('should create a placeholder message on first append', async () => {
    sm.append('Hello world')
    await sm.complete()

    expect(bot.sendMessage).toHaveBeenCalledWith(12345, '💭...')
    expect(bot.editMessageText).toHaveBeenCalled()
  })

  it('should edit message with accumulated text on complete', async () => {
    sm.append('Hello ')
    sm.append('world!')
    await sm.complete()

    // At least one edit call should contain the full text
    const editCalls = (bot.editMessageText as ReturnType<typeof vi.fn>).mock.calls
    const lastEdit = editCalls[editCalls.length - 1]
    expect(lastEdit[0]).toBe(12345) // chatId
    expect(lastEdit[1]).toBe(42) // messageId
    expect(lastEdit[2]).toContain('Hello world!')
  })

  it('should add done indicator on complete', async () => {
    sm.append('Test message')
    await sm.complete()

    const editCalls = (bot.editMessageText as ReturnType<typeof vi.fn>).mock.calls
    const lastEdit = editCalls[editCalls.length - 1]
    expect(lastEdit[2]).toContain('✅')
  })

  it('should not append after complete', async () => {
    sm.append('First')
    await sm.complete()

    const editCountBefore = (bot.editMessageText as ReturnType<typeof vi.fn>).mock.calls.length
    sm.append('Second')
    await new Promise((r) => setTimeout(r, 100))

    const editCountAfter = (bot.editMessageText as ReturnType<typeof vi.fn>).mock.calls.length
    expect(editCountAfter).toBe(editCountBefore)
  })

  it('should reset state', async () => {
    sm.append('Some text')
    await sm.complete()

    sm.reset()

    expect(sm.getMessageId()).toBeNull()

    // Should be able to start fresh
    sm.append('New text')
    await sm.complete()

    expect(bot.sendMessage).toHaveBeenCalledTimes(2) // Two placeholder messages
  })

  it('should return null messageId before first append', () => {
    expect(sm.getMessageId()).toBeNull()
  })
})
