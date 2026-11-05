// @vitest-environment node
/**
 * Attention 问答链路（T08 #78）。
 *
 * 覆盖：attentionAnswer 把回答落成领域 Input 并投递给对应 Worker（等待认领）、
 * requestId 幂等、非 open / 未知 Attention 与空回答的稳定错误码；Worker 用
 * answers 认领已提交回答后 Attention 关闭；相同问题只提醒一次（不新建、
 * 不撤回）；不同问题替换时旧 Attention 撤回。全部经公开命令验证。
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

function codeOf(fn: () => unknown): string {
  try {
    fn()
    return '<no-error>'
  } catch (err) {
    return (err as { code?: string }).code ?? '<no-code>'
  }
}

function setupOpenAttention(domain: SuperAgentDomain, question = '旧接口还要保留吗？') {
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
  const asker = domain.addInput({
    ticketId: ticket.ticketId,
    requestId: 'request-asker',
    kind: 'text',
    human: true,
    text: question,
  }).input
  const asked = domain.report({
    ticketId: ticket.ticketId,
    assignmentId: assignment.assignmentId,
    reportId: 'report-question',
    kind: 'blocked',
    summary: '等待确认',
    question,
    askedBy: asker.inputId,
  })
  return { ticket, assignment, asker, attentionId: asked.attentionId as string }
}

describe('answerAttention', () => {
  it('records the answer as a human input delivered to the worker and keeps the attention open awaiting claim', () => {
    const domain = makeDomain()
    const { ticket, attentionId } = setupOpenAttention(domain)

    const answered = domain.answerAttention({
      attentionId,
      requestId: 'request-answer',
      text: '保留，别删',
    })

    expect(answered.duplicate).toBe(false)
    expect(answered.delivered).toBe(true)
    expect(answered.gated).toBe(false)
    expect(answered.input).toMatchObject({
      ticketId: ticket.ticketId,
      kind: 'text',
      human: true,
      text: '保留，别删',
      status: 'delivered',
    })
    expect(answered.attention.status).toBe('open')
    expect(answered.attention.answers).toEqual([answered.input.inputId])
    expect(answered.attention.askedBy).not.toBe(answered.input.inputId)
    expect(domain.stageOf(ticket.ticketId)).toBe('person/answer')
  })

  it('is idempotent by requestId and does not append the answer twice', () => {
    const domain = makeDomain()
    const { attentionId } = setupOpenAttention(domain)

    const first = domain.answerAttention({
      attentionId,
      requestId: 'request-answer',
      text: '保留，别删',
    })
    const second = domain.answerAttention({
      attentionId,
      requestId: 'request-answer',
      text: '保留，别删',
    })

    expect(second.duplicate).toBe(true)
    expect(second.input.inputId).toBe(first.input.inputId)
    expect(second.attention.answers).toEqual([first.input.inputId])
    expect(
      Object.values(domain.state.inputs).filter((input) => input.text === '保留，别删'),
    ).toHaveLength(1)
  })

  it('rejects unknown or no-longer-open attentions with stable codes', () => {
    const domain = makeDomain()
    const { attentionId } = setupOpenAttention(domain)

    expect(
      codeOf(() =>
        domain.answerAttention({ attentionId: 'attention-missing', requestId: 'r1', text: 'x' }),
      ),
    ).toBe('notAttention')
    expect(
      codeOf(() => domain.answerAttention({ attentionId, requestId: 'r2', text: '   ' })),
    ).toBe('invalidAnswer')
  })

  it('rejects answering an attention that was withdrawn by a replacing question', () => {
    const domain = makeDomain()
    const { ticket, assignment, attentionId } = setupOpenAttention(domain)
    const asker = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-asker-2',
      kind: 'text',
      human: true,
      text: '新问题',
    }).input
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-question-2',
      kind: 'blocked',
      summary: '改问另一个问题',
      question: '数据库用哪个？',
      askedBy: asker.inputId,
    })

    expect(domain.state.attentions[attentionId].status).toBe('withdrawn')
    expect(
      codeOf(() =>
        domain.answerAttention({ attentionId, requestId: 'r3', text: '太迟了' }),
      ),
    ).toBe('notAttention')
  })
})

describe('answer claim', () => {
  it('closes the attention when the worker claims a submitted answer input', () => {
    const domain = makeDomain()
    const { ticket, assignment, attentionId } = setupOpenAttention(domain)
    const answered = domain.answerAttention({
      attentionId,
      requestId: 'request-answer',
      text: '保留，别删',
    })

    const claimed = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-claim',
      kind: 'waiting',
      summary: '已按回答继续',
      answers: [answered.input.inputId],
    })

    expect(claimed.attentionId).toBe(attentionId)
    expect(domain.state.attentions[attentionId]).toMatchObject({
      status: 'answered',
      answers: [answered.input.inputId],
      answeredAt: AT,
    })
    expect(domain.state.tickets[ticket.ticketId].answers).toEqual([answered.input.inputId])
    expect(domain.state.tickets[ticket.ticketId].attentionId).toBeNull()
    expect(domain.stageOf(ticket.ticketId)).not.toBe('person/answer')
  })

  it('still rejects answers that were never bound to an open attention', () => {
    const domain = makeDomain()
    const { ticket, assignment } = setupOpenAttention(domain)
    const stray = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-stray',
      kind: 'text',
      human: true,
      text: '顺便改下文案',
    }).input

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-claim-stray',
          kind: 'waiting',
          summary: '完成',
          answers: [stray.inputId],
        }),
      ),
    ).toBe('notAnswerable')
  })
})

describe('question dedup and replacement', () => {
  it('does not create a second attention when the same open question is reported again', () => {
    const domain = makeDomain()
    const { ticket, assignment, attentionId } = setupOpenAttention(domain)

    const repeated = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-question-repeat',
      kind: 'blocked',
      summary: '再次提醒同一问题',
      question: '旧接口还要保留吗？',
      askedBy: domain.state.attentions[attentionId].askedBy,
    })

    expect(repeated.attentionId).toBe(attentionId)
    expect(Object.keys(domain.state.attentions)).toHaveLength(1)
    expect(domain.state.attentions[attentionId].status).toBe('open')
  })

  it('withdraws the old attention when a different question replaces it', () => {
    const domain = makeDomain()
    const { ticket, assignment, attentionId } = setupOpenAttention(domain)
    const asker = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-asker-2',
      kind: 'text',
      human: true,
      text: '改问另一个问题',
    }).input

    const replaced = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-question-2',
      kind: 'blocked',
      summary: '改问另一个问题',
      question: '数据库用哪个？',
      askedBy: asker.inputId,
    })

    expect(replaced.attentionId).not.toBe(attentionId)
    expect(domain.state.attentions[attentionId].status).toBe('withdrawn')
    expect(domain.state.attentions[replaced.attentionId as string].status).toBe('open')
    expect(domain.state.tickets[ticket.ticketId].attentionId).toBe(replaced.attentionId)
  })
})
