// @vitest-environment node
/**
 * 运行时接线的黄金路径（T21）：一条 IM 消息 → Router 路由 → Worker 真跑 →
 * Report 回灌卡片 → 结果中继回 Router。
 *
 * 这条链路是用户报的两个问题的正面对照：
 *  - 「派了任务没有 worker 干活」= 调度器的 launcher 一直是 null；
 *  - 「Router 自己把活干了」= Router 走的是渲染端普通聊天（带全套写工具）。
 * 用例只注入 fake 引擎接缝，不打真 CLI（设计 §13.1）。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentService } from '../service'
import { SUPER_AGENT_ROUTER_ROLE_PROMPT, SUPER_AGENT_WORKER_ROLE_PROMPT } from '../prompts'
import {
  superAgentRouterEngineSessionId,
  superAgentWorkerEngineSessionId,
} from '../sessionId'
import { createFakeBridge, reportFence, routeFence } from './fakeBridge'

const REPO = '/repo/a'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function makeService() {
  const fake = createFakeBridge()
  const service = createSuperAgentService({ bridge: fake.bridge })
  return { service, fake }
}

describe('super agent runtime wiring', () => {
  it('binds the router to a stable engine session id derived from the project', async () => {
    const { service } = makeService()
    const bound = service.routerBind(REPO)

    expect(bound.sessionId).toBe(superAgentRouterEngineSessionId(REPO))
    expect(bound.running).toBe(false)
    // 幂等：重复 bind 仍返回同一条会话（重启后接的是同一段 IM 历史）
    expect(service.routerBind(REPO).sessionId).toBe(bound.sessionId)
  })

  it('sends the human message through the router session, not the renderer turn', async () => {
    const { service, fake } = makeService()
    const bound = service.routerBind(REPO)

    await service.routerMessage(REPO, {
      requestId: 'req-1',
      text: '帮我把登录页修好',
      displayText: '帮我把登录页修好',
    })

    expect(fake.pushed[0]).toMatchObject({
      sessionId: bound.sessionId,
      content: '帮我把登录页修好',
      permissionMode: 'default',
    })
    expect(fake.started[0]?.config).toMatchObject({
      cwd: REPO,
      permissionMode: 'default',
      appendSystemPrompt: SUPER_AGENT_ROUTER_ROLE_PROMPT,
    })
    expect(service.state(REPO).router?.running).toBe(true)
  })

  it('rejects an empty router message instead of burning a turn', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)

    await expect(
      service.routerMessage(REPO, { requestId: 'req-1', text: '   ' }),
    ).rejects.toThrow(/invalidRouterMessage/)
    expect(fake.sent).toHaveLength(0)
  })

  it('turns a router suggestion into a dispatched ticket that a worker actually runs', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })

    fake.emit(superAgentRouterEngineSessionId(REPO), 'result', {
      result: `已建一张工单。\n\n${routeFence([{ kind: 'accept', title: '修复登录页', note: '让登录页可提交' }])}`,
    })
    await flush()

    const board = service.tickets(REPO)
    expect(board.tickets).toHaveLength(1)
    expect(board.tickets[0]).toMatchObject({ title: '修复登录页', state: 'working' })
    // 派工即占槽：Worker 会话真的被拉起来了（这就是之前一直缺的一环）
    const workerSession = superAgentWorkerEngineSessionId(board.tickets[0]!.ticketId)
    const workerStart = fake.started.find((call) => call.sessionId === workerSession)
    expect(workerStart?.config).toMatchObject({
      cwd: REPO,
      permissionMode: 'bypassPermissions',
      appendSystemPrompt: SUPER_AGENT_WORKER_ROLE_PROMPT,
    })
    // 首条消息带本次执行身份（Report 要逐字回填 assignmentId）
    const firstWorkerMessage = fake.sent.find((call) => call.sessionId === workerSession)?.content ?? ''
    // 目标是人的原话，Router 的旁注另起一段 —— 转述进不了 Worker 的视野
    expect(firstWorkerMessage).toMatch(/## 目标\n\n修登录页/)
    expect(firstWorkerMessage).toContain('让登录页可提交')
    expect(firstWorkerMessage).toMatch(/assignmentId: \S+/)
  })

  it('recovers a missing route and launches the worker for the original request', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, {
      requestId: 'req-restart',
      text: '重启覆盖率会话，并派一个 Explore 代理找候选模块',
    })

    fake.emit(routerSession, 'result', {
      result: '我先检查部分产出，然后重启覆盖率跑，并派一个 Explore 代理。',
    })
    expect(service.tickets(REPO).tickets).toHaveLength(0)
    expect(service.state(REPO).router?.running).toBe(true)

    fake.emit(routerSession, 'result', {
      result: routeFence([{ kind: 'accept', title: '重启覆盖率会话与测试探索' }]),
    })
    await flush()

    const board = service.tickets(REPO)
    expect(board.tickets).toHaveLength(1)
    expect(board.tickets[0]).toMatchObject({ title: '重启覆盖率会话与测试探索', state: 'working' })
    const workerSession = superAgentWorkerEngineSessionId(board.tickets[0]!.ticketId)
    expect(fake.started.some((call) => call.sessionId === workerSession)).toBe(true)
    const firstWorkerMessage = fake.sent.find((call) => call.sessionId === workerSession)?.content ?? ''
    expect(firstWorkerMessage).toContain('重启覆盖率会话，并派一个 Explore 代理找候选模块')
  })

  it('attaches a follow-up to the live ticket instead of opening a duplicate', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })
    const routerSession = superAgentRouterEngineSessionId(REPO)
    fake.emit(routerSession, 'result', {
      result: routeFence([{ kind: 'accept', title: '修复登录页', note: '让登录页可提交' }]),
    })
    await flush()
    const ticket = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)

    // 第二轮：人接着问同一件事的后续，Router 判定为 attach
    await service.routerMessage(REPO, { requestId: 'req-2', text: '顺便把错误提示也改清楚' })
    fake.emit(routerSession, 'result', {
      result: routeFence([{ kind: 'attach', ticketId: ticket.ticketId, note: '同一处文案' }]),
    })
    await flush()

    // 没有第二张工单；这条人消息作为输入投给了原工单的 Worker
    expect(service.tickets(REPO).tickets).toHaveLength(1)
    const delivered = fake.sent.filter((call) => call.sessionId === workerSession)
    expect(delivered.some((call) => (call.content ?? '').includes('顺便把错误提示也改清楚'))).toBe(true)
    expect(delivered.some((call) => (call.content ?? '').includes('同一处文案'))).toBe(true)
  })

  it('stops the ticket the router was told to stop, without touching others', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    const first = service.dispatch(REPO, { requestId: 'req-a', title: 'A', text: '做 A' })
    service.dispatch(REPO, { requestId: 'req-b', title: 'B', text: '做 B' })
    await flush()

    await service.routerMessage(REPO, { requestId: 'req-1', text: 'A 先别做了' })
    fake.emit(superAgentRouterEngineSessionId(REPO), 'result', {
      result: routeFence([{ kind: 'stop', ticketId: first.ticketId }]),
    })
    await flush()

    const board = service.tickets(REPO)
    expect(board.tickets.find((t) => t.ticketId === first.ticketId)?.state).toBe('stopped')
    // 只停 Router 点名的那张：另一张不受影响，槽位释放后照常往前推进
    expect(board.tickets.find((t) => t.title === 'B')?.state).not.toBe('stopped')
  })

  it('feeds the worker report back into the card and relays the outcome to the router', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })
    fake.emit(superAgentRouterEngineSessionId(REPO), 'result', {
      result: routeFence([{ kind: 'accept', title: '修复登录页', note: '让登录页可提交' }]),
    })
    await flush()

    const ticket = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    const assignmentId = (fake.sent[1]?.content ?? '').match(/assignmentId: (\S+)/)?.[1] ?? ''
    expect(assignmentId).toBeTruthy()

    fake.emit(workerSession, 'result', {
      result: reportFence({ assignmentId, reportId: 'r1', kind: 'ready', summary: '已改完并通过校验' }),
    })
    await flush()

    expect(service.tickets(REPO).tickets[0]?.state).toBe('review')
    // 最终 Report 中继给 Router：Router 会话收到的是宿主写的工单事件，不是人说的话
    const relayed = fake.sent.filter((call) => call.sessionId === superAgentRouterEngineSessionId(REPO))
    expect(relayed).toHaveLength(2)
    expect(relayed[1]?.content).toContain('[工单事件]')
    expect(relayed[1]?.content).toContain('已改完并通过校验')
    // 中继会自己起一轮：Router 再次进入 running
    expect(service.state(REPO).router?.running).toBe(true)
  })

  it('ends the execution as failed when the worker turn has no valid report', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })
    fake.emit(superAgentRouterEngineSessionId(REPO), 'result', {
      result: routeFence([{ kind: 'accept', title: '修复登录页', note: '让登录页可提交' }]),
    })
    await flush()

    const ticket = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    fake.emit(workerSession, 'result', { result: '我改好了，应该没问题' })
    await flush()

    // 协议失败不能猜成完成：卡片停在 failed 人工阶段，健康项被记一次
    expect(service.tickets(REPO).tickets[0]?.state).toBe('failed')
    const health = service.health(REPO)
    expect(health.items.some((item) => item.category === 'effect:launch')).toBe(true)
  })

  it('aborts the router turn without touching the worker session', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    // 显式派工先让一个 Worker 真跑起来（launch promise 仍挂起 = 会话活动）
    const dispatched = service.dispatch(REPO, {
      requestId: 'req-ticket',
      title: '修复登录页',
      text: '让登录页可提交',
    })
    await flush()
    await service.routerMessage(REPO, { requestId: 'req-1', text: '现在怎么样了' })

    await service.routerAbort(REPO)

    const routerSession = superAgentRouterEngineSessionId(REPO)
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)
    expect(fake.aborted).toEqual([routerSession])
    expect(fake.aborted).not.toContain(workerSession)
    expect(service.state(REPO).router?.running).toBe(false)
    // Worker 不受 Router 中止影响：会话仍在活动，卡片仍是 working
    expect(service.tickets(REPO).tickets[0]?.state).toBe('working')
  })

  it('stops the worker process when the ticket is stopped', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })
    fake.emit(superAgentRouterEngineSessionId(REPO), 'result', {
      result: routeFence([{ kind: 'accept', title: '修复登录页', note: '让登录页可提交' }]),
    })
    await flush()
    const ticket = service.tickets(REPO).tickets[0]!

    service.ticketStop(REPO, { ticketId: ticket.ticketId, reason: '人工停止' })
    await flush()

    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    expect(fake.aborted).toContain(workerSession)
    expect(fake.stopped).toContain(workerSession)
    expect(service.tickets(REPO).tickets[0]?.state).toBe('stopped')
  })

  it('lands the router projection on the first message, not only on bind', async () => {
    const fake = createFakeBridge()
    const statuses: { repoRoot: string; router: unknown }[] = []
    const service = createSuperAgentService({
      bridge: fake.bridge,
      onRouterStatusChanged: (repoRoot, router) => statuses.push({ repoRoot, router }),
    })

    // 不等 bind 直接发消息：投影必须已经存在，否则 typing 广播无处可挂，
    // 渲染端的停止按钮与计时会静默失灵。
    const result = await service.routerMessage(REPO, { requestId: 'req-1', text: '你好' })

    expect(result.sessionId).toBe(superAgentRouterEngineSessionId(REPO))
    expect(service.state(REPO).router).toEqual({ sessionId: result.sessionId, running: true })
    expect(statuses).toEqual([
      { repoRoot: REPO, router: { sessionId: result.sessionId, running: true } },
    ])
  })

  it('keeps tickets queued when no engine seam was injected', async () => {
    const service = createSuperAgentService()
    service.routerBind(REPO)

    const dispatched = service.dispatch(REPO, {
      requestId: 'req-1',
      title: '修复登录页',
      text: '让登录页可提交',
    })

    // 没有运行时就不假装启动：卡片停在排队，Router 也不会静默起会话
    expect(service.tickets(REPO).tickets[0]?.state).toBe('queued')
    expect(dispatched.queuePosition).toBe(1)
    await expect(
      service.routerMessage(REPO, { requestId: 'req-2', text: '你好' }),
    ).rejects.toThrow(/engineLaunchFailed/)
  })
})
