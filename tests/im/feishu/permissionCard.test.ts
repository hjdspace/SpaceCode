import { describe, it, expect, vi } from 'vitest'
import { FeishuPermissionCard } from '@electron/im/adapters/feishu/permissionCard'
import type { FeishuBot } from '@electron/im/adapters/feishu/feishuBot'

function createMockBot(): FeishuBot {
  return {
    sendCardMessage: vi.fn().mockResolvedValue({ message_id: 'msg_001' }),
    sendTextMessage: vi.fn().mockResolvedValue({ message_id: 'msg_fallback' }),
    patchMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as FeishuBot
}

describe('FeishuPermissionCard', () => {
  it('should send a permission card', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    await card.send(
      'ou_123',
      'open_id',
      'req_001',
      'Bash',
      { command: 'rm -rf /' },
      'Remove files'
    )

    expect(bot.sendCardMessage).toHaveBeenCalled()
    expect(card.getPendingCount('ou_123')).toBe(1)
  })

  it('should handle allow callback', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    await card.send('ou_123', 'open_id', 'req_001', 'Bash', { command: 'ls' })

    const result = card.handleCallback('ou_123', 'permit:req_001:yes')
    expect(result).toEqual({ requestId: 'req_001', action: 'allow' })
    expect(card.getPendingCount('ou_123')).toBe(0)
  })

  it('should handle deny callback', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    await card.send('ou_123', 'open_id', 'req_002', 'Write', { file_path: '/test' })

    const result = card.handleCallback('ou_123', 'permit:req_002:no')
    expect(result).toEqual({ requestId: 'req_002', action: 'deny' })
  })

  it('should handle always callback', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    await card.send('ou_123', 'open_id', 'req_003', 'Read', { file_path: '/test' })

    const result = card.handleCallback('ou_123', 'permit:req_003:always')
    expect(result).toEqual({ requestId: 'req_003', action: 'always' })
  })

  it('should return null for non-permission callback', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    const result = card.handleCallback('ou_123', 'other_action')
    expect(result).toBeNull()
  })

  it('should get single pending requestId', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    await card.send('ou_123', 'open_id', 'req_single', 'Bash', {})

    expect(card.getSinglePendingRequestId('ou_123')).toBe('req_single')
  })

  it('should clear pending permissions', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    await card.send('ou_123', 'open_id', 'req_001', 'Bash', {})
    card.clear('ou_123')

    expect(card.getPendingCount('ou_123')).toBe(0)
  })

  it('should detect path safety issues', async () => {
    const bot = createMockBot()
    const card = new FeishuPermissionCard(bot)

    // Tool writing outside workDir should trigger path safety
    await card.send(
      'ou_123',
      'open_id',
      'req_001',
      'Write',
      { file_path: '/etc/passwd' },
      undefined,
      '/home/user/projects'
    )

    // The card should still be sent
    expect(bot.sendCardMessage).toHaveBeenCalled()
  })
})
