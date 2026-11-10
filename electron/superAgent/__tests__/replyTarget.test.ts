// @vitest-environment node
/**
 * #103：reply 目标解析 —— 把「回复给谁」从领域引用（Input / Attention / Report）
 * 解析为平台会话地址（设计 §6.4）。
 *
 *  - acknowledgement / answer：回到人消息所在会话；
 *  - attention：回到提问消息所在会话；
 *  - result：回到工单发起会话；
 *  - 桌面/无平台来源统一落到 `desktop`。
 */
import { describe, expect, it } from 'vitest'
import { resolveSuperAgentReplyChannel } from '../replyTarget'
import type { SuperAgentInput, SuperAgentOutboxReplyPayload, SuperAgentTicket, SuperAgentTrigger } from '../model'

function trigger(overrides: Partial<SuperAgentTrigger> = {}): SuperAgentTrigger {
  return {
    triggerId: 'trigger-feishu',
    key: 'feishu:message:om_human',
    ordinal: 0,
    source: 'feishu-im',
    threadIds: ['feishu:chat:oc_chat'],
    actor: 'ou_user',
    human: true,
    addressed: null,
    channel: 'feishu:chat:oc_chat',
    url: null,
    text: '修一下登录页',
    at: '2026-11-06T00:00:00.000Z',
    meta: {},
    disposition: {
      filtered: null,
      ticketIds: ['ticket-1'],
      contextTicketIds: [],
      requeued: false,
      handedBack: false,
      ackedAt: null,
    },
    ...overrides,
  }
}

function input(overrides: Partial<SuperAgentInput> = {}): SuperAgentInput {
  return {
    inputId: 'input-1',
    ticketId: 'ticket-1',
    ordinal: 1,
    kind: 'trigger',
    status: 'delivered',
    human: true,
    context: false,
    note: null,
    text: '修一下登录页',
    triggerId: 'trigger-feishu',
    requestId: null,
    at: '2026-11-06T00:00:00.000Z',
    readAt: null,
    deliveredTo: null,
    deliveredAt: null,
    releasedAt: null,
    ...overrides,
  }
}

function ticket(overrides: Partial<SuperAgentTicket> = {}): SuperAgentTicket {
  return {
    ticketId: 'ticket-1',
    title: '修登录页',
    state: 'open',
    createdAt: '2026-11-06T00:00:00.000Z',
    origin: { triggerId: 'trigger-feishu', triggerIds: ['trigger-feishu'] },
    mandateId: 'mandate-1',
    threadId: 'feishu:chat:oc_chat',
    assignmentIds: [],
    inputIds: ['input-1'],
    answers: [],
    attentionId: null,
    execution: { name: 'claude-code', directory: '/tmp', assignmentId: null },
    follows: [],
    delivery: null,
    undelivered: [],
    reviewRemindedAt: null,
    ended: null,
    ...overrides,
  }
}

function reply(
  replyType: SuperAgentOutboxReplyPayload['replyType'],
  overrides: Partial<SuperAgentOutboxReplyPayload> = {},
): SuperAgentOutboxReplyPayload {
  return {
    kind: 'reply',
    replyType,
    text: '回复内容',
    inReplyTo: 'input-1',
    attentionId: null,
    reportId: null,
    ...overrides,
  }
}

describe('resolveSuperAgentReplyChannel', () => {
  it('routes an acknowledgement back to the human message topic', () => {
    const channel = resolveSuperAgentReplyChannel({
      ticket: ticket(),
      payload: reply('acknowledgement'),
      state: { triggers: { 'trigger-feishu': trigger() }, inputs: { 'input-1': input() } },
    })

    expect(channel).toBe('feishu:chat:oc_chat:reply:om_human')
  })

  it('routes an answer to the same topic as the acknowledged input', () => {
    const channel = resolveSuperAgentReplyChannel({
      ticket: ticket(),
      payload: reply('answer'),
      state: { triggers: { 'trigger-feishu': trigger() }, inputs: { 'input-1': input() } },
    })

    expect(channel).toBe('feishu:chat:oc_chat:reply:om_human')
  })

  it('routes an attention back to the message that asked the question', () => {
    const channel = resolveSuperAgentReplyChannel({
      ticket: ticket(),
      payload: reply('attention', { attentionId: 'attention-1' }),
      state: { triggers: { 'trigger-feishu': trigger() }, inputs: { 'input-1': input() } },
    })

    expect(channel).toBe('feishu:chat:oc_chat:reply:om_human')
  })

  it('routes a result back to the ticket origin session', () => {
    const channel = resolveSuperAgentReplyChannel({
      ticket: ticket({ origin: { triggerId: 'trigger-github', triggerIds: ['trigger-github'] } }),
      payload: reply('result', { inReplyTo: null, reportId: 'report-1' }),
      state: {
        triggers: {
          'trigger-github': trigger({
            triggerId: 'trigger-github',
            key: 'github-pr:comment:acme/app:42:17',
            source: 'github-pr',
            channel: 'github:pr:acme/app:42',
            threadIds: ['github:pr:acme/app:42'],
            meta: { inReplyTo: null },
          }),
        },
        inputs: {},
      },
    })

    expect(channel).toBe('github:pr:acme/app:42')
  })

  it('targets the review thread for ack/answer on a review comment', () => {
    const channel = resolveSuperAgentReplyChannel({
      ticket: ticket(),
      payload: reply('acknowledgement'),
      state: {
        triggers: {
          'trigger-feishu': trigger({
            key: 'github-pr:comment:acme/app:42:17',
            source: 'github-pr',
            channel: 'github:pr:acme/app:42',
            threadIds: ['github:pr:acme/app:42'],
            meta: { inReplyTo: 19 },
          }),
        },
        inputs: { 'input-1': input() },
      },
    })

    expect(channel).toBe('github:pr:acme/app:42:reply:19')
  })

  it('falls back to desktop for desktop-origin tickets and unknown channels', () => {
    expect(
      resolveSuperAgentReplyChannel({
        ticket: ticket(),
        payload: reply('acknowledgement'),
        state: {
          triggers: {
            'trigger-feishu': trigger({ channel: null, key: 'desktop:message:1', source: 'desktop-router' }),
          },
          inputs: { 'input-1': input() },
        },
      }),
    ).toBe('desktop')

    expect(
      resolveSuperAgentReplyChannel({
        ticket: ticket(),
        payload: reply('result', { inReplyTo: null, reportId: 'report-1' }),
        state: {
          triggers: { 'trigger-feishu': trigger({ channel: 'internal' }) },
          inputs: {},
        },
      }),
    ).toBe('desktop')
  })
})
