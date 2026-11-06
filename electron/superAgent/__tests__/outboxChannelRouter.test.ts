// @vitest-environment node
/**
 * #103：Outbox 组合通道 —— 按 channel 前缀把消息路由到 desktop / 飞书 / GitHub
 * 发送器；未注册的目标直接 gone，绝不误发到别的平台。
 */
import { describe, expect, it } from 'vitest'
import { DESKTOP_OUTBOX_CHANNEL } from '../desktopChannel'
import { createSuperAgentOutboxChannelRouter } from '../outboxChannelRouter'
import type { SuperAgentOutboxMessage } from '../model'
import type { SuperAgentOutboxSendOutcome } from '../outbox'

function message(channel: string): SuperAgentOutboxMessage {
  return {
    messageId: 'reply:ack:input-1',
    ticketId: 'ticket-1',
    channel,
    kind: 'reply',
    ordinal: 1,
    status: 'pending',
    createdAt: '2026-11-06T00:00:00.000Z',
    payload: {
      kind: 'reply',
      replyType: 'acknowledgement',
      text: '收到',
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
  }
}

function recorder(receipt: string) {
  const calls: SuperAgentOutboxMessage[] = []
  const send = async (msg: SuperAgentOutboxMessage): Promise<SuperAgentOutboxSendOutcome> => {
    calls.push(msg)
    return { outcome: 'sent', receipt }
  }
  return { calls, send }
}

describe('super agent outbox channel router', () => {
  it('routes the desktop channel by exact match', async () => {
    const desktop = recorder('desktop:reply:ack:input-1')
    const router = createSuperAgentOutboxChannelRouter([
      { exact: DESKTOP_OUTBOX_CHANNEL, channel: desktop.send },
    ])

    const outcome = await router(message(DESKTOP_OUTBOX_CHANNEL))

    expect(outcome).toEqual({ outcome: 'sent', receipt: 'desktop:reply:ack:input-1' })
    expect(desktop.calls).toHaveLength(1)
  })

  it('routes platform channels by prefix', async () => {
    const feishu = recorder('om_1')
    const github = recorder('9001')
    const desktop = recorder('desktop:reply:ack:input-1')
    const router = createSuperAgentOutboxChannelRouter([
      { exact: DESKTOP_OUTBOX_CHANNEL, channel: desktop.send },
      { prefix: 'feishu:', channel: feishu.send },
      { prefix: 'github:', channel: github.send },
    ])

    await router(message('feishu:chat:oc_1:reply:om_human'))
    await router(message('github:pr:acme/app:42'))

    expect(feishu.calls).toHaveLength(1)
    expect(github.calls).toHaveLength(1)
    expect(desktop.calls).toHaveLength(0)
  })

  it('drops unregistered channels instead of misdelivering them', async () => {
    const desktop = recorder('desktop:reply:ack:input-1')
    const router = createSuperAgentOutboxChannelRouter([
      { exact: DESKTOP_OUTBOX_CHANNEL, channel: desktop.send },
    ])

    const outcome = await router(message('feishu:chat:oc_1'))

    expect(outcome).toEqual({ outcome: 'gone', error: 'outboxChannelNotConfigured' })
    expect(desktop.calls).toHaveLength(0)
  })
})
