import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DingtalkStreamState } from '@electron/im/adapters/dingtalk/streamState'
import type { DingtalkBot } from '@electron/im/adapters/dingtalk/dingtalkBot'

function createMockBot(): DingtalkBot {
  return {
    sendAiCardMessage: vi.fn().mockResolvedValue({ processQueryKey: 'pqk_001', messageId: 'msg_001' }),
    updateStreamingCard: vi.fn().mockResolvedValue(undefined),
    finalizeStreamingCard: vi.fn().mockResolvedValue(undefined),
    sendTextMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as DingtalkBot
}

describe('DingtalkStreamState', () => {
  let bot: DingtalkBot

  beforeEach(() => {
    bot = createMockBot()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start in idle state', () => {
    const state = new DingtalkStreamState(bot, 'webhook_url', 'template_001')
    expect(state.getProcessQueryKey()).toBeNull()
    expect(state.isWebhookExpired()).toBe(false)
  })

  it('should create AI card on first content flush', async () => {
    const state = new DingtalkStreamState(bot, 'webhook_url', 'template_001')
    state.append('Hello World')

    await vi.advanceTimersByTimeAsync(1500)

    expect(bot.sendAiCardMessage).toHaveBeenCalled()
    expect(state.getProcessQueryKey()).toBe('pqk_001')
  })

  it('should complete and finalize card', async () => {
    const state = new DingtalkStreamState(bot, 'webhook_url', 'template_001')
    state.append('Final content')

    await vi.advanceTimersByTimeAsync(1500)
    await state.complete()

    expect(bot.finalizeStreamingCard).toHaveBeenCalled()
  })

  it('should reset state', () => {
    const state = new DingtalkStreamState(bot, 'webhook_url', 'template_001')
    state.append('text')
    state.reset()
    expect(state.getProcessQueryKey()).toBeNull()
  })

  it('should detect webhook expiry', async () => {
    const expiredBot = {
      ...bot,
      sendAiCardMessage: vi.fn().mockRejectedValue(new Error('sessionwebhook.expired')),
      sendTextMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as DingtalkBot

    const state = new DingtalkStreamState(expiredBot, 'expired_webhook', 'template_001')
    state.append('text')

    await vi.advanceTimersByTimeAsync(1500)

    expect(state.isWebhookExpired()).toBe(true)
  })
})
