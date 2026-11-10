// @vitest-environment node
/**
 * #101：desktop Outbox 通道适配器的契约测试。
 *
 *  - reply 投递到 Router 会话（IM 气泡），返回稳定回执；
 *  - 同一 messageId 幂等（崩溃「已发送、回执未写回」窗口的重投不会产生第二个气泡）；
 *  - 非 reply 载荷是内部 Effect，不走人可见通道；
 *  - 推送瞬时失败 → waiting 交给 runner 退避重试。
 */
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_OUTBOX_CHANNEL,
  createSuperAgentDesktopOutboxChannel,
} from '../desktopChannel'
import type { SuperAgentOutboxMessage } from '../model'

function replyMessage(overrides: Partial<SuperAgentOutboxMessage> = {}): SuperAgentOutboxMessage {
  return {
    messageId: 'reply:ack:input-1',
    ticketId: 'ticket-1',
    channel: DESKTOP_OUTBOX_CHANNEL,
    kind: 'reply',
    ordinal: 1,
    status: 'pending',
    createdAt: '2026-11-06T00:00:00.000Z',
    payload: {
      kind: 'reply',
      replyType: 'acknowledgement',
      text: '收到：修登录页。已交给 Worker 处理。',
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

describe('super agent desktop outbox channel', () => {
  it('pushes a reply bubble and returns a stable receipt', async () => {
    const pushed: SuperAgentOutboxMessage[] = []
    const channel = createSuperAgentDesktopOutboxChannel({ push: (message) => pushed.push(message) })
    const message = replyMessage()

    const outcome = await channel(message)

    expect(outcome).toEqual({ outcome: 'sent', receipt: `desktop:${message.messageId}` })
    expect(pushed).toHaveLength(1)
    expect(pushed[0]?.messageId).toBe(message.messageId)
  })

  it('is idempotent by messageId instead of pushing a second bubble', async () => {
    const pushed: SuperAgentOutboxMessage[] = []
    const channel = createSuperAgentDesktopOutboxChannel({ push: (message) => pushed.push(message) })
    const message = replyMessage()

    const first = await channel(message)
    const second = await channel(message)

    expect(pushed).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('refuses non-reply payloads: internal effects do not reach the human channel', async () => {
    const pushed: SuperAgentOutboxMessage[] = []
    const channel = createSuperAgentDesktopOutboxChannel({ push: (message) => pushed.push(message) })
    const message = replyMessage({
      messageId: 'launch:assignment-1',
      kind: 'launch',
      payload: { kind: 'launch', assignmentId: 'assignment-1' },
    })

    const outcome = await channel(message)

    expect(outcome.outcome).toBe('gone')
    expect(outcome.outcome === 'gone' ? outcome.error : '').toBe('desktopChannelReplyOnly')
    expect(pushed).toHaveLength(0)
  })

  it('reports waiting when the desktop push throws, so the runner backs off', async () => {
    const channel = createSuperAgentDesktopOutboxChannel({
      push: () => {
        throw new Error('renderer unavailable')
      },
    })

    const outcome = await channel(replyMessage())

    expect(outcome).toEqual({ outcome: 'waiting', error: 'renderer unavailable' })
  })
})
