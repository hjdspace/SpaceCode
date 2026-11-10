// @vitest-environment node
/**
 * #103：飞书 Outbox 通道适配器契约。
 *
 *  - `feishu:chat:<chatId>[:reply:<messageId>]` 解析为话题回复目标；
 *  - 以平台 message id 作为回执，messageId 同进程幂等；
 *  - 目标消息被撤回/不存在 → gone（dropped 带原因，不重发）；
 *  - 其余失败 → waiting，交给 runner 退避。
 */
import { describe, expect, it } from 'vitest'
import { FeishuApiError } from '../../im/adapters/feishu/feishuBot'
import {
  createSuperAgentFeishuOutboxChannel,
  feishuOutboxChannel,
  parseFeishuOutboxChannel,
  type FeishuOutboxSendInput,
} from '../feishuChannel'
import type { SuperAgentOutboxMessage } from '../model'

function replyMessage(overrides: Partial<SuperAgentOutboxMessage> = {}): SuperAgentOutboxMessage {
  return {
    messageId: 'reply:ack:input-1',
    ticketId: 'ticket-1',
    channel: 'feishu:chat:oc_chat:reply:om_human',
    kind: 'reply',
    ordinal: 1,
    status: 'pending',
    createdAt: '2026-11-06T00:00:00.000Z',
    payload: {
      kind: 'reply',
      replyType: 'acknowledgement',
      text: '收到：修登录页。',
      inReplyTo: 'input-1',
      attentionId: null,
      reportId: null,
    },
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    sentAt: null,
    receipt: null,
    withdrawnAt: null,
    ...overrides,
  }
}

function channelWith(
  send: (input: FeishuOutboxSendInput) => Promise<{ messageId: string }>,
) {
  return createSuperAgentFeishuOutboxChannel({ send })
}

describe('feishu outbox channel address', () => {
  it('parses chat and topic reply target', () => {
    expect(parseFeishuOutboxChannel('feishu:chat:oc_chat:reply:om_human')).toEqual({
      chatId: 'oc_chat',
      replyToMessageId: 'om_human',
    })
  })

  it('parses chat without a reply target', () => {
    expect(parseFeishuOutboxChannel('feishu:chat:oc_chat')).toEqual({
      chatId: 'oc_chat',
      replyToMessageId: null,
    })
  })

  it('composes the channel address used by reply target resolution', () => {
    expect(feishuOutboxChannel('oc_chat', 'om_human')).toBe('feishu:chat:oc_chat:reply:om_human')
    expect(feishuOutboxChannel('oc_chat', null)).toBe('feishu:chat:oc_chat')
  })

  it('rejects malformed channels', () => {
    expect(parseFeishuOutboxChannel('desktop')).toBeNull()
    expect(parseFeishuOutboxChannel('feishu:')).toBeNull()
  })
})

describe('feishu outbox channel delivery', () => {
  it('replies in thread and returns the platform message id as receipt', async () => {
    const calls: FeishuOutboxSendInput[] = []
    const channel = channelWith(async (input) => {
      calls.push(input)
      return { messageId: 'om_reply_1' }
    })

    const outcome = await channel(replyMessage())

    expect(outcome).toEqual({ outcome: 'sent', receipt: 'om_reply_1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      chatId: 'oc_chat',
      replyToMessageId: 'om_human',
      messageId: 'reply:ack:input-1',
      text: '收到：修登录页。',
    })
  })

  it('is idempotent by messageId instead of posting a second reply', async () => {
    const calls: FeishuOutboxSendInput[] = []
    const channel = channelWith(async (input) => {
      calls.push(input)
      return { messageId: 'om_reply_1' }
    })
    const message = replyMessage()

    const first = await channel(message)
    const second = await channel(message)

    expect(calls).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('waits on transient failures so the runner backs off', async () => {
    const channel = channelWith(async () => {
      throw new Error('feishu timeout')
    })

    const outcome = await channel(replyMessage())

    expect(outcome).toEqual({ outcome: 'waiting', error: 'feishu timeout' })
  })

  it('treats a withdrawn or missing target message as gone', async () => {
    const channel = channelWith(async () => {
      throw new FeishuApiError('Feishu API error: message withdrawn', 230011)
    })

    const outcome = await channel(replyMessage())

    expect(outcome).toEqual({ outcome: 'gone', error: 'Feishu API error: message withdrawn' })
  })

  it('refuses non-reply payloads: internal effects never reach the platform', async () => {
    const channel = channelWith(async () => ({ messageId: 'om_reply_1' }))
    const message = replyMessage({
      messageId: 'launch:assignment-1',
      kind: 'launch',
      payload: { kind: 'launch', assignmentId: 'assignment-1' },
    })

    const outcome = await channel(message)

    expect(outcome).toEqual({ outcome: 'gone', error: 'feishuChannelReplyOnly' })
  })

  it('reports gone when the channel address is malformed', async () => {
    const channel = channelWith(async () => ({ messageId: 'om_reply_1' }))
    const message = replyMessage({ channel: 'feishu:' })

    const outcome = await channel(message)

    expect(outcome).toEqual({ outcome: 'gone', error: 'feishuChannelInvalidAddress' })
  })
})
