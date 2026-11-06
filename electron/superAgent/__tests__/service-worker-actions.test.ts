/**
 * Worker 指令的 Executor 接线（#100）。
 *
 * Worker 的最终回复在 Report 之后可附带三种围栏动作；service 负责：
 *  - 先把整条消息的指令块解析完（坏指令 = 协议失败，不落半截事实）；
 *  - 再逐条调领域命令（交回 triggerId → inputId、退订、仅上下文订阅）；
 *  - 同步卡片投影；越权指令记健康但不影响已经有效的 Report。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentService } from '../service'
import {
  superAgentRouterEngineSessionId,
  superAgentWorkerEngineSessionId,
} from '../sessionId'
import { createFakeBridge, reportFence, routeFence } from './fakeBridge'

const REPO = '/repo/a'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function fence(name: string, payload: unknown): string {
  return ['```' + name, JSON.stringify(payload), '```'].join('\n')
}

async function withWorkingTicket(): Promise<{
  service: ReturnType<typeof createSuperAgentService>
  fake: ReturnType<typeof createFakeBridge>
  ticketId: string
  assignmentId: string
  workerSession: string
}> {
  const fake = createFakeBridge()
  const service = createSuperAgentService({ bridge: fake.bridge })
  service.routerBind(REPO)
  const routerSession = superAgentRouterEngineSessionId(REPO)
  await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })
  fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '修复登录页' }]) })
  await flush()
  const ticket = service.tickets(REPO).tickets[0]!
  return {
    service,
    fake,
    ticketId: ticket.ticketId,
    assignmentId: ticket.assignmentId!,
    workerSession: superAgentWorkerEngineSessionId(ticket.ticketId),
  }
}

describe('Worker 指令接线', () => {
  it('turns a duplicated worker fence into a protocol failure with a stable health code', async () => {
    const { service, fake, assignmentId, workerSession } = await withWorkingTicket()

    fake.emit(workerSession, 'result', {
      result: [
        reportFence({ assignmentId, reportId: 'done-2', kind: 'ready', summary: '已完成' }),
        fence('super-agent:thread-follow', { threadId: 'th-a' }),
        fence('super-agent:thread-follow', { threadId: 'th-b' }),
      ].join('\n\n'),
    })
    await flush()

    const board = service.tickets(REPO)
    expect(board.tickets[0]?.state).toBe('failed')
    const item = service.health(REPO).items.find((entry) => entry.category === 'effect:launch')
    expect(item?.code).toBe('workerActionNotUnique')
  })

  it('rejects an unknown thread unsubscribe but keeps the valid report', async () => {
    const { service, fake, assignmentId, workerSession } = await withWorkingTicket()

    fake.emit(workerSession, 'result', {
      result: [
        reportFence({ assignmentId, reportId: 'done-3', kind: 'ready', summary: '已完成' }),
        fence('super-agent:thread-unrelated', { threadId: 'th-not-subscribed', reason: '无关' }),
      ].join('\n\n'),
    })
    await flush()

    // 越权/找不到 Thread 的指令不执行，但 Report 仍按 ready 落地。
    expect(service.tickets(REPO).tickets[0]?.state).toBe('review')
    const item = service.health(REPO).items.find((entry) => entry.category === 'workerAction')
    expect(item?.code).not.toBeNull()
  })
})
