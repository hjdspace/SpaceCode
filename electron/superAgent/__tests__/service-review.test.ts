// @vitest-environment node
/**
 * service 层 T10 契约（#80）：
 *  - ticketAccept / ticketStop / ticketMessage / ticketRetry 四个出口；
 *  - 卡片携带 reviewRemindedAt / canRetry（重试后 canRetry 关闭）；
 *  - snapshot.review.reminded 按工单去重（不按提醒次数计）；
 *  - reviewReminder 引擎接线：到点外发 → 卡片水位更新 → ticket-updated 广播；
 *    验收/停止后计数归零（提醒随出口自然取消）。
 */
import { describe, expect, it } from 'vitest'
import type { SuperAgentTicketUpdateEvent } from '@/shared/channels/superAgent'
import { isSuperAgentDomainError } from '../errors'
import { createSuperAgentService } from '../service'
import { SUPER_AGENT_REPORT_FENCE } from '../reportParser'

const REPO = 'D:/repo'
const HOUR = 3_600_000

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function reportText(
  assignmentId: string,
  reportId: string,
  extra: Record<string, unknown> = {},
): string {
  return `\`\`\`${SUPER_AGENT_REPORT_FENCE}\n${JSON.stringify({
    assignmentId,
    reportId,
    kind: 'progress',
    summary: '推进中',
    ...extra,
  })}\n\`\`\``
}

class FakeClock {
  // 起点取真实当前时间：dispatch/report 的领域时间戳走真实时钟，
  // 扫描时钟必须与其对齐，否则「到点」判定失真。
  private ms = Date.now()
  now(): Date {
    return new Date(this.ms)
  }
  advance(ms: number): void {
    this.ms += ms
  }
}

interface Ctx {
  updates: Array<[string, SuperAgentTicketUpdateEvent]>
}

function makeService(ctx: Ctx, clock?: FakeClock, hours?: number) {
  return createSuperAgentService({
    onTicketUpdated: (repoRoot, event) => ctx.updates.push([repoRoot, event]),
    reviewReminder: clock ? { hours, now: () => clock.now() } : undefined,
  })
}

/** 派工 + ready Report：工单进入待验收（launcher 未接入时 pending 也可回报）。 */
function readyTicket(service: ReturnType<typeof makeService>) {
  const dispatched = service.dispatch(REPO, {
    requestId: nextId('req'),
    title: '修复登录',
    text: '登录按钮无响应',
    actor: 'tester',
  })
  service.workerReport(REPO, {
    text: reportText(dispatched.assignmentId, nextId('rep'), {
      kind: 'ready',
      summary: '请验收',
    }),
  })
  return dispatched
}

function cardOf(service: ReturnType<typeof makeService>, ticketId: string) {
  return service.tickets(REPO).tickets.find((card) => card.ticketId === ticketId)
}

describe('ticketAccept 验收出口', () => {
  it('completes a ready ticket and broadcasts the completed card', () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)
    ctx.updates.length = 0

    const result = service.ticketAccept(REPO, { ticketId })
    expect(result).toMatchObject({ repoRoot: REPO, ticketId, outcome: 'completed' })
    expect(cardOf(service, ticketId)?.state).toBe('completed')
    const lastUpdate = ctx.updates[ctx.updates.length - 1]
    expect(lastUpdate?.[1].tickets.find((c) => c.ticketId === ticketId)?.state).toBe('completed')
  })

  it('refuses repeat accept with ticketEnded', () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)
    service.ticketAccept(REPO, { ticketId })
    try {
      service.ticketAccept(REPO, { ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expect(isSuperAgentDomainError(err)).toBe(true)
      expect((err as { code: string }).code).toBe('ticketEnded')
    }
  })
})

describe('ticketStop 停止出口', () => {
  it('stops a ticket and zeroes the review reminder count', () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)
    const result = service.ticketStop(REPO, { ticketId })
    expect(result).toMatchObject({ repoRoot: REPO, ticketId, outcome: 'stopped' })
    expect(cardOf(service, ticketId)?.state).toBe('stopped')
    expect(service.state(REPO).review.reminded).toBe(0)
  })
})

describe('ticketMessage 继续追问出口', () => {
  it('re-enters working on the original assignment and closes accept', async () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)

    const result = await service.ticketMessage(REPO, {
      requestId: nextId('req'),
      ticketId,
      text: '再改一版',
    })
    expect(result).toMatchObject({ ticketId, delivered: true, duplicate: false })
    // launcher 未接入：Assignment 保持 pending，卡片子态为 queued
    // （阶段已离开 review 回到 working；accept 出口随之关闭）
    expect(cardOf(service, ticketId)?.state).toBe('queued')
    // 回到 working 后验收出口关闭
    try {
      service.ticketAccept(REPO, { ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as { code: string }).code).toBe('notReady')
    }
  })

  it('refuses empty follow-up text with invalidTicketMessage', async () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)
    await expect(
      service.ticketMessage(REPO, { requestId: nextId('req'), ticketId, text: '   ' }),
    ).rejects.toMatchObject({ code: 'invalidTicketMessage' })
  })

  it('replays a duplicate requestId without a second input', async () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)
    const requestId = nextId('req')
    const first = await service.ticketMessage(REPO, { requestId, ticketId, text: '再改一版' })
    const second = await service.ticketMessage(REPO, { requestId, ticketId, text: '再改一版' })
    expect(second.duplicate).toBe(true)
    expect(second.inputId).toBe(first.inputId)
  })
})

describe('ticketRetry 重试出口', () => {
  function failedTicket(service: ReturnType<typeof makeService>) {
    const dispatched = service.dispatch(REPO, {
      requestId: nextId('req'),
      title: '修复登录',
      text: '登录按钮无响应',
      actor: 'tester',
    })
    service.workerReport(REPO, {
      text: reportText(dispatched.assignmentId, nextId('rep'), {
        kind: 'failed',
        summary: '引擎崩溃',
      }),
    })
    return dispatched
  }

  it('exposes canRetry on failed cards and creates generation 2 on retry', () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = failedTicket(service)
    expect(cardOf(service, ticketId)).toMatchObject({ state: 'failed', canRetry: true })

    const result = service.ticketRetry(REPO, { ticketId })
    expect(result).toMatchObject({ ticketId, generation: 2 })
    // 新代次排队（launcher 未接入保持排队）；重试后闸门关闭
    expect(service.queue(REPO).queued[0]).toMatchObject({ ticketId })
    expect(cardOf(service, ticketId)?.canRetry).toBe(false)
  })

  it('refuses retry for review tickets with notRetryable', () => {
    const ctx: Ctx = { updates: [] }
    const service = makeService(ctx)
    const { ticketId } = readyTicket(service)
    expect(cardOf(service, ticketId)?.canRetry).toBe(false)
    try {
      service.ticketRetry(REPO, { ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as { code: string }).code).toBe('notRetryable')
    }
  })
})

describe('reviewReminder 引擎接线', () => {
  it('sweeps due tickets, stamps cards and counts deduped tickets', () => {
    const ctx: Ctx = { updates: [] }
    const clock = new FakeClock()
    const service = makeService(ctx, clock, 24)
    const first = readyTicket(service)
    const second = readyTicket(service)
    ctx.updates.length = 0

    clock.advance(23 * HOUR)
    expect(service.sweepReviewReminders(REPO)).toBe(0)
    // 共推进 25h：两单 report.at 相差几毫秒，精确 24h 会漏掉第二单
    clock.advance(2 * HOUR)
    expect(service.sweepReviewReminders(REPO)).toBe(2)
    // 卡片携带提醒水位；徽章计数按工单去重 = 2
    const remindedAt = new Date(clock.now()).toISOString()
    expect(cardOf(service, first.ticketId)?.reviewRemindedAt).toBe(remindedAt)
    expect(cardOf(service, second.ticketId)?.reviewRemindedAt).toBe(remindedAt)
    expect(service.state(REPO).review.reminded).toBe(2)
    // 重复 sweep 不重复外发（水位推进到当下）
    expect(service.sweepReviewReminders(REPO)).toBe(0)
    // 水位变化随既有 ticket-updated 卡片广播
    const broadcast = ctx.updates[ctx.updates.length - 1]?.[1]
    expect(
      broadcast?.tickets.find((c: { ticketId: string }) => c.ticketId === first.ticketId)
        ?.reviewRemindedAt,
    ).toBe(remindedAt)
  })

  it('keeps the stage in review and clears the count once accepted', () => {
    const ctx: Ctx = { updates: [] }
    const clock = new FakeClock()
    const service = makeService(ctx, clock, 1)
    const { ticketId } = readyTicket(service)
    // 多留 1 分钟余量：report.at 晚于扫描时钟起点几毫秒，精确 1h 会漏掉
    clock.advance(HOUR + 60_000)
    expect(service.sweepReviewReminders(REPO)).toBe(1)
    expect(cardOf(service, ticketId)?.state).toBe('review')

    service.ticketAccept(REPO, { ticketId })
    expect(service.state(REPO).review.reminded).toBe(0)
    clock.advance(48 * HOUR)
    expect(service.sweepReviewReminders(REPO)).toBe(0)
  })
})
