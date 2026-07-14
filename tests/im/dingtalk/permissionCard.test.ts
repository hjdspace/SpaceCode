import { describe, it, expect, vi } from 'vitest'
import { DingtalkPermissionCard } from '@electron/im/adapters/dingtalk/permissionCard'
import type { DingtalkBot } from '@electron/im/adapters/dingtalk/dingtalkBot'

function createMockBot(): DingtalkBot {
  return {
    sendAiCardMessage: vi.fn().mockResolvedValue({ processQueryKey: 'pqk_001' }),
    sendTextMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as DingtalkBot
}

describe('DingtalkPermissionCard', () => {
  it('should send a permission card', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, 'template_001')

    await card.send('webhook_url', 'req_001', 'Bash', { command: 'ls' })

    expect(bot.sendAiCardMessage).toHaveBeenCalled()
    expect(card.getPendingCount('webhook_url')).toBe(1)
  })

  it('should handle allow callback', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, 'template_001')

    await card.send('webhook_url', 'req_001', 'Bash', {})

    const result = card.handleCallback('webhook_url', 'permit:req_001:yes')
    expect(result).toEqual({ requestId: 'req_001', action: 'allow' })
    expect(card.getPendingCount('webhook_url')).toBe(0)
  })

  it('should handle deny callback', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, 'template_001')

    await card.send('webhook_url', 'req_002', 'Write', {})

    const result = card.handleCallback('webhook_url', 'permit:req_002:no')
    expect(result).toEqual({ requestId: 'req_002', action: 'deny' })
  })

  it('should handle always callback', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, 'template_001')

    await card.send('webhook_url', 'req_003', 'Read', {})

    const result = card.handleCallback('webhook_url', 'permit:req_003:always')
    expect(result).toEqual({ requestId: 'req_003', action: 'always' })
  })

  it('should return null for non-permission callback', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, 'template_001')

    const result = card.handleCallback('webhook_url', 'something_else')
    expect(result).toBeNull()
  })

  it('should clear pending permissions', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, 'template_001')

    await card.send('webhook_url', 'req_001', 'Bash', {})
    card.clear('webhook_url')

    expect(card.getPendingCount('webhook_url')).toBe(0)
  })

  it('should fallback to text when templateId is empty', async () => {
    const bot = createMockBot()
    const card = new DingtalkPermissionCard(bot, '')

    await card.send('webhook_url', 'req_001', 'Bash', { command: 'ls' })

    expect(bot.sendTextMessage).toHaveBeenCalled()
  })
})
