// @vitest-environment node
/**
 * 订阅 fast path 与 owner 语义（T17 #87，设计 §6.2）。
 *
 * 覆盖验收：
 *  - fast path 不重复建单、不重复投递（fastPathConsumed / fan-out 归属）；
 *  - owner 归属与交回语义正确（followupOwners / handbackInput：交回一次、
 *    订阅保留、最后一个 owner 交回后回流 Eval 恰一次）；
 *  - mark_unrelated 只退自己订阅，来源 Thread 与 follows 除外；
 *  - attach 订阅整条 Thread；owner 持有期 Router 只能 stop（attach 被拒）；
 *  - 订阅寿命：stopped 立即失效，已结束工单最多两周后停止（订阅清理）。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain, type TriggerDraft } from '../domain'
import type { SuperAgentTicket, SuperAgentTrigger } from '../model'

const T0 = '2026-01-01T00:00:00.000Z'
const SUBSCRIPTION_TTL_MS = 1_000

function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString()
}

interface Harness {
  domain: SuperAgentDomain
  setNow(ms: number): void
  intake(key: string, partial?: Partial<TriggerDraft>): SuperAgentTrigger
  ticket(key: string, threadId?: string): SuperAgentTicket
  deliver(trigger: SuperAgentTrigger, ticketId: string, context?: boolean): ReturnType<SuperAgentDomain['addInput']>
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
  const ticket = (
    key: string,
    threadId = 'th1',
    addressed: TriggerDraft['addressed'] = 'mention',
  ): SuperAgentTicket => {
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
        addressed,
        text: `建单 ${key}`,
      },
    }).ticket
  }
  /** 模拟 Ingestor fan-out：把 Trigger 作为指定工单的输入投递。 */
  const deliver = (
    trigger: SuperAgentTrigger,
    ticketId: string,
    context = false,
  ): ReturnType<SuperAgentDomain['addInput']> => {
    return domain.addInput({
      ticketId,
      requestId: `source:${trigger.key}:${ticketId}:${context ? 'ctx' : 'in'}`,
      kind: 'trigger',
      human: trigger.human,
      context,
      text: trigger.text,
      triggerId: trigger.triggerId,
    })
  }
  return { domain, setNow: (ms: number) => (nowMs = ms), intake, ticket, deliver }
}

describe('owner 归属（followupOwners / fastPathConsumed）', () => {
  it('assigns a human message to every adjudicable open subscription holding it', () => {
    const h = makeDomain()
    const first = h.ticket('a')
    const second = h.ticket('b')
    const trigger = h.intake('m1', { addressed: null })
    h.deliver(trigger, first.ticketId)
    h.deliver(trigger, second.ticketId)

    expect(h.domain.followupOwners(trigger.triggerId).sort()).toEqual(
      [first.ticketId, second.ticketId].sort(),
    )
    expect(h.domain.fastPathConsumed(trigger.triggerId)).toBe(true)
  })

  it('excludes contextOnly subscriptions, ended tickets and released inputs', () => {
    const h = makeDomain()
    const owner = h.ticket('a')
    const contextOnly = h.ticket('b')
    const ended = h.ticket('c')
    const trigger = h.intake('m1', { addressed: null })
    const owned = h.deliver(trigger, owner.ticketId).input
    h.deliver(trigger, contextOnly.ticketId, true)
    h.deliver(trigger, ended.ticketId)
    h.domain.state.threads['th1'].subscriptions.find(
      (subscription) => subscription.ticketId === contextOnly.ticketId,
    )!.contextOnly = true
    h.domain.endTicket({
      ticketId: ended.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })

    expect(h.domain.followupOwners(trigger.triggerId)).toEqual([owner.ticketId])
    // contextOnly 订阅的消费不构成 fast path：消息仍可进 Eval。
    expect(h.domain.fastPathConsumed(trigger.triggerId)).toBe(true)

    // 交回后不再是 owner，订阅保留（见 handback 用例）。
    h.domain.handbackInput({ ticketId: owner.ticketId, inputId: owned.inputId })
    expect(h.domain.followupOwners(trigger.triggerId)).toEqual([])
    // 唯一可裁决 owner 交回后 fast path 不再生效。
    expect(h.domain.fastPathConsumed(trigger.triggerId)).toBe(false)
  })

  it('treats bot consumption by a live adjudicable subscription as fast path', () => {
    const h = makeDomain()
    const owner = h.ticket('a')
    const bot = h.intake('m1', { human: false, addressed: 'direct', actor: 'feishu:bot:ci' })
    h.deliver(bot, owner.ticketId, true)

    // bot 消息没有 owner（不能冒充人工授权），但已被存活订阅消费。
    expect(h.domain.followupOwners(bot.triggerId)).toEqual([])
    expect(h.domain.fastPathConsumed(bot.triggerId)).toBe(true)
  })
})

describe('handback 交回', () => {
  it('releases one owner while others still hold the message (no reflow)', () => {
    const h = makeDomain()
    const first = h.ticket('a')
    const second = h.ticket('b')
    const trigger = h.intake('m1', { addressed: null })
    const firstInput = h.deliver(trigger, first.ticketId).input
    h.deliver(trigger, second.ticketId)

    const result = h.domain.handbackInput({
      ticketId: first.ticketId,
      inputId: firstInput.inputId,
      at: at(100),
    })

    expect(result.requeued).toBe(false)
    expect(result.ownersRemaining).toEqual([second.ticketId])
    expect(firstInput.releasedAt).toBe(at(100))
    // 交回后仍保留订阅。
    expect(
      h.domain.state.threads['th1'].subscriptions.some(
        (subscription) => subscription.ticketId === first.ticketId,
      ),
    ).toBe(true)
    // 尚有 owner 持有：不回流 Eval。
    expect(trigger.disposition.handedBack).toBe(false)
    expect(h.domain.state.threads['th1'].pendingTriggerIds).not.toContain(trigger.triggerId)
    expect(h.domain.state.handbacks).not.toContain(firstInput.inputId)
  })

  it('reflows to Eval exactly once when the last owner hands back', () => {
    const h = makeDomain()
    const owner = h.ticket('a')
    const trigger = h.intake('m1', { addressed: null })
    const input = h.deliver(trigger, owner.ticketId).input

    const result = h.domain.handbackInput({
      ticketId: owner.ticketId,
      inputId: input.inputId,
      at: at(100),
    })

    expect(result.requeued).toBe(true)
    expect(result.ownersRemaining).toEqual([])
    expect(trigger.disposition.handedBack).toBe(true)
    expect(trigger.disposition.ticketIds).not.toContain(owner.ticketId)
    expect(h.domain.state.threads['th1'].pendingTriggerIds).toContain(trigger.triggerId)
    expect(h.domain.state.handbacks).toEqual([input.inputId])

    // 交回只允许一次：重复交回被拒绝。
    expect(() =>
      h.domain.handbackInput({ ticketId: owner.ticketId, inputId: input.inputId }),
    ).toThrowError(expect.objectContaining({ code: 'handedBack' }))

    // 工单随后结束：已交回的消息不再次释放（回流恰一次）。
    const ended = h.domain.endTicket({
      ticketId: owner.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })
    expect(ended.releasedInputIds).not.toContain(input.inputId)
    expect(h.domain.state.handbacks.filter((id) => id === input.inputId)).toHaveLength(1)
    expect(
      h.domain.state.threads['th1'].pendingTriggerIds.filter((id) => id === trigger.triggerId),
    ).toHaveLength(1)
  })

  it('rejects handback of desktop, context or foreign inputs with a stable code', () => {
    const h = makeDomain()
    const owner = h.ticket('a')
    const other = h.ticket('b')
    const desktop = h.domain.addInput({
      ticketId: owner.ticketId,
      requestId: 'request-desktop-1',
      kind: 'text',
      human: true,
      text: '桌面追问',
    }).input
    const trigger = h.intake('m1', { addressed: null })
    const context = h.deliver(trigger, owner.ticketId, true).input
    const owned = h.deliver(trigger, other.ticketId).input

    expect(() =>
      h.domain.handbackInput({ ticketId: owner.ticketId, inputId: desktop.inputId }),
    ).toThrowError(expect.objectContaining({ code: 'notHandbackable' }))
    expect(() =>
      h.domain.handbackInput({ ticketId: owner.ticketId, inputId: context.inputId }),
    ).toThrowError(expect.objectContaining({ code: 'notHandbackable' }))
    expect(() =>
      h.domain.handbackInput({ ticketId: owner.ticketId, inputId: owned.inputId }),
    ).toThrowError(expect.objectContaining({ code: 'notHandbackable' }))
    expect(() =>
      h.domain.handbackInput({ ticketId: owner.ticketId, inputId: 'input-missing' }),
    ).toThrowError(expect.objectContaining({ code: 'inputNotFound' }))
  })
})

describe('mark_unrelated', () => {
  function subscribedToSecondThread(h: Harness): {
    ticket: SuperAgentTicket
    trigger: SuperAgentTrigger
  } {
    const ticket = h.ticket('a')
    const trigger = h.intake('m2', { threadIds: ['th2'], addressed: null })
    h.domain.attachTicket({ ticketId: ticket.ticketId, triggerId: trigger.triggerId })
    return { ticket, trigger }
  }

  it('drops only its own subscription and hands back that thread’s messages', () => {
    const h = makeDomain()
    const { ticket, trigger } = subscribedToSecondThread(h)
    const input = h.domain.state.inputs[ticket.inputIds[0]]
    expect(input.triggerId).toBe(trigger.triggerId)

    const result = h.domain.markUnrelated({
      ticketId: ticket.ticketId,
      threadId: 'th2',
      at: at(100),
    })

    expect(
      h.domain.state.threads['th2'].subscriptions.some(
        (subscription) => subscription.ticketId === ticket.ticketId,
      ),
    ).toBe(false)
    // 来源 Thread 的订阅不受影响。
    expect(
      h.domain.state.threads['th1'].subscriptions.some(
        (subscription) => subscription.ticketId === ticket.ticketId,
      ),
    ).toBe(true)
    expect(result.releasedInputIds).toEqual([input.inputId])
    expect(result.requeuedInputIds).toEqual([input.inputId])
    expect(h.domain.state.threads['th2'].pendingTriggerIds).toContain(trigger.triggerId)
  })

  it('leaves other tickets on the same thread subscribed', () => {
    const h = makeDomain()
    const { ticket } = subscribedToSecondThread(h)
    const other = h.ticket('b', 'th2')

    h.domain.markUnrelated({ ticketId: ticket.ticketId, threadId: 'th2' })

    expect(
      h.domain.state.threads['th2'].subscriptions.some(
        (subscription) => subscription.ticketId === other.ticketId,
      ),
    ).toBe(true)
    expect(
      h.domain.state.threads['th2'].subscriptions.some(
        (subscription) => subscription.ticketId === ticket.ticketId,
      ),
    ).toBe(false)
  })

  it('protects the origin thread and follows from unsubscription', () => {
    const h = makeDomain()
    const { ticket } = subscribedToSecondThread(h)
    ticket.follows.push('th-follow')

    expect(() =>
      h.domain.markUnrelated({ ticketId: ticket.ticketId, threadId: 'th1' }),
    ).toThrowError(expect.objectContaining({ code: 'subscriptionProtected' }))
    expect(() =>
      h.domain.markUnrelated({ ticketId: ticket.ticketId, threadId: 'th-follow' }),
    ).toThrowError(expect.objectContaining({ code: 'subscriptionProtected' }))
    // 来源 Thread 订阅原样保留。
    expect(
      h.domain.state.threads['th1'].subscriptions.some(
        (subscription) => subscription.ticketId === ticket.ticketId,
      ),
    ).toBe(true)
  })

  it('refuses threads the ticket is not subscribed to', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.ticket('b', 'th2')

    expect(() =>
      h.domain.markUnrelated({ ticketId: ticket.ticketId, threadId: 'th2' }),
    ).toThrowError(expect.objectContaining({ code: 'notSubscribed' }))
  })
})

describe('attach', () => {
  it('subscribes the ticket to every thread of the trigger and delivers the message', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m2', { threadIds: ['th2', 'th3'], addressed: null })

    const result = h.domain.attachTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      at: at(100),
    })

    expect(result.duplicate).toBe(false)
    expect(result.input).not.toBeNull()
    expect(result.input!.human).toBe(true)
    expect(result.input!.context).toBe(false)
    expect(result.input!.triggerId).toBe(trigger.triggerId)
    for (const threadId of ['th2', 'th3']) {
      expect(
        h.domain.state.threads[threadId].subscriptions.some(
          (subscription) => subscription.ticketId === ticket.ticketId && !subscription.contextOnly,
        ),
      ).toBe(true)
    }
    expect(trigger.disposition.ticketIds).toContain(ticket.ticketId)
    expect(h.domain.followupOwners(trigger.triggerId)).toEqual([ticket.ticketId])
  })

  it('is refused while live owners hold the message (Router can only stop)', () => {
    const h = makeDomain()
    // owner 订阅 th2 并持有该消息；attacker 试图把它 attach 给自己。
    const owner = h.ticket('a', 'th2')
    const attacker = h.ticket('b')
    const trigger = h.intake('m2', { threadIds: ['th2'], addressed: null })
    h.deliver(trigger, owner.ticketId)

    expect(() =>
      h.domain.attachTicket({ ticketId: attacker.ticketId, triggerId: trigger.triggerId }),
    ).toThrowError(expect.objectContaining({ code: 'workerDecides' }))
    expect(
      h.domain.state.threads['th2'].subscriptions.some(
        (subscription) => subscription.ticketId === attacker.ticketId,
      ),
    ).toBe(false)
  })

  it('is idempotent for the same trigger and ticket', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m2', { threadIds: ['th2'], addressed: null })

    const first = h.domain.attachTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
    })
    const second = h.domain.attachTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
    })

    expect(second.duplicate).toBe(true)
    expect(second.input?.inputId).toBe(first.input?.inputId)
    expect(ticket.inputIds).toHaveLength(1)
    expect(
      h.domain.state.threads['th2'].subscriptions.filter(
        (subscription) => subscription.ticketId === ticket.ticketId,
      ),
    ).toHaveLength(1)
  })

  it('refuses ended tickets', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m2', { threadIds: ['th2'], addressed: null })
    h.domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'stopped',
      by: 'user',
      reason: 'done',
    })

    expect(() =>
      h.domain.attachTicket({ ticketId: ticket.ticketId, triggerId: trigger.triggerId }),
    ).toThrowError(expect.objectContaining({ code: 'ticketEnded' }))
  })

  it('refuses a message this ticket already handed back', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m2', { threadIds: ['th2'], addressed: null })
    const first = h.domain.attachTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
    })
    h.domain.handbackInput({ ticketId: ticket.ticketId, inputId: first.input!.inputId })

    expect(() =>
      h.domain.attachTicket({ ticketId: ticket.ticketId, triggerId: trigger.triggerId }),
    ).toThrowError(expect.objectContaining({ code: 'handedBack' }))
    // 不重复消费已交回的消息。
    expect(ticket.inputIds).toHaveLength(1)
  })
})

describe('wake：人消息按原 Mandate 恢复已结束工单（T25 #98）', () => {
  it('reopens a completed ticket with a resumed input and no new assignment or eval', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })
    const trigger = h.intake('m1')

    const result = h.domain.wakeTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      requestId: 'wake-1',
    })

    expect(result.woken).toBe(true)
    expect(result.reason).toBeNull()
    expect(ticket.state).toBe('open')
    expect(ticket.ended).toBeNull()
    expect(result.input?.kind).toBe('resumed')
    expect(result.input?.human).toBe(true)
    expect(result.input?.context).toBe(false)
    expect(result.input?.triggerId).toBe(trigger.triggerId)
    expect(ticket.assignmentIds).toHaveLength(0)
    expect(Object.keys(h.domain.state.evals)).toHaveLength(0)
    expect(trigger.disposition.ticketIds).toContain(ticket.ticketId)
  })

  it('refuses stopped tickets and leaves them ended', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'stopped',
      by: 'user',
      reason: 'done',
    })
    const trigger = h.intake('m1')

    const result = h.domain.wakeTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      requestId: 'wake-1',
    })

    expect(result.woken).toBe(false)
    expect(result.reason).toBe('stopped')
    expect(ticket.state).toBe('ended')
    expect(ticket.inputIds).toHaveLength(0)
  })

  it('refuses bot messages even when their ticket was merely completed', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })
    const trigger = h.intake('m1', { human: false, actor: 'feishu:bot:ci', addressed: 'direct' })

    const result = h.domain.wakeTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      requestId: 'wake-1',
    })

    expect(result.woken).toBe(false)
    expect(result.reason).toBe('not-human')
    expect(ticket.state).toBe('ended')
  })

  it('refuses when the policy no longer admits the original mandate', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    h.domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })
    h.domain.setPolicy({
      admissions: [{ source: 'feishu-im', channels: ['oc-other'], allowlist: [], bots: [] }],
    })
    const trigger = h.intake('m1')

    const result = h.domain.wakeTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      requestId: 'wake-1',
    })

    expect(result.woken).toBe(false)
    expect(result.reason).toBe('out-of-scope')
    expect(ticket.state).toBe('ended')
    expect(ticket.inputIds).toHaveLength(0)
  })

  it('does not re-consume a message the ticket previously released on end', () => {
    const h = makeDomain()
    const ticket = h.ticket('a')
    const trigger = h.intake('m1')
    h.deliver(trigger, ticket.ticketId)
    h.domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })
    expect(h.domain.state.inputs[ticket.inputIds[0]].releasedAt).not.toBeNull()

    const result = h.domain.wakeTicket({
      ticketId: ticket.ticketId,
      triggerId: trigger.triggerId,
      requestId: 'wake-replay',
    })

    expect(result.woken).toBe(false)
    expect(result.reason).toBe('handedBack')
    expect(ticket.state).toBe('ended')
    expect(ticket.inputIds).toHaveLength(1)
  })
})

describe('Eval 防御', () => {
  it('startEval skips human triggers still held by live owners', () => {
    const h = makeDomain()
    h.domain.setPolicy({ acceptMode: 'observe' })
    const owner = h.ticket('a')
    // held 走默认 mention（Gate 会放行），确保它被排除是因为 owner 持有而非被过滤。
    const held = h.intake('m1')
    h.deliver(held, owner.ticketId)
    const free = h.intake('m2')

    // 模拟陈旧队列：持有消息被重新压回 pending（正常流程不会发生）。
    h.domain.state.threads['th1'].pendingTriggerIds.push(held.triggerId)

    const evalRecord = h.domain.startEval({ threadId: 'th1' })
    expect(evalRecord.triggerIds).toEqual([free.triggerId])
    expect(evalRecord.triggerIds).not.toContain(held.triggerId)
  })
})

describe('订阅寿命', () => {
  it('prunes stopped tickets immediately and ended tickets after the TTL', () => {
    const h = makeDomain(SUBSCRIPTION_TTL_MS)
    const open = h.ticket('a')
    const stopped = h.ticket('b', 'th2')
    const completed = h.ticket('c', 'th3')
    h.domain.endTicket({
      ticketId: stopped.ticketId,
      outcome: 'stopped',
      by: 'user',
      reason: 'done',
    })
    h.domain.endTicket({
      ticketId: completed.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })

    const first = h.domain.pruneExpiredSubscriptions({ at: at(0) })
    // stopped 立即失效；completed 在 TTL 内保留；open 永续。
    expect(first).toEqual([`th2:${stopped.ticketId}`])
    expect(
      h.domain.state.threads['th1'].subscriptions.some(
        (subscription) => subscription.ticketId === open.ticketId,
      ),
    ).toBe(true)
    expect(
      h.domain.state.threads['th3'].subscriptions.some(
        (subscription) => subscription.ticketId === completed.ticketId,
      ),
    ).toBe(true)

    h.setNow(SUBSCRIPTION_TTL_MS + 1)
    const second = h.domain.pruneExpiredSubscriptions()
    expect(second).toEqual([`th3:${completed.ticketId}`])
    // 幂等：再次清理为空。
    expect(h.domain.pruneExpiredSubscriptions()).toEqual([])
  })

  it('keeps subscriptions of open tickets across prunes', () => {
    const h = makeDomain(SUBSCRIPTION_TTL_MS)
    const open = h.ticket('a')
    h.setNow(10 * SUBSCRIPTION_TTL_MS)
    expect(h.domain.pruneExpiredSubscriptions()).toEqual([])
    expect(
      h.domain.state.threads['th1'].subscriptions.some(
        (subscription) => subscription.ticketId === open.ticketId,
      ),
    ).toBe(true)
  })
})
