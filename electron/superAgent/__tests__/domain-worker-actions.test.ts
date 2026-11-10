/**
 * Worker 指令的领域事实（#100）。
 *
 * 三种围栏动作最终都要落到 Domain：
 *  - `followForContext`：把相关 Thread 登记为仅上下文订阅（不授权、不唤醒、
 *    不产生 follow-up 归属），重复登记幂等；来源/已 follow 的订阅不降级。
 *  - `handbackInput` / `markUnrelated` 带原因时写审计，供工单详情折叠展示。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain, type TriggerDraft } from '../domain'
import type { SuperAgentTicket, SuperAgentTrigger } from '../model'
import { resolveSuperAgentHandbackInputId } from '../workerActions'

const T0 = '2026-01-01T00:00:00.000Z'

function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString()
}

interface Harness {
  domain: SuperAgentDomain
  intake(key: string, partial?: Partial<TriggerDraft>): SuperAgentTrigger
  ticket(key: string, threadId?: string): SuperAgentTicket
  deliver(trigger: SuperAgentTrigger, ticketId: string): ReturnType<SuperAgentDomain['addInput']>
}

function makeDomain(): Harness {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(Date.parse(T0)),
    newId: (kind: string) => `${kind}-${++counter}`,
  })
  const intake = (key: string, partial: Partial<TriggerDraft> = {}): SuperAgentTrigger => {
    const draft: TriggerDraft = {
      key,
      source: 'feishu-im',
      threadIds: ['th1'],
      actor: 'feishu:user:u1',
      human: true,
      addressed: 'mention',
      text: `消息 ${key}`,
      ...partial,
    }
    return domain.intakeTrigger(draft).trigger
  }
  const ticket = (key: string, threadId = 'th1'): SuperAgentTicket => {
    return domain.createTicket({
      requestId: `req-${key}`,
      title: `工单 ${key}`,
      repoRoot: '/repo',
      trigger: {
        key,
        source: 'feishu-im',
        threadIds: [threadId],
        actor: 'feishu:user:u1',
        human: true,
        addressed: 'mention',
        text: `建单 ${key}`,
      },
    }).ticket
  }
  const deliver = (trigger: SuperAgentTrigger, ticketId: string) =>
    domain.addInput({
      ticketId,
      requestId: `source:${trigger.key}:${ticketId}`,
      kind: 'trigger',
      human: trigger.human,
      context: false,
      text: trigger.text,
      triggerId: trigger.triggerId,
    })
  return { domain, intake, ticket, deliver }
}

describe('followForContext（仅上下文订阅）', () => {
  it('subscribes the thread as context-only without granting follow-up ownership', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    // intake 建出另一条 Thread；它不是工单来源，也未与工单建立订阅。
    const related = h.intake('related', { threadIds: ['th-related'] })
    h.domain.followForContext({
      ticketId: ticket.ticketId,
      threadId: 'th-related',
      reason: '相关 PR 需要参考',
      at: at(10),
    })

    const subscription = h.domain.state.threads['th-related'].subscriptions.find(
      (item) => item.ticketId === ticket.ticketId,
    )
    expect(subscription).toMatchObject({ ticketId: ticket.ticketId, contextOnly: true })

    // 不授权：这条 Thread 的新人消息不归该工单裁决。
    expect(h.domain.followupOwners(related.triggerId)).toEqual([])
    // 授权事实未被伪造（没有 follows，也不产生可裁决归属）。
    expect(h.domain.state.tickets[ticket.ticketId]?.follows).toEqual([])
  })

  it('is idempotent and does not append a second audit record', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.intake('related', { threadIds: ['th-related'] })

    const first = h.domain.followForContext({ ticketId: ticket.ticketId, threadId: 'th-related', at: at(10) })
    const second = h.domain.followForContext({ ticketId: ticket.ticketId, threadId: 'th-related', at: at(20) })

    expect(first.subscriptionCreated).toBe(true)
    expect(second.subscriptionCreated).toBe(false)
    expect(
      h.domain.state.threads['th-related'].subscriptions.filter(
        (item) => item.ticketId === ticket.ticketId,
      ),
    ).toHaveLength(1)
    expect(
      h.domain.state.workerActions.filter(
        (item) => item.kind === 'threadFollow' && item.threadId === 'th-related',
      ),
    ).toHaveLength(1)
  })

  it('does not downgrade an existing adjudicable subscription', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.domain.followThread({
      ticketId: ticket.ticketId,
      threadId: 'github:pr:o/r:7',
      source: 'github-pr',
      at: at(10),
    })

    const result = h.domain.followForContext({
      ticketId: ticket.ticketId,
      threadId: 'github:pr:o/r:7',
      at: at(20),
    })

    expect(result.subscriptionCreated).toBe(false)
    expect(
      h.domain.state.threads['github:pr:o/r:7'].subscriptions.find(
        (item) => item.ticketId === ticket.ticketId,
      )?.contextOnly,
    ).toBe(false)
  })

  it('refuses an unknown thread or an ended ticket', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    expect(() =>
      h.domain.followForContext({ ticketId: ticket.ticketId, threadId: 'th-missing' }),
    ).toThrow(/threadNotFound/)
    h.domain.endTicket({ ticketId: ticket.ticketId, outcome: 'completed', by: 'user', reason: 'done' })
    expect(() =>
      h.domain.followForContext({ ticketId: ticket.ticketId, threadId: 'th1' }),
    ).toThrow(/ticketEnded/)
  })
})

describe('handback 的 triggerId → inputId 解析', () => {
  it('resolves the unreleased human input the ticket actually holds', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m1', { addressed: null })
    const input = h.deliver(trigger, ticket.ticketId).input

    expect(
      resolveSuperAgentHandbackInputId(h.domain.state, ticket.ticketId, trigger.triggerId),
    ).toBe(input.inputId)
  })

  it('prefers the live input when the same trigger was also delivered as context', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m1', { addressed: null })
    const human = h.deliver(trigger, ticket.ticketId).input
    // 同一条 Trigger 的上下文副本排在前面，交回应选中仍可直接裁决的人消息。
    const context = h.domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'ctx-1',
      kind: 'trigger',
      human: true,
      context: true,
      text: trigger.text,
      triggerId: trigger.triggerId,
    }).input

    expect(
      resolveSuperAgentHandbackInputId(h.domain.state, ticket.ticketId, trigger.triggerId),
    ).toBe(human.inputId)
    expect(context.inputId).not.toBe(human.inputId)
  })

  it('refuses an unknown trigger or a trigger held by another ticket', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const other = h.intake('m1', { threadIds: ['th-other'], addressed: null })

    expect(() =>
      resolveSuperAgentHandbackInputId(h.domain.state, ticket.ticketId, 'trigger-missing'),
    ).toThrow(/triggerNotFound/)
    expect(() =>
      resolveSuperAgentHandbackInputId(h.domain.state, ticket.ticketId, other.triggerId),
    ).toThrow(/notHandbackable/)
  })
})

describe('Worker 指令审计（原因可在工单详情查到）', () => {
  it('records a handback reason on the ticket audit', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m1', { addressed: null })
    const input = h.deliver(trigger, ticket.ticketId).input

    const result = h.domain.handbackInput({
      ticketId: ticket.ticketId,
      inputId: input.inputId,
      reason: '应由另一张工单处理',
    })

    // 最后一个 owner 交回 → 回流 Eval 候选。
    expect(result.requeued).toBe(true)
    expect(h.domain.state.workerActions[h.domain.state.workerActions.length - 1]).toMatchObject({
      kind: 'handback',
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      inputId: input.inputId,
      threadId: null,
      reason: '应由另一张工单处理',
    })
  })

  it('records a thread-unrelated reason with the released inputs', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m1', { threadIds: ['th-noise'], addressed: null })
    // attachTicket 建立的是可裁决订阅（不进 ticket.follows 保护集），
    // followThread 会被 markUnrelated 视为受保护 Thread。
    const input = h.domain.attachTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
    }).input
    if (!input) throw new Error('attachTicket 应落下输入')

    h.domain.markUnrelated({ ticketId: ticket.ticketId, threadId: 'th-noise', reason: '与本工单无关' })

    expect(h.domain.state.workerActions[h.domain.state.workerActions.length - 1]).toMatchObject({
      kind: 'threadUnrelated',
      ticketId: ticket.ticketId,
      triggerId: null,
      inputId: null,
      threadId: 'th-noise',
      reason: '与本工单无关',
    })
    expect(h.domain.state.inputs[input.inputId]?.releasedAt).not.toBeNull()
  })

  it('records a context subscription audit entry', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.intake('ref', { threadIds: ['th-ref'] })

    h.domain.followForContext({
      ticketId: ticket.ticketId,
      threadId: 'th-ref',
      reason: '参考实现',
      at: at(5),
    })

    expect(h.domain.state.workerActions[h.domain.state.workerActions.length - 1]).toMatchObject({
      kind: 'threadFollow',
      ticketId: ticket.ticketId,
      triggerId: null,
      inputId: null,
      threadId: 'th-ref',
      reason: '参考实现',
    })
  })
})
