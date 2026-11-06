// @vitest-environment node
/**
 * Ticket 阶段派生（T03 #73）。
 *
 * 阶段是纯派生值：只由 Ticket 的 ending、delivery、Attention、Assignment 与 Input
 * 这些领域事实决定，不读取 `ticket.stage` 之类的双写字段。这里逐条覆盖
 * docs/design/super-agent-implementation-plan.md §5.2 的优先级表，包括
 * 「最新 Assignment 已 ended 且之后没有新 Input → idle」这一分支。
 */
import { describe, expect, it } from 'vitest'
import type {
  SuperAgentAssignment,
  SuperAgentAttention,
  SuperAgentInput,
  SuperAgentTicket,
} from '../model'
import { deriveTicketStage, waitsForPerson, type TicketStageFacts } from '../stage'

const TICKET_ID = 'ticket-1'

function makeTicket(overrides: Partial<SuperAgentTicket> = {}): SuperAgentTicket {
  return {
    ticketId: TICKET_ID,
    title: '修复登录',
    state: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: { triggerId: 'trigger-1', triggerIds: ['trigger-1'] },
    mandateId: 'mandate-1',
    threadId: 'thread-1',
    assignmentIds: ['assignment-1'],
    inputIds: [],
    answers: [],
    attentionId: null,
    execution: { name: 'main', directory: '/repo', assignmentId: 'assignment-1' },
    follows: [],
    delivery: null,
    undelivered: [],
    reviewRemindedAt: null,
    ended: null,
    ...overrides,
  }
}

function makeAssignment(overrides: Partial<SuperAgentAssignment> = {}): SuperAgentAssignment {
  return {
    assignmentId: 'assignment-1',
    ticketId: TICKET_ID,
    generation: 1,
    state: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    endedReason: null,
    createdOrdinal: 10,
    endedOrdinal: null,
    report: null,
    deliveredAt: null,
    idleAt: null,
    ...overrides,
  }
}

function makeInput(overrides: Partial<SuperAgentInput> = {}): SuperAgentInput {
  return {
    inputId: 'input-1',
    ticketId: TICKET_ID,
    ordinal: 20,
    kind: 'text',
    status: 'delivered',
    human: true,
    context: false,
    note: null,
    text: '继续',
    triggerId: null,
    requestId: null,
    at: '2026-01-01T00:00:00.000Z',
    readAt: null,
    deliveredTo: 'assignment-1',
    deliveredAt: '2026-01-01T00:00:00.000Z',
    releasedAt: null,
    ...overrides,
  }
}

function makeAttention(overrides: Partial<SuperAgentAttention> = {}): SuperAgentAttention {
  return {
    attentionId: 'attention-1',
    ticketId: TICKET_ID,
    assignmentId: 'assignment-1',
    kind: 'question',
    question: '要保留旧接口吗？',
    askedBy: 'input-1',
    askedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    answers: [],
    answeredAt: null,
    sessionId: null,
    requestId: null,
    ...overrides,
  }
}

function facts(overrides: Partial<TicketStageFacts> = {}): TicketStageFacts {
  return {
    ticket: makeTicket(),
    assignments: [makeAssignment()],
    inputs: [],
    attentions: [],
    ...overrides,
  }
}

describe('deriveTicketStage', () => {
  it('returns the ending stage first, before delivery and attention', () => {
    const withOpenAttention = facts({
      ticket: makeTicket({
        state: 'ended',
        ended: {
          at: '2026-01-02T00:00:00.000Z',
          by: 'user',
          outcome: 'stopped',
          reason: 'user stop',
        },
        delivery: { inputId: 'input-1', error: 'boom', at: '2026-01-02T00:00:00.000Z' },
      }),
      attentions: [makeAttention()],
    })

    expect(deriveTicketStage(withOpenAttention)).toBe('stopped')
  })

  it.each([
    ['completed', 'completed'],
    ['dropped', 'dropped'],
    ['stopped', 'stopped'],
    ['merged', 'completed'],
    ['closed', 'completed'],
  ] as const)('maps ended outcome %s to %s', (outcome, stage) => {
    const view = facts({
      ticket: makeTicket({
        state: 'ended',
        ended: { at: '2026-01-02T00:00:00.000Z', by: 'worker', outcome, reason: 'done' },
      }),
    })

    expect(deriveTicketStage(view)).toBe(stage)
  })

  it('reports delivery failure before an unanswered attention', () => {
    const view = facts({
      ticket: makeTicket({
        delivery: { inputId: 'input-1', error: 'channel closed', at: '2026-01-02T00:00:00.000Z' },
      }),
      attentions: [makeAttention()],
    })

    expect(deriveTicketStage(view)).toBe('person/delivery')
  })

  it('reports person/answer while an attention is open', () => {
    const view = facts({ attentions: [makeAttention()] })

    expect(deriveTicketStage(view)).toBe('person/answer')
  })

  it('ignores answered and withdrawn attentions', () => {
    const view = facts({
      attentions: [
        makeAttention({ status: 'answered', answeredAt: '2026-01-02T00:00:00.000Z' }),
        makeAttention({ attentionId: 'attention-2', status: 'withdrawn' }),
      ],
    })

    expect(deriveTicketStage(view)).not.toBe('person/answer')
  })

  it.each([
    ['ready', 'person/answer'],
    ['blocked', 'person/answer'],
    ['failed', 'person/answer'],
  ] as const)('lets an open attention win over a %s report', (kind, stage) => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind,
            summary: 'report with question',
            at: '2026-01-02T00:00:00.000Z',
            question: '要保留旧接口吗？',
            askedBy: 'input-1',
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      attentions: [makeAttention()],
    })

    expect(deriveTicketStage(view)).toBe(stage)
  })

  it('reports person/review for a ready report without later input', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'ready',
            summary: 'done',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
          idleAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
    })

    expect(deriveTicketStage(view)).toBe('person/review')
  })

  it('does not leave review for a context-only input after the ready report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'ready',
            summary: 'done',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31, context: true, human: false, kind: 'trigger' })],
    })

    expect(deriveTicketStage(view)).toBe('person/review')
  })

  it('does not leave blocked handoff for a context-only input after the report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'blocked',
            summary: 'need help',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31, context: true, kind: 'trigger' })],
    })

    expect(deriveTicketStage(view)).toBe('person/blocked')
  })

  it('leaves review once a human message arrives after the ready report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'ready',
            summary: 'done',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31 })],
    })

    expect(deriveTicketStage(view)).toBe('working')
  })

  it.each([
    ['blocked', 'person/blocked'],
    ['failed', 'person/failed'],
  ] as const)('reports %s as person handoff while no human message follows', (kind, stage) => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind,
            summary: 'need help',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
    })

    expect(deriveTicketStage(view)).toBe(stage)
  })

  it.each(['blocked', 'failed'] as const)(
    'leaves %s handoff once a human message arrives after the report',
    (kind) => {
      const view = facts({
        assignments: [
          makeAssignment({
            report: {
              reportId: 'report-1',
              assignmentId: 'assignment-1',
              ticketId: TICKET_ID,
              ordinal: 30,
              kind,
              summary: 'need help',
              at: '2026-01-02T00:00:00.000Z',
              question: null,
              askedBy: null,
              answers: [],
              details: null,
              artifacts: [],
            },
          }),
        ],
        inputs: [makeInput({ ordinal: 31 })],
      })

      expect(deriveTicketStage(view)).toBe('working')
    },
  )

  it('does not count automatic inputs as clearing a blocked/failed handoff', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'blocked',
            summary: 'need help',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31, human: false, kind: 'trigger' })],
    })

    expect(deriveTicketStage(view)).toBe('person/blocked')
  })

  it('derives working/queued when no assignment exists', () => {
    const view = facts({
      ticket: makeTicket({ assignmentIds: [], execution: { name: 'main', directory: '/repo', assignmentId: null } }),
      assignments: [],
    })

    expect(deriveTicketStage(view)).toBe('working/queued')
  })

  it('derives working/queued for a pending assignment', () => {
    const view = facts({ assignments: [makeAssignment({ state: 'pending', startedAt: null })] })

    expect(deriveTicketStage(view)).toBe('working/queued')
  })

  it('derives idle from a waiting report without later input', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'waiting',
            summary: 'idle',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
          idleAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
    })

    expect(deriveTicketStage(view)).toBe('idle')
  })

  it('leaves idle once input arrives after the waiting report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'waiting',
            summary: 'idle',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31 })],
    })

    expect(deriveTicketStage(view)).toBe('working')
  })

  it('stays idle when only a context-only input arrives after the waiting report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'waiting',
            summary: 'idle',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31, context: true, human: false, kind: 'trigger' })],
    })

    expect(deriveTicketStage(view)).toBe('idle')
  })

  it('derives idle for an ended assignment without a final report and no later input', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          state: 'ended',
          endedAt: '2026-01-02T00:00:00.000Z',
          endedReason: 'completed',
          endedOrdinal: 30,
        }),
      ],
    })

    expect(deriveTicketStage(view)).toBe('idle')
  })

  it('leaves idle when input arrives after the assignment ended', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          state: 'ended',
          endedAt: '2026-01-02T00:00:00.000Z',
          endedReason: 'completed',
          endedOrdinal: 30,
        }),
      ],
      inputs: [makeInput({ ordinal: 31 })],
    })

    expect(deriveTicketStage(view)).toBe('working')
  })

  it('uses the latest assignment by generation, not array order', () => {
    const view = facts({
      ticket: makeTicket({ assignmentIds: ['assignment-1', 'assignment-2'] }),
      assignments: [
        makeAssignment({
          assignmentId: 'assignment-2',
          generation: 2,
          state: 'pending',
          startedAt: null,
          report: null,
        }),
        makeAssignment({
          assignmentId: 'assignment-1',
          generation: 1,
          state: 'ended',
          endedOrdinal: 40,
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'ready',
            summary: 'done',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
    })

    expect(deriveTicketStage(view)).toBe('working/queued')
  })

  it('derives working for a running assignment with a progress report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'progress',
            summary: 'half way',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
    })

    expect(deriveTicketStage(view)).toBe('working')
  })

  it('derives working for a running assignment without a report', () => {
    expect(deriveTicketStage(facts())).toBe('working')
  })
})

describe('waitsForPerson', () => {
  it('is true while the latest report is blocked/failed and no human input follows', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'failed',
            summary: 'broken',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
    })

    expect(waitsForPerson(view)).toBe(true)
  })

  it('is false after a human input follows the report', () => {
    const view = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'blocked',
            summary: 'need help',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31 })],
    })

    expect(waitsForPerson(view)).toBe(false)
  })

  it('stays true when the following human input never reached the worker', () => {
    // 代次已 interrupted 时 addInput 把消息落成永久 pending。把它算成"人已经说过了"
    // 会同时骗到两处：闸门被一条没送出去的消息解除，阶段刷成执行中、重试入口消失，
    // 而现场根本没有进程在跑。
    const view = facts({
      assignments: [
        makeAssignment({
          state: 'interrupted',
          endedOrdinal: 25,
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'failed',
            summary: 'broken',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
      inputs: [makeInput({ ordinal: 31, status: 'pending', deliveredAt: null, deliveredTo: null })],
    })

    expect(waitsForPerson(view)).toBe(true)
    expect(deriveTicketStage(view)).toBe('person/failed')
  })

  it('is false for a waiting report and for an ended ticket', () => {
    const waiting = facts({
      assignments: [
        makeAssignment({
          report: {
            reportId: 'report-1',
            assignmentId: 'assignment-1',
            ticketId: TICKET_ID,
            ordinal: 30,
            kind: 'waiting',
            summary: 'idle',
            at: '2026-01-02T00:00:00.000Z',
            question: null,
            askedBy: null,
            answers: [],
            details: null,
            artifacts: [],
          },
        }),
      ],
    })
    const ended = facts({
      ticket: makeTicket({
        state: 'ended',
        ended: { at: '2026-01-02T00:00:00.000Z', by: 'user', outcome: 'stopped', reason: 'stop' },
      }),
    })

    expect(waitsForPerson(waiting)).toBe(false)
    expect(waitsForPerson(ended)).toBe(false)
  })
})
