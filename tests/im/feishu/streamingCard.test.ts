import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StreamingCard } from '@electron/im/adapters/feishu/streamingCard'
import type { FeishuBot } from '@electron/im/adapters/feishu/feishuBot'

// Create a mock FeishuBot
function createMockBot(): FeishuBot {
  return {
    cardCreate: vi.fn().mockResolvedValue('card_001'),
    sendCardMessage: vi.fn().mockResolvedValue({ message_id: 'msg_001' }),
    cardStreamContent: vi.fn().mockResolvedValue(undefined),
    cardUpdateSettings: vi.fn().mockResolvedValue(undefined),
    cardUpdate: vi.fn().mockResolvedValue(undefined),
    patchMessage: vi.fn().mockResolvedValue(undefined),
    sendTextMessage: vi.fn().mockResolvedValue({ message_id: 'msg_fallback' }),
  } as unknown as FeishuBot
}

describe('StreamingCard', () => {
  let bot: FeishuBot

  beforeEach(() => {
    bot = createMockBot()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start in idle state', () => {
    const card = new StreamingCard(bot, 'ou_123', 'open_id')
    expect(card.getCardId()).toBeNull()
    expect(card.getMessageId()).toBeNull()
  })

  it('should accumulate text on append', () => {
    const card = new StreamingCard(bot, 'ou_123', 'open_id')
    card.append('Hello ')
    card.append('World')
    // Text is buffered internally; no card creation until flush
  })

  it('should create card and stream content on flush', async () => {
    const card = new StreamingCard(bot, 'ou_123', 'open_id')
    card.append('Hello World')

    // Trigger flush
    await vi.advanceTimersByTimeAsync(200)

    expect(bot.cardCreate).toHaveBeenCalled()
    expect(bot.sendCardMessage).toHaveBeenCalled()
    expect(card.getCardId()).toBe('card_001')
  })

  it('should complete and finalize card', async () => {
    const card = new StreamingCard(bot, 'ou_123', 'open_id')
    card.append('Final text')

    // Trigger initial flush to create card
    await vi.advanceTimersByTimeAsync(200)

    // Complete
    await card.complete()

    expect(bot.cardUpdateSettings).toHaveBeenCalled()
    expect(bot.cardUpdate).toHaveBeenCalled()
  })

  it('should reset state', () => {
    const card = new StreamingCard(bot, 'ou_123', 'open_id')
    card.append('text')
    card.reset()
    expect(card.getCardId()).toBeNull()
    expect(card.getMessageId()).toBeNull()
  })

  it('should track streaming disabled state', () => {
    const card = new StreamingCard(bot, 'ou_123', 'open_id')
    expect(card.isStreamingDisabled()).toBe(false)
  })
})
