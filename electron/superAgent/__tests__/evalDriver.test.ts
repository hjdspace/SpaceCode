/**
 * Eval 驱动闭环（T16 #86 / #99）：候选按 Thread 建批 → Router 语义评估 → Decision。
 *
 * 覆盖验收：
 *  - 候选按 Thread 建批，一次 evaluate 只投递一批；
 *  - observe 记录「本会接受」不建单；auto accept 建单并带命中规则；
 *  - deadline 从真正送达 Router 起算，queued 不计时；超时重排 2 次、第 3 次记 unavailable；
 *  - 暂停期间不超时、不开始新 Eval；
 *  - 协议严格解析：缺失/多块/坏 JSON/字段非法都是稳定错误码，不猜意图；
 *  - 旧版本/迟到结果不落地，不影响新一轮。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import {
  createSuperAgentEvalDriver,
  parseSuperAgentEvalText,
  type SuperAgentEvalRouterTurn,
} from '../evalDriver'
import type { SuperAgentAcceptMode } from '../model'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const TTL_MS = 60_000

function evalFence(fields: Record<string, unknown>): string {
  return ['```super-agent:eval', JSON.stringify(fields, null, 2), '```'].join('\n')
}

interface Harness {
  domain: SuperAgentDomain
  driver: ReturnType<typeof createSuperAgentEvalDriver>
  turns: SuperAgentEvalRouterTurn[]
  failures: { code: string; evalId: string }[]
  intake(key: string, text?: string): string
  configure(acceptMode: SuperAgentAcceptMode): void
  advance(ms: number): void
}

function makeHarness(options: { configured?: boolean } = {}): Harness {
  let clock = T0
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(clock),
    newId: (kind) => `${kind}-${++counter}`,
    evalTtlMs: TTL_MS,
  })
  const turns: SuperAgentEvalRouterTurn[] = []
  const failures: { code: string; evalId: string }[] = []
  const driver = createSuperAgentEvalDriver({
    domain,
    repoRoot: '/repo',
    router: { evaluate: (turn) => turns.push(turn) },
    onChanged: () => undefined,
    onFailure: (code, evalId) => failures.push({ code, evalId }),
  })
  const intake = (key: string, text = `消息 ${key}`): string =>
    domain.intakeTrigger({
      key,
      source: 'feishu-im',
      threadIds: ['th1'],
      actor: 'feishu:user:u1',
      human: true,
      addressed: 'mention',
      text,
    }).trigger.triggerId
  const configure = (acceptMode: SuperAgentAcceptMode): void => {
    domain.setPolicy({
      acceptMode,
      rules: [{ name: 'rule-a', instruction: '先看日志再改代码' }],
      admissions: [{ source: 'feishu-im', channels: [], allowlist: [], bots: [] }],
    })
  }
  if (options.configured !== false) configure('auto')
  return {
    domain,
    driver,
    turns,
    failures,
    intake,
    configure,
    advance: (ms) => {
      clock += ms
    },
  }
}

function evalIds(h: Harness): string[] {
  return Object.keys(h.domain.state.evals)
}

/** 送达并返回该轮 Eval（evalId 从卡片正文读取，和 Router 看到的一致）。 */
function deliver(h: Harness, index = 0): { evalId: string; turn: SuperAgentEvalRouterTurn } {
  const turn = h.turns[index]!
  const evalId = turn.text.match(/evalId: (eval-\S+)/)?.[1]
  if (!evalId) throw new Error('评估卡缺少 evalId')
  turn.onDeliver?.()
  return { evalId, turn }
}

describe('Eval 驱动：建批与裁决', () => {
  it('把同一 Thread 的候选合成一批，只投递一张评估卡', () => {
    const h = makeHarness()
    h.intake('e1', '把登录页的报错弹窗修一下')
    h.intake('e2', '补充：只在密码错误时弹')
    h.driver.pump()

    expect(h.turns).toHaveLength(1)
    expect(h.turns[0]!.text).toContain('把登录页的报错弹窗修一下')
    expect(h.turns[0]!.text).toContain('补充：只在密码错误时弹')
    expect(h.turns[0]!.text).toContain('先看日志再改代码')
    expect(h.turns[0]!.text).toContain('super-agent:eval')
    expect(h.turns[0]!.text).toMatch(/evalId: eval-\d+/)
  })

  it('observe：accept 只记录本会接受，不建工单并带 reason', () => {
    const h = makeHarness()
    h.configure('observe')
    h.intake('e1', '明天的会改到下午两点')
    h.driver.pump()
    const { evalId, turn } = deliver(h)
    const evalRoot = h.domain.state.evals[evalId]!
    turn.onResult(
      evalFence({
        version: 1,
        evalId: evalRoot.evalId,
        action: 'ignore',
        matchedRules: [],
        reason: '只是在说日程，没有要求动手',
      }),
    )

    expect(h.domain.state.evals[evalId]!.state).toBe('decided')
    expect(h.domain.state.evals[evalId]!.decision).toMatchObject({
      action: 'ignore',
      matchedRules: [],
      ticketId: null,
      reason: '只是在说日程，没有要求动手',
    })
    expect(h.domain.state.tickets).toEqual({})
    expect(h.turns).toHaveLength(1)
  })

  it('auto：accept 建单，命中规则进入 Mandate', () => {
    const h = makeHarness()
    const triggerId = h.intake('e1', '修一下登录页的报错弹窗')
    h.driver.pump()
    const { evalId, turn } = deliver(h)
    turn.onResult(
      evalFence({
        version: 1,
        evalId,
        action: 'accept',
        matchedRules: ['rule-a'],
        reason: '明确要求修复登录页问题',
      }),
    )

    const tickets = Object.values(h.domain.state.tickets)
    expect(tickets).toHaveLength(1)
    const ticket = tickets[0]!
    expect(ticket.origin.triggerIds).toEqual([triggerId])
    expect(h.domain.state.evals[evalId]!.decision).toMatchObject({
      action: 'accept',
      ticketId: ticket.ticketId,
      matchedRules: ['rule-a'],
    })
    expect(h.domain.state.mandates[ticket.mandateId]!.matchedRules).toEqual(['rule-a'])
    expect(h.domain.state.assignments[ticket.assignmentIds[0]!]!.state).toBe('pending')
  })

  it('observe 与 auto 都不会在 off 模式下发起评估', () => {
    const h = makeHarness({ configured: false })
    h.intake('e1')
    h.driver.pump()
    expect(h.turns).toHaveLength(0)
  })
})

describe('Eval 驱动：超时与暂停', () => {
  it('queued 不计时；delivered 到点才重排，第 3 次记 unavailable', () => {
    const h = makeHarness()
    h.intake('e1')
    h.driver.pump()

    // 未送达：扫几次都不算超时
    h.advance(TTL_MS * 2)
    expect(h.driver.sweep()).toBe(0)
    expect(h.turns[0]!.isStale?.()).toBe(false)

    // 第 1 次送达后超时 → 重排并立即开新一轮（新 Eval 仍 queued）
    h.turns[0]!.onDeliver?.()
    h.advance(TTL_MS)
    expect(h.driver.sweep()).toBe(1)
    expect(evalIds(h)).toHaveLength(2)
    expect(h.turns).toHaveLength(2)
    expect(h.turns[1]!.text).toContain('已重新排队')

    // 第 2 次超时 → 再重排
    h.turns[1]!.onDeliver?.()
    h.advance(TTL_MS)
    expect(h.driver.sweep()).toBe(1)
    expect(evalIds(h)).toHaveLength(3)

    // 第 3 次超时 → unavailable，且不再开新一轮
    h.turns[2]!.onDeliver?.()
    h.advance(TTL_MS)
    expect(h.driver.sweep()).toBe(1)
    const ids = evalIds(h)
    const last = h.domain.state.evals[ids[ids.length - 1]!]!
    expect(last.state).toBe('unavailable')
    expect(h.domain.state.threads.th1!.evaluating).toBe(false)
    expect(h.failures).toContainEqual({ code: 'evalUnavailable', evalId: last.evalId })
    expect(h.turns).toHaveLength(3)
  })

  it('暂停期间不超时、不开始新评估；恢复后按原 deadline 继续计时', () => {
    const h = makeHarness()
    h.intake('e1')
    h.driver.pump()
    h.turns[0]!.onDeliver?.()
    h.domain.pauseProject()
    h.advance(TTL_MS * 3)
    expect(h.driver.sweep()).toBe(0)
    expect(h.domain.state.evals[evalIds(h)[0]!]!.state).toBe('delivered')

    h.intake('e2')
    h.driver.pump()
    expect(h.turns).toHaveLength(1)

    h.domain.resumeProject()
    h.advance(TTL_MS)
    expect(h.driver.sweep()).toBe(1)
  })
})

describe('Eval 协议严格解析', () => {
  it('缺失/多块/坏 JSON/字段非法一律稳定错误码，不落地裁决', () => {
    const h = makeHarness()
    h.intake('e1')
    h.driver.pump()
    const turn = h.turns[0]!

    const cases: { text: string; code: string }[] = [
      { text: '我先想想', code: 'evalMissing' },
      {
        text: `${evalFence({ version: 1, evalId: 'x', action: 'ignore', matchedRules: [], reason: 'a' })}\n${evalFence({ version: 1, evalId: 'x', action: 'accept', matchedRules: [], reason: 'b' })}`,
        code: 'evalNotUnique',
      },
      { text: '```super-agent:eval\n{not json}\n```', code: 'evalUnparsable' },
      { text: evalFence({ version: 1, evalId: 'x', action: 'ignore', matchedRules: [], reason: 'a', extra: 1 }), code: 'evalInvalid' },
      { text: evalFence({ version: 1, evalId: 'x', action: 'maybe', matchedRules: [], reason: 'a' }), code: 'evalInvalid' },
      { text: evalFence({ version: 2, evalId: 'x', action: 'ignore', matchedRules: [], reason: 'a' }), code: 'evalInvalid' },
      { text: evalFence({ version: 1, evalId: 'x', action: 'ignore', matchedRules: ['a', 'a'], reason: 'a' }), code: 'evalInvalid' },
      { text: evalFence({ version: 1, evalId: 'x', action: 'ignore', matchedRules: [] }), code: 'evalInvalid' },
    ]

    for (const item of cases) {
      turn.onDeliver?.()
      turn.onResult(item.text)
      expect(h.failures[h.failures.length - 1]?.code).toBe(item.code)
      expect(h.domain.state.evals[evalIds(h)[0]!]!.state).toBe('delivered')
      expect(h.domain.state.evals[evalIds(h)[0]!]!.decision).toBeNull()
    }
  })

  it('evalId 与当前批次不一致时按 evalInvalid 拒绝', () => {
    const h = makeHarness()
    h.intake('e1')
    h.driver.pump()
    const turn = h.turns[0]!
    turn.onDeliver?.()
    turn.onResult(evalFence({ version: 1, evalId: 'eval-999', action: 'ignore', matchedRules: [], reason: 'x' }))
    expect(h.failures[h.failures.length - 1]).toMatchObject({ code: 'evalInvalid' })
    expect(h.domain.state.evals[evalIds(h)[0]!]!.state).toBe('delivered')
  })

  it('parseSuperAgentEvalText 返回严格校验后的字段', () => {
    const parsed = parseSuperAgentEvalText(
      evalFence({ version: 1, evalId: 'eval-1', action: 'accept', matchedRules: ['r'], reason: '明确要求' }),
    )
    expect(parsed).toEqual({
      version: 1,
      evalId: 'eval-1',
      action: 'accept',
      matchedRules: ['r'],
      reason: '明确要求',
    })
  })
})

describe('Eval 驱动：旧版本与迟到结果', () => {
  it('Policy 变更丢弃运行中 Eval，迟到回复不落地，新版本重新开评估', () => {
    const h = makeHarness()
    h.intake('e1')
    h.driver.pump()
    const first = evalIds(h)[0]!
    h.turns[0]!.onDeliver?.()

    h.configure('observe')
    expect(h.domain.state.evals[first]!.state).toBe('discarded')
    h.driver.pump()
    expect(h.turns).toHaveLength(2)
    expect(h.domain.state.evals[evalIds(h)[1]!]!.policyVersion).toBe(
      h.domain.state.policy.version,
    )

    h.turns[0]!.onResult(
      evalFence({ version: 1, evalId: first, action: 'accept', matchedRules: [], reason: '迟到' }),
    )
    expect(h.domain.state.evals[first]!.state).toBe('discarded')
    expect(h.domain.state.tickets).toEqual({})
  })
})
