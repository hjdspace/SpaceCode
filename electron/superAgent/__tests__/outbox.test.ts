// @vitest-environment node
/**
 * T18 #88 Outbox 回写与受控 reply。
 *
 * 覆盖（issue #88 验收标准）：
 *  - 受控 reply 授权链：answer 只能指向 Worker 用 answers 认领过的人问题
 *   （noAnswer），progress 不冒充结果（notReady），acknowledgement 指向本工单
 *    人消息且工单结束后拒绝（ackEnded），attention 必须匹配当前未清除的
 *    Attention 文本（notAttention）；
 *  - 相同问题只提醒一次：同一 Attention 的 attention 回复去重；问题被替换或
 *    工单结束时，未发出的 attention 回复从 Outbox 撤回；
 *  - messageId 永久去重：重复外发请求返回原消息（duplicate），载荷不同为冲突；
 *  - 回写（receipt）：sent/waiting/gone 各自落库，waiting 指数退避、gone 记
 *    dropped 不无限重发；
 *  - 限流保序：launch/delivery/relay/reply/reviewReminder 各自限流，同一
 *    ticket+channel 严格有序，不同 ticket 可并行；
 *  - 重启续做：sent 不重复投递；崩溃在「平台已发送、receipt 未写回」窗口时，
 *    由 Channel 以 messageId 幂等对账，不盲目重复外发。
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import {
  createSuperAgentOutbox,
  type SuperAgentOutboxChannel,
  type SuperAgentOutboxSendOutcome,
} from '../outbox'
import { openPersistedSuperAgentProject } from '../persistence'
import { createSuperAgentService } from '../service'
import type {
  SuperAgentOutboxMessage,
  SuperAgentOutboxPayload,
} from '../model'

const AT = '2026-01-01T00:00:00.000Z'
const AT_MS = Date.parse(AT)

let uid = 0
const nextReq = (prefix: string): string => `${prefix}-${++uid}`

function makeDomain(): SuperAgentDomain {
  let counter = 0
  return createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
    return '<no-error>'
  } catch (err) {
    return (err as { code?: string }).code ?? '<no-code>'
  }
}

interface Setup {
  domain: SuperAgentDomain
  ticketId: string
  assignmentId: string
}

function setupTicket(domain: SuperAgentDomain): Setup {
  const dispatched = domain.dispatch({
    requestId: nextReq('dispatch'),
    title: '修复登录',
    repoRoot: '/repo',
    text: '修复登录失败的问题',
    actor: 'alice',
  })
  const ticketId = dispatched.ticket.ticketId
  const assignment = domain.launchAssignment({ assignmentId: dispatched.assignment.assignmentId })
  return { domain, ticketId, assignmentId: assignment.assignmentId }
}

/**
 * 建立一个 open Attention：人提问 → Worker 报问。返回提问人与 Attention。
 * 注意 setupClaimedAnswer 建立的 Attention 会被认领关闭（answered），
 * attention 类外发必须用本帮助函数保持 Attention open。
 */
function setupOpenAttention(domain: SuperAgentDomain, setup: Setup, question: string) {
  const asker = domain.addInput({
    ticketId: setup.ticketId,
    requestId: nextReq('request-asker'),
    kind: 'text',
    human: true,
    text: question,
  }).input
  const asked = domain.report({
    ticketId: setup.ticketId,
    assignmentId: setup.assignmentId,
    reportId: nextReq('report-question'),
    kind: 'blocked',
    summary: '等待确认',
    question,
    askedBy: asker.inputId,
  })
  return { asker, attentionId: asked.attentionId as string }
}

/** 提问 → Worker 报问 → 人回答 → Worker 认领：返回问题与被认领的回答 Input。 */
function setupClaimedAnswer(
  domain: SuperAgentDomain,
  setup: Setup,
  question = '旧接口还要保留吗？',
) {
  const asked = setupOpenAttention(domain, setup, question)
  const answered = domain.answerAttention({
    attentionId: asked.attentionId,
    requestId: nextReq('request-answer'),
    text: '保留，别删',
  })
  domain.report({
    ticketId: setup.ticketId,
    assignmentId: setup.assignmentId,
    reportId: nextReq('report-claim'),
    kind: 'progress',
    summary: '已收到回答',
    answers: [answered.input.inputId],
  })
  return { asker: asked.asker, claimed: answered.input, attentionId: asked.attentionId }
}

function replyPayload(overrides: Partial<SuperAgentOutboxPayload>): SuperAgentOutboxPayload {
  return {
    kind: 'reply',
    replyType: 'answer',
    text: '已处理',
    inReplyTo: null,
    attentionId: null,
    reportId: null,
    ...overrides,
  } as SuperAgentOutboxPayload
}

function outboxOf(domain: SuperAgentDomain): SuperAgentOutboxMessage[] {
  return Object.values(domain.state.outbox)
}

// ── 受控 reply 授权链 ────────────────────────────────────────────────

describe('enqueueOutboxMessage: answer 授权链', () => {
  it('允许外发 Worker 已认领的人问题回答，且载荷可追溯到认领 Input', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const { claimed } = setupClaimedAnswer(domain, setup)

    const enqueued = domain.enqueueOutboxMessage({
      messageId: 'reply-claim-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({ replyType: 'answer', inReplyTo: claimed.inputId }),
    })

    expect(enqueued.duplicate).toBe(false)
    expect(enqueued.message.status).toBe('pending')
    expect(enqueued.message.kind).toBe('reply')
    expect(enqueued.message.channel).toBe('feishu:chat-1')
    expect(enqueued.message.payload).toEqual(
      replyPayload({ replyType: 'answer', inReplyTo: claimed.inputId }),
    )
  })

  it('未认领的问题不得外发为回答（noAnswer），bot 消息不得作为回答引用（notAsker）', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const { asker } = setupClaimedAnswer(domain, setup)
    const bot = domain.addInput({
      ticketId: setup.ticketId,
      requestId: 'request-bot',
      kind: 'note',
      human: false,
      text: 'CI 说构建挂了',
    }).input

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'reply-unclaimed',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'answer', inReplyTo: asker.inputId }),
        }),
      ),
    ).toBe('noAnswer')

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'reply-bot',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'answer', inReplyTo: bot.inputId }),
        }),
      ),
    ).toBe('notAsker')
  })

  it('工单结束后的 answer 外发被拒绝', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const { claimed } = setupClaimedAnswer(domain, setup)
    domain.ticketStop({ ticketId: setup.ticketId })

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'reply-after-end',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'answer', inReplyTo: claimed.inputId }),
        }),
      ),
    ).toBe('ticketEnded')
  })
})

describe('enqueueOutboxMessage: acknowledgement / result 授权链', () => {
  it('acknowledgement 只能指向到达本工单的人消息，工单结束后拒绝', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const human = domain.addInput({
      ticketId: setup.ticketId,
      requestId: 'request-human',
      kind: 'text',
      human: true,
      text: '收到我刚才的消息了吗？',
    }).input
    const bot = domain.addInput({
      ticketId: setup.ticketId,
      requestId: 'request-bot',
      kind: 'note',
      human: false,
      text: 'CI 构建完成',
    }).input

    const ok = domain.enqueueOutboxMessage({
      messageId: 'ack-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({ replyType: 'acknowledgement', inReplyTo: human.inputId }),
    })
    expect(ok.message.status).toBe('pending')

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'ack-bot',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'acknowledgement', inReplyTo: bot.inputId }),
        }),
      ),
    ).toBe('notAsker')

    domain.ticketStop({ ticketId: setup.ticketId })
    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'ack-ended',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'acknowledgement', inReplyTo: human.inputId }),
        }),
      ),
    ).toBe('ackEnded')
  })

  it('progress 不冒充结果：未 ready 时 result 被拒，引用 progress 报告被拒（notReady）', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)

    const progress = domain.report({
      ticketId: setup.ticketId,
      assignmentId: setup.assignmentId,
      reportId: 'report-progress',
      kind: 'progress',
      summary: '做到一半',
    })

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'result-too-early',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'result', reportId: 'report-progress' }),
        }),
      ),
    ).toBe('notReady')

    const ready = domain.report({
      ticketId: setup.ticketId,
      assignmentId: setup.assignmentId,
      reportId: 'report-ready',
      kind: 'ready',
      summary: '修完了，请验收',
    })

    // ready 后引用 progress 报告外发为结果仍然被拒：progress 不外发为结果
    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'result-progress',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'result', reportId: progress.report.reportId }),
        }),
      ),
    ).toBe('notReady')

    const ok = domain.enqueueOutboxMessage({
      messageId: 'result-ready',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({ replyType: 'result', reportId: ready.report.reportId }),
    })
    expect(ok.message.status).toBe('pending')
  })

  it('result 在 completed 工单上仍可追溯外发，stopped 工单拒绝', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const ready = domain.report({
      ticketId: setup.ticketId,
      assignmentId: setup.assignmentId,
      reportId: 'report-ready',
      kind: 'ready',
      summary: '修完了，请验收',
    })

    domain.ticketAccept({ ticketId: setup.ticketId })
    const ok = domain.enqueueOutboxMessage({
      messageId: 'result-completed',
      ticketId: setup.ticketId,
      channel: 'github:issue-1',
      payload: replyPayload({ replyType: 'result', reportId: ready.report.reportId }),
    })
    expect(ok.message.status).toBe('pending')

    const stopped = setupTicket(makeDomain())
    stopped.domain.report({
      ticketId: stopped.ticketId,
      assignmentId: stopped.assignmentId,
      reportId: 'report-ready-2',
      kind: 'ready',
      summary: '修完了',
    })
    stopped.domain.ticketStop({ ticketId: stopped.ticketId })
    expect(
      codeOf(() =>
        stopped.domain.enqueueOutboxMessage({
          messageId: 'result-stopped',
          ticketId: stopped.ticketId,
          channel: 'github:issue-2',
          payload: replyPayload({ replyType: 'result', reportId: 'report-ready-2' }),
        }),
      ),
    ).toBe('notReady')
  })
})

describe('enqueueOutboxMessage: attention 授权链与「同一问题只提醒一次」', () => {
  it('attention 回复必须匹配当前 open Attention 的文本；回答后不得再提醒', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const asked = setupOpenAttention(domain, setup, '旧接口还要保留吗？')

    const ok = domain.enqueueOutboxMessage({
      messageId: 'attention-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({
        replyType: 'attention',
        attentionId: asked.attentionId,
        text: '旧接口还要保留吗？',
      }),
    })
    expect(ok.message.status).toBe('pending')

    // 文本与当前 Attention 不匹配
    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'attention-mismatch',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({
            replyType: 'attention',
            attentionId: asked.attentionId,
            text: '另一个问题？',
          }),
        }),
      ),
    ).toBe('notAttention')

    // Attention 已被认领回答（open → answered）：不再外发提醒
    const answered = domain.answerAttention({
      attentionId: asked.attentionId,
      requestId: nextReq('request-answer'),
      text: '保留，别删',
    })
    domain.report({
      ticketId: setup.ticketId,
      assignmentId: setup.assignmentId,
      reportId: nextReq('report-claim'),
      kind: 'progress',
      summary: '已收到回答',
      answers: [answered.input.inputId],
    })
    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'attention-answered',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({
            replyType: 'attention',
            attentionId: asked.attentionId,
            text: '旧接口还要保留吗？',
          }),
        }),
      ),
    ).toBe('notAttention')
  })

  it('同一 Attention 只提醒一次：不同 messageId 的重复外发返回原消息', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const asked = setupOpenAttention(domain, setup, '旧接口还要保留吗？')

    const first = domain.enqueueOutboxMessage({
      messageId: 'attention-stable-id',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({
        replyType: 'attention',
        attentionId: asked.attentionId,
        text: '旧接口还要保留吗？',
      }),
    })
    const second = domain.enqueueOutboxMessage({
      messageId: 'attention-other-id',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({
        replyType: 'attention',
        attentionId: asked.attentionId,
        text: '旧接口还要保留吗？',
      }),
    })

    expect(second.duplicate).toBe(true)
    expect(second.message.messageId).toBe(first.message.messageId)
    expect(outboxOf(domain)).toHaveLength(1)
  })

  it('新问题替换旧问题时，未发出的 attention 回复从 Outbox 撤回', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const asked = setupOpenAttention(domain, setup, '旧接口还要保留吗？')

    const old = domain.enqueueOutboxMessage({
      messageId: 'attention-old',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({
        replyType: 'attention',
        attentionId: asked.attentionId,
        text: '旧接口还要保留吗？',
      }),
    })

    // Worker 提出新的问题替换旧问题
    domain.report({
      ticketId: setup.ticketId,
      assignmentId: setup.assignmentId,
      reportId: nextReq('report-question'),
      kind: 'blocked',
      summary: '还要确认',
      question: '那超时时间呢？',
      askedBy: asked.asker.inputId,
    })

    expect(old.message.status).toBe('withdrawn')
    const pending = outboxOf(domain).filter((message) => message.status === 'pending')
    expect(pending).toHaveLength(0)
  })

  it('工单结束时，未发出的 attention 回复一并撤回', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const asked = setupOpenAttention(domain, setup, '旧接口还要保留吗？')

    const pending = domain.enqueueOutboxMessage({
      messageId: 'attention-end',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({
        replyType: 'attention',
        attentionId: asked.attentionId,
        text: '旧接口还要保留吗？',
      }),
    })

    domain.ticketStop({ ticketId: setup.ticketId })
    expect(pending.message.status).toBe('withdrawn')
  })
})

// ── 内部 effect 与载荷校验、messageId 永久去重 ──────────────────────

describe('enqueueOutboxMessage: 内部 kind 与幂等', () => {
  it('launch/delivery/relay 各自校验引用归属，载荷或通道非法稳定拒绝', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'launch-1',
          ticketId: setup.ticketId,
          channel: 'internal',
          payload: { kind: 'launch', assignmentId: 'assignment-404' },
        }),
      ),
    ).toBe('assignmentNotFound')

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'delivery-1',
          ticketId: setup.ticketId,
          channel: 'internal',
          payload: { kind: 'delivery', inputId: 'input-404', requestId: 'r' },
        }),
      ),
    ).toBe('inputNotFound')

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'relay-1',
          ticketId: setup.ticketId,
          channel: 'internal',
          payload: { kind: 'relay', reportId: 'report-404' },
        }),
      ),
    ).toBe('invalidOutbound')

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'empty-channel',
          ticketId: setup.ticketId,
          channel: '  ',
          payload: { kind: 'reviewReminder' },
        }),
      ),
    ).toBe('invalidOutbound')

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'empty-text',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({ replyType: 'answer', text: '  ' }),
        }),
      ),
    ).toBe('invalidOutbound')
  })

  it('messageId 永久去重：已外发（sent）后重复入队返回原消息，载荷不同为冲突', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const claimed = setupClaimedAnswer(domain, setup)
    const payload = replyPayload({ replyType: 'answer', inReplyTo: claimed.claimed.inputId })

    domain.enqueueOutboxMessage({
      messageId: 'dedupe-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload,
    })
    domain.settleOutboxMessage({
      messageId: 'dedupe-1',
      outcome: 'sent',
      receipt: 'platform-msg-1',
    })

    const again = domain.enqueueOutboxMessage({
      messageId: 'dedupe-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload,
    })
    expect(again.duplicate).toBe(true)
    expect(again.message.status).toBe('sent')
    expect(again.message.receipt).toBe('platform-msg-1')
    expect(outboxOf(domain)).toHaveLength(1)

    expect(
      codeOf(() =>
        domain.enqueueOutboxMessage({
          messageId: 'dedupe-1',
          ticketId: setup.ticketId,
          channel: 'feishu:chat-1',
          payload: replyPayload({
            replyType: 'answer',
            text: '不同的载荷',
            inReplyTo: claimed.claimed.inputId,
          }),
        }),
      ),
    ).toBe('conflict')
  })
})

// ── 回写（receipt）与退避 ────────────────────────────────────────────

describe('settleOutboxMessage: 回写与退避', () => {
  it('sent 写回平台回执，重复回写幂等返回原消息', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    const claimed = setupClaimedAnswer(domain, setup)
    domain.enqueueOutboxMessage({
      messageId: 'settle-sent',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: replyPayload({ replyType: 'answer', inReplyTo: claimed.claimed.inputId }),
    })

    const settled = domain.settleOutboxMessage({
      messageId: 'settle-sent',
      outcome: 'sent',
      receipt: 'platform-abc',
    })
    expect(settled.duplicate).toBe(false)
    expect(settled.message.status).toBe('sent')
    expect(settled.message.receipt).toBe('platform-abc')
    expect(settled.message.sentAt).toBe(AT)

    const repeat = domain.settleOutboxMessage({
      messageId: 'settle-sent',
      outcome: 'sent',
      receipt: 'platform-abc',
    })
    expect(repeat.duplicate).toBe(true)
    expect(repeat.message).toBe(settled.message)
  })

  it('waiting 指数退避：attempts 递增、nextAttemptAt 越推越晚，保持 pending', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    domain.enqueueOutboxMessage({
      messageId: 'settle-waiting',
      ticketId: setup.ticketId,
      channel: 'internal',
      payload: { kind: 'reviewReminder' },
    })

    const first = domain.settleOutboxMessage({
      messageId: 'settle-waiting',
      outcome: 'waiting',
      error: 'timeout',
    })
    expect(first.message.status).toBe('pending')
    expect(first.message.attempts).toBe(1)
    expect(first.message.nextAttemptAt).not.toBeNull()
    // message 是同一可变对象：先记录第一次的退避时间再二次回写
    const firstNextAttemptAt = first.message.nextAttemptAt

    const second = domain.settleOutboxMessage({
      messageId: 'settle-waiting',
      outcome: 'waiting',
      error: 'timeout',
    })
    expect(second.message.attempts).toBe(2)
    // 指数退避：第二次的下次可试时间必须比第一次晚
    expect(Date.parse(second.message.nextAttemptAt as string)).toBeGreaterThan(
      Date.parse(firstNextAttemptAt as string),
    )
  })

  it('gone 记 dropped 不再重发；未知 messageId 稳定拒绝', () => {
    const domain = makeDomain()
    const setup = setupTicket(domain)
    domain.enqueueOutboxMessage({
      messageId: 'settle-gone',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: { kind: 'reviewReminder' },
    })

    const dropped = domain.settleOutboxMessage({
      messageId: 'settle-gone',
      outcome: 'gone',
      error: 'chat dissolved',
    })
    expect(dropped.message.status).toBe('dropped')
    expect(dropped.message.lastError).toBe('chat dissolved')

    const repeat = domain.settleOutboxMessage({
      messageId: 'settle-gone',
      outcome: 'waiting',
      error: 'timeout',
    })
    expect(repeat.duplicate).toBe(true)
    expect(repeat.message.status).toBe('dropped')

    expect(
      codeOf(() =>
        domain.settleOutboxMessage({ messageId: 'nope', outcome: 'sent', receipt: 'x' }),
      ),
    ).toBe('invalidOutbound')
  })
})

// ── runner：限流保序、退避重试、重启续做 ─────────────────────────────

interface ChannelCall {
  message: SuperAgentOutboxMessage
  resolve: (outcome: SuperAgentOutboxSendOutcome) => void
}

/**
 * 受控 fake channel：外发调用人工手动落定；相同 messageId 重复投递返回原回执
 * （崩溃对账契约：Channel 必须以 messageId 幂等，不重复执行平台副作用）。
 */
function fakeChannel() {
  const calls: ChannelCall[] = []
  const sent = new Map<string, string>()
  const channel: SuperAgentOutboxChannel = (message) =>
    new Promise((resolve) => {
      const known = sent.get(message.messageId)
      if (known) {
        resolve({ outcome: 'sent', receipt: known })
        return
      }
      calls.push({ message, resolve })
    })
  const settle = (call: ChannelCall, receipt: string): void => {
    sent.set(call.message.messageId, receipt)
    call.resolve({ outcome: 'sent', receipt })
  }
  return { channel, calls, settle, sent }
}

const ZERO_LIMITS = { launch: 0, delivery: 0, relay: 0, reply: 0, reviewReminder: 0 }

/** 冲刷微任务/宏任务队列，让 runner 的回写与自动续泵先跑完。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function runnerDomain(): SuperAgentDomain {
  return makeDomain()
}

describe('outbox runner: 限流保序与退避', () => {
  it('同一 ticket+channel 严格有序，不同 ticket 可并行', async () => {
    const domain = runnerDomain()
    const a = setupTicket(domain)
    const b = setupTicket(domain)
    const hub = fakeChannel()
    let clock = AT_MS
    const outbox = createSuperAgentOutbox({
      domain,
      channel: hub.channel,
      limits: ZERO_LIMITS,
      now: () => new Date(clock),
    })
    domain.enqueueOutboxMessage({
      messageId: 'a-1',
      ticketId: a.ticketId,
      channel: 'feishu:chat-a',
      payload: { kind: 'reviewReminder' },
    })
    domain.enqueueOutboxMessage({
      messageId: 'a-2',
      ticketId: a.ticketId,
      channel: 'feishu:chat-a',
      payload: { kind: 'reviewReminder' },
    })
    domain.enqueueOutboxMessage({
      messageId: 'b-1',
      ticketId: b.ticketId,
      channel: 'feishu:chat-b',
      payload: { kind: 'reviewReminder' },
    })

    expect(outbox.pump()).toBe(2)
    expect(hub.calls.map((call) => call.message.messageId)).toEqual(['a-1', 'b-1'])

    // a-1 未落定前，同 lane 的 a-2 不投；b 已投完不影响 a lane
    expect(outbox.pump()).toBe(0)
    hub.settle(hub.calls[0], 'receipt-a-1')
    await flush()
    // 落定回写后自动续泵：a-2 立即派发
    expect(hub.calls.map((call) => call.message.messageId)).toEqual(['a-1', 'b-1', 'a-2'])
    expect(outbox.pump()).toBe(0)
  })

  it('各类投递各自限流：同类第二晚一个间隔，异类不被牵连', () => {
    const domain = runnerDomain()
    const a = setupTicket(domain)
    const b = setupTicket(domain)
    const hub = fakeChannel()
    let clock = AT_MS
    const outbox = createSuperAgentOutbox({
      domain,
      channel: hub.channel,
      limits: { ...ZERO_LIMITS, reviewReminder: 100 },
      now: () => new Date(clock),
    })
    domain.enqueueOutboxMessage({
      messageId: 'r-1',
      ticketId: a.ticketId,
      channel: 'feishu:chat-a',
      payload: { kind: 'reviewReminder' },
    })
    domain.enqueueOutboxMessage({
      messageId: 'r-2',
      ticketId: b.ticketId,
      channel: 'feishu:chat-b',
      payload: { kind: 'reviewReminder' },
    })
    domain.enqueueOutboxMessage({
      messageId: 'l-1',
      ticketId: a.ticketId,
      channel: 'feishu:chat-c',
      payload: { kind: 'launch', assignmentId: a.assignmentId },
    })

    // reviewReminder 限流只放行 r-1；launch 是另一类，立即放行
    expect(outbox.pump()).toBe(2)
    expect(hub.calls.map((call) => call.message.messageId)).toEqual(['r-1', 'l-1'])

    clock += 99
    expect(outbox.pump()).toBe(0)
    clock += 1
    expect(outbox.pump()).toBe(1)
    expect(hub.calls.map((call) => call.message.messageId)).toEqual(['r-1', 'l-1', 'r-2'])
  })

  it('waiting 指数退避后重试，gone 记 dropped 不再重发', async () => {
    const domain = runnerDomain()
    const setup = setupTicket(domain)
    let clock = AT_MS
    let failWith: 'waiting' | 'gone' = 'waiting'
    const attempts: string[] = []
    const outbox = createSuperAgentOutbox({
      domain,
      channel: (message) => {
        attempts.push(message.messageId)
        if (failWith === 'waiting') return Promise.resolve({ outcome: 'waiting', error: 'net' })
        return Promise.resolve({ outcome: 'gone', error: 'chat dissolved' })
      },
      limits: ZERO_LIMITS,
      now: () => new Date(clock),
    })
    domain.enqueueOutboxMessage({
      messageId: 'flaky-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: { kind: 'reviewReminder' },
    })

    expect(outbox.pump()).toBe(1)
    await flush()
    // 退避窗口内不重试
    expect(outbox.pump()).toBe(0)
    clock += 60_000
    expect(outbox.pump()).toBe(1)
    await flush()
    expect(attempts).toEqual(['flaky-1', 'flaky-1'])
    expect(domain.state.outbox['flaky-1'].status).toBe('pending')
    expect(domain.state.outbox['flaky-1'].attempts).toBe(2)

    failWith = 'gone'
    clock += 120_000
    expect(outbox.pump()).toBe(1)
    await flush()
    expect(domain.state.outbox['flaky-1'].status).toBe('dropped')
    clock += 120_000
    expect(outbox.pump()).toBe(0)
    expect(attempts).toHaveLength(3)
  })

  it('settle 有界等待在途投递落定（shutdown 语义）', async () => {
    const domain = runnerDomain()
    const setup = setupTicket(domain)
    const hub = fakeChannel()
    const outbox = createSuperAgentOutbox({
      domain,
      channel: hub.channel,
      limits: ZERO_LIMITS,
      now: () => new Date(AT_MS),
    })
    domain.enqueueOutboxMessage({
      messageId: 'settle-1',
      ticketId: setup.ticketId,
      channel: 'feishu:chat-1',
      payload: { kind: 'reviewReminder' },
    })
    outbox.pump()

    const settled = outbox.settle(50)
    hub.settle(hub.calls[0], 'receipt-1')
    expect(await settled).toBe(true)
    expect(domain.state.outbox['settle-1'].status).toBe('sent')

    // 无在途时立即落定
    expect(await outbox.settle(50)).toBe(true)
  })
})

// ── 持久化集成：重启续做、不重复投递 ────────────────────────────────

describe('outbox 持久化与重启续做', () => {
  const dirs: string[] = []

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'super-agent-outbox-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sent 不重复投递；崩溃在「已发送未回写」窗口时以 messageId 对账，不盲目重发', async () => {
    const userDataDir = tempDir()
    const repoRoot = tempDir()

    // 第一段：建单 + 入列 + 正常外发（回执已写回）
    const first = openPersistedSuperAgentProject({ userDataDir, repoRoot })
    const setup1 = setupTicket(first.domain)
    first.domain.enqueueOutboxMessage({
      messageId: 'done-1',
      ticketId: setup1.ticketId,
      channel: 'feishu:chat-1',
      payload: { kind: 'reviewReminder' },
    })
    first.domain.settleOutboxMessage({
      messageId: 'done-1',
      outcome: 'sent',
      receipt: 'platform-done-1',
    })

    // 第二段：模拟「平台已发送、receipt 未写回」的崩溃窗口
    first.domain.enqueueOutboxMessage({
      messageId: 'crash-1',
      ticketId: setup1.ticketId,
      channel: 'feishu:chat-1',
      payload: { kind: 'reviewReminder' },
    })
    const hub = fakeChannel()
    const outbox1 = createSuperAgentOutbox({
      domain: first.domain,
      channel: hub.channel,
      limits: ZERO_LIMITS,
    })
    outbox1.start()
    expect(hub.calls).toHaveLength(1)
    expect(hub.calls[0].message.messageId).toBe('crash-1')
    // 进程在回写前崩溃：不落定、不回写，直接关 Store
    outbox1.stop()
    first.store.close()

    // 第三段：重启 —— sent 不再投递；crash 窗口消息只续做一次，
    // Channel 以 messageId 幂等返回原回执，不重复执行平台副作用
    const second = openPersistedSuperAgentProject({ userDataDir, repoRoot })
    expect(second.domain.state.outbox['done-1'].status).toBe('sent')
    expect(second.domain.state.outbox['crash-1'].status).toBe('pending')
    const sideEffects: string[] = []
    const channel2: SuperAgentOutboxChannel = (message) =>
      new Promise((resolve) => {
        sideEffects.push(message.messageId)
        resolve({ outcome: 'sent', receipt: `platform-${message.messageId}` })
      })
    const outbox2 = createSuperAgentOutbox({
      domain: second.domain,
      channel: channel2,
      limits: ZERO_LIMITS,
    })
    outbox2.start()
    expect(sideEffects).toEqual(['crash-1'])
    outbox2.stop()
    await flush()

    const resumed = second.domain.state.outbox['crash-1']
    expect(resumed.status).toBe('sent')
    expect(resumed.receipt).toBe('platform-crash-1')
    second.store.close()
  })

  it('service 接线：outboxEnqueue 经 runner 外发，shutdown 后重启不重复投递', async () => {
    const userDataDir = tempDir()
    const repoRoot = tempDir()
    const sent: string[] = []
    const channel: SuperAgentOutboxChannel = (message) => {
      sent.push(message.messageId)
      return Promise.resolve({ outcome: 'sent', receipt: `platform-${message.messageId}` })
    }
    const makeService = () =>
      createSuperAgentService({
        userDataDir,
        outbox: { channel, limits: ZERO_LIMITS, sweepIntervalMs: 60_000 },
      })

    const service = makeService()
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'dispatch-1',
      title: '修复登录',
      text: '修复登录失败的问题',
    })
    const enqueued = service.outboxEnqueue(repoRoot, {
      messageId: 'svc-1',
      ticketId: dispatched.ticketId,
      channel: 'feishu:chat-1',
      payload: { kind: 'reviewReminder' },
    })
    expect(enqueued.status).toBe('pending')
    service.sweepOutbox(repoRoot)

    // 等待 runner 完成 channel 回写
    for (
      let i = 0;
      i < 100 &&
      service.outboxQueue(repoRoot).find((m) => m.messageId === 'svc-1')?.status !== 'sent';
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(sent).toEqual(['svc-1'])
    expect(service.outboxQueue(repoRoot).find((m) => m.messageId === 'svc-1')?.status).toBe(
      'sent',
    )

    await service.shutdown(repoRoot)

    // 重启：sent 消息不重复投递
    const reopened = makeService()
    reopened.sweepOutbox(repoRoot)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toEqual(['svc-1'])
    expect(reopened.outboxQueue(repoRoot).find((m) => m.messageId === 'svc-1')?.status).toBe(
      'sent',
    )
    await reopened.shutdown(repoRoot)
  })
})
