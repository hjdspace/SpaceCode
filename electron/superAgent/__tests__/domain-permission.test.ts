// @vitest-environment node
/**
 * 权限 Attention（T23 #94）：Worker 的权限请求落成持久 Attention，按
 * sessionId+requestId 幂等；回答与撤回都只关闭对应的那一条，不碰问题类 Attention。
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

function setupRunningAssignment(domain: SuperAgentDomain) {
  const created = domain.createTicket({
    requestId: 'ticket-request-1',
    title: '修复登录',
    repoRoot: '/repo',
    trigger: {
      key: 'desktop-dispatch-1',
      source: 'desktop',
      threadIds: [],
      actor: 'alice',
      human: true,
      text: '修复登录失败的问题',
    },
  })
  const ticket = created.ticket
  const assignment = domain.startAssignment({ ticketId: ticket.ticketId })
  return { ticket, assignment }
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
    return '<no-error>'
  } catch (err) {
    return (err as { code?: string }).code ?? '<no-code>'
  }
}

describe('permission attention', () => {
  it('creates one open permission attention per sessionId+requestId with audit fields', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupRunningAssignment(domain)

    const first = domain.requestPermission({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      sessionId: 'session-1',
      requestId: 'permission-1',
      question: '权限请求：Edit（修改 src/a.ts）',
    })
    const second = domain.requestPermission({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      sessionId: 'session-1',
      requestId: 'permission-1',
      question: '权限请求：Edit（修改 src/a.ts）',
    })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(first.attention).toMatchObject({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      kind: 'permission',
      status: 'open',
      sessionId: 'session-1',
      requestId: 'permission-1',
      question: '权限请求：Edit（修改 src/a.ts）',
    })
    expect(second.attention.attentionId).toBe(first.attention.attentionId)
    expect(Object.values(domain.state.attentions)).toHaveLength(1)
  })

  it('answers a permission attention and clears the ticket pointer, idempotently', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupRunningAssignment(domain)
    const created = domain.requestPermission({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      sessionId: 'session-1',
      requestId: 'permission-1',
      question: '权限请求：Bash',
    })
    expect(ticket.attentionId).toBe(created.attention.attentionId)

    const first = domain.answerPermission({ attentionId: created.attention.attentionId })
    expect(first.attention.status).toBe('answered')
    expect(first.attention.answeredAt).toBe(AT)
    expect(first.duplicate).toBe(false)
    expect(ticket.attentionId).toBeNull()

    const second = domain.answerPermission({ attentionId: created.attention.attentionId })
    expect(second.duplicate).toBe(true)
    expect(second.attention.status).toBe('answered')
  })

  it('withdraws only the matching permission attention on request cancellation', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupRunningAssignment(domain)
    const permission = domain.requestPermission({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      sessionId: 'session-1',
      requestId: 'permission-1',
      question: '权限请求：Write',
    })

    const withdrawn = domain.withdrawPermission({
      sessionId: 'session-1',
      requestId: 'permission-1',
    })

    expect(withdrawn?.attentionId).toBe(permission.attention.attentionId)
    expect(withdrawn?.status).toBe('withdrawn')
    expect(ticket.attentionId).toBeNull()
    expect(
      domain.withdrawPermission({ sessionId: 'session-1', requestId: 'permission-other' }),
    ).toBeNull()
  })

  it('refuses to treat a question attention as a permission answer', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupRunningAssignment(domain)
    const asker = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-asker',
      kind: 'text',
      human: true,
      text: '要不要保留旧接口？',
    }).input
    const asked = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-question',
      kind: 'blocked',
      summary: '等待确认',
      question: '要不要保留旧接口？',
      askedBy: asker.inputId,
    })

    expect(codeOf(() =>
      domain.answerPermission({ attentionId: asked.attentionId as string }),
    )).toBe('notPermission')
  })

  it('withdraws unanswered permission attentions when the ticket stops', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupRunningAssignment(domain)
    const created = domain.requestPermission({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      sessionId: 'session-1',
      requestId: 'permission-1',
      question: '权限请求：Edit',
    })

    domain.ticketStop({ ticketId: ticket.ticketId, reason: '人工停止' })

    expect(domain.state.attentions[created.attention.attentionId]?.status).toBe('withdrawn')
    expect(codeOf(() =>
      domain.requestPermission({
        ticketId: ticket.ticketId,
        assignmentId: assignment.assignmentId,
        sessionId: 'session-1',
        requestId: 'permission-2',
        question: '权限请求：Edit',
      }),
    )).toBe('ticketEnded')
  })
})
