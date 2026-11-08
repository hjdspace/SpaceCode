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
import { describe, expect, it, vi } from 'vitest'
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
  it('publishes ready as runtime idle without ending the reusable assignment, then runs a same-generation follow-up', async () => {
    const fake = createFakeBridge()
    const onWorkerUpdated = vi.fn()
    const service = createSuperAgentService({ bridge: fake.bridge, onWorkerUpdated })
    const dispatched = service.dispatch(REPO, { requestId: 'status', title: '检查', text: '检查' })
    await flush()
    const { ticketId, assignmentId } = dispatched
    const mirror = service.workerBind(REPO, ticketId)
    expect(mirror.running).toBe(true)
    fake.emit(mirror.sessionId, 'result', {
      result: reportFence({ assignmentId, reportId: 'ready-1', kind: 'ready', summary: '待验收' }),
    })
    await flush()

    expect(service.workerBind(REPO, ticketId)).toMatchObject({
      running: false,
      ticketState: 'review',
      segments: [{ assignmentId, generation: 1, state: 'running', endedAt: null, reportKind: 'ready' }],
    })
    expect(onWorkerUpdated).toHaveBeenLastCalledWith(REPO, expect.objectContaining({ ticketId, running: false, ticketState: 'review' }))

    await service.ticketMessage(REPO, { requestId: 'follow-up', ticketId, text: '再检查一次' })
    expect(service.workerBind(REPO, ticketId)).toMatchObject({ running: true, segments: [{ assignmentId, generation: 1 }] })
    expect(onWorkerUpdated).toHaveBeenLastCalledWith(REPO, expect.objectContaining({ ticketId, running: true }))
    fake.emit(mirror.sessionId, 'result', {
      result: reportFence({ assignmentId, reportId: 'ready-2', kind: 'ready', summary: '再次完成' }),
    })
    await flush()
    expect(service.workerBind(REPO, ticketId)).toMatchObject({ running: false, segments: [{ reportSummary: '再次完成' }] })
  })

  it.each(['stop', 'error', 'exit', 'start-failure'] as const)('publishes runtime idle after %s', async (ending) => {
    const fake = createFakeBridge()
    const onWorkerUpdated = vi.fn()
    const service = createSuperAgentService({ bridge: fake.bridge, onWorkerUpdated })
    if (ending === 'start-failure') fake.failNextStart = new Error('spawn failed')
    const dispatched = service.dispatch(REPO, { requestId: ending, title: '检查', text: '检查' })
    const mirror = service.workerBind(REPO, dispatched.ticketId)
    await flush()
    if (ending === 'stop') service.ticketStop(REPO, { ticketId: dispatched.ticketId })
    else if (ending !== 'start-failure') fake.emit(mirror.sessionId, ending, { message: 'engine failure' })
    await flush()
    expect(service.workerBind(REPO, dispatched.ticketId).running).toBe(false)
    expect(onWorkerUpdated).toHaveBeenLastCalledWith(REPO, expect.objectContaining({ ticketId: dispatched.ticketId, running: false }))
  })

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

  it('keeps the selected model on the worker, including queued launches', async () => {
    const { service, fake } = makeService()
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'model-a', text: '分析覆盖率', model: 'haiku' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '覆盖率' }]) })
    await flush()
    const first = service.tickets(REPO).tickets[0]!
    const firstSession = superAgentWorkerEngineSessionId(first.ticketId)
    expect(fake.started.find((call) => call.sessionId === firstSession)?.config?.model).toBe('haiku')
    expect(fake.pushed.find((call) => call.sessionId === firstSession)?.model).toBe('haiku')

    await service.routerMessage(REPO, { requestId: 'model-b', text: '检查文案', model: 'opus' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '文案' }]) })
    const second = service.tickets(REPO).tickets[1]!
    await service.routerMessage(REPO, { requestId: 'model-c', text: '你好', model: 'sonnet' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'ignore' }]) })
    fake.emit(firstSession, 'result', {
      result: reportFence({ assignmentId: first.assignmentId, reportId: 'done-a', kind: 'ready', summary: '完成' }),
    })
    await flush()
    const secondSession = superAgentWorkerEngineSessionId(second.ticketId)
    expect(fake.started.find((call) => call.sessionId === secondSession)?.config?.model).toBe('opus')
  })

  it.each([true, false])('carries the original task across a greeting (explicit reference: %s)', async (withReference) => {
    const { service, fake } = makeService()
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'coverage-request', text: '分析覆盖率，补充测试' })
    fake.emit(routerSession, 'result', { result: '准备重启覆盖率会话。' })
    fake.emit(routerSession, 'result', { result: '仍未给出路由。' })
    await service.routerMessage(REPO, { requestId: 'scope-limit', text: '先别补测试，只分析覆盖率' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'ignore' }]) })
    await service.routerMessage(REPO, { requestId: 'greeting', text: '你好' })
    fake.emit(routerSession, 'result', {
      result: routeFence([{ kind: 'accept', title: '覆盖率', ...(withReference ? { sourceRequestId: 'coverage-request' } : {}) }]),
    })
    await flush()
    const ticket = service.tickets(REPO).tickets[0]
    expect(ticket).toBeDefined()
    const text = fake.sent.find((call) => call.sessionId === superAgentWorkerEngineSessionId(ticket!.ticketId))?.content ?? ''
    expect(text).toContain('分析覆盖率，补充测试')
    expect(text).toContain('先别补测试，只分析覆盖率')
    expect(text).toContain('你好')
    expect(text).not.toContain('## 目标\n\n你好')
  })

  it.each(['ignore', 'unknown-source', 'relay'])('does not manufacture a task from %s', async (mode) => {
    const { service, fake } = makeService()
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'greeting-only', text: '你好' })
    fake.emit(routerSession, 'result', {
      result: routeFence(mode === 'unknown-source'
        ? [{ kind: 'accept', title: '覆盖率', sourceRequestId: 'not-a-human-message' }]
        : [{ kind: 'ignore' }]),
    })
    if (mode === 'relay') {
      const dispatched = service.dispatch(REPO, { requestId: 'legitimate', title: '已有任务', text: '检查登录页' })
      await flush()
      const ticket = service.tickets(REPO).tickets[0]!
      fake.emit(superAgentWorkerEngineSessionId(dispatched.ticketId), 'result', {
        result: reportFence({ assignmentId: ticket.assignmentId, reportId: 'finished', kind: 'ready', summary: '已完成' }),
      })
      await flush()
      fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '未经授权的新任务', note: '顺便处理' }]) })
    }
    await flush()
    expect(service.tickets(REPO).tickets).toHaveLength(mode === 'relay' ? 1 : 0)
  })

  it('provides an asker identity and repairs a waiting report without losing the question', async () => {
    const { service, fake } = makeService()
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'req-question', text: '分析覆盖率' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '覆盖率' }]) })
    await flush()
    const ticket = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    const firstMessage = fake.sent.find((call) => call.sessionId === workerSession)?.content ?? ''
    const asker = firstMessage.match(/inputId: (\S+)/)?.[1]
    expect(asker).toBeTruthy()
    fake.emit(workerSession, 'result', {
      result: reportFence({ assignmentId: ticket.assignmentId, reportId: 'question', kind: 'waiting', summary: '需要确认范围', question: '补测试还是只分析？' }),
    })
    await flush()
    expect(service.tickets(REPO).tickets[0]?.state).toBe('working')
    expect(fake.sent.filter((call) => call.sessionId === workerSession).slice(-1)[0]?.content).toContain('askedBy')
    fake.emit(workerSession, 'result', {
      result: reportFence({ assignmentId: ticket.assignmentId, reportId: 'question-fixed', kind: 'waiting', summary: '需要确认范围', question: '补测试还是只分析？', askedBy: asker }),
    })
    await flush()
    expect(service.tickets(REPO).tickets[0]?.state).toBe('answer')
    expect(fake.sent.filter((call) => call.sessionId === routerSession).slice(-1)[0]?.content).toContain('需要确认范围')
  })

  it('stops correcting an invalid question after one attempt and explains the failure', async () => {
    const { service, fake } = makeService()
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'bad-question', text: '分析覆盖率' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '覆盖率' }]) })
    await flush()
    const ticket = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    const result = reportFence({ assignmentId: ticket.assignmentId, reportId: 'invalid', kind: 'waiting', summary: '需确认', question: '范围是什么？', askedBy: 'not-an-input' })
    fake.emit(workerSession, 'result', { result })
    await flush()
    fake.emit(workerSession, 'result', { result })
    await flush()
    expect(fake.sent.filter((call) => call.sessionId === workerSession)).toHaveLength(2)
    expect(service.tickets(REPO).tickets[0]?.state).toBe('failed')
    expect(fake.sent.filter((call) => call.sessionId === routerSession).slice(-1)[0]?.content).toContain('汇报协议失败')
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

  it('retries a failed ticket as a new generation in the same worker session', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '分析覆盖率并补充测试' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '分析覆盖率' }]) })
    await flush()

    const first = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(first.ticketId)
    fake.emit(workerSession, 'result', {
      result: reportFence({ assignmentId: first.assignmentId, reportId: 'r-1', kind: 'failed', summary: '收尾没有有效 Report' }),
    })
    await flush()
    expect(service.tickets(REPO).tickets[0]?.state).toBe('failed')

    // 人说"重新执行"：Router 现在有 retry 这个动词，不再只能用 attach 假装重跑
    await service.routerMessage(REPO, { requestId: 'req-2', text: '重新执行' })
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'retry', ticketId: first.ticketId }]) })
    await flush()

    const board = service.tickets(REPO).tickets[0]!
    // 同一张工单、同一个 Worker 会话（id 由 ticketId 稳定派生），代次 +1 重新起执行
    expect(board.ticketId).toBe(first.ticketId)
    expect(board.generation).toBe(2)
    expect(fake.started.filter((call) => call.sessionId === workerSession)).toHaveLength(2)
    expect(fake.sent.filter((call) => call.sessionId === workerSession)).toHaveLength(2)
  })

  it('refuses an attach with no live execution to receive it and tells the router why', async () => {
    const { service, fake } = makeService()
    service.routerBind(REPO)
    const routerSession = superAgentRouterEngineSessionId(REPO)
    await service.routerMessage(REPO, { requestId: 'req-1', text: '修登录页' })
    // Router 会话先起，这一次 start 不能被失败注入吃掉 —— 注入要留给 Worker 的启动
    fake.failNextStart = new Error('worker spawn failed')
    fake.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '修复登录页' }]) })
    await flush()

    const ticket = service.tickets(REPO).tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    expect(fake.sent.filter((call) => call.sessionId === workerSession)).toHaveLength(0)

    // 启动失败后代次已经 ended：attach 投不出去，落库只会留下一条永久 pending 的
    // 死信，并把阶段刷成没有进程在跑的"执行中"（重试入口随之消失）。
    await service.routerMessage(REPO, { requestId: 'req-2', text: '顺便把错误提示也改清楚' })
    fake.emit(routerSession, 'result', {
      result: routeFence([{ kind: 'attach', ticketId: ticket.ticketId, note: '同一处文案' }]),
    })
    await flush()

    expect(fake.sent.filter((call) => call.sessionId === workerSession)).toHaveLength(0)
    const routerTexts = fake.sent
      .filter((call) => call.sessionId === routerSession)
      .map((call) => call.content ?? '')
    expect(routerTexts.some((text) => text.includes('[路由未执行]'))).toBe(true)
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
