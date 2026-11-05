// @vitest-environment node
/**
 * unavailable Eval 的人工处置命令（T20 #90）。
 *
 * 覆盖验收：
 *  - reevaluateEval：只对 unavailable 开放；批次 Trigger 回队、连续超时计数清零、
 *    Thread 可立即开新一轮评估（处置不影响串行推进）；落处置审计；
 *  - dismissEval：只对 unavailable 开放；Trigger 显式释放不回队（不阻塞 Thread）、
 *    落处置审计；
 *  - 两个命令对非 unavailable 状态抛稳定错误码 evalNotUnavailable，找不到抛 evalNotFound；
 *  - 处置事实持久化：重水化原样保留、缺失 disposal 字段补 null。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain, type TriggerDraft } from '../domain'
import type { SuperAgentDomainState, SuperAgentSourceAdmission } from '../model'

const T0 = '2026-01-01T00:00:00.000Z'
const TTL_MS = 60_000

function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString()
}

function admission(
  partial: Partial<SuperAgentSourceAdmission> & { source: string },
): SuperAgentSourceAdmission {
  return { channels: [], allowlist: [], bots: [], ...partial }
}

interface Harness {
  domain: SuperAgentDomain
  intake(key: string, partial?: Record<string, unknown>): string
}

function makeDomain(initialState?: SuperAgentDomainState, evalTtlMs = TTL_MS): Harness {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(T0),
    newId: (kind: string) => `${kind}-${++counter}`,
    evalTtlMs,
    ...(initialState ? { initialState } : {}),
  })
  const intake = (key: string, partial: Record<string, unknown> = {}): string => {
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
    return domain.intakeTrigger(draft).trigger.triggerId
  }
  return { domain, intake }
}

function configure(h: Harness): void {
  h.domain.setPolicy({
    acceptMode: 'observe',
    rules: [],
    admissions: [admission({ source: 'feishu-im' })],
  })
}

/** 走满 3 次连续超时，把 Eval 推到 unavailable。 */
function makeUnavailable(h: Harness, atMs = 0): string {
  const first = h.domain.startEval({ threadId: 'th1', at: at(atMs) })
  h.domain.deliverEval({ evalId: first.evalId, at: at(atMs) })
  h.domain.expireEval({ evalId: first.evalId, at: at(atMs + TTL_MS) })
  const second = h.domain.startEval({ threadId: 'th1', at: at(atMs + TTL_MS) })
  h.domain.deliverEval({ evalId: second.evalId, at: at(atMs + TTL_MS) })
  h.domain.expireEval({ evalId: second.evalId, at: at(atMs + 2 * TTL_MS) })
  const third = h.domain.startEval({ threadId: 'th1', at: at(atMs + 2 * TTL_MS) })
  h.domain.deliverEval({ evalId: third.evalId, at: at(atMs + 2 * TTL_MS) })
  h.domain.expireEval({ evalId: third.evalId, at: at(atMs + 3 * TTL_MS) })
  expect(third.state).toBe('unavailable')
  return third.evalId
}

describe('reevaluateEval', () => {
  it('requeues the withheld triggers and resets the consecutive-timeout counter', () => {
    const h = makeDomain()
    configure(h)
    const triggerId = h.intake('e1')
    const evalId = makeUnavailable(h)

    const result = h.domain.reevaluateEval({ evalId, at: at(4 * TTL_MS) })

    expect(result.eval.state).toBe('reevaluated')
    expect(result.requeuedTriggerIds).toEqual([triggerId])
    expect(result.eval.disposal).toEqual({ action: 'reevaluated', at: at(4 * TTL_MS) })
    // Trigger 回到 pending，连续超时计数清零（重新评估重置计数）。
    expect(h.domain.state.threads.th1.pendingTriggerIds).toEqual([triggerId])
    expect(h.domain.state.threads.th1.expired).toBe(0)
    expect(h.domain.state.threads.th1.evaluating).toBe(false)
    expect(h.domain.state.triggers[triggerId].disposition.requeued).toBe(true)
  })

  it('lets the thread start a fresh eval round immediately after reevaluation', () => {
    const h = makeDomain()
    configure(h)
    h.intake('e1')
    const evalId = makeUnavailable(h)

    h.domain.reevaluateEval({ evalId })

    const next = h.domain.startEval({ threadId: 'th1', at: at(4 * TTL_MS) })
    expect(next.triggerIds).toHaveLength(1)
    expect(next.policyVersion).toBe(h.domain.state.policy.version)
  })

  it('leaves triggers owned by other tickets out of the requeue', () => {
    const h = makeDomain()
    configure(h)
    const t1 = h.intake('e1')
    const t2 = h.intake('e2')
    const evalId = makeUnavailable(h)
    // e2 在评估期间被桌面派工消费：重新评估不得抢走归属。
    h.domain.createTicket({
      requestId: 'req-desktop',
      title: '桌面工单',
      repoRoot: '/repo',
      trigger: {
        key: 'e2',
        source: 'feishu-im',
        threadIds: ['th1'],
        actor: 'feishu:user:u1',
        human: true,
        addressed: 'mention',
        text: '消息 e2',
      },
    })

    const result = h.domain.reevaluateEval({ evalId })

    expect(result.requeuedTriggerIds).toEqual([t1])
    expect(h.domain.state.threads.th1.pendingTriggerIds).toEqual([t1])
    expect(h.domain.state.triggers[t2].disposition.ticketIds).toHaveLength(1)
  })

  it('refuses non-unavailable evals and unknown ids with stable codes', () => {
    const h = makeDomain()
    configure(h)
    h.intake('e1')
    const evalId = makeUnavailable(h)
    h.domain.reevaluateEval({ evalId })
    expect(() => h.domain.reevaluateEval({ evalId })).toThrowError(
      expect.objectContaining({ code: 'evalNotUnavailable' }),
    )
    expect(() => h.domain.reevaluateEval({ evalId: 'missing' })).toThrowError(
      expect.objectContaining({ code: 'evalNotFound' }),
    )

    const decided = makeDomain()
    configure(decided)
    decided.intake('e1')
    const record = decided.domain.startEval({ threadId: 'th1', at: at(0) })
    decided.domain.deliverEval({ evalId: record.evalId, at: at(0) })
    decided.domain.submitEvalDecision({ evalId: record.evalId, action: 'ignore', at: at(1) })
    expect(() => decided.domain.reevaluateEval({ evalId: record.evalId })).toThrowError(
      expect.objectContaining({ code: 'evalNotUnavailable' }),
    )
  })
})

describe('dismissEval', () => {
  it('releases the withheld triggers without requeueing and records the audit', () => {
    const h = makeDomain()
    configure(h)
    h.intake('e1')
    const evalId = makeUnavailable(h)

    const evalRecord = h.domain.dismissEval({ evalId, at: at(4 * TTL_MS) })

    expect(evalRecord.state).toBe('dismissed')
    expect(evalRecord.disposal).toEqual({ action: 'dismissed', at: at(4 * TTL_MS) })
    // 显式忽略：Trigger 不回队（不阻塞 Thread），也不参与后续评估。
    expect(h.domain.state.threads.th1.pendingTriggerIds).toEqual([])
    expect(h.domain.state.threads.th1.expired).toBe(0)
    expect(h.domain.state.threads.th1.evaluating).toBe(false)
  })

  it('keeps the thread free for new triggers after dismissal', () => {
    const h = makeDomain()
    configure(h)
    h.intake('e1')
    const evalId = makeUnavailable(h)
    h.domain.dismissEval({ evalId })

    // 新消息照常开新一轮评估：处置不影响 Thread 串行推进。
    h.intake('e2')
    const next = h.domain.startEval({ threadId: 'th1', at: at(4 * TTL_MS) })
    expect(next.triggerIds).toHaveLength(1)
  })

  it('refuses non-unavailable evals and unknown ids with stable codes', () => {
    const h = makeDomain()
    configure(h)
    h.intake('e1')
    const evalId = makeUnavailable(h)
    h.domain.dismissEval({ evalId })
    expect(() => h.domain.dismissEval({ evalId })).toThrowError(
      expect.objectContaining({ code: 'evalNotUnavailable' }),
    )
    expect(() => h.domain.dismissEval({ evalId: 'missing' })).toThrowError(
      expect.objectContaining({ code: 'evalNotFound' }),
    )
  })
})

describe('处置事实持久化', () => {
  it('rehydrates disposal as-is and defaults a missing disposal field to null', () => {
    const h = makeDomain()
    configure(h)
    h.intake('e1')
    const dismissedId = makeUnavailable(h)
    h.domain.dismissEval({ evalId: dismissedId, at: at(3 * TTL_MS + 1) })

    const rehydratedState = JSON.parse(JSON.stringify(h.domain.state)) as SuperAgentDomainState
    const rehydrated = makeDomain(rehydratedState)
    expect(rehydrated.domain.state.evals[dismissedId].state).toBe('dismissed')
    expect(rehydrated.domain.state.evals[dismissedId].disposal).toEqual({
      action: 'dismissed',
      at: at(3 * TTL_MS + 1),
    })
    // 重复处置在重水化后仍被拒绝（事实原样保留）。
    expect(() => rehydrated.domain.dismissEval({ evalId: dismissedId })).toThrowError(
      expect.objectContaining({ code: 'evalNotUnavailable' }),
    )

    // 旧快照（Eval 记录无 disposal 字段）补 null。
    const legacy = JSON.parse(JSON.stringify(h.domain.state)) as SuperAgentDomainState
    const withUndefined = legacy.evals[dismissedId] as { disposal?: unknown }
    delete withUndefined.disposal
    const legacyDomain = makeDomain(legacy)
    expect(legacyDomain.domain.state.evals[dismissedId].disposal).toBeNull()
  })
})
