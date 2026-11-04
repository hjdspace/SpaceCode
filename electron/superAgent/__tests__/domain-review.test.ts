// @vitest-environment node
/**
 * T10 #80 领域契约：验收、停止与重试出口 + review 提醒水位。
 *
 * 三个显式出口（设计 §5.2/§10.3）：
 *  - ticketAccept：只有 person/review 可验收 → completed；其余 notReady；
 *  - 继续追问：review 中的人消息复用原 Assignment 回到 working（不换代次）；
 *  - ticketStop：→ stopped、Mandate 撤回、在途 Assignment 以 stopped 收尾、
 *    结束瞬间未读的人消息回流 Eval（不被吞）、后续自动事件不得重开；
 *  - retryTicket：只对 open 且 person/delivery、person/blocked、person/failed 开放，
 *    重试产生新代次（generation+1），并清除永久投递失败；
 *  - markReviewReminded：review 水位只前进，离开 review/结束后拒绝。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import { isSuperAgentDomainError } from '../errors'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

interface Ctx {
  domain: SuperAgentDomain
  ticketId: string
  assignmentId: string
}

/** 派工 → 启动 → ready Report：进入 person/review。 */
function readyDomain(): Ctx {
  const domain = createSuperAgentDomain()
  const result = domain.dispatch({
    requestId: nextId('req'),
    title: '修复登录',
    repoRoot: 'D:/repo',
    text: '登录按钮无响应',
    actor: 'tester',
  })
  domain.launchAssignment({ assignmentId: result.assignment.assignmentId })
  domain.report({
    ticketId: result.ticket.ticketId,
    assignmentId: result.assignment.assignmentId,
    reportId: nextId('rep'),
    kind: 'ready',
    summary: '已完成，请验收',
  })
  return { domain, ticketId: result.ticket.ticketId, assignmentId: result.assignment.assignmentId }
}

function expectCode(err: unknown, code: string): void {
  expect(isSuperAgentDomainError(err)).toBe(true)
  expect((err as { code: string }).code).toBe(code)
}

describe('ticketAccept 验收出口', () => {
  it('completes a ready ticket by user without revoking the mandate', () => {
    const { domain, ticketId } = readyDomain()
    const result = domain.ticketAccept({ ticketId })
    expect(result.ticket.state).toBe('ended')
    expect(result.ticket.ended).toMatchObject({ outcome: 'completed', by: 'user' })
    const mandate = domain.state.mandates[result.ticket.mandateId]
    expect(mandate.revokedAt).toBeNull()
    expect(domain.stageOf(ticketId)).toBe('completed')
  })

  it('releases unread human messages back to eval on accept', () => {
    const { domain, ticketId } = readyDomain()
    // 仅上下文的人消息：不唤醒、不改变 review 阶段，但仍是未读人消息
    const added = domain.addInput({
      ticketId,
      requestId: nextId('req'),
      kind: 'text',
      human: true,
      context: true,
      text: '顺带看看注册页',
    })
    // 已投递未读的人消息：验收结束后必须回流，不被静默吞掉
    expect(added.delivered).toBe(true)
    expect(domain.stageOf(ticketId)).toBe('person/review')
    const result = domain.ticketAccept({ ticketId })
    expect(result.releasedInputIds).toContain(added.input.inputId)
    expect(domain.state.inputs[added.input.inputId].releasedAt).not.toBeNull()
  })

  it('refuses to accept a ticket that is not in review (notReady)', () => {
    const domain = createSuperAgentDomain()
    const result = domain.dispatch({
      requestId: nextId('req'),
      title: '修复登录',
      repoRoot: 'D:/repo',
      text: '登录按钮无响应',
      actor: 'tester',
    })
    expect(() => domain.ticketAccept({ ticketId: result.ticket.ticketId })).toThrowError()
    try {
      domain.ticketAccept({ ticketId: result.ticket.ticketId })
    } catch (err) {
      expectCode(err, 'notReady')
    }
  })

  it('refuses to accept an ended ticket (ticketEnded)', () => {
    const { domain, ticketId } = readyDomain()
    domain.ticketAccept({ ticketId })
    try {
      domain.ticketAccept({ ticketId })
    } catch (err) {
      expectCode(err, 'ticketEnded')
    }
  })
})

describe('继续追问：review 的人消息复用原 Assignment 回到 working', () => {
  it('reopens the same assignment without a new generation', () => {
    const { domain, ticketId, assignmentId } = readyDomain()
    const result = domain.ticketMessage({
      ticketId,
      requestId: nextId('req'),
      text: '注册页也一起修了',
    })
    expect(result.input.human).toBe(true)
    expect(result.delivered).toBe(true)
    // 复用原 Assignment：不新建、不递增 generation
    const ticket = domain.state.tickets[ticketId]
    expect(ticket.assignmentIds).toHaveLength(1)
    expect(domain.stageOf(ticketId)).toBe('working')
    expect(domain.state.assignments[assignmentId].state).toBe('running')
  })
})

describe('ticketStop 停止出口', () => {
  it('stops a ready ticket, revokes the mandate and ends the running assignment', () => {
    const { domain, ticketId, assignmentId } = readyDomain()
    const result = domain.ticketStop({ ticketId })
    expect(result.ticket.state).toBe('ended')
    expect(result.ticket.ended).toMatchObject({ outcome: 'stopped', by: 'user' })
    expect(domain.state.mandates[result.ticket.mandateId].revokedAt).not.toBeNull()
    expect(domain.state.assignments[assignmentId]).toMatchObject({
      state: 'ended',
      endedReason: 'stopped',
    })
    expect(domain.stageOf(ticketId)).toBe('stopped')
  })

  it('releases unread human messages instead of swallowing them at stop time', () => {
    const { domain, ticketId } = readyDomain()
    const added = domain.addInput({
      ticketId,
      requestId: nextId('req'),
      kind: 'text',
      human: true,
      text: '补充：注意移动端',
    })
    const result = domain.ticketStop({ ticketId })
    expect(result.releasedInputIds).toContain(added.input.inputId)
    expect(domain.state.handbacks).toContain(added.input.inputId)
  })

  it('keeps a stopped ticket closed against automatic events', () => {
    const { domain, ticketId, assignmentId } = readyDomain()
    domain.ticketStop({ ticketId })
    // 自动事件不得重开：Report 与新 Input 一律拒绝
    try {
      domain.report({
        ticketId,
        assignmentId,
        reportId: nextId('rep'),
        kind: 'progress',
        summary: '迟到的事实',
      })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'ticketEnded')
    }
    try {
      domain.addInput({
        ticketId,
        requestId: nextId('req'),
        kind: 'text',
        human: false,
        text: 'bot event',
      })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'ticketEnded')
    }
  })

  it('refuses to stop an ended ticket (ticketEnded)', () => {
    const { domain, ticketId } = readyDomain()
    domain.ticketStop({ ticketId })
    try {
      domain.ticketStop({ ticketId })
    } catch (err) {
      expectCode(err, 'ticketEnded')
    }
  })
})

describe('retryTicket 重试出口', () => {
  function failedDomain(): Ctx {
    const domain = createSuperAgentDomain()
    const result = domain.dispatch({
      requestId: nextId('req'),
      title: '修复登录',
      repoRoot: 'D:/repo',
      text: '登录按钮无响应',
      actor: 'tester',
    })
    domain.launchAssignment({ assignmentId: result.assignment.assignmentId })
    domain.report({
      ticketId: result.ticket.ticketId,
      assignmentId: result.assignment.assignmentId,
      reportId: nextId('rep'),
      kind: 'failed',
      summary: '引擎崩溃',
    })
    return { domain, ticketId: result.ticket.ticketId, assignmentId: result.assignment.assignmentId }
  }

  it('creates a new generation for a failed ticket and supersedes the old assignment', () => {
    const { domain, ticketId, assignmentId } = failedDomain()
    const result = domain.retryTicket({ ticketId })
    expect(result.assignment.generation).toBe(2)
    expect(result.assignment.state).toBe('pending')
    // 旧代次被人工重试取代：不再悬挂 running
    expect(domain.state.assignments[assignmentId]).toMatchObject({
      state: 'ended',
      endedReason: 'stopped',
    })
    expect(domain.stageOf(ticketId)).toBe('working/queued')
  })

  it('clears the permanent delivery failure so the stage leaves person/delivery', () => {
    const { domain, ticketId, assignmentId } = failedDomain()
    const added = domain.addInput({
      ticketId,
      requestId: nextId('req'),
      kind: 'text',
      human: true,
      text: '请继续',
    })
    domain.failDelivery({ inputId: added.input.inputId, error: 'engine gone' })
    expect(domain.stageOf(ticketId)).toBe('person/delivery')
    domain.retryTicket({ ticketId })
    expect(domain.state.tickets[ticketId].delivery).toBeNull()
    expect(domain.stageOf(ticketId)).toBe('working/queued')
  })

  it('retries a blocked ticket', () => {
    const { domain, ticketId } = failedDomain()
    domain.report({
      ticketId,
      assignmentId: domain.state.tickets[ticketId].execution.assignmentId as string,
      reportId: nextId('rep'),
      kind: 'blocked',
      summary: '缺权限',
    })
    expect(domain.stageOf(ticketId)).toBe('person/blocked')
    const result = domain.retryTicket({ ticketId })
    expect(result.assignment.generation).toBe(2)
  })

  it('refuses retry once a human message has re-entered working (notRetryable)', () => {
    const { domain, ticketId } = failedDomain()
    const added = domain.addInput({
      ticketId,
      requestId: nextId('req'),
      kind: 'text',
      human: true,
      text: '我给了权限，继续',
    })
    expect(added.delivered).toBe(true)
    expect(domain.stageOf(ticketId)).toBe('working')
    try {
      domain.retryTicket({ ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'notRetryable')
    }
  })

  it('refuses retry for review and idle tickets (notRetryable)', () => {
    const ready = readyDomain()
    try {
      ready.domain.retryTicket({ ticketId: ready.ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'notRetryable')
    }

    const domain = createSuperAgentDomain()
    const result = domain.dispatch({
      requestId: nextId('req'),
      title: '修复登录',
      repoRoot: 'D:/repo',
      text: '登录按钮无响应',
      actor: 'tester',
    })
    domain.launchAssignment({ assignmentId: result.assignment.assignmentId })
    domain.report({
      ticketId: result.ticket.ticketId,
      assignmentId: result.assignment.assignmentId,
      reportId: nextId('rep'),
      kind: 'waiting',
      summary: '等待中',
    })
    expect(domain.stageOf(result.ticket.ticketId)).toBe('idle')
    try {
      domain.retryTicket({ ticketId: result.ticket.ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'notRetryable')
    }
  })

  it('refuses retry for ended tickets (ticketEnded)', () => {
    const { domain, ticketId } = failedDomain()
    domain.ticketStop({ ticketId })
    try {
      domain.retryTicket({ ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'ticketEnded')
    }
  })
})

describe('markReviewReminded review 超时提醒水位', () => {
  it('records the watermark only for tickets in review', () => {
    const { domain, ticketId } = readyDomain()
    const ticket = domain.markReviewReminded({ ticketId, at: '2026-01-02T00:00:00.000Z' })
    expect(ticket.reviewRemindedAt).toBe('2026-01-02T00:00:00.000Z')
    // 超时提醒不改变阶段：保持 person/review，不降级、不自动 accept
    expect(domain.stageOf(ticketId)).toBe('person/review')
    expect(ticket.state).toBe('open')
  })

  it('never moves the watermark backwards', () => {
    const { domain, ticketId } = readyDomain()
    domain.markReviewReminded({ ticketId, at: '2026-01-03T00:00:00.000Z' })
    const ticket = domain.markReviewReminded({ ticketId, at: '2026-01-02T00:00:00.000Z' })
    expect(ticket.reviewRemindedAt).toBe('2026-01-03T00:00:00.000Z')
  })

  it('refuses to remind outside review (notReady)', () => {
    const { domain, ticketId, assignmentId } = readyDomain()
    // 继续追问离开 review 后不再提醒
    domain.ticketMessage({ ticketId, requestId: nextId('req'), text: '再改一版' })
    try {
      domain.markReviewReminded({ ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'notReady')
    }

    const fresh = readyDomain()
    fresh.domain.report({
      ticketId: fresh.ticketId,
      assignmentId: fresh.assignmentId,
      reportId: nextId('rep'),
      kind: 'failed',
      summary: '又失败了',
    })
    try {
      fresh.domain.markReviewReminded({ ticketId: fresh.ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'notReady')
    }
  })

  it('refuses to remind an ended ticket (ticketEnded)', () => {
    const { domain, ticketId } = readyDomain()
    domain.ticketAccept({ ticketId })
    try {
      domain.markReviewReminded({ ticketId })
      throw new Error('should have thrown')
    } catch (err) {
      expectCode(err, 'ticketEnded')
    }
  })
})
