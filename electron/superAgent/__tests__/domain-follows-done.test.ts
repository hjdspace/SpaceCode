// @vitest-environment node
/**
 * T19 #89：PR 合并/关闭按 Thread 结束工单（followsDone）。
 *
 * 覆盖验收：
 *  - 来源 Thread 或 follows 该 Thread 的开放工单按 merged/closed 结束，
 *    结束结果不压成 completed（ended.outcome 原样落库、ended.by 可查询）；
 *  - follows 关系在工单结束后保留（审计），attach 订阅来源之外的 Thread
 *    会记入 follows（且幂等）；
 *  - 幂等：重复报告同一 Thread 终止返回空 endedTickets，不抛 ticketEnded；
 *  - 与其余结束出口一致的收尾：开放 Attention 撤回、最新代次一并收尾；
 *    merged/closed 是自然结束，Mandate 不撤回（区别于 ticketStop）；
 *  - 订阅寿命：followsDone 结束（非 stopped）的工单订阅保留至 TTL。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain, type TriggerDraft } from '../domain'
import type { SuperAgentTicket, SuperAgentTrigger } from '../model'

const T0 = '2026-01-01T00:00:00.000Z'
const PR_THREAD = 'github:pr:acme/app:42'
const SUBSCRIPTION_TTL_MS = 1_000

interface Harness {
  domain: SuperAgentDomain
  setNow(ms: number): void
  intake(key: string, partial?: Partial<TriggerDraft>): SuperAgentTrigger
  ticket(key: string, threadId?: string): SuperAgentTicket
}

function makeDomain(subscriptionTtlMs?: number): Harness {
  let counter = 0
  let nowMs = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(Date.parse(T0) + nowMs),
    newId: (kind: string) => `${kind}-${++counter}`,
    ...(subscriptionTtlMs !== undefined ? { subscriptionTtlMs } : {}),
  })
  const intake = (key: string, partial: Partial<TriggerDraft> = {}): SuperAgentTrigger => {
    const draft: TriggerDraft = {
      key,
      source: 'github-pr',
      threadIds: [PR_THREAD],
      actor: 'github:user:reviewer',
      human: true,
      text: `消息 ${key}`,
      ...partial,
    }
    return domain.intakeTrigger(draft).trigger
  }
  const ticket = (key: string, threadId = PR_THREAD): SuperAgentTicket => {
    return domain.createTicket({
      requestId: `req-${key}`,
      title: `工单 ${key}`,
      repoRoot: '/repo',
      trigger: {
        key,
        source: 'github-pr',
        threadIds: [threadId],
        actor: 'github:user:alice',
        human: true,
        text: `建单 ${key}`,
      },
    }).ticket
  }
  return { domain, setNow: (ms: number) => (nowMs = ms), intake, ticket }
}

describe('followsDone：PR 合并/关闭结束工单', () => {
  it('ends open tickets on or following the thread with the raw outcome', () => {
    const h = makeDomain()
    const origin = h.ticket('origin')
    // 另一来源工单 attach 订阅 PR Thread，并 follow 该 PR（follows 由 Worker
    // 的 follow_for_context 类动作建立，T19 只负责结束时保留审计）。
    const desktop = h.ticket('desktop', 'desktop:thread:1')
    const prTrigger = h.intake('pr-review-1', { addressed: null })
    h.domain.attachTicket({ ticketId: desktop.ticketId, triggerId: prTrigger.triggerId })
    desktop.follows.push(PR_THREAD)
    // 与 PR 无关的开放工单不受影响。
    const other = h.ticket('other', 'desktop:thread:2')

    const result = h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged' })

    expect(result.threadId).toBe(PR_THREAD)
    expect(result.endedTickets.map((entry) => entry.ticket.ticketId).sort()).toEqual(
      [origin.ticketId, desktop.ticketId].sort(),
    )
    for (const entry of result.endedTickets) {
      expect(entry.ticket.state).toBe('ended')
      expect(entry.ticket.ended?.outcome).toBe('merged')
      expect(entry.ticket.ended?.by).toBe('user')
      expect(entry.ticket.ended?.at).toBe(T0)
    }
    expect(h.domain.state.tickets[other.ticketId].state).toBe('open')
    // ended.outcome 原样落库（不压成 completed）；阶段展示按等价「已完成」派生。
    expect(origin.ended?.outcome).not.toBe('completed')
    expect(h.domain.stageOf(origin.ticketId)).toBe('completed')
  })

  it('keeps closed outcome distinct from merged and defaults the reason per outcome', () => {
    const h = makeDomain()
    const origin = h.ticket('origin')
    const result = h.domain.followsDone({ threadId: PR_THREAD, outcome: 'closed' })
    expect(result.endedTickets).toHaveLength(1)
    expect(origin.ended?.outcome).toBe('closed')
    expect(origin.ended?.reason).toBe('pr-closed')
  })

  it('preserves the follows relationship for audit after ending', () => {
    const h = makeDomain()
    const desktop = h.ticket('desktop', 'desktop:thread:1')
    desktop.follows.push(PR_THREAD)

    h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged', reason: 'pr-merged:octocat' })

    const ended = h.domain.state.tickets[desktop.ticketId]
    expect(ended.state).toBe('ended')
    // follows 保留审计：结束后仍可查询工单与 PR 的跟随关系与结束原因。
    expect(ended.follows).toEqual([PR_THREAD])
    expect(ended.ended?.reason).toBe('pr-merged:octocat')
  })

  it('is idempotent: replaying the same thread termination ends nothing and does not throw', () => {
    const h = makeDomain()
    h.ticket('origin')
    const first = h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged' })
    expect(first.endedTickets).toHaveLength(1)
    const second = h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged' })
    expect(second.endedTickets).toHaveLength(0)
    // 未订阅任何工单的 Thread 终止同样是无害的 no-op。
    const unknown = h.domain.followsDone({ threadId: 'github:pr:acme/app:99', outcome: 'closed' })
    expect(unknown.endedTickets).toHaveLength(0)
  })

  it('cleans up like other endings: withdraws open attentions and ends the latest assignment', () => {
    const h = makeDomain()
    const origin = h.ticket('origin')
    const assignment = h.domain.startAssignment({ ticketId: origin.ticketId })
    const asked = h.domain.addInput({
      ticketId: origin.ticketId,
      requestId: 'human-q1',
      kind: 'text',
      human: true,
      text: '这里要阻塞吗？',
    })
    h.domain.report({
      assignmentId: assignment.assignmentId,
      ticketId: origin.ticketId,
      reportId: 'report-1',
      kind: 'waiting',
      summary: '等待确认',
      question: '这里要阻塞吗？',
      askedBy: asked.input.inputId,
    })
    expect(origin.attentionId).not.toBeNull()
    const openAttentionId = origin.attentionId

    const result = h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged' })

    const ended = h.domain.state.tickets[origin.ticketId]
    const endedAssignment = h.domain.state.assignments[assignment.assignmentId]
    expect(endedAssignment.state).toBe('ended')
    expect(result.endedTickets.flatMap((entry) => entry.withdrawnAttentionIds)).toContain(
      openAttentionId,
    )
    expect(h.domain.state.attentions[openAttentionId ?? '']?.status).toBe('withdrawn')
    expect(ended.attentionId).toBeNull()
  })

  it('does not revoke the mandate on merged/closed endings (unlike ticketStop)', () => {
    const h = makeDomain()
    const origin = h.ticket('origin')
    h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged' })
    const mandate = h.domain.state.mandates[origin.mandateId]
    expect(mandate.revokedAt).toBeNull()
  })

  it('keeps subscriptions until the TTL after a merged/closed ending (not stopped)', () => {
    const h = makeDomain(SUBSCRIPTION_TTL_MS)
    const origin = h.ticket('origin')
    h.domain.followsDone({ threadId: PR_THREAD, outcome: 'merged' })
    const thread = h.domain.state.threads[PR_THREAD]
    expect(thread.subscriptions.map((s) => s.ticketId)).toContain(origin.ticketId)

    h.setNow(SUBSCRIPTION_TTL_MS + 1)
    const pruned = h.domain.pruneExpiredSubscriptions()
    expect(pruned.some((entry) => entry.startsWith(`${PR_THREAD}:`))).toBe(true)
    expect(thread.subscriptions).toHaveLength(0)
  })
})
