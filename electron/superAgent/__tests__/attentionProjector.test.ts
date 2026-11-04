// @vitest-environment node
/**
 * Attention 投影（T08 #78）。
 *
 * 覆盖：question 触发 asked 事件（含工单溯源标题）；就地回答在 open 期间
 * 刷新视图（asked）；Worker 认领触发 answered；替换触发 withdrawn→asked
 * 且旧气泡在前；无变化不重复广播；pendingTickets 按工单去重。
 */
import { describe, expect, it } from 'vitest'
import type { SuperAgentAttentionEvent } from '@/shared/channels/superAgent'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import { createSuperAgentAttentionProjector } from '../attentionProjector'

const AT = '2026-01-01T00:00:00.000Z'

function makeDomain(): SuperAgentDomain {
  let counter = 0
  return createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })
}

function setupTicketWithAssignment(domain: SuperAgentDomain, title: string) {
  const created = domain.createTicket({
    requestId: `ticket-request-${title}`,
    title,
    repoRoot: '/repo',
    trigger: {
      key: `desktop-${title}`,
      source: 'desktop',
      threadIds: [],
      actor: 'alice',
      human: true,
      text: `${title}的问题`,
    },
  })
  const assignment = domain.startAssignment({ ticketId: created.ticket.ticketId })
  return { ticket: created.ticket, assignment }
}

function askQuestion(
  domain: SuperAgentDomain,
  ticketId: string,
  assignmentId: string,
  question: string,
  reportId: string,
) {
  const asker = domain.addInput({
    ticketId,
    requestId: `request-${reportId}`,
    kind: 'text',
    human: true,
    text: question,
  }).input
  return domain.report({
    ticketId,
    assignmentId,
    reportId,
    kind: 'blocked',
    summary: '等待确认',
    question,
    askedBy: asker.inputId,
  })
}

describe('createSuperAgentAttentionProjector', () => {
  it('emits an asked event with ticket traceability when a question opens an attention', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupTicketWithAssignment(domain, '修复登录')
    const events: SuperAgentAttentionEvent[] = []
    const projector = createSuperAgentAttentionProjector({
      domain,
      repoRoot: '/repo',
      onAttentionEvent: (event) => events.push(event),
    })

    askQuestion(domain, ticket.ticketId, assignment.assignmentId, '旧接口还要保留吗？', 'report-1')
    const emitted = projector.sync()

    expect(emitted).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      repoRoot: '/repo',
      reason: 'asked',
      pendingTickets: 1,
      attention: {
        ticketId: ticket.ticketId,
        ticketTitle: '修复登录',
        kind: 'question',
        question: '旧接口还要保留吗？',
        status: 'open',
        answers: [],
      },
    })
    expect(emitted[0].attentions).toHaveLength(1)
  })

  it('does not emit when nothing changed', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupTicketWithAssignment(domain, '修复登录')
    const projector = createSuperAgentAttentionProjector({
      domain,
      repoRoot: '/repo',
      onAttentionEvent: () => {},
    })
    askQuestion(domain, ticket.ticketId, assignment.assignmentId, 'Q1', 'report-1')
    projector.sync()

    expect(projector.sync()).toEqual([])
  })

  it('refreshes the open view (asked) when the human submits an in-place answer', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupTicketWithAssignment(domain, '修复登录')
    const asked = askQuestion(domain, ticket.ticketId, assignment.assignmentId, 'Q1', 'report-1')
    const projector = createSuperAgentAttentionProjector({
      domain,
      repoRoot: '/repo',
      onAttentionEvent: () => {},
    })
    projector.sync()

    const answered = domain.answerAttention({
      attentionId: asked.attentionId as string,
      requestId: 'request-answer',
      text: '保留，别删',
    })
    const emitted = projector.sync()

    expect(emitted).toHaveLength(1)
    expect(emitted[0].reason).toBe('asked')
    expect(emitted[0].attention.status).toBe('open')
    expect(emitted[0].attention.answers).toEqual([answered.input.inputId])
  })

  it('emits answered when the worker claims the submitted answer', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupTicketWithAssignment(domain, '修复登录')
    const asked = askQuestion(domain, ticket.ticketId, assignment.assignmentId, 'Q1', 'report-1')
    const answered = domain.answerAttention({
      attentionId: asked.attentionId as string,
      requestId: 'request-answer',
      text: '保留，别删',
    })
    const projector = createSuperAgentAttentionProjector({
      domain,
      repoRoot: '/repo',
      onAttentionEvent: () => {},
    })
    projector.sync()

    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-claim',
      kind: 'waiting',
      summary: '已按回答继续',
      answers: [answered.input.inputId],
    })
    const emitted = projector.sync()

    expect(emitted).toHaveLength(1)
    expect(emitted[0].reason).toBe('answered')
    expect(emitted[0].attention.status).toBe('answered')
    expect(emitted[0].pendingTickets).toBe(0)
  })

  it('emits withdrawn for the replaced attention before asked for the new one', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupTicketWithAssignment(domain, '修复登录')
    const asked = askQuestion(domain, ticket.ticketId, assignment.assignmentId, 'Q1', 'report-1')
    const projector = createSuperAgentAttentionProjector({
      domain,
      repoRoot: '/repo',
      onAttentionEvent: () => {},
    })
    projector.sync()

    const replaced = askQuestion(domain, ticket.ticketId, assignment.assignmentId, 'Q2', 'report-2')
    const emitted = projector.sync()

    expect(emitted.map((event) => event.reason)).toEqual(['withdrawn', 'asked'])
    expect(emitted[0].attention.attentionId).toBe(asked.attentionId)
    expect(emitted[1].attention.attentionId).toBe(replaced.attentionId)
    expect(emitted[1].attentions).toHaveLength(2)
  })

  it('dedupes pending tickets by ticket and exposes views for the board', () => {
    const domain = makeDomain()
    const first = setupTicketWithAssignment(domain, '修复登录')
    const second = setupTicketWithAssignment(domain, '优化构建')
    askQuestion(domain, first.ticket.ticketId, first.assignment.assignmentId, 'Q1', 'report-1')
    const repeated = askQuestion(
      domain,
      first.ticket.ticketId,
      first.assignment.assignmentId,
      'Q1-again',
      'report-2',
    )
    askQuestion(domain, second.ticket.ticketId, second.assignment.assignmentId, 'Q2', 'report-3')
    const projector = createSuperAgentAttentionProjector({
      domain,
      repoRoot: '/repo',
      onAttentionEvent: () => {},
    })

    expect(projector.pendingTickets()).toBe(2)
    expect(projector.views()).toHaveLength(3)
    // Q1 被替换后撤回，同一工单只剩 Q1-again 处于 open；另一工单 Q2 open。
    expect(projector.views().map((view) => view.status)).toEqual(['withdrawn', 'open', 'open'])
    expect(repeated.attentionId).toBeTruthy()
  })
})
