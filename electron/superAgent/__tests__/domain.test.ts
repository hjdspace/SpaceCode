// @vitest-environment node
/**
 * 单写者领域状态机（T03 #73）。
 *
 * 覆盖：Trigger/request/report 幂等键、blocked/failed 输入闸门、人工消息复用原
 * Assignment、结束迁移清理 Attention/delivery 并释放未裁决人消息、Report 交叉校验。
 * 所有行为都通过公开命令验证，不直接改写内部状态。
 */
import { describe, expect, it } from 'vitest'
import {
  createSuperAgentDomain,
  idempotencyKey,
  type SuperAgentDomain,
} from '../domain'

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

function createDesktopTicket(domain: SuperAgentDomain, requestId = 'ticket-request-1') {
  return domain.createTicket({
    requestId,
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
}

function startFirstAssignment(domain: SuperAgentDomain, ticketId: string) {
  return domain.startAssignment({ ticketId })
}

function reportBlocked(
  domain: SuperAgentDomain,
  ticketId: string,
  assignmentId: string,
  reportId = 'report-blocked-1',
) {
  return domain.report({
    ticketId,
    assignmentId,
    reportId,
    kind: 'blocked',
    summary: '需要确认接口兼容性',
  })
}

describe('idempotencyKey', () => {
  it('builds stable keys for event, request, report and outbox message facts', () => {
    expect(idempotencyKey('event', 'im:msg-1')).toBe('event:im:msg-1')
    expect(idempotencyKey('request', 'req-1')).toBe('request:req-1')
    expect(idempotencyKey('report', 'assignment-1', 'report-1')).toBe('report:assignment-1:report-1')
    expect(idempotencyKey('message', 'outbox-1')).toBe('message:outbox-1')
  })

  it('rejects blank key parts so repeated facts cannot collide on an empty key', () => {
    expect(() => idempotencyKey('event', '')).toThrow()
    expect(() => idempotencyKey('report', 'assignment-1', ' ')).toThrow()
  })
})

describe('trigger intake', () => {
  it('stores a trigger once and returns the original result for the same event key', () => {
    const domain = makeDomain()
    const draft = {
      key: 'im:msg-1',
      source: 'im',
      threadIds: ['thread-a'],
      actor: 'alice',
      human: true,
      addressed: 'mention' as const,
      text: '登录页报错了',
    }

    const first = domain.intakeTrigger(draft)
    const second = domain.intakeTrigger({ ...draft, text: '登录页报错了（重复投递）' })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.trigger.triggerId).toBe(first.trigger.triggerId)
    expect(Object.keys(domain.state.triggers)).toHaveLength(1)
    expect(first.trigger).toMatchObject({
      source: 'im',
      human: true,
      addressed: 'mention',
      threadIds: ['thread-a'],
      disposition: { ticketIds: [], handedBack: false },
    })
    expect(domain.state.threads['thread-a'].triggerIds).toEqual([first.trigger.triggerId])
    expect(domain.state.threads['thread-a'].pendingTriggerIds).toEqual([first.trigger.triggerId])
  })

  it('reuses the original thread even when a duplicate event carries edited text', () => {
    const domain = makeDomain()
    const first = domain.intakeTrigger({
      key: 'im:msg-1',
      source: 'im',
      threadIds: ['thread-a'],
      actor: 'alice',
      human: true,
      text: '原文',
    })
    const second = domain.intakeTrigger({
      key: 'im:msg-1',
      source: 'im',
      threadIds: ['thread-a'],
      actor: 'alice',
      human: true,
      text: '编辑后的文本',
    })

    expect(second.duplicate).toBe(true)
    expect(second.trigger.text).toBe('原文')
    expect(domain.state.threads['thread-a'].triggerIds).toEqual([first.trigger.triggerId])
  })
})

describe('ticket creation', () => {
  it('creates ticket, mandate, thread and subscription atomically', () => {
    const domain = makeDomain()

    const created = createDesktopTicket(domain)

    expect(created.duplicate).toBe(false)
    expect(created.ticket).toMatchObject({
      title: '修复登录',
      state: 'open',
      mandateId: created.mandate.mandateId,
      threadId: created.thread.threadId,
      assignmentIds: [],
      inputIds: [],
      answers: [],
      attentionId: null,
      ended: null,
      reviewRemindedAt: null,
    })
    expect(created.mandate).toMatchObject({
      ticketId: created.ticket.ticketId,
      policyVersion: 1,
      strength: 'explicit',
      basis: 'addressed',
      actor: 'alice',
      scope: { repoRoot: '/repo', paths: [] },
      revokedAt: null,
    })
    expect(created.thread.subscriptions).toEqual([
      { ticketId: created.ticket.ticketId, attachedAt: AT, contextOnly: false },
    ])
    const trigger = Object.values(domain.state.triggers)[0]
    expect(trigger.disposition.ticketIds).toEqual([created.ticket.ticketId])
    expect(domain.state.tickets[created.ticket.ticketId]).toBeDefined()
    expect(domain.stageOf(created.ticket.ticketId)).toBe('working/queued')
  })

  it('returns the original ticket for a repeated requestId and refuses a different payload', () => {
    const domain = makeDomain()

    const first = createDesktopTicket(domain, 'request-1')
    const second = createDesktopTicket(domain, 'request-1')

    expect(second.duplicate).toBe(true)
    expect(second.ticket.ticketId).toBe(first.ticket.ticketId)
    expect(Object.keys(domain.state.tickets)).toHaveLength(1)
    expect(Object.keys(domain.state.mandates)).toHaveLength(1)

    expect(
      codeOf(() =>
        domain.createTicket({
          requestId: 'request-1',
          title: '另一个标题',
          repoRoot: '/repo',
          trigger: {
            key: 'desktop-dispatch-2',
            source: 'desktop',
            threadIds: [],
            actor: 'alice',
            human: true,
            text: '不同工单',
          },
        }),
      ),
    ).toBe('conflict')
  })
})

describe('assignment generations', () => {
  it('starts generation 1 and increments only when a new assignment is created', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)

    const first = startFirstAssignment(domain, ticket.ticketId)

    expect(first).toMatchObject({
      ticketId: ticket.ticketId,
      generation: 1,
      state: 'running',
      endedAt: null,
      endedOrdinal: null,
      report: null,
    })
    expect(domain.state.tickets[ticket.ticketId].assignmentIds).toEqual([first.assignmentId])
    expect(domain.stageOf(ticket.ticketId)).toBe('working')

    expect(codeOf(() => domain.startAssignment({ ticketId: ticket.ticketId }))).toBe('notRetryable')

    domain.endAssignment({ assignmentId: first.assignmentId, reason: 'completed' })
    const second = domain.startAssignment({ ticketId: ticket.ticketId })

    expect(second.generation).toBe(2)
    expect(second.assignmentId).not.toBe(first.assignmentId)
    expect(domain.state.assignments[first.assignmentId].endedOrdinal).not.toBeNull()
  })
})

describe('report validation', () => {
  it('rejects ready reports that also carry a question', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'ready',
          summary: '完成',
          question: '还要改文档吗？',
          askedBy: 'input-1',
        }),
      ),
    ).toBe('questionWithResult')
  })

  it('rejects a question without an asker input', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'blocked',
          summary: '等待答复',
          question: '接口兼容吗？',
        }),
      ),
    ).toBe('askerWithoutQuestion')
  })

  it('rejects a question whose asker is not a human input of this ticket', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'blocked',
          summary: '等待答复',
          question: '接口兼容吗？',
          askedBy: 'input-missing',
        }),
      ),
    ).toBe('notAsker')
  })

  it('rejects answers that were never asked by the worker', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    const input = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'input-1',
      kind: 'text',
      human: true,
      text: '顺便改下文案',
    }).input

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'waiting',
          summary: '完成',
          answers: [input.inputId],
        }),
      ),
    ).toBe('notAnswerable')
  })

  it('rejects a report from an ended assignment', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    domain.endAssignment({ assignmentId: assignment.assignmentId, reason: 'completed' })

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'waiting',
          summary: '完成',
        }),
      ),
    ).toBe('assignmentEnded')
  })

  it('rejects a report whose assignment belongs to another ticket', () => {
    const domain = makeDomain()
    const first = createDesktopTicket(domain, 'request-1')
    const second = createDesktopTicket(domain, 'request-2')
    const assignment = startFirstAssignment(domain, first.ticket.ticketId)

    expect(
      codeOf(() =>
        domain.report({
          ticketId: second.ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'waiting',
          summary: '完成',
        }),
      ),
    ).toBe('assignmentNotFound')
  })

  it('rejects a report for an ended ticket', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    domain.endTicket({ ticketId: ticket.ticketId, outcome: 'stopped', by: 'user', reason: '人工停止' })

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'waiting',
          summary: '完成',
        }),
      ),
    ).toBe('ticketEnded')
  })
})

describe('report idempotency', () => {
  it('returns the original report for a repeated assignmentId+reportId fact', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    const command = {
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'waiting' as const,
      summary: '完成第一轮',
    }

    const first = domain.report(command)
    const second = domain.report(command)

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.report.reportId).toBe('report-1')
    expect(Object.keys(domain.state.reports)).toHaveLength(1)
    expect(domain.state.assignments[assignment.assignmentId].report?.summary).toBe('完成第一轮')
  })

  it('refuses a repeated assignmentId+reportId with a different payload', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'waiting',
      summary: '完成第一轮',
    })

    expect(
      codeOf(() =>
        domain.report({
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          reportId: 'report-1',
          kind: 'waiting',
          summary: '不同结果',
        }),
      ),
    ).toBe('conflict')
  })
})

describe('attention lifecycle', () => {
  it('opens an attention from a question and lets a later report claim the answer', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    const question = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-question',
      kind: 'text',
      human: true,
      text: '旧接口还要保留吗？',
    }).input

    const asked = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'blocked',
      summary: '等待确认',
      question: '旧接口还要保留吗？',
      askedBy: question.inputId,
    })

    expect(asked.attentionId).toBeTruthy()
    expect(domain.stageOf(ticket.ticketId)).toBe('person/answer')
    expect(domain.state.attentions[asked.attentionId as string]).toMatchObject({
      askedBy: question.inputId,
      status: 'open',
      answers: [],
    })

    const answered = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-2',
      kind: 'waiting',
      summary: '已按回答继续',
      answers: [question.inputId],
    })

    expect(answered.attentionId).toBe(asked.attentionId)
    expect(domain.state.attentions[asked.attentionId as string]).toMatchObject({
      status: 'answered',
      answers: [question.inputId],
    })
    expect(domain.state.tickets[ticket.ticketId].answers).toEqual([question.inputId])
    expect(domain.stageOf(ticket.ticketId)).not.toBe('person/answer')
  })

  it('returns the same attention for a repeated question report', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    const question = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-question',
      kind: 'text',
      human: true,
      text: '怎么验证？',
    }).input
    const command = {
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'blocked' as const,
      summary: '等待确认',
      question: '怎么验证？',
      askedBy: question.inputId,
    }

    const first = domain.report(command)
    const second = domain.report(command)

    expect(second.duplicate).toBe(true)
    expect(second.attentionId).toBe(first.attentionId)
    expect(Object.keys(domain.state.attentions)).toHaveLength(1)
  })

  it('withdraws an open attention when the ticket reaches ready', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    const question = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-question',
      kind: 'text',
      human: true,
      text: '怎么验证？',
    }).input
    const asked = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'blocked',
      summary: '等待确认',
      question: '怎么验证？',
      askedBy: question.inputId,
    })

    const ready = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-2',
      kind: 'ready',
      summary: '可以验收',
    })

    expect(ready.attentionId).toBeNull()
    expect(domain.state.attentions[asked.attentionId as string].status).toBe('withdrawn')
    expect(domain.state.tickets[ticket.ticketId].attentionId).toBeNull()
    expect(domain.stageOf(ticket.ticketId)).toBe('person/review')
  })
})

describe('blocked/failed input gate', () => {
  it.each(['blocked', 'failed'] as const)(
    '%s stores automatic input without delivery and lets a human message reuse the assignment',
    (kind) => {
      const domain = makeDomain()
      const { ticket } = createDesktopTicket(domain)
      const assignment = startFirstAssignment(domain, ticket.ticketId)
      domain.report({
        ticketId: ticket.ticketId,
        assignmentId: assignment.assignmentId,
        reportId: 'report-1',
        kind,
        summary: '需要人工介入',
      })
      expect(domain.stageOf(ticket.ticketId)).toBe(`person/${kind}`)

      const automatic = domain.addInput({
        ticketId: ticket.ticketId,
        requestId: 'request-automatic-1',
        kind: 'trigger',
        human: false,
        text: 'CI 失败',
      })

      expect(automatic).toMatchObject({ gated: true, delivered: false, duplicate: false })
      expect(automatic.input).toMatchObject({ status: 'pending', deliveredTo: null, human: false })
      expect(domain.stageOf(ticket.ticketId)).toBe(`person/${kind}`)

      const human = domain.addInput({
        ticketId: ticket.ticketId,
        requestId: 'request-human-1',
        kind: 'text',
        human: true,
        text: '先跳过 CI，继续改',
      })

      expect(human).toMatchObject({ gated: false, delivered: true })
      expect(human.input).toMatchObject({
        status: 'delivered',
        deliveredTo: assignment.assignmentId,
      })
      expect(domain.state.tickets[ticket.ticketId].assignmentIds).toEqual([assignment.assignmentId])
      expect(domain.state.assignments[assignment.assignmentId].generation).toBe(1)
      expect(domain.stageOf(ticket.ticketId)).toBe('working')

      const afterHuman = domain.addInput({
        ticketId: ticket.ticketId,
        requestId: 'request-automatic-2',
        kind: 'trigger',
        human: false,
        text: 'CI 恢复',
      })

      expect(afterHuman.gated).toBe(false)
      expect(afterHuman.delivered).toBe(true)
      expect(afterHuman.input.status).toBe('delivered')
    },
  )

  it('does not let a context-only human input lift the blocked gate', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'blocked',
      summary: '需要人工介入',
    })

    const context = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-context-1',
      kind: 'text',
      human: true,
      context: true,
      text: '仅同步上下文',
    })

    expect(context).toMatchObject({ gated: true, delivered: false })
    expect(context.input).toMatchObject({ status: 'pending', context: true })
    expect(domain.stageOf(ticket.ticketId)).toBe('person/blocked')
  })

  it('returns the original input for a repeated requestId', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    reportBlocked(domain, ticket.ticketId, assignment.assignmentId)

    const command = {
      ticketId: ticket.ticketId,
      requestId: 'request-1',
      kind: 'trigger' as const,
      human: false,
      text: 'CI 失败',
    }
    const first = domain.addInput(command)
    const second = domain.addInput(command)

    expect(second.duplicate).toBe(true)
    expect(second.input.inputId).toBe(first.input.inputId)
    expect(domain.state.tickets[ticket.ticketId].inputIds).toEqual([first.input.inputId])
  })

  it('refuses the same requestId with a different payload', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-1',
      kind: 'text',
      human: true,
      text: '继续',
    })

    expect(
      codeOf(() =>
        domain.addInput({
          ticketId: ticket.ticketId,
          requestId: 'request-1',
          kind: 'text',
          human: true,
          text: '不同消息',
        }),
      ),
    ).toBe('conflict')
  })

  it('refuses an input that references an unknown trigger', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    startFirstAssignment(domain, ticket.ticketId)

    expect(
      codeOf(() =>
        domain.addInput({
          ticketId: ticket.ticketId,
          requestId: 'request-1',
          kind: 'trigger',
          human: false,
          triggerId: 'trigger-missing',
          text: '未知事件',
        }),
      ),
    ).toBe('triggerNotFound')
    expect(domain.state.tickets[ticket.ticketId].inputIds).toEqual([])
  })

  it('refuses input for a missing or ended ticket', () => {
    const domain = makeDomain()

    expect(
      codeOf(() =>
        domain.addInput({
          ticketId: 'ticket-missing',
          requestId: 'request-1',
          kind: 'text',
          human: true,
          text: '继续',
        }),
      ),
    ).toBe('ticketNotFound')

    const { ticket } = createDesktopTicket(domain)
    domain.endTicket({ ticketId: ticket.ticketId, outcome: 'stopped', by: 'user', reason: '人工停止' })

    expect(
      codeOf(() =>
        domain.addInput({
          ticketId: ticket.ticketId,
          requestId: 'request-2',
          kind: 'text',
          human: true,
          text: '继续',
        }),
      ),
    ).toBe('ticketEnded')
  })
})

describe('ticket ending migration', () => {
  it('clears attention and delivery, then releases undecided human inputs', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)

    const trigger = domain.intakeTrigger({
      key: 'im:msg-1',
      source: 'im',
      threadIds: ['thread-a'],
      actor: 'bob',
      human: true,
      text: '再补一个边界用例',
    }).trigger
    const pendingHuman = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-human-1',
      kind: 'trigger',
      human: true,
      triggerId: trigger.triggerId,
      text: trigger.text,
    }).input
    const failedHuman = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-human-2',
      kind: 'text',
      human: true,
      text: '这条没投递成功',
    }).input
    const askedQuestion = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-human-3',
      kind: 'text',
      human: true,
      text: '这条已经被 Worker 认领回答',
    }).input
    const openQuestion = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-human-4',
      kind: 'text',
      human: true,
      text: '这条还没来得及回答',
    }).input

    const answered = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'blocked',
      summary: '等待确认',
      question: '边界用例怎么补？',
      askedBy: askedQuestion.inputId,
    })
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-2',
      kind: 'waiting',
      summary: '已按回答继续',
      answers: [askedQuestion.inputId],
    })
    const stillOpen = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-3',
      kind: 'blocked',
      summary: '仍有一个问题',
      question: '这条怎么处理？',
      askedBy: openQuestion.inputId,
    })
    domain.failDelivery({ inputId: failedHuman.inputId, error: 'channel closed' })
    expect(domain.state.tickets[ticket.ticketId].delivery).not.toBeNull()

    const ended = domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'stopped',
      by: 'user',
      reason: '人工停止',
    })

    expect(ended.releasedInputIds.sort()).toEqual(
      [pendingHuman.inputId, failedHuman.inputId, openQuestion.inputId].sort(),
    )
    expect(ended.withdrawnAttentionIds).toEqual([stillOpen.attentionId])
    expect(domain.state.tickets[ticket.ticketId]).toMatchObject({
      state: 'ended',
      attentionId: null,
      delivery: null,
      undelivered: [],
      answers: [askedQuestion.inputId],
    })
    expect(domain.state.attentions[answered.attentionId as string].status).toBe('answered')
    expect(domain.state.attentions[stillOpen.attentionId as string].status).toBe('withdrawn')
    expect(domain.state.inputs[askedQuestion.inputId].releasedAt).toBeNull()
    expect(domain.state.inputs[pendingHuman.inputId].releasedAt).toBe(AT)
    expect(domain.state.inputs[failedHuman.inputId].releasedAt).toBe(AT)
    expect(domain.state.inputs[openQuestion.inputId].releasedAt).toBe(AT)
    expect(domain.state.handbacks).toEqual(
      expect.arrayContaining([pendingHuman.inputId, failedHuman.inputId, openQuestion.inputId]),
    )
    expect(trigger.disposition.handedBack).toBe(true)
    expect(trigger.disposition.ticketIds).not.toContain(ticket.ticketId)
    expect(domain.stageOf(ticket.ticketId)).toBe('stopped')
  })

  it('does not hand a trigger back while another ticket still owns it', () => {
    const domain = makeDomain()
    const triggerDraft = {
      key: 'im:msg-shared',
      source: 'im',
      threadIds: ['thread-a'],
      actor: 'bob',
      human: true,
      text: '两个工单共享的事件',
    }
    const first = domain.createTicket({
      requestId: 'ticket-request-a',
      title: '工单 A',
      repoRoot: '/repo',
      trigger: triggerDraft,
    })
    const second = domain.createTicket({
      requestId: 'ticket-request-b',
      title: '工单 B',
      repoRoot: '/repo',
      trigger: triggerDraft,
    })
    const trigger = Object.values(domain.state.triggers)[0]
    const input = domain.addInput({
      ticketId: first.ticket.ticketId,
      requestId: 'request-a',
      kind: 'trigger',
      human: true,
      triggerId: trigger.triggerId,
      text: trigger.text,
    }).input

    const ended = domain.endTicket({
      ticketId: first.ticket.ticketId,
      outcome: 'stopped',
      by: 'user',
      reason: '人工停止',
    })

    expect(ended.releasedInputIds).toEqual([input.inputId])
    expect(domain.state.inputs[input.inputId].releasedAt).toBe(AT)
    expect(trigger.disposition.handedBack).toBe(false)
    expect(trigger.disposition.ticketIds).toEqual([second.ticket.ticketId])
    expect(domain.state.handbacks).not.toContain(input.inputId)
  })

  it('auto-ends the ticket on a dropped report and cleans derived state', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    const question = domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-question',
      kind: 'text',
      human: true,
      text: '为什么停了？',
    }).input
    const asked = domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'blocked',
      summary: '等待确认',
      question: '继续吗？',
      askedBy: question.inputId,
    })

    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-2',
      kind: 'dropped',
      summary: '无需处理，自动丢弃',
    })

    expect(domain.state.tickets[ticket.ticketId]).toMatchObject({
      state: 'ended',
      attentionId: null,
      delivery: null,
    })
    expect(domain.state.tickets[ticket.ticketId].ended?.outcome).toBe('dropped')
    expect(domain.state.tickets[ticket.ticketId].ended?.by).toBe('worker')
    expect(domain.state.attentions[asked.attentionId as string].status).toBe('withdrawn')
    expect(domain.stageOf(ticket.ticketId)).toBe('dropped')
  })

  it('refuses to end an already ended ticket or an unknown ticket', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    domain.endTicket({ ticketId: ticket.ticketId, outcome: 'completed', by: 'user', reason: '验收通过' })

    expect(
      codeOf(() =>
        domain.endTicket({ ticketId: ticket.ticketId, outcome: 'stopped', by: 'user', reason: '再次停止' }),
      ),
    ).toBe('ticketEnded')
    expect(
      codeOf(() =>
        domain.endTicket({ ticketId: 'ticket-missing', outcome: 'stopped', by: 'user', reason: '停止' }),
      ),
    ).toBe('ticketNotFound')
  })
})

describe('stage derivation through the domain', () => {
  it('derives person/review after ready and returns to working on a human follow-up', () => {
    const domain = makeDomain()
    const { ticket } = createDesktopTicket(domain)
    const assignment = startFirstAssignment(domain, ticket.ticketId)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId: assignment.assignmentId,
      reportId: 'report-1',
      kind: 'ready',
      summary: '可以验收',
    })
    expect(domain.stageOf(ticket.ticketId)).toBe('person/review')

    domain.addInput({
      ticketId: ticket.ticketId,
      requestId: 'request-followup',
      kind: 'text',
      human: true,
      text: '再改一处',
    })

    expect(domain.stageOf(ticket.ticketId)).toBe('working')
  })
})
