// @vitest-environment node
/**
 * 串行调度器（T05 #75）。
 *
 * 覆盖验收：
 *  - 单 worker 串行：maxWorkers=1，后到的工单排队且队列可见（queue() 快照）；
 *  - 槽位在任何 await 之前同步预留：连发两张只有一次 launch；
 *  - launch 前脏区检查，共享目录现状注入 Worker 首条消息；
 *  - launch 失败：Assignment 结束为 failed、槽位释放、下一张继续、健康上报接缝回调；
 *  - 并行上限只在显式 worktree 下允许（共享目录并行被代码拒绝）；
 *  - Executor 未接入（launcher 为 null）时工单保持排队，不抛错、不假启动。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSuperAgentDomain } from '../domain'
import {
  createSuperAgentScheduler,
  type WorkerLauncher,
  type WorkerLaunchRequest,
} from '../scheduler'
import type { SuperAgentWorkspaceStatus } from '../workspace'

const AT = '2026-01-01T00:00:00.000Z'

const CLEAN: SuperAgentWorkspaceStatus = { dirty: false, statusText: '', head: 'main', entries: [] }
const DIRTY: SuperAgentWorkspaceStatus = {
  dirty: true,
  statusText: ' M src/a.ts',
  head: 'main',
  entries: [' M src/a.ts'],
}

function makeDomain() {
  let counter = 0
  return createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })
}

function deferredLaunch(): {
  launcher: WorkerLauncher
  launchSpy: ReturnType<typeof vi.fn>
  resolve: (value?: unknown) => void
  reject: (reason?: unknown) => void
} {
  interface Deferred {
    promise: Promise<unknown>
    resolve: (value?: unknown) => void
    reject: (reason?: unknown) => void
  }
  const createDeferred = (): Deferred => {
    let resolve!: (value?: unknown) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  let current = createDeferred()
  let used = false
  // 每次 launch 返回独立的 pending promise；resolve/reject 作用于最近一次调用
  const launchSpy = vi.fn(() => {
    if (used) current = createDeferred()
    used = true
    return current.promise
  })
  return {
    launcher: { launch: launchSpy as unknown as WorkerLauncher['launch'] },
    launchSpy,
    resolve: (value?: unknown) => current.resolve(value),
    reject: (reason?: unknown) => current.reject(reason),
  }
}

function makeScheduler(options: { launcher?: WorkerLauncher | null; probeStatus?: SuperAgentWorkspaceStatus } = {}) {
  const domain = makeDomain()
  const probeFn = vi.fn(async () => options.probeStatus ?? CLEAN)
  const onQueueChanged = vi.fn()
  const onLaunchError = vi.fn()
  const scheduler = createSuperAgentScheduler({
    domain,
    repoRoot: '/repo',
    launcher: options.launcher ?? null,
    probe: { probe: probeFn },
    spillWriter: (ticketId, name) => `/spill/${ticketId}/${name}`,
    onQueueChanged,
    onLaunchError,
    now: () => new Date(AT),
  })
  return { domain, scheduler, probe: probeFn, onQueueChanged, onLaunchError }
}

function dispatch(scheduler: ReturnType<typeof makeScheduler>['scheduler'], requestId: string, title: string) {
  return scheduler.dispatch({
    requestId,
    title,
    repoRoot: '/repo',
    text: `${title} 的目标描述`,
    actor: 'alice',
  })
}

describe('serial scheduling', () => {
  it('launches only one worker at a time and queues the rest in FIFO order', async () => {
    const { launcher, launchSpy, resolve } = deferredLaunch()
    const { scheduler } = makeScheduler({ launcher })

    // 槽位在任何 await 之前同步预留：第一张立即占槽（位置 0），第二张排队
    const first = dispatch(scheduler, 'd1', '工单一')
    const second = dispatch(scheduler, 'd2', '工单二')
    expect(first.queuePosition).toBe(0)
    expect(second.queuePosition).toBe(1)

    await vi.waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(1))

    const queueWhileBusy = scheduler.queue()
    expect(queueWhileBusy.maxWorkers).toBe(1)
    expect(queueWhileBusy.running.map((e) => e.title)).toEqual(['工单一'])
    expect(queueWhileBusy.queued).toEqual([
      expect.objectContaining({ title: '工单二', position: 1 }),
    ])

    // 第一张完成后，第二张按 FIFO 接续启动
    resolve()
    await vi.waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(2))

    const firstRequest = launchSpy.mock.calls[0][0] as WorkerLaunchRequest
    expect(firstRequest.assignmentId).not.toBe('')

    const queueAfter = scheduler.queue()
    expect(queueAfter.running.map((e) => e.title)).toEqual(['工单二'])
    expect(queueAfter.queued).toEqual([])

    resolve()
    await vi.waitFor(() => expect(scheduler.queue().running).toHaveLength(0))
  })

  it('marks the pending assignment running and keeps the queue visible until it ends', async () => {
    const { launcher, resolve } = deferredLaunch()
    const { domain, scheduler } = makeScheduler({ launcher })

    const first = dispatch(scheduler, 'd1', '工单一')
    await vi.waitFor(() =>
      expect(domain.state.assignments[first.assignment.assignmentId].state).toBe('running'),
    )
    expect(domain.state.assignments[first.assignment.assignmentId].startedAt).toBe(AT)

    resolve()
    await vi.waitFor(() => expect(scheduler.queue().running).toHaveLength(0))
  })

  it('injects the shared workspace status into the worker first message before launch', async () => {
    const { launcher, launchSpy, resolve } = deferredLaunch()
    const { scheduler } = makeScheduler({ launcher, probeStatus: DIRTY })

    dispatch(scheduler, 'd1', '工单一')
    await vi.waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(1))

    const request = launchSpy.mock.calls[0][0] as WorkerLaunchRequest
    expect(request.repoRoot).toBe('/repo')
    expect(request.workspace.dirty).toBe(true)
    expect(request.firstMessage).toContain(' M src/a.ts')
    expect(request.firstMessage).toContain('工单一')
    resolve()
  })

  it('ends the assignment as failed and pumps the queue when launch rejects', async () => {
    const { launcher, launchSpy, reject, resolve } = deferredLaunch()
    const { domain, scheduler, onLaunchError } = makeScheduler({ launcher })

    const first = dispatch(scheduler, 'd1', '工单一')
    dispatch(scheduler, 'd2', '工单二')

    await vi.waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(1))
    reject(new Error('engine down'))
    await vi.waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(2))

    expect(domain.state.assignments[first.assignment.assignmentId].state).toBe('ended')
    expect(domain.state.assignments[first.assignment.assignmentId].endedReason).toBe('failed')
    expect(onLaunchError).toHaveBeenCalledWith(first.ticket.ticketId, expect.any(Error))

    const queue = scheduler.queue()
    expect(queue.running.map((e) => e.title)).toEqual(['工单二'])
    resolve()
  })

  it('keeps tickets queued without a launcher wired (no fake launch)', () => {
    const { scheduler } = makeScheduler({ launcher: null })

    const first = dispatch(scheduler, 'd1', '工单一')
    const second = dispatch(scheduler, 'd2', '工单二')

    expect(first.queuePosition).toBe(1)
    expect(second.queuePosition).toBe(2)
    const queue = scheduler.queue()
    expect(queue.running).toEqual([])
    expect(queue.queued.map((e) => e.title)).toEqual(['工单一', '工单二'])
  })

  it('reports the dirty flag of a running ticket in the queue snapshot', async () => {
    const { launcher, resolve } = deferredLaunch()
    const { scheduler } = makeScheduler({ launcher, probeStatus: DIRTY })

    dispatch(scheduler, 'd1', '工单一')
    await vi.waitFor(() => expect(scheduler.queue().running[0]?.dirty).toBe(true))
    resolve()
  })

  it('injects dispatch-time @ context and attachments into the first message', async () => {
    const { launcher, launchSpy, resolve } = deferredLaunch()
    const { scheduler } = makeScheduler({ launcher })

    scheduler.dispatch({
      requestId: 'd1',
      title: '工单一',
      repoRoot: '/repo',
      text: '目标描述',
      actor: 'alice',
      contextPaths: ['src/login.ts'],
      attachments: ['docs/需求.md'],
    })
    await vi.waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(1))

    const request = launchSpy.mock.calls[0][0] as WorkerLaunchRequest
    expect(request.firstMessage).toContain('@src/login.ts')
    expect(request.firstMessage).toContain('docs/需求.md')
    resolve()
  })

  it('notifies onQueueChanged whenever the queue composition changes', async () => {
    const { launcher, resolve } = deferredLaunch()
    const { scheduler, onQueueChanged } = makeScheduler({ launcher })

    dispatch(scheduler, 'd1', '工单一')
    dispatch(scheduler, 'd2', '工单二')
    expect(onQueueChanged.mock.calls.length).toBeGreaterThanOrEqual(2)

    resolve()
    await vi.waitFor(() => {
      const calls = onQueueChanged.mock.calls
      const last = calls[calls.length - 1]?.[0]
      expect(last.running.map((e: { title: string }) => e.title)).toEqual(['工单二'])
    })
  })
})

describe('scheduler policy guard', () => {
  it('rejects parallel workers on a shared directory (no worktree)', () => {
    const domain = makeDomain()
    expect(() =>
      createSuperAgentScheduler({ domain, repoRoot: '/repo', maxWorkers: 2, worktree: false }),
    ).toThrowError(expect.objectContaining({ code: 'slotUnavailable' }))
  })

  it('allows explicit worktree isolation to raise the worker cap', () => {
    const domain = makeDomain()
    const scheduler = createSuperAgentScheduler({
      domain,
      repoRoot: '/repo',
      maxWorkers: 2,
      worktree: true,
    })
    expect(scheduler.queue().maxWorkers).toBe(2)
  })
})
