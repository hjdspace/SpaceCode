// @vitest-environment node
/**
 * Gate/Eval/Policy 领域命令（T16 #86）。
 *
 * 覆盖验收：
 *  - off/observe/auto 三模式行为正确（off 阻止 Eval；observe 记录「本会接受」不建单；
 *    auto 建单并生成 Decision → Mandate → pending Assignment 审计链）；
 *  - deadline 从候选送达起算（未送达不计时），超时重排 2 次、第 3 次记 unavailable；
 *  - 暂停期间不超时，恢复后 deadline 顺延一个暂停时长；
 *  - Policy 版本变化丢弃运行中 Eval 并按新版本重排；旧版本的评估结果不得落地；
 *  - Decision 提交时重新检查版本与去重；
 *  - bot 最多 inferred、不能 stop；命中规则写入 Mandate；续接前 revalidate 生效；
 *  - Policy/Eval 是持久领域事实：重水化原样保留、缺失补默认。
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

/** 开启 observe/auto 模式并为 feishu-im 配置准入表。 */
function configure(
  h: Harness,
  acceptMode: 'observe' | 'auto',
  entry?: Partial<SuperAgentSourceAdmission>,
) {
  return h.domain.setPolicy({
    acceptMode,
    rules: [{ name: 'rule-a', instruction: '先看日志' }],
    admissions: [admission({ source: 'feishu-im', ...entry })],
  })
}

/** 走完一次送达：startEval → deliverEval，返回 evalId。 */
function deliveredEval(h: Harness, atMs = 0): string {
  const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(atMs) })
  h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(atMs) })
  return evalRecord.evalId
}

describe('Policy 版本化与默认值', () => {
  it('defaults to version 1 with acceptMode off (no automatic acceptance)', () => {
    const h = makeDomain()
    expect(h.domain.state.policy).toEqual({
      version: 1,
      acceptMode: 'off',
      rules: [],
      admissions: [],
    })
  })

  it('bumps the version on change, stays idempotent on no-op, and persists across rehydration', () => {
    const h = makeDomain()
    const first = h.domain.setPolicy({ acceptMode: 'observe' })
    expect(first.policy.version).toBe(2)
    expect(first.changed).toBe(true)

    const again = h.domain.setPolicy({ acceptMode: 'observe' })
    expect(again.changed).toBe(false)
    expect(again.policy.version).toBe(2)

    // 深比较：规则内容变化才算变化。
    const rules = h.domain.setPolicy({ rules: [{ name: 'r1', instruction: 'i' }] })
    expect(rules.policy.version).toBe(3)
    const sameRules = h.domain.setPolicy({ rules: [{ name: 'r1', instruction: 'i' }] })
    expect(sameRules.changed).toBe(false)

    const rehydrated = makeDomain(
      JSON.parse(JSON.stringify(h.domain.state)) as SuperAgentDomainState,
    )
    expect(rehydrated.domain.state.policy.version).toBe(3)
    expect(rehydrated.domain.state.policy.rules).toEqual([{ name: 'r1', instruction: 'i' }])
  })

  it('rejects malformed policies with a stable error code', () => {
    const h = makeDomain()
    expect(() => h.domain.setPolicy({ acceptMode: 'sometimes' as never })).toThrowError(
      expect.objectContaining({ code: 'invalidPolicy' }),
    )
    expect(() =>
      h.domain.setPolicy({ rules: [{ name: '', instruction: 'i' }] }),
    ).toThrowError(expect.objectContaining({ code: 'invalidPolicy' }))
    expect(() =>
      h.domain.setPolicy({
        rules: [
          { name: 'r', instruction: 'a' },
          { name: 'r', instruction: 'b' },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalidPolicy' }))
    expect(() =>
      h.domain.setPolicy({
        admissions: [
          admission({ source: 'x' }),
          admission({ source: 'x' }),
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalidPolicy' }))
  })
})

describe('acceptMode 三模式', () => {
  it('off: refuses to start an eval at all (no model spend)', () => {
    const h = makeDomain()
    h.intake('e1')
    expect(() => h.domain.startEval({ threadId: 'th1' })).toThrowError(
      expect.objectContaining({ code: 'acceptModeOff' }),
    )
  })

  it('observe: records would-accept with matched rules but creates no ticket', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    const result = h.domain.submitEvalDecision({
      evalId: evalRecord.evalId,
      action: 'accept',
      matchedRules: ['rule-a'],
      at: at(1_000),
    })
    expect(result.duplicate).toBe(false)
    expect(result.ticket).toBeNull()
    expect(result.eval.decision).toEqual({
      action: 'accept',
      at: at(1_000),
      matchedRules: ['rule-a'],
      ticketId: null,
    })
    expect(result.eval.state).toBe('decided')
    expect(Object.keys(h.domain.state.tickets)).toHaveLength(0)
    expect(h.domain.state.threads.th1.evaluating).toBe(false)
  })

  it('auto: creates ticket, mandate (with matched rules), decision and pending assignment', () => {
    const h = makeDomain()
    configure(h, 'auto')
    const triggerId = h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    expect(evalRecord.strength).toBe('explicit')
    expect(evalRecord.basis).toBe('addressed')
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    const result = h.domain.submitEvalDecision({
      evalId: evalRecord.evalId,
      action: 'accept',
      matchedRules: ['rule-a'],
      repoRoot: '/repo',
      at: at(1_000),
    })
    expect(result.ticket).not.toBeNull()
    const ticket = result.ticket!
    expect(ticket.origin.triggerIds).toEqual([triggerId])
    expect(ticket.threadId).toBe('th1')

    const mandate = h.domain.state.mandates[ticket.mandateId]
    expect(mandate.matchedRules).toEqual(['rule-a'])
    expect(mandate.policyVersion).toBe(h.domain.state.policy.version)
    expect(mandate.strength).toBe('explicit')

    const decision = h.domain.state.decisions[ticket.ticketId]
    expect(decision.action).toBe('accept')
    expect(decision.strength).toBe('explicit')

    const assignment = h.domain.state.assignments[ticket.assignmentIds[0]]
    expect(assignment.state).toBe('pending')
    expect(h.domain.state.triggers[triggerId].disposition.ticketIds).toEqual([ticket.ticketId])
  })

  it('auto: accept without repoRoot is refused', () => {
    const h = makeDomain()
    configure(h, 'auto')
    h.intake('e1')
    const evalId = deliveredEval(h)
    expect(() =>
      h.domain.submitEvalDecision({ evalId, action: 'accept', at: at(1) }),
    ).toThrowError(expect.objectContaining({ code: 'invalidDispatch' }))
  })

  it('observe: reject is impossible but stop/ignore/unavailable still work', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalId = deliveredEval(h)
    const result = h.domain.submitEvalDecision({ evalId, action: 'ignore', at: at(1) })
    expect(result.eval.decision?.action).toBe('ignore')
    expect(result.ticket).toBeNull()
  })
})

describe('Eval 串行与 deadline', () => {
  it('runs at most one eval per thread and merges later triggers into the next batch', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const first = h.domain.startEval({ threadId: 'th1', at: at(0) })
    expect(() => h.domain.startEval({ threadId: 'th1', at: at(1) })).toThrowError(
      expect.objectContaining({ code: 'evalBusy' }),
    )

    // 评估期间新到的 Trigger 留在 pending，合并进下一批。
    h.intake('e2')
    expect(h.domain.state.threads.th1.pendingTriggerIds).toHaveLength(1)

    h.domain.deliverEval({ evalId: first.evalId, at: at(1) })
    h.domain.submitEvalDecision({ evalId: first.evalId, action: 'ignore', at: at(2) })
    const second = h.domain.startEval({ threadId: 'th1', at: at(3) })
    expect(second.triggerIds).toHaveLength(1)
  })

  it('refuses to start when the thread has no admitted pending triggers', () => {
    const h = makeDomain()
    configure(h, 'observe', { allowlist: [] })
    h.intake('e1', { addressed: null })
    // Thread 存在但候选全部被 Gate 过滤：refuse 且过滤原因码落库。
    expect(() => h.domain.startEval({ threadId: 'th1' })).toThrowError(
      expect.objectContaining({ code: 'evalEmpty' }),
    )
    expect(h.domain.state.triggers['trigger-1'].disposition.filtered).toBe('not-admitted')
    expect(() => h.domain.startEval({ threadId: 'nope' })).toThrowError(
      expect.objectContaining({ code: 'threadNotFound' }),
    )
  })

  it('does not count time before delivery (queued evals never expire)', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    const outcome = h.domain.expireEval({ evalId: evalRecord.evalId, at: at(10 * TTL_MS) })
    expect(outcome.outcome).toBe('ignored')
    expect(evalRecord.state).toBe('queued')
  })

  it('computes the deadline from delivery time only', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    // 排队 10 分钟后才送达：deadline 从送达那一刻起算。
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(600_000) })
    expect(evalRecord.deadlineAt).toBe(at(600_000 + TTL_MS))
    const early = h.domain.expireEval({ evalId: evalRecord.evalId, at: at(600_000 + TTL_MS - 1) })
    expect(early.outcome).toBe('ignored')
    const onTime = h.domain.expireEval({
      evalId: evalRecord.evalId,
      at: at(600_000 + TTL_MS),
    })
    expect(onTime.outcome).toBe('requeued')
  })
})

describe('超时重排与 unavailable', () => {
  it('requeues twice then records unavailable on the third consecutive timeout', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const first = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: first.evalId, at: at(0) })
    const r1 = h.domain.expireEval({ evalId: first.evalId, at: at(TTL_MS) })
    expect(r1.outcome).toBe('requeued')
    expect(first.state).toBe('requeued')
    expect(h.domain.state.threads.th1.expired).toBe(1)
    expect(h.domain.state.threads.th1.pendingTriggerIds).toEqual(first.triggerIds)
    expect(h.domain.state.triggers[first.triggerIds[0]].disposition.requeued).toBe(true)
    expect(h.domain.state.threads.th1.evaluating).toBe(false)

    const second = h.domain.startEval({ threadId: 'th1', at: at(TTL_MS) })
    h.domain.deliverEval({ evalId: second.evalId, at: at(TTL_MS) })
    const r2 = h.domain.expireEval({ evalId: second.evalId, at: at(2 * TTL_MS) })
    expect(r2.outcome).toBe('requeued')
    expect(h.domain.state.threads.th1.expired).toBe(2)

    const third = h.domain.startEval({ threadId: 'th1', at: at(2 * TTL_MS) })
    h.domain.deliverEval({ evalId: third.evalId, at: at(2 * TTL_MS) })
    const r3 = h.domain.expireEval({ evalId: third.evalId, at: at(3 * TTL_MS) })
    expect(r3.outcome).toBe('unavailable')
    expect(third.state).toBe('unavailable')
    expect(third.decision?.action).toBe('unavailable')
    expect(h.domain.state.threads.th1.expired).toBe(3)
    // unavailable 不是 ignore：Trigger 被扣住不回队，等待人工处置。
    expect(h.domain.state.threads.th1.pendingTriggerIds).toHaveLength(0)
    expect(h.domain.state.threads.th1.evaluating).toBe(false)
  })

  it('resets the consecutive-timeout counter after a real decision', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const first = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: first.evalId, at: at(0) })
    h.domain.expireEval({ evalId: first.evalId, at: at(TTL_MS) })
    expect(h.domain.state.threads.th1.expired).toBe(1)

    const second = h.domain.startEval({ threadId: 'th1', at: at(TTL_MS) })
    h.domain.deliverEval({ evalId: second.evalId, at: at(TTL_MS) })
    h.domain.submitEvalDecision({ evalId: second.evalId, action: 'ignore', at: at(TTL_MS + 1) })
    expect(h.domain.state.threads.th1.expired).toBe(0)
  })

  it('accepts a model-reported unavailable decision as well', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalId = deliveredEval(h)
    const result = h.domain.submitEvalDecision({ evalId, action: 'unavailable', at: at(1) })
    expect(result.eval.state).toBe('unavailable')
    expect(result.eval.decision?.action).toBe('unavailable')
  })

  it('is idempotent for a decided eval and refuses undelivered submissions', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    expect(() =>
      h.domain.submitEvalDecision({ evalId: evalRecord.evalId, action: 'ignore', at: at(0) }),
    ).toThrowError(expect.objectContaining({ code: 'evalNotDelivered' }))

    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    const first = h.domain.submitEvalDecision({ evalId: evalRecord.evalId, action: 'ignore', at: at(1) })
    const dup = h.domain.submitEvalDecision({ evalId: evalRecord.evalId, action: 'ignore', at: at(2) })
    expect(dup.duplicate).toBe(true)
    expect(dup.eval.decision?.at).toBe(first.eval.decision?.at)
  })
})

describe('暂停顺延', () => {
  it('does not expire during a pause and shifts the deadline by the pause duration on resume', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    expect(evalRecord.deadlineAt).toBe(at(TTL_MS))

    // t=10s 暂停，暂停期间（早已越过原 deadline）不超时。
    h.domain.pauseProject({ at: at(10_000) })
    const during = h.domain.expireEval({ evalId: evalRecord.evalId, at: at(120_000) })
    expect(during.outcome).toBe('ignored')
    expect(evalRecord.state).toBe('delivered')

    // t=130s 恢复：deadline 顺延一个暂停时长（120s）→ 60s + 120s = 180s。
    h.domain.resumeProject({ at: at(130_000) })
    expect(evalRecord.deadlineAt).toBe(at(180_000))
    const before = h.domain.expireEval({ evalId: evalRecord.evalId, at: at(179_999) })
    expect(before.outcome).toBe('ignored')
    const after = h.domain.expireEval({ evalId: evalRecord.evalId, at: at(180_000) })
    expect(after.outcome).toBe('requeued')
  })
})

describe('Policy 版本变化丢弃重排', () => {
  it('discards running evals and requeues their triggers for the new version', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })

    const result = h.domain.setPolicy({ acceptMode: 'auto' })
    expect(result.discardedEvalIds).toEqual([evalRecord.evalId])
    expect(evalRecord.state).toBe('discarded')
    expect(h.domain.state.threads.th1.pendingTriggerIds).toEqual(evalRecord.triggerIds)
    expect(h.domain.state.threads.th1.evaluating).toBe(false)

    // 旧版本的评估结果不得直接落地。
    expect(() =>
      h.domain.submitEvalDecision({
        evalId: evalRecord.evalId,
        action: 'accept',
        at: at(1),
      }),
    ).toThrowError(expect.objectContaining({ code: 'evalPolicyStale' }))

    // 重排后的下一轮带新版本号。
    const next = h.domain.startEval({ threadId: 'th1', at: at(1) })
    expect(next.policyVersion).toBe(h.domain.state.policy.version)
  })

  it('grants the requeued batch a fresh timeout quota after a policy change', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')

    // 超时 2 次：连续计数到 2。
    const first = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: first.evalId, at: at(0) })
    h.domain.expireEval({ evalId: first.evalId, at: at(TTL_MS) })
    const second = h.domain.startEval({ threadId: 'th1', at: at(TTL_MS) })
    h.domain.deliverEval({ evalId: second.evalId, at: at(TTL_MS) })
    h.domain.expireEval({ evalId: second.evalId, at: at(2 * TTL_MS) })
    expect(h.domain.state.threads.th1.expired).toBe(2)

    // 第三批评估在途时 Policy 变化：丢弃不是超时，重排后配额清零。
    const third = h.domain.startEval({ threadId: 'th1', at: at(2 * TTL_MS) })
    h.domain.deliverEval({ evalId: third.evalId, at: at(2 * TTL_MS) })
    h.domain.setPolicy({ acceptMode: 'observe', admissions: [] })
    expect(h.domain.state.threads.th1.expired).toBe(0)

    // 新版本下的首批重新获得完整的「重排 2 次」配额。
    const fourth = h.domain.startEval({ threadId: 'th1', at: at(2 * TTL_MS) })
    h.domain.deliverEval({ evalId: fourth.evalId, at: at(2 * TTL_MS) })
    const outcome = h.domain.expireEval({ evalId: fourth.evalId, at: at(3 * TTL_MS) })
    expect(outcome.outcome).toBe('requeued')
    expect(h.domain.state.threads.th1.expired).toBe(1)
  })

  it('re-gates pending triggers at eval start under the current policy', () => {
    const h = makeDomain()
    configure(h, 'observe')
    const admitted = h.intake('e1')
    const later = h.intake('e2', { addressed: null, actor: 'feishu:user:u2' })

    // 准入表收紧后，之前已入队的候选在 startEval 时被程序层重新过滤。
    h.domain.setPolicy({
      acceptMode: 'observe',
      admissions: [admission({ source: 'feishu-im', allowlist: [] })],
    })
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    expect(evalRecord.triggerIds).toEqual([admitted])
    expect(h.domain.state.triggers[later].disposition.filtered).toBe('not-admitted')
    expect(h.domain.state.threads.th1.pendingTriggerIds).not.toContain(later)
  })
})

describe('Decision 去重与 bot 限制', () => {
  it('excludes triggers already owned by another ticket when accepting', () => {
    const h = makeDomain()
    configure(h, 'auto')
    const t1 = h.intake('e1')
    const t2 = h.intake('e2')

    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })

    // 评估在途时，桌面显式派工消费了 e1：accept 不得重复建单。
    const other = h.domain.createTicket({
      requestId: 'req-desktop',
      title: '桌面工单',
      repoRoot: '/repo',
      trigger: {
        key: 'e1',
        source: 'feishu-im',
        threadIds: ['th1'],
        actor: 'feishu:user:u1',
        human: true,
        addressed: 'mention',
        text: '消息 e1',
      },
    })

    const result = h.domain.submitEvalDecision({
      evalId: evalRecord.evalId,
      action: 'accept',
      repoRoot: '/repo',
      at: at(1_000),
    })
    expect(result.ticket!.origin.triggerIds).toEqual([t2])
    // e1 的归属不被抢走，仍属于桌面工单。
    expect(h.domain.state.triggers[t1].disposition.ticketIds).toEqual([other.ticket.ticketId])
    expect(h.domain.state.triggers[t2].disposition.ticketIds).toEqual([result.ticket!.ticketId])
  })

  it('downgrades accept to ignore when every trigger is already owned', () => {
    const h = makeDomain()
    configure(h, 'auto')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    h.domain.createTicket({
      requestId: 'req-desktop',
      title: '桌面工单',
      repoRoot: '/repo',
      trigger: {
        key: 'e1',
        source: 'feishu-im',
        threadIds: ['th1'],
        actor: 'feishu:user:u1',
        human: true,
        addressed: 'mention',
        text: '消息 e1',
      },
    })
    const result = h.domain.submitEvalDecision({
      evalId: evalRecord.evalId,
      action: 'accept',
      repoRoot: '/repo',
      at: at(1_000),
    })
    expect(result.ticket).toBeNull()
    expect(result.eval.decision?.action).toBe('ignore')
  })

  it('caps bots at inferred and refuses bot stop decisions', () => {
    const h = makeDomain()
    configure(h, 'auto', { bots: ['feishu:bot:ci'] })
    h.intake('e1', { actor: 'feishu:bot:ci', human: false, addressed: 'direct' })
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    expect(evalRecord.bot).toBe(true)
    expect(evalRecord.strength).toBe('inferred')
    expect(evalRecord.basis).toBe('bot')

    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    expect(() =>
      h.domain.submitEvalDecision({ evalId: evalRecord.evalId, action: 'stop', at: at(1) }),
    ).toThrowError(expect.objectContaining({ code: 'botForbidden' }))

    const accepted = h.domain.submitEvalDecision({
      evalId: evalRecord.evalId,
      action: 'accept',
      repoRoot: '/repo',
      at: at(2),
    })
    const mandate = h.domain.state.mandates[accepted.ticket!.mandateId]
    expect(mandate.strength).toBe('inferred')
    expect(mandate.basis).toBe('bot')
  })

  it('treats a mixed human+bot batch as human-led (stop not blocked)', () => {
    const h = makeDomain()
    configure(h, 'auto', { bots: ['feishu:bot:ci'] })
    // 先建一张工单供 stop 结束。
    h.intake('e1')
    const first = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: first.evalId, at: at(0) })
    const created = h.domain.submitEvalDecision({
      evalId: first.evalId,
      action: 'accept',
      repoRoot: '/repo',
      at: at(1),
    })

    // 混批：人消息 + bot 消息 —— 按人消息授权判定，stop 不被 botForbidden 拦截。
    h.intake('e2')
    h.intake('e3', { actor: 'feishu:bot:ci', human: false, addressed: null })
    const mixed = h.domain.startEval({ threadId: 'th1', at: at(2) })
    expect(mixed.bot).toBe(false)
    expect(mixed.strength).toBe('explicit')
    h.domain.deliverEval({ evalId: mixed.evalId, at: at(2) })
    const stopped = h.domain.submitEvalDecision({
      evalId: mixed.evalId,
      action: 'stop',
      at: at(3),
    })
    expect(stopped.eval.decision?.action).toBe('stop')
    expect(created.ticket!.state).toBe('ended')
  })

  it('ends subscribed open tickets on stop and downgrades stop without owners', () => {
    const h = makeDomain()
    configure(h, 'auto')
    h.intake('e1')
    const firstEval = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: firstEval.evalId, at: at(0) })
    const created = h.domain.submitEvalDecision({
      evalId: firstEval.evalId,
      action: 'accept',
      repoRoot: '/repo',
      at: at(1),
    })
    const ticket = created.ticket!

    // 新到消息进入下一轮 Eval，语义判定为 stop：结束订阅该 Thread 的开放工单。
    h.intake('e2')
    const stopEval = h.domain.startEval({ threadId: 'th1', at: at(2) })
    h.domain.deliverEval({ evalId: stopEval.evalId, at: at(2) })
    const stopped = h.domain.submitEvalDecision({
      evalId: stopEval.evalId,
      action: 'stop',
      at: at(3),
    })
    expect(stopped.eval.decision?.action).toBe('stop')
    expect(ticket.state).toBe('ended')
    expect(ticket.ended?.outcome).toBe('stopped')
    expect(ticket.ended?.by).toBe('policy')

    // 已无开放工单：stop 降级为 ignore 落档。
    h.intake('e3')
    const idleStop = h.domain.startEval({ threadId: 'th1', at: at(4) })
    h.domain.deliverEval({ evalId: idleStop.evalId, at: at(4) })
    const downgraded = h.domain.submitEvalDecision({
      evalId: idleStop.evalId,
      action: 'stop',
      at: at(5),
    })
    expect(downgraded.eval.decision?.action).toBe('ignore')
  })
})

describe('matchedRules 校验', () => {
  it('rejects rule names that are not in the current policy', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalId = deliveredEval(h)
    expect(() =>
      h.domain.submitEvalDecision({
        evalId,
        action: 'accept',
        matchedRules: ['rule-not-in-policy'],
        at: at(1),
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalidPolicy' }))
  })
})

describe('revalidate（续接前重校验）', () => {
  it('invalidates an inferred mandate after the policy stops admitting the actor', () => {
    const h = makeDomain()
    configure(h, 'auto', { allowlist: ['feishu:user:u1'] })
    h.intake('e1', { addressed: null })
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    expect(evalRecord.basis).toBe('admission')
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })
    const created = h.domain.submitEvalDecision({
      evalId: evalRecord.evalId,
      action: 'accept',
      repoRoot: '/repo',
      at: at(1),
    })
    const ticket = created.ticket!

    expect(h.domain.revalidateTicket(ticket.ticketId)).toEqual({ valid: true, reason: null })

    // 名单移除该 actor：版本 +1，revalidate 失效，续接被拒。
    h.domain.setPolicy({
      acceptMode: 'auto',
      admissions: [admission({ source: 'feishu-im', allowlist: [] })],
    })
    const check = h.domain.revalidateTicket(ticket.ticketId)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('not-admitted')
    expect(() =>
      h.domain.ticketMessage({ ticketId: ticket.ticketId, requestId: 'msg-1', text: '继续' }),
    ).toThrowError(expect.objectContaining({ code: 'mandateRevoked' }))
  })

  it('keeps explicit desktop mandates valid under the default policy', () => {
    const h = makeDomain()
    const dispatched = h.domain.dispatch({
      requestId: 'req-1',
      title: '桌面工单',
      repoRoot: '/repo',
      text: '目标',
      actor: 'desktop:user:local',
    })
    expect(h.domain.revalidateTicket(dispatched.ticket.ticketId)).toEqual({
      valid: true,
      reason: null,
    })
    const message = h.domain.ticketMessage({
      ticketId: dispatched.ticket.ticketId,
      requestId: 'msg-1',
      text: '继续',
    })
    expect(message.input.text).toBe('继续')
  })

  it('invalidates revoked mandates', () => {
    const h = makeDomain()
    const dispatched = h.domain.dispatch({
      requestId: 'req-1',
      title: '桌面工单',
      repoRoot: '/repo',
      text: '目标',
      actor: 'desktop:user:local',
    })
    h.domain.ticketStop({ ticketId: dispatched.ticket.ticketId })
    expect(h.domain.revalidateTicket(dispatched.ticket.ticketId).valid).toBe(false)
  })
})

describe('filterTrigger（程序层过滤落库）', () => {
  it('records the filter reason and removes the trigger from eval candidacy', () => {
    const h = makeDomain()
    const triggerId = h.intake('e1')
    h.domain.filterTrigger({ triggerId, reason: 'out-of-scope' })
    const trigger = h.domain.state.triggers[triggerId]
    expect(trigger.disposition.filtered).toBe('out-of-scope')
    expect(h.domain.state.threads.th1.pendingTriggerIds).not.toContain(triggerId)

    // 幂等：重复过滤（含断档重放、策略变化后原因码不同）不推进事实，
    // 首个原因码为准 —— 否则重放会被 Ingestor 误判为坏事件进隔离区。
    const seq = h.domain.state.seq
    h.domain.filterTrigger({ triggerId, reason: 'out-of-scope' })
    h.domain.filterTrigger({ triggerId, reason: 'not-admitted' })
    expect(h.domain.state.seq).toBe(seq)
    expect(trigger.disposition.filtered).toBe('out-of-scope')
    expect(() => h.domain.filterTrigger({ triggerId: 'missing', reason: 'x' })).toThrowError(
      expect.objectContaining({ code: 'triggerNotFound' }),
    )
  })
})

describe('Eval 持久化', () => {
  it('rehydrates policy and eval facts as-is and defaults missing fields', () => {
    const h = makeDomain()
    configure(h, 'observe')
    h.intake('e1')
    const evalRecord = h.domain.startEval({ threadId: 'th1', at: at(0) })
    h.domain.deliverEval({ evalId: evalRecord.evalId, at: at(0) })

    const rehydrated = makeDomain(
      JSON.parse(JSON.stringify(h.domain.state)) as SuperAgentDomainState,
    )
    expect(rehydrated.domain.state.policy.acceptMode).toBe('observe')
    const evalId = evalRecord.evalId
    expect(rehydrated.domain.state.evals[evalId].state).toBe('delivered')
    expect(rehydrated.domain.state.evals[evalId].deadlineAt).toBe(at(TTL_MS))

    // 旧快照（无 policy/evals 字段）补默认。
    const legacy = JSON.parse(JSON.stringify(h.domain.state)) as SuperAgentDomainState
    delete (legacy as { policy?: unknown }).policy
    delete (legacy as { evals?: unknown }).evals
    const legacyDomain = makeDomain(legacy)
    expect(legacyDomain.domain.state.policy).toEqual({
      version: 1,
      acceptMode: 'off',
      rules: [],
      admissions: [],
    })
    expect(legacyDomain.domain.state.evals).toEqual({})
  })
})
