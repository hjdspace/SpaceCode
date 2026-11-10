// @vitest-environment node
/**
 * 显式派工领域命令（T05 #75）。
 *
 * 覆盖：派工产生 Decision/Mandate/pending Assignment 审计链（basis 可追溯）、
 * request 幂等与冲突、launchAssignment pending→running、非 pending 拒绝启动、
 * 空标题/空目标的稳定错误码、派工后阶段为 working/queued。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'

const AT = '2026-01-01T00:00:00.000Z'

function makeDomain(): SuperAgentDomain {
  let counter = 0
  return createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })
}

function dispatchTicket(domain: SuperAgentDomain, requestId = 'dispatch-1') {
  return domain.dispatch({
    requestId,
    title: '修复登录',
    repoRoot: '/repo',
    text: '登录按钮点击后无响应，请排查并修复',
    actor: 'alice',
    contextPaths: ['src/login.ts'],
  })
}

describe('dispatch', () => {
  it('creates a Decision/Mandate/pending Assignment audit chain with traceable basis', () => {
    const domain = makeDomain()
    const result = dispatchTicket(domain)

    const { ticket, decision, mandate, assignment } = result
    expect(result.duplicate).toBe(false)

    // Decision：显式派工固定 accept/explicit/addressed，关联可追溯
    expect(decision.action).toBe('accept')
    expect(decision.strength).toBe('explicit')
    expect(decision.basis).toBe('addressed')
    expect(decision.source).toBe('desktop')
    expect(decision.human).toBe(true)
    expect(decision.actor).toBe('alice')
    expect(decision.policyVersion).toBe(1)
    expect(decision.ticketId).toBe(ticket.ticketId)
    expect(decision.triggerId).toBe(ticket.origin.triggerId)

    // Mandate：审计链与 Decision 字段一致
    expect(mandate.ticketId).toBe(ticket.ticketId)
    expect(mandate.strength).toBe('explicit')
    expect(mandate.basis).toBe('addressed')
    expect(mandate.policyVersion).toBe(decision.policyVersion)
    expect(mandate.scope).toEqual({ repoRoot: '/repo', paths: [] })

    // Assignment：pending 排队，尚未启动
    expect(assignment.ticketId).toBe(ticket.ticketId)
    expect(assignment.state).toBe('pending')
    expect(assignment.generation).toBe(1)
    expect(assignment.startedAt).toBeNull()

    // 决策入 state，可按 ticketId 追溯
    expect(domain.state.decisions[ticket.ticketId]).toEqual(decision)

    // 阶段派生：pending Assignment → working/queued
    expect(domain.stageOf(ticket.ticketId)).toBe('working/queued')
  })

  it('is idempotent on the same requestId and does not create a second assignment', () => {
    const domain = makeDomain()
    const first = dispatchTicket(domain, 'dispatch-1')
    const second = dispatchTicket(domain, 'dispatch-1')

    expect(second.duplicate).toBe(true)
    expect(second.ticket.ticketId).toBe(first.ticket.ticketId)
    expect(second.decision.decisionId).toBe(first.decision.decisionId)
    expect(second.assignment.assignmentId).toBe(first.assignment.assignmentId)
    expect(first.ticket.assignmentIds).toHaveLength(1)
  })

  it('rejects the same requestId with a different payload as a conflict', () => {
    const domain = makeDomain()
    dispatchTicket(domain, 'dispatch-1')

    expect(() =>
      domain.dispatch({
        requestId: 'dispatch-1',
        title: '另一个目标',
        repoRoot: '/repo',
        text: '不同的目标文本',
        actor: 'alice',
      }),
    ).toThrowError(expect.objectContaining({ code: 'conflict' }))
  })

  it('rejects blank title or text with the stable invalidDispatch code', () => {
    const domain = makeDomain()
    expect(() =>
      domain.dispatch({ requestId: 'd1', title: '  ', repoRoot: '/repo', text: '目标', actor: 'a' }),
    ).toThrowError(expect.objectContaining({ code: 'invalidDispatch' }))
    expect(() =>
      domain.dispatch({ requestId: 'd2', title: '标题', repoRoot: '/repo', text: '', actor: 'a' }),
    ).toThrowError(expect.objectContaining({ code: 'invalidDispatch' }))
  })

  it('refuses to resume the worker session of a ticket that is still active', () => {
    const domain = makeDomain()
    const source = dispatchTicket(domain, 'source')

    expect(() =>
      domain.dispatch({
        requestId: 'resume-active',
        title: '新任务',
        repoRoot: '/repo',
        text: '在旧会话上继续新任务',
        actor: 'alice',
        resumeTicketId: source.ticket.ticketId,
      } as Parameters<SuperAgentDomain['dispatch']>[0]),
    ).toThrowError(expect.objectContaining({ code: 'invalidDispatch' }))
  })

  it('refuses to share one ended worker session with another open ticket', () => {
    const domain = makeDomain()
    const source = dispatchTicket(domain, 'source')
    domain.launchAssignment({ assignmentId: source.assignment.assignmentId })
    domain.report({
      ticketId: source.ticket.ticketId,
      assignmentId: source.assignment.assignmentId,
      reportId: 'source-ready',
      kind: 'ready',
      summary: '待验收',
    })
    domain.ticketAccept({ ticketId: source.ticket.ticketId })
    domain.dispatch({
      requestId: 'resume-first',
      title: '第一张续聊工单',
      repoRoot: '/repo',
      text: '第一张新任务',
      actor: 'alice',
      resumeTicketId: source.ticket.ticketId,
    } as Parameters<SuperAgentDomain['dispatch']>[0])

    expect(() =>
      domain.dispatch({
        requestId: 'resume-second',
        title: '第二张续聊工单',
        repoRoot: '/repo',
        text: '第二张新任务',
        actor: 'alice',
        resumeTicketId: source.ticket.ticketId,
      } as Parameters<SuperAgentDomain['dispatch']>[0]),
    ).toThrowError(expect.objectContaining({ code: 'invalidDispatch' }))
  })

  it('keeps dispatched FIFO order by createdOrdinal', () => {
    const domain = makeDomain()
    const first = dispatchTicket(domain, 'd1')
    const second = dispatchTicket(domain, 'd2')

    expect(first.assignment.createdOrdinal).toBeLessThan(second.assignment.createdOrdinal)
  })
})

describe('launchAssignment', () => {
  it('moves a pending assignment to running and stamps startedAt', () => {
    const domain = makeDomain()
    const { assignment } = dispatchTicket(domain)

    const launched = domain.launchAssignment({ assignmentId: assignment.assignmentId })
    expect(launched.state).toBe('running')
    expect(launched.startedAt).toBe(AT)
    expect(domain.stageOf(launched.ticketId)).toBe('working')
  })

  it('refuses to launch an assignment that is not pending', () => {
    const domain = makeDomain()
    const { assignment } = dispatchTicket(domain)
    domain.launchAssignment({ assignmentId: assignment.assignmentId })

    expect(() => domain.launchAssignment({ assignmentId: assignment.assignmentId })).toThrowError(
      expect.objectContaining({ code: 'assignmentNotPending' }),
    )
  })

  it('refuses unknown assignments with the stable missing code', () => {
    const domain = makeDomain()
    expect(() => domain.launchAssignment({ assignmentId: 'assignment-404' })).toThrowError(
      expect.objectContaining({ code: 'assignmentNotFound' }),
    )
  })

  it('keeps startAssignment refusing while an assignment is pending', () => {
    const domain = makeDomain()
    const { ticket } = dispatchTicket(domain)

    expect(() => domain.startAssignment({ ticketId: ticket.ticketId })).toThrowError(
      expect.objectContaining({ code: 'notRetryable' }),
    )
  })
})
