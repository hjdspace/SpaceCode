// @vitest-environment node
/**
 * T10 #80 reviewReminder 持久化 scheduled effect 契约（设计 §9.2）：
 *  - 进入 review 后按 reviewReminderHours（默认 24h，可配置、集中单处）排期；
 *  - 首次到点提醒一次，之后每 24 小时最多一次；
 *  - 每次外发把 reviewRemindedAt 落盘（写入领域状态），重启重建不重复补发、
 *    不因重启重置为「从未提醒」；
 *  - 长时间无人验收只补一次提醒，不按错过次数风暴补发；
 *  - ticketAccept/ticketStop/继续追问等离开 review 的迁移都取消排期；
 *  - 超时只提醒：不改变阶段、不自动 accept、不降级。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import {
  DEFAULT_REVIEW_REMINDER_HOURS,
  REVIEW_REMINDER_REPEAT_HOURS,
  createSuperAgentReviewReminder,
} from '../reviewReminder'

const HOUR = 3_600_000
let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

/** 固定时钟：手动推进，验证排期与水位。 */
class FakeClock {
  private ms = Date.parse('2026-01-01T00:00:00.000Z')
  now(): Date {
    return new Date(this.ms)
  }
  advance(ms: number): void {
    this.ms += ms
  }
}

interface Ctx {
  domain: SuperAgentDomain
  clock: FakeClock
  reminded: Array<{ ticketId: string; at: string }>
  ticketId: string
  engine: ReturnType<typeof createSuperAgentReviewReminder>
}

function readyContext(hours?: number): Ctx {
  const domain = createSuperAgentDomain()
  const clock = new FakeClock()
  const result = domain.dispatch({
    requestId: nextId('req'),
    title: '修复登录',
    repoRoot: 'D:/repo',
    text: '登录按钮无响应',
    actor: 'tester',
    at: clock.now().toISOString(),
  })
  domain.launchAssignment({ assignmentId: result.assignment.assignmentId })
  domain.report({
    ticketId: result.ticket.ticketId,
    assignmentId: result.assignment.assignmentId,
    reportId: nextId('rep'),
    kind: 'ready',
    summary: '请验收',
    at: clock.now().toISOString(),
  })
  const reminded: Ctx['reminded'] = []
  const engine = createSuperAgentReviewReminder({
    domain,
    hours,
    now: () => clock.now(),
    onRemind: (ticketId, at) => reminded.push({ ticketId, at }),
    // 不 start()：测试手动 sweep，避免真实定时器
  })
  return { domain, clock, reminded, ticketId: result.ticket.ticketId, engine }
}

describe('reviewReminder 排期与频次', () => {
  it('does not remind before reviewReminderHours elapse (default 24h)', () => {
    const { clock, reminded, engine } = readyContext()
    expect(DEFAULT_REVIEW_REMINDER_HOURS).toBe(24)
    clock.advance(23 * HOUR)
    expect(engine.sweep()).toBe(0)
    expect(reminded).toHaveLength(0)
  })

  it('reminds once when due and records reviewRemindedAt', () => {
    const { clock, domain, reminded, engine, ticketId } = readyContext()
    clock.advance(24 * HOUR)
    expect(engine.sweep()).toBe(1)
    expect(reminded).toHaveLength(1)
    expect(reminded[0].ticketId).toBe(ticketId)
    // 水位落盘；重复 sweep 不重复提醒
    expect(domain.state.tickets[ticketId].reviewRemindedAt).toBe(clock.now().toISOString())
    expect(engine.sweep()).toBe(0)
    expect(reminded).toHaveLength(1)
  })

  it('repeats at most once per day afterwards', () => {
    const { clock, reminded, engine } = readyContext()
    clock.advance(24 * HOUR)
    engine.sweep()
    clock.advance(23 * HOUR)
    expect(engine.sweep()).toBe(0)
    clock.advance(2 * HOUR)
    expect(engine.sweep()).toBe(1)
    expect(reminded).toHaveLength(2)
    expect(REVIEW_REMINDER_REPEAT_HOURS).toBe(24)
  })

  it('catches up with exactly one reminder after a long outage, not a storm', () => {
    const { clock, reminded, engine } = readyContext()
    clock.advance(5 * 24 * HOUR)
    expect(engine.sweep()).toBe(1)
    expect(reminded).toHaveLength(1)
  })

  it('honours a configurable reviewReminderHours', () => {
    const { clock, reminded, engine } = readyContext(4)
    clock.advance(3 * HOUR)
    expect(engine.sweep()).toBe(0)
    clock.advance(1 * HOUR)
    expect(engine.sweep()).toBe(1)
    expect(reminded).toHaveLength(1)
  })
})

describe('reviewReminder 重建与取消', () => {
  it('rebuilds from reviewRemindedAt without re-sending (重启不补发)', () => {
    const { clock, domain, reminded, engine, ticketId } = readyContext()
    clock.advance(24 * HOUR)
    engine.sweep()
    expect(reminded).toHaveLength(1)
    clock.advance(1 * HOUR)

    // 重启：同一份领域状态上重建引擎（含 reviewRemindedAt 水位）
    const rebuilt: Ctx['reminded'] = []
    const rebuiltEngine = createSuperAgentReviewReminder({
      domain,
      now: () => clock.now(),
      onRemind: (id, at) => rebuilt.push({ ticketId: id, at }),
    })
    expect(rebuiltEngine.sweep()).toBe(0)
    expect(rebuilt).toHaveLength(0)
    // 到下一个 24h 间隔才再次提醒
    clock.advance(23 * HOUR)
    expect(rebuiltEngine.sweep()).toBe(1)
    expect(rebuilt).toHaveLength(1)
    expect(rebuiltEngine.sweep()).toBe(0)
    expect(domain.state.tickets[ticketId].reviewRemindedAt).toBe(clock.now().toISOString())
  })

  it('cancels the schedule when the ticket leaves review', () => {
    const { clock, domain, reminded, engine, ticketId } = readyContext()
    clock.advance(24 * HOUR)
    expect(engine.sweep()).toBe(1)

    // 接受验收：离开 review，不再提醒
    domain.ticketAccept({ ticketId, at: clock.now().toISOString() })
    clock.advance(48 * HOUR)
    expect(engine.sweep()).toBe(0)
    expect(reminded).toHaveLength(1)

    // 停止出口同样取消
    const stopped = readyContext()
    stopped.clock.advance(24 * HOUR)
    stopped.engine.sweep()
    stopped.domain.ticketStop({ ticketId: stopped.ticketId, at: stopped.clock.now().toISOString() })
    stopped.clock.advance(48 * HOUR)
    expect(stopped.engine.sweep()).toBe(0)
    expect(stopped.reminded).toHaveLength(1)
  })

  it('cancels the schedule when a follow-up message re-enters working', () => {
    const { clock, domain, engine, reminded, ticketId } = readyContext()
    clock.advance(24 * HOUR)
    expect(engine.sweep()).toBe(1)
    domain.ticketMessage({
      ticketId,
      requestId: nextId('req'),
      text: '再改一版',
      at: clock.now().toISOString(),
    })
    clock.advance(48 * HOUR)
    expect(engine.sweep()).toBe(0)
    expect(reminded).toHaveLength(1)
  })

  it('never changes the stage or accepts the ticket (超时只提醒)', () => {
    const { clock, domain, engine, ticketId } = readyContext()
    clock.advance(7 * 24 * HOUR)
    engine.sweep()
    engine.sweep()
    const ticket = domain.state.tickets[ticketId]
    expect(ticket.state).toBe('open')
    expect(ticket.ended).toBeNull()
    expect(domain.stageOf(ticketId)).toBe('person/review')
  })
})
