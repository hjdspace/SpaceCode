import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PermissionCard } from '@electron/im/adapters/telegram/permissionCard'
import type { TelegramBot } from '@electron/im/adapters/telegram/telegramBot'

function createMockBot(): TelegramBot {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    getMe: vi.fn(),
    setMyCommands: vi.fn(),
    sendPhoto: vi.fn(),
    deleteMessage: vi.fn(),
    downloadFile: vi.fn(),
    getUpdates: vi.fn(),
  } as unknown as TelegramBot
}

describe('PermissionCard', () => {
  let bot: TelegramBot
  let card: PermissionCard

  beforeEach(() => {
    bot = createMockBot()
    card = new PermissionCard(bot)
  })

  it('should send a permission card with inline keyboard', async () => {
    await card.send(12345, 'req-123', 'Bash', { command: 'rm -rf /tmp' }, 'Remove temp files')

    expect(bot.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining('Bash'),
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ 允许', callback_data: 'permit:req-123:yes' },
            { text: '♾️ 永久允许', callback_data: 'permit:req-123:always' },
            { text: '❌ 拒绝', callback_data: 'permit:req-123:no' },
          ]],
        },
      }
    )
  })

  it('should track pending permissions', async () => {
    expect(card.getPendingCount(12345)).toBe(0)

    await card.send(12345, 'req-1', 'Bash', {})

    expect(card.getPendingCount(12345)).toBe(1)
    expect(card.getSinglePendingRequestId(12345)).toBe('req-1')
  })

  it('should handle allow callback', async () => {
    await card.send(12345, 'req-abc', 'Write', { path: '/tmp/test.txt' })

    const result = await card.handleCallback(12345, 'permit:req-abc:yes', 'cb-1')

    expect(result).toEqual({ requestId: 'req-abc', action: 'allow' })
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cb-1')
    expect(card.getPendingCount(12345)).toBe(0)
  })

  it('should handle always callback', async () => {
    await card.send(12345, 'req-xyz', 'Read', {})

    const result = await card.handleCallback(12345, 'permit:req-xyz:always', 'cb-2')

    expect(result).toEqual({ requestId: 'req-xyz', action: 'always' })
    expect(card.getPendingCount(12345)).toBe(0)
  })

  it('should handle deny callback', async () => {
    await card.send(12345, 'req-denied', 'Bash', {})

    const result = await card.handleCallback(12345, 'permit:req-denied:no', 'cb-3')

    expect(result).toEqual({ requestId: 'req-denied', action: 'deny' })
    expect(card.getPendingCount(12345)).toBe(0)
  })

  it('should return null for non-permission callback', async () => {
    const result = await card.handleCallback(12345, 'some_other_callback', 'cb-4')
    expect(result).toBeNull()
  })

  it('should edit message after decision', async () => {
    await card.send(12345, 'req-edit', 'Bash', {})

    await card.handleCallback(12345, 'permit:req-edit:yes', 'cb-5')

    expect(bot.editMessageText).toHaveBeenCalledWith(
      12345,
      100, // messageId
      expect.stringContaining('已允许')
    )
  })

  it('should handle multiple pending permissions', async () => {
    await card.send(12345, 'req-1', 'Bash', {})
    await card.send(12345, 'req-2', 'Write', {})

    expect(card.getPendingCount(12345)).toBe(2)
    expect(card.getSinglePendingRequestId(12345)).toBeUndefined()

    // Resolve one
    await card.handleCallback(12345, 'permit:req-1:yes', 'cb-6')

    expect(card.getPendingCount(12345)).toBe(1)
    expect(card.getSinglePendingRequestId(12345)).toBe('req-2')
  })

  it('should clear all pending for a chat', async () => {
    await card.send(12345, 'req-1', 'Bash', {})
    await card.send(12345, 'req-2', 'Write', {})

    card.clear(12345)

    expect(card.getPendingCount(12345)).toBe(0)
  })

  it('should cleanup expired pending permissions', async () => {
    await card.send(12345, 'req-old', 'Bash', {})

    // Advance time past TTL (5 minutes)
    vi.useFakeTimers()
    vi.advanceTimersByTime(6 * 60 * 1000)

    card.cleanupExpired()

    expect(card.getPendingCount(12345)).toBe(0)

    vi.useRealTimers()
  })
})
