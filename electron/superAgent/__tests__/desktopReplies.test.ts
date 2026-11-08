// @vitest-environment node
/**
 * #101：Router 裁决链路接入受控 Outbox —— 四种 reply 都有产生点，并经 desktop
 * 通道外发到 Router 会话（IM 气泡），不再由 Router 直接说话。
 *
 * accept 建单时的 origin 人消息由 Scheduler 在 launch 时落成 Input（#75 既有行为），
 * acknowledgement 指向它；ready/dropped Report 产生 result；提问产生 attention；
 * Worker 用 answers 认领后产生 answer。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentService } from '../service'
import { superAgentRouterEngineSessionId } from '../sessionId'
import { createFakeBridge, reportFence, routeFence, type FakeBridge } from './fakeBridge'

const REPO = '/repo/a'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function makeService(replyLimit = 0) {
  const fake = createFakeBridge()
  const service = createSuperAgentService({
    bridge: fake.bridge,
    outbox: { desktop: true, limits: { reply: replyLimit }, sweepIntervalMs: 60_000 },
  })
  return { service, fake }
}

type Service = ReturnType<typeof createSuperAgentService>

async function acceptTicket(service: Service, fake: FakeBridge, requestId: string, text: string, title: string) {
  const routerSession = superAgentRouterEngineSessionId(REPO)
  service.routerBind(REPO)
  await service.routerMessage(REPO, { requestId, text })
  fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title }]) })
  await flush()
  const ticket = service.tickets(REPO).tickets[0]
  expect(ticket).toBeDefined()
  return ticket!
}

function replyOf(service: Service, replyType: string) {
  return service
    .outboxQueue(REPO)
    .find((message) => message.payload.kind === 'reply' && message.payload.replyType === replyType)
}

describe('super agent controlled replies over the desktop outbox', () => {
  it('acknowledges accept with one sentence and points at the origin human message', async () => {
    const { service, fake } = makeService()
    await acceptTicket(service, fake, 'req-ack', '修登录页', '修复登录页')

    const ack = replyOf(service, 'acknowledgement')
    expect(ack).toBeDefined()
    expect(ack!.payload.kind === 'reply' ? ack!.payload.inReplyTo : null).toBeTruthy()
    expect(ack!.channel).toBe('desktop')

    const bubble = fake.pushed.find((push) => push.messageId === ack!.messageId)
    expect(bubble).toMatchObject({
      sessionId: superAgentRouterEngineSessionId(REPO),
      sessionType: 'superAgent',
      startTurn: false,
      // 宿主替 Agent 说给人听的话：落成 user 会变成用户气泡
      role: 'assistant',
    })
    expect(bubble?.content).toContain('修登录页')

    await flush()
    expect(service.outboxQueue(REPO).find((message) => message.messageId === ack!.messageId)).toMatchObject({
      status: 'sent',
      receipt: `desktop:${ack!.messageId}`,
    })
  })

  it('reports a ready Report as a result reply', async () => {
    const { service, fake } = makeService()
    const ticket = await acceptTicket(service, fake, 'req-result', '修登录页', '修复登录页')

    service.workerReport(REPO, {
      text: reportFence({
        assignmentId: ticket.assignmentId,
        reportId: 'report-ready',
        kind: 'ready',
        summary: '**登录页已可提交**\n\n- 已补测试\n- 已验证提交流程',
      }),
    })
    await flush()

    const result = replyOf(service, 'result')
    expect(result).toBeDefined()
    const bubble = fake.pushed.find((push) => push.messageId === result!.messageId)
    expect(bubble?.content).toBe('**已完成 · 待验收**\n\n修复登录页\n\n**登录页已可提交**\n\n- 已补测试\n- 已验证提交流程')
    expect(service.outboxQueue(REPO).find((m) => m.messageId === result!.messageId)?.status).toBe('sent')
  })

  it('forwards an open question as an attention reply', async () => {
    const { service, fake } = makeService()
    const ticket = await acceptTicket(service, fake, 'req-attention', '修登录页', '修复登录页')
    const ack = replyOf(service, 'acknowledgement')
    const askedBy = ack!.payload.kind === 'reply' ? ack!.payload.inReplyTo : null

    service.workerReport(REPO, {
      text: reportFence({
        assignmentId: ticket.assignmentId,
        reportId: 'report-question',
        kind: 'blocked',
        summary: '等待确认',
        question: '旧登录入口还要保留吗？',
        askedBy,
      }),
    })
    await flush()

    const attention = replyOf(service, 'attention')
    expect(attention).toBeDefined()
    expect(attention!.payload.kind === 'reply' ? attention!.payload.text : '').toBe('旧登录入口还要保留吗？')
    const bubble = fake.pushed.find((push) => push.messageId === attention!.messageId)
    expect(bubble?.content).toBe('旧登录入口还要保留吗？')
  })

  it('answers only after the Worker claims the human answer with answers', async () => {
    const { service, fake } = makeService()
    const ticket = await acceptTicket(service, fake, 'req-answer', '修登录页', '修复登录页')
    const ack = replyOf(service, 'acknowledgement')
    const askedBy = ack!.payload.kind === 'reply' ? ack!.payload.inReplyTo : null

    service.workerReport(REPO, {
      text: reportFence({
        assignmentId: ticket.assignmentId,
        reportId: 'report-question-2',
        kind: 'blocked',
        summary: '等待确认',
        question: '旧登录入口还要保留吗？',
        askedBy,
      }),
    })
    await flush()
    const attention = replyOf(service, 'attention')
    const attentionId = attention!.payload.kind === 'reply' ? attention!.payload.attentionId : null

    expect(replyOf(service, 'answer')).toBeUndefined()
    const answered = await service.attentionAnswer(REPO, {
      requestId: 'answer-1',
      attentionId: attentionId!,
      text: '保留，别删',
    })

    service.workerReport(REPO, {
      text: reportFence({
        assignmentId: ticket.assignmentId,
        reportId: 'report-claim',
        kind: 'progress',
        summary: '已按回答继续',
        answers: [answered.inputId],
      }),
    })
    await flush()

    const answer = replyOf(service, 'answer')
    expect(answer).toBeDefined()
    expect(answer!.payload.kind === 'reply' ? answer!.payload.inReplyTo : null).toBe(answered.inputId)
    const bubble = fake.pushed.find((push) => push.messageId === answer!.messageId)
    expect(bubble?.content).toContain('已按回答继续')
  })

  it('keeps reply order for the same ticket: acknowledgement before later replies', async () => {
    const { service, fake } = makeService()
    const ticket = await acceptTicket(service, fake, 'req-order', '修登录页', '修复登录页')

    service.workerReport(REPO, {
      text: reportFence({
        assignmentId: ticket.assignmentId,
        reportId: 'report-ready-2',
        kind: 'ready',
        summary: '完成了',
      }),
    })
    await flush()

    const ack = replyOf(service, 'acknowledgement')
    const result = replyOf(service, 'result')
    expect(ack!.ordinal).toBeLessThan(result!.ordinal)
  })

  it('withdraws an undelivered attention reply instead of delivering a stale question', async () => {
    const { service, fake } = makeService(60_000)
    const ticket = await acceptTicket(service, fake, 'req-withdraw', '修登录页', '修复登录页')
    const ack = replyOf(service, 'acknowledgement')

    service.workerReport(REPO, {
      text: reportFence({
        assignmentId: ticket.assignmentId,
        reportId: 'report-question-3',
        kind: 'blocked',
        summary: '等待确认',
        question: '旧登录入口还要保留吗？',
        askedBy: ack!.payload.kind === 'reply' ? ack!.payload.inReplyTo : null,
      }),
    })
    await flush()

    // reply 限流把第二条 reply 挡在 pending，构造「未发出的 attention 消息」
    const attention = replyOf(service, 'attention')
    expect(attention?.status).toBe('pending')

    service.ticketStop(REPO, { ticketId: ticket.ticketId })
    await flush()

    const withdrawn = replyOf(service, 'attention')
    expect(withdrawn?.status).toBe('withdrawn')
    expect(withdrawn?.withdrawnAt).toBeTruthy()
    expect(fake.pushed.some((push) => push.messageId === withdrawn!.messageId)).toBe(false)
  })
})
