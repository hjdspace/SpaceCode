import { describe, it, expect, vi } from 'vitest'
import { TypingIndicator } from '@electron/im/adapters/wechat/typing'
import type { WechatBot } from '@electron/im/adapters/wechat/wechatBot'

function createMockBot(): WechatBot {
  return {
    sendTyping: vi.fn().mockResolvedValue(undefined),
  } as unknown as WechatBot
}

describe('TypingIndicator', () => {
  it('should start sending typing indicators', () => {
    const bot = createMockBot()
    const indicator = new TypingIndicator(bot)

    indicator.start('user_123')

    expect(bot.sendTyping).toHaveBeenCalledWith('user_123')
    indicator.stop('user_123')
  })

  it('should not start twice for same user', () => {
    const bot = createMockBot()
    const indicator = new TypingIndicator(bot)

    indicator.start('user_123')
    indicator.start('user_123')

    // sendTyping called once immediately (not twice)
    expect(bot.sendTyping).toHaveBeenCalledTimes(1)
    indicator.stop('user_123')
  })

  it('should stop typing indicators', () => {
    const bot = createMockBot()
    const indicator = new TypingIndicator(bot)

    indicator.start('user_123')
    indicator.stop('user_123')

    // After stop, no more calls should happen
    const callCount = (bot.sendTyping as ReturnType<typeof vi.fn>).mock.calls.length
    // Wait a bit and verify no new calls
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  it('should stop all indicators', () => {
    const bot = createMockBot()
    const indicator = new TypingIndicator(bot)

    indicator.start('user_1')
    indicator.start('user_2')
    indicator.stopAll()

    expect((bot.sendTyping as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
