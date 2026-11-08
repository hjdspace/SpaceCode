// @vitest-environment node
/**
 * #104 后台作业：完成唤醒、turn 结束保留槽位、30 分钟上限。
 *
 * 用真实 service + Executor + fake bridge 覆盖接线：引擎事件 → 注册表 → 新 Input
 * → 既有投递路径；以及超时后 kill、waiting 报告与槽位释放。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSuperAgentService } from '../service'
import { superAgentRouterEngineSessionId, superAgentWorkerEngineSessionId } from '../sessionId'
import { createFakeBridge, reportFence, routeFence } from './fakeBridge'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('waitFor timeout')
}

function backgroundBashStart(fake: ReturnType<typeof createFakeBridge>, sessionId: string, toolUseId: string, taskId: string) {
  fake.emit(sessionId, 'tool_use', { id: toolUseId, name: 'Bash', input: { run_in_background: true } })
  fake.emit(sessionId, 'tool_result', {
    tool_use_id: toolUseId,
    content: `Command running in background with ID: ${taskId}`,
  })
}

describe('super agent background jobs (#104)', () => {
  it('publishes idle when a ready worker releases its background hold', async () => {
    const fake = createFakeBridge()
    const onWorkerUpdated = vi.fn()
    const service = createSuperAgentService({ bridge: fake.bridge, onWorkerUpdated })
    const repoRoot = '/repo/background-review'
    const { ticketId, assignmentId } = service.dispatch(repoRoot, { requestId: 'ready', title: '检查', text: '检查' })
    await flush()
    const mirror = service.workerBind(repoRoot, ticketId)
    // ready 的 shell 属于验收支撑，不占槽；subagent 才会保留这个 hold。
    fake.emit(mirror.sessionId, 'tool_use', { id: 'agent-ready', name: 'Agent', input: {} })
    fake.emit(mirror.sessionId, 'result', {
      result: reportFence({ assignmentId, reportId: 'ready', kind: 'ready', summary: '已完成' }),
    })
    expect(service.workerBind(repoRoot, ticketId).running).toBe(true)
    fake.emit(mirror.sessionId, 'tool_result', { tool_use_id: 'agent-ready', content: 'passed' })
    await flush()
    expect(service.workerBind(repoRoot, ticketId).running).toBe(false)
    expect(onWorkerUpdated).toHaveBeenLastCalledWith(repoRoot, expect.objectContaining({ ticketId, running: false, ticketState: 'review' }))
    expect(service.queue(repoRoot).running).toHaveLength(0)
  })

  it('keeps the slot at turn end, then wakes an idle worker when the shell completes', async () => {
    const fake = createFakeBridge()
    const service = createSuperAgentService({ bridge: fake.bridge })
    const repoRoot = '/repo/background-wake'
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '跑全量测试',
      text: '跑全量测试',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    backgroundBashStart(fake, workerSession, 'toolu_1', 'bash_1')
    fake.emit(workerSession, 'result', {
      result: reportFence({
        assignmentId: dispatched.assignmentId,
        reportId: 'r1',
        kind: 'waiting',
        summary: '等后台作业',
      }),
    })
    await flush()

    // turn 已结束但 shell 作业仍在校验/跑测试：槽位保留。
    expect(service.queue(repoRoot).running.map((entry) => entry.ticketId)).toEqual([
      dispatched.ticketId,
    ])

    fake.emit(workerSession, 'system', { subtype: 'task_notification', task_id: 'bash_1', output: '42 passed' })
    await waitFor(() => fake.sent.some((call) => call.content?.includes('[后台作业完成]') ?? false))
    expect(
      fake.sent.find(
        (call) => call.sessionId === workerSession && (call.content?.includes('[后台作业完成]') ?? false),
      )?.content,
    ).toContain('42 passed')
    // 唤醒是同一轮里的新 turn：槽位没有被提前释放给别的工单。
    expect(service.queue(repoRoot).running.map((entry) => entry.ticketId)).toEqual([
      dispatched.ticketId,
    ])

    fake.emit(workerSession, 'result', {
      result: reportFence({
        assignmentId: dispatched.assignmentId,
        reportId: 'r2',
        kind: 'waiting',
        summary: '后台结果已读完',
      }),
    })
    await flush()
    expect(service.queue(repoRoot).running).toHaveLength(0)
  })

  it('kills overdue shell jobs, reports waiting, and releases the slot', async () => {
    const fake = createFakeBridge()
    const service = createSuperAgentService({
      bridge: fake.bridge,
      backgroundJobs: { maxAgeMs: 0, sweepIntervalMs: 5 },
    })
    const repoRoot = '/repo/background-timeout'
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '起验收服务',
      text: '起验收服务',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    backgroundBashStart(fake, workerSession, 'toolu_1', 'bash_1')
    fake.emit(workerSession, 'result', {
      result: reportFence({
        assignmentId: dispatched.assignmentId,
        reportId: 'r1',
        kind: 'waiting',
        summary: '等验收服务',
      }),
    })
    await flush()
    // 先让 Router 把「等后台作业」这一轮收掉，否则中继队列被 turnInFlight 压住。
    fake.emit(superAgentRouterEngineSessionId(repoRoot), 'result', {
      result: routeFence([{ kind: 'ignore' }]),
    })
    await flush()

    await waitFor(() => fake.stoppedTasks.length > 0)
    expect(fake.stoppedTasks).toEqual([{ sessionId: workerSession, taskId: 'bash_1' }])
    await waitFor(() =>
      fake.sent.some(
        (call) =>
          call.sessionId === superAgentRouterEngineSessionId(repoRoot) &&
          (call.content?.includes('30 分钟上限') ?? false),
      ),
    )
    const relay = fake.sent.find(
      (call) =>
        call.sessionId === superAgentRouterEngineSessionId(repoRoot) &&
        (call.content?.includes('30 分钟上限') ?? false),
    )
    expect(relay?.content).toContain('bash_1')
    expect(relay?.content).toContain('未获得输出摘录')
    expect(service.queue(repoRoot).running).toHaveLength(0)
  })
})
