// @vitest-environment node
/**
 * progressProjector 契约（T06 #76）：
 *  - ticket.updated 携带 fromSeq/toSeq 与全量卡片；无变化不重复发事件；
 *  - 卡片状态全集：queued/preparing/working/idle/delivery/review/answer/
 *    blocked/failed/completed/stopped/dropped（preparing 为投影子态）；
 *  - 同一工单 Report 更新现有卡片（ticketId 身份不变、列表不重复）；
 *  - ticket.progress 1 秒节流：首个立即发、窗口内合并、只发最新事实；
 *    投影 seq 与领域 seq 分开编号，丢弃中间进度不重放；
 *  - 领域断档由 toSeq 水位暴露，Renderer 据此全量重拉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SuperAgentTicketCardState,
  SuperAgentTicketProgress,
  SuperAgentTicketUpdateEvent,
} from '@/shared/channels/superAgent'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import {
  createSuperAgentProgressProjector,
  type SuperAgentProgressProjector,
} from '../progressProjector'

const REPO = 'D:/repo'

interface Harness {
  domain: SuperAgentDomain
  projector: SuperAgentProgressProjector
  updates: SuperAgentTicketUpdateEvent[]
  progress: SuperAgentTicketProgress[]
}

let counter = 0

function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function harness(options: { throttleMs?: number } = {}): Harness {
  const domain = createSuperAgentDomain({ newId: () => nextId('id') })
  const updates: SuperAgentTicketUpdateEvent[] = []
  const progress: SuperAgentTicketProgress[] = []
  const projector = createSuperAgentProgressProjector({
    domain,
    repoRoot: REPO,
    onTicketUpdated: (event) => updates.push(event),
    onTicketProgress: (payload) => progress.push(payload),
    ...(options.throttleMs !== undefined ? { throttleMs: options.throttleMs } : {}),
  })
  return { domain, projector, updates, progress }
}

/** 派工并同步，返回新工单的 ticketId/assignmentId。 */
function dispatchTicket(h: Harness): { ticketId: string; assignmentId: string } {
  const result = h.domain.dispatch({
    requestId: nextId('req'),
    title: '修复登录',
    repoRoot: REPO,
    text: '登录按钮无响应',
    actor: 'tester',
  })
  h.projector.sync()
  return { ticketId: result.ticket.ticketId, assignmentId: result.assignment.assignmentId }
}

/** 最近一次投影里该工单的卡片状态。 */
function lastState(h: Harness, ticketId: string): SuperAgentTicketCardState {
  const event = h.updates[h.updates.length - 1]
  const card = event.tickets.find((entry) => entry.ticketId === ticketId)
  if (!card) throw new Error(`missing card ${ticketId}`)
  return card.state
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ticket.updated 投影与 seq 水位', () => {
  it('emits nothing before any domain fact', () => {
    const h = harness()
    expect(h.projector.sync()).toBeNull()
    expect(h.updates).toHaveLength(0)
  })

  it('emits a queued card with fromSeq/toSeq after dispatch', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)

    expect(h.updates).toHaveLength(1)
    const event = h.updates[0]
    expect(event.fromSeq).toBe(0)
    expect(event.toSeq).toBeGreaterThan(0)
    expect(event.tickets).toHaveLength(1)
    expect(event.tickets[0]).toMatchObject({
      ticketId,
      title: '修复登录',
      state: 'queued',
      assignmentId,
      generation: 1,
      scopePaths: [],
      ended: null,
    })
  })

  it('does not re-emit when nothing changed (Report 更新现有卡片，不重复发气泡)', () => {
    const h = harness()
    dispatchTicket(h)
    expect(h.projector.sync()).toBeNull()
    expect(h.updates).toHaveLength(1)
  })

  it('advances fromSeq/toSeq with domain facts', () => {
    const h = harness()
    dispatchTicket(h)
    const first = h.updates[0]

    h.domain.dispatch({
      requestId: nextId('req'),
      title: '第二张',
      repoRoot: REPO,
      text: '另一个目标',
      actor: 'tester',
    })
    const second = h.projector.sync()

    expect(second).not.toBeNull()
    expect(second!.fromSeq).toBe(first.toSeq)
    expect(second!.toSeq).toBeGreaterThan(first.toSeq)
    expect(second!.tickets).toHaveLength(2)
  })

  it('emits without seq bump when preparing flips (fromSeq === toSeq)', () => {
    const h = harness()
    const { ticketId } = dispatchTicket(h)
    const before = h.updates[0]

    h.projector.setPreparing(ticketId, true)
    const event = h.projector.sync()

    expect(event).not.toBeNull()
    expect(event!.fromSeq).toBe(before.toSeq)
    expect(event!.toSeq).toBe(before.toSeq)
    expect(event!.tickets[0].state).toBe('preparing')
  })
})

describe('卡片状态全集', () => {
  it('covers every documented card state', () => {
    const h = harness()

    // queued → preparing → working → idle → review → completed
    const a = dispatchTicket(h)
    expect(lastState(h, a.ticketId)).toBe('queued')

    h.projector.setPreparing(a.ticketId, true)
    h.projector.sync()
    expect(lastState(h, a.ticketId)).toBe('preparing')

    h.projector.setPreparing(a.ticketId, false)
    h.domain.launchAssignment({ assignmentId: a.assignmentId })
    h.projector.sync()
    expect(lastState(h, a.ticketId)).toBe('working')

    h.domain.report({
      ticketId: a.ticketId,
      assignmentId: a.assignmentId,
      reportId: nextId('rep'),
      kind: 'waiting',
      summary: '等待中',
    })
    h.projector.sync()
    expect(lastState(h, a.ticketId)).toBe('idle')

    h.domain.report({
      ticketId: a.ticketId,
      assignmentId: a.assignmentId,
      reportId: nextId('rep'),
      kind: 'ready',
      summary: '待验收',
    })
    h.projector.sync()
    expect(lastState(h, a.ticketId)).toBe('review')

    h.domain.endTicket({ ticketId: a.ticketId, outcome: 'completed', by: 'user', reason: '验收通过' })
    h.projector.sync()
    expect(lastState(h, a.ticketId)).toBe('completed')

    // stopped
    const b = dispatchTicket(h)
    h.domain.endTicket({ ticketId: b.ticketId, outcome: 'stopped', by: 'user', reason: '人工停止' })
    h.projector.sync()
    expect(lastState(h, b.ticketId)).toBe('stopped')

    // dropped（Report 驱动自动结束）
    const c = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId: c.assignmentId })
    h.domain.report({
      ticketId: c.ticketId,
      assignmentId: c.assignmentId,
      reportId: nextId('rep'),
      kind: 'dropped',
      summary: '目标不成立',
    })
    h.projector.sync()
    expect(lastState(h, c.ticketId)).toBe('dropped')

    // blocked / failed
    const d = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId: d.assignmentId })
    h.domain.report({
      ticketId: d.ticketId,
      assignmentId: d.assignmentId,
      reportId: nextId('rep'),
      kind: 'blocked',
      summary: '缺少凭据',
    })
    h.projector.sync()
    expect(lastState(h, d.ticketId)).toBe('blocked')

    const e = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId: e.assignmentId })
    h.domain.report({
      ticketId: e.ticketId,
      assignmentId: e.assignmentId,
      reportId: nextId('rep'),
      kind: 'failed',
      summary: '构建失败',
    })
    h.projector.sync()
    expect(lastState(h, e.ticketId)).toBe('failed')

    // delivery（永久投递失败）
    const f = dispatchTicket(h)
    const input = h.domain.addInput({
      ticketId: f.ticketId,
      requestId: nextId('req'),
      kind: 'text',
      human: true,
      text: '补充信息',
    })
    h.domain.failDelivery({ inputId: input.input.inputId, error: 'engine gone' })
    h.projector.sync()
    expect(lastState(h, f.ticketId)).toBe('delivery')

    // answer（未回答 Attention）
    const g = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId: g.assignmentId })
    const humanInput = h.domain.addInput({
      ticketId: g.ticketId,
      requestId: nextId('req'),
      kind: 'text',
      human: true,
      text: '采用哪种方案？',
    })
    h.domain.report({
      ticketId: g.ticketId,
      assignmentId: g.assignmentId,
      reportId: nextId('rep'),
      kind: 'waiting',
      summary: '需要确认',
      question: '采用哪种方案？',
      askedBy: humanInput.input.inputId,
    })
    h.projector.sync()
    expect(lastState(h, g.ticketId)).toBe('answer')
  })

  it('keeps one card per ticket while reports update it in place', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId })

    for (const kind of ['waiting', 'ready'] as const) {
      h.domain.report({
        ticketId,
        assignmentId,
        reportId: nextId('rep'),
        kind,
        summary: `${kind} 摘要`,
      })
      h.projector.sync()
    }

    const latest = h.updates[h.updates.length - 1]
    expect(latest.tickets.filter((t) => t.ticketId === ticketId)).toHaveLength(1)
    expect(latest.tickets.find((t) => t.ticketId === ticketId)!.state).toBe('review')
  })

  it('ends with a merged/closed outcome mapped to completed', () => {
    const h = harness()
    const { ticketId } = dispatchTicket(h)
    h.domain.endTicket({ ticketId, outcome: 'merged', by: 'worker', reason: 'PR 合并' })
    h.projector.sync()
    expect(h.updates[h.updates.length - 1].tickets[0].state).toBe('completed')
  })
})

describe('ticket.progress 节流与独立水位', () => {
  it('emits the first progress immediately and coalesces within 1s', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId })
    h.projector.sync()
    vi.advanceTimersByTime(1200)

    h.projector.recordProgress(ticketId, { currentTool: 'Read', toolCalls: 1, elapsedMs: 10 })
    expect(h.progress).toHaveLength(1)

    // 1 秒窗口内连续到达的进度只保留最新，不逐条重放
    h.projector.recordProgress(ticketId, { currentTool: 'Edit', toolCalls: 2, elapsedMs: 500 })
    h.projector.recordProgress(ticketId, { currentTool: 'Bash', toolCalls: 3, elapsedMs: 900 })
    expect(h.progress).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(h.progress).toHaveLength(2)
    expect(h.progress[1]).toMatchObject({
      ticketId,
      state: 'working',
      assignmentId,
      currentTool: 'Bash',
      toolCalls: 3,
      elapsedMs: 900,
    })
  })

  it('uses an independent projection seq, not the domain seq', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId })
    h.projector.sync()
    vi.advanceTimersByTime(1200)

    const domainSeq = h.domain.state.seq
    h.projector.recordProgress(ticketId, { currentTool: 'Read' })
    vi.advanceTimersByTime(1000)
    h.projector.recordProgress(ticketId, { currentTool: 'Edit' })

    const seqs = h.progress.map((p) => p.seq)
    expect(seqs).toEqual([1, 2])
    expect(seqs[0]).not.toBe(domainSeq)
    // 节流丢弃的中间进度不会在之后补发（不重放）
    expect(h.progress.map((p) => p.currentTool)).toEqual(['Read', 'Edit'])
  })

  it('falls back to elapsed computed from assignment startedAt', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId })
    h.projector.sync()
    vi.advanceTimersByTime(1200)

    vi.advanceTimersByTime(3000)
    h.projector.recordProgress(ticketId, { currentTool: 'Read' })

    expect(h.progress).toHaveLength(1)
    expect(h.progress[0].elapsedMs).toBeGreaterThanOrEqual(3000)
  })

  it('carries lastActivityAt for the progress payload', () => {
    const h = harness()
    const { ticketId } = dispatchTicket(h)
    vi.advanceTimersByTime(500)

    h.projector.recordProgress(ticketId, { currentTool: 'Read' })

    expect(h.progress[0].lastActivityAt).not.toBeNull()
  })

  it('exposes cards() mirroring the latest sync', () => {
    const h = harness()
    const { ticketId } = dispatchTicket(h)
    expect(h.projector.cards().map((c) => c.ticketId)).toEqual([ticketId])
    expect(h.projector.cards()[0].state).toBe('queued')
  })

  it('opens the stop exit for every open ticket and closes it once ended', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)
    // 排队中也要能停：否则串行队列里排队的工单只能干等
    expect(h.projector.cards()[0]).toMatchObject({ state: 'queued', canStop: true })

    h.domain.launchAssignment({ assignmentId })
    h.projector.sync()
    expect(h.projector.cards()[0]).toMatchObject({ state: 'working', canStop: true })

    h.domain.ticketStop({ ticketId })
    h.projector.sync()
    expect(h.projector.cards()[0]).toMatchObject({ state: 'stopped', canStop: false })
  })

  it('peekProgress reads the same facts without advancing the progress watermark', () => {
    const h = harness()
    const { ticketId, assignmentId } = dispatchTicket(h)
    h.domain.launchAssignment({ assignmentId })
    h.projector.recordProgress(ticketId, { currentTool: 'Bash' })
    const emitted = h.progress[h.progress.length - 1]

    const peeked = h.projector.peekProgress(ticketId)

    expect(peeked).toMatchObject({ ticketId, currentTool: 'Bash', seq: emitted.seq })
    // 只读一次不该多发一条 ticket.progress
    expect(h.progress).toHaveLength(1)
  })
})
