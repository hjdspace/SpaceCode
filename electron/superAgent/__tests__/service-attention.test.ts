// @vitest-environment node
/**
 * service 层 T08 契约（#78）：
 *  - question Report 触发 attention-asked 广播，attentions 返回气泡看板；
 *  - attentionAnswer 把回答落成领域 Input 投递给对应 Worker（requestId 幂等），
 *    open 气泡视图刷新；Worker 认领触发 attention-answered，看板折叠保留审计；
 *  - 替换问题触发 withdrawn → asked；
 *  - snapshot.attention.unanswered 按工单去重联动徽章计数；
 *  - 稳定错误码（notAttention）经 IPC 接缝透传。
 */
import { describe, expect, it } from 'vitest'
import type { SuperAgentAttentionEvent } from '@/shared/channels/superAgent'
import { isSuperAgentDomainError } from '../errors'
import { createSuperAgentService } from '../service'
import { SUPER_AGENT_REPORT_FENCE } from '../reportParser'

const REPO = 'D:/repo'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function reportText(assignmentId: string, reportId: string, extra: Record<string, unknown> = {}): string {
  return `\`\`\`${SUPER_AGENT_REPORT_FENCE}\n${JSON.stringify({
    assignmentId,
    reportId,
    kind: 'blocked',
    summary: '等待确认',
    ...extra,
  })}\n\`\`\``
}

function makeService(events: Array<[string, SuperAgentAttentionEvent]>) {
  return createSuperAgentService({
    onAttentionEvent: (repoRoot, event) => events.push([repoRoot, event]),
  })
}

/** 派工 → 接管 → 人工提问消息 → question Report，返回打开的 attentionId。 */
async function openAttention(service: ReturnType<typeof makeService>, question: string) {
  const dispatched = service.dispatch(REPO, {
    requestId: nextId('req'),
    title: '修复登录',
    text: '登录按钮无响应',
    actor: 'tester',
  })
  service.workerTakeover(REPO, dispatched.ticketId)
  const asker = await service.workerMessage(REPO, {
    requestId: nextId('ask'),
    ticketId: dispatched.ticketId,
    text: question,
  })
  const asked = service.workerReport(REPO, {
    text: reportText(dispatched.assignmentId, nextId('rep'), {
      question,
      askedBy: asker.inputId,
    }),
  })
  return { ...dispatched, asker, attentionId: asked.attentionId as string }
}

describe('Attention 问答链路', () => {
  it('broadcasts attention-asked on a question report and exposes the bubble board', async () => {
    const events: Array<[string, SuperAgentAttentionEvent]> = []
    const service = makeService(events)
    const { ticketId, attentionId } = await openAttention(service, '旧接口还要保留吗？')

    expect(events).toHaveLength(1)
    expect(events[0][0]).toBe(REPO)
    expect(events[0][1].reason).toBe('asked')
    expect(events[0][1].attention).toMatchObject({
      attentionId,
      ticketId,
      ticketTitle: '修复登录',
      status: 'open',
      kind: 'question',
      question: '旧接口还要保留吗？',
    })
    const board = service.attentions(REPO)
    expect(board.pendingTickets).toBe(1)
    expect(board.attentions.map((view) => view.attentionId)).toEqual([attentionId])
    // 徽章计数联动：按工单去重的待处理数
    expect(service.state(REPO).attention.unanswered).toBe(1)
  })

  it('delivers the in-place answer as a domain input and refreshes the open bubble', async () => {
    const events: Array<[string, SuperAgentAttentionEvent]> = []
    const service = makeService(events)
    const { ticketId, attentionId } = await openAttention(service, '旧接口还要保留吗？')
    events.length = 0

    const first = await service.attentionAnswer(REPO, {
      requestId: 'answer-1',
      attentionId,
      text: '保留，别删',
    })

    expect(first).toMatchObject({
      attentionId,
      ticketId,
      status: 'delivered',
      delivered: true,
      gated: false,
      duplicate: false,
    })
    const board = service.attentions(REPO)
    expect(board.attentions[0].status).toBe('open')
    expect(board.attentions[0].answers).toEqual([first.inputId])
    // open 期间视图刷新仍走 asked 通道
    expect(events.map(([, event]) => event.reason)).toEqual(['asked'])
    expect(events[0][1].attention.answers).toEqual([first.inputId])

    // requestId 幂等：重复提交返回原 Input，不重复落库
    const second = await service.attentionAnswer(REPO, {
      requestId: 'answer-1',
      attentionId,
      text: '保留，别删',
    })
    expect(second.duplicate).toBe(true)
    expect(second.inputId).toBe(first.inputId)
    expect(service.attentions(REPO).attentions[0].answers).toEqual([first.inputId])
  })

  it('broadcasts attention-answered when the worker claims the answer and keeps audit', async () => {
    const events: Array<[string, SuperAgentAttentionEvent]> = []
    const service = makeService(events)
    const { assignmentId, attentionId } = await openAttention(service, '旧接口还要保留吗？')
    const answered = await service.attentionAnswer(REPO, {
      requestId: 'answer-1',
      attentionId,
      text: '保留，别删',
    })
    events.length = 0

    service.workerReport(REPO, {
      text: reportText(assignmentId, nextId('rep'), {
        kind: 'waiting',
        summary: '已按回答继续',
        answers: [answered.inputId],
      }),
    })

    expect(events.map(([, event]) => event.reason)).toEqual(['answered'])
    const board = service.attentions(REPO)
    expect(board.attentions[0]).toMatchObject({ status: 'answered', answers: [answered.inputId] })
    expect(board.pendingTickets).toBe(0)
    expect(service.state(REPO).attention.unanswered).toBe(0)
  })

  it('withdraws the old bubble and asks the new one when the question is replaced', async () => {
    const events: Array<[string, SuperAgentAttentionEvent]> = []
    const service = makeService(events)
    const { ticketId, assignmentId } = await openAttention(service, '旧接口还要保留吗？')
    events.length = 0

    const asker = await service.workerMessage(REPO, {
      requestId: nextId('ask'),
      ticketId,
      text: '新问题',
    })
    service.workerReport(REPO, {
      text: reportText(assignmentId, nextId('rep'), {
        question: '数据库用哪个？',
        askedBy: asker.inputId,
      }),
    })

    expect(events.map(([, event]) => event.reason)).toEqual(['withdrawn', 'asked'])
    const board = service.attentions(REPO)
    expect(board.pendingTickets).toBe(1)
    expect(board.attentions.map((view) => view.status)).toEqual(['withdrawn', 'open'])
  })

  it('rejects answering an unknown attention with the stable code notAttention', async () => {
    const events: Array<[string, SuperAgentAttentionEvent]> = []
    const service = makeService(events)

    try {
      await service.attentionAnswer(REPO, {
        requestId: 'answer-x',
        attentionId: 'attention-missing',
        text: '回答',
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(isSuperAgentDomainError(err)).toBe(true)
      if (isSuperAgentDomainError(err)) expect(err.code).toBe('notAttention')
    }
  })
})
