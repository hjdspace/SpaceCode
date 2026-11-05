// @vitest-environment node
/**
 * 调度器执行策略（T12 #82）。
 *
 * 覆盖验收：
 *  - 默认串行与 T05 一致（1 槽，共享根目录，不建 worktree）；
 *  - 策略切换即时生效：domain.setExecutionPolicy 并行后经 applyPolicy 续跑，多张工单并发占槽；
 *  - 并行强制 per-ticket worktree：持久状态损坏（parallel + worktree='none'）构造即拒绝；
 *  - worktree 模式下 launch 请求指向 per-ticket 工作树；准备失败 → assignment failed +
 *    健康上报 + 队列继续（不卡死）；
 *  - 每轮 launch 前保存检查点；
 *  - handoff 槽位释放语义：handoff Report 先标意图，turn 结束、无后续 Input、
 *    无占槽后台工作三个条件全满足才提前释放槽位；launch 落定不重复释放。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSuperAgentScheduler, type WorkerLaunchRequest, type WorkerLauncher } from '../scheduler'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import type { SuperAgentCheckpointStore } from '../checkpoint'
import type { TicketWorktreePreparer } from '../ticketWorktree'
import type { SuperAgentWorkspaceStatus, WorkspaceProbe } from '../workspace'

const AT = '2026-01-01T00:00:00.000Z'
const REPO = 'D:/repo'

function makeWorkspace(): SuperAgentWorkspaceStatus {
  return {
    head: 'abc123',
    dirty: false,
    statusText: '',
    entries: [],
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** launch 链上有多个 await，用多轮微任务冲刷让 launch 推进到 launcher.launch。 */
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

interface Harness {
  domain: SuperAgentDomain
  scheduler: ReturnType<typeof createSuperAgentScheduler>
  launches: WorkerLaunchRequest[]
  launcherDeferreds: Map<string, Array<ReturnType<typeof deferred>>>
  checkpoints: SuperAgentCheckpointStore
  preparer: TicketWorktreePreparer
  launchErrors: { ticketId: string; err: unknown }[]
}

function makeHarness(overrides: Partial<Parameters<typeof createSuperAgentScheduler>[0]> = {}): Harness {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })
  const launches: WorkerLaunchRequest[] = []
  const launcherDeferreds = new Map<string, Array<ReturnType<typeof deferred>>>()
  const launchErrors: { ticketId: string; err: unknown }[] = []
  const launcher: WorkerLauncher = {
    async launch(request) {
      launches.push(request)
      const d = deferred()
      const list = launcherDeferreds.get(request.ticketId) ?? []
      list.push(d)
      launcherDeferreds.set(request.ticketId, list)
      await d.promise
    },
  }
  const probe: WorkspaceProbe = { probe: async () => makeWorkspace() }
  const checkpoints: SuperAgentCheckpointStore = {
    save: vi.fn(async () => {}),
    latest: () => null,
    rollbackFiles: async () => ({ rolled: [], skipped: [] }),
  }
  const preparer: TicketWorktreePreparer = {
    prepare: vi.fn(async (root, ticketId) => ({
      ok: true as const,
      worktree: {
        absolute: `${root}/.spacecode/worktrees/${ticketId}`,
        relative: `.spacecode/worktrees/${ticketId}`,
        branch: `agent/superagent-${ticketId}`,
        reused: false,
      },
    })),
  }
  const scheduler = createSuperAgentScheduler({
    domain,
    repoRoot: REPO,
    launcher,
    probe,
    checkpoints,
    preparer,
    onLaunchError: (ticketId, err) => launchErrors.push({ ticketId, err }),
    ...overrides,
  })
  return { domain, scheduler, launches, launcherDeferreds, checkpoints, preparer, launchErrors }
}

function dispatch(h: Harness, n: number): void {
  for (let i = 1; i <= n; i += 1) {
    h.scheduler.dispatch({
      requestId: `req-${i}`,
      title: `工单 ${i}`,
      repoRoot: REPO,
      text: `目标 ${i}`,
      actor: 'person',
      at: AT,
    })
  }
}

async function waitForLaunches(h: Harness, count: number): Promise<void> {
  await flush()
  expect(h.launches).toHaveLength(count)
}

describe('execution policy in scheduler (default serial, T05-compatible)', () => {
  it('keeps one shared-directory slot by default', () => {
    const h = makeHarness()
    dispatch(h, 2)
    const q = h.scheduler.queue()
    expect(q.maxWorkers).toBe(1)
    expect(q.running).toHaveLength(1)
    expect(q.queued).toHaveLength(1)
  })

  it('rejects construction when persisted policy says parallel without worktree (corrupt state)', () => {
    const domain = createSuperAgentDomain({ now: () => new Date(AT) })
    domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    // 直接模拟持久层损坏：并行却共享目录
    ;(domain.state.executionPolicy as { worktree: string }).worktree = 'none'
    expect(() =>
      createSuperAgentScheduler({ domain, repoRoot: REPO, launcher: null }),
    ).toThrowError(expect.objectContaining({ code: 'parallelRequiresWorktree' }))
  })
})

describe('policy change takes effect immediately', () => {
  it('starts a second worker as soon as the policy switches to parallel', async () => {
    const h = makeHarness()
    dispatch(h, 3)
    await waitForLaunches(h, 1)
    expect(h.scheduler.queue().running).toHaveLength(1)

    h.domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    h.scheduler.applyPolicy()
    await waitForLaunches(h, 2)

    const q = h.scheduler.queue()
    expect(q.maxWorkers).toBe(2)
    expect(q.running).toHaveLength(2)
    expect(q.queued).toHaveLength(1)
  })

  it('is capped by maxWorkers', async () => {
    const h = makeHarness()
    dispatch(h, 4)
    h.domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 3 })
    h.scheduler.applyPolicy()
    await waitForLaunches(h, 3)
    const q = h.scheduler.queue()
    expect(q.running).toHaveLength(3)
    expect(q.queued).toHaveLength(1)
  })
})

describe('per-ticket worktree under parallel policy', () => {
  it('launches each ticket in its own worktree', async () => {
    const h = makeHarness()
    h.domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    h.scheduler.applyPolicy()
    dispatch(h, 2)
    await waitForLaunches(h, 2)

    const first = h.launches[0]
    expect(first.repoRoot).toBe(`${REPO}/.spacecode/worktrees/${first.ticketId}`)
    expect(first.worktree).toMatchObject({ branch: `agent/superagent-${first.ticketId}` })
    expect(h.preparer.prepare).toHaveBeenCalledWith(REPO, first.ticketId)
  })

  it('does not create worktrees in serial mode (shared directory)', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    expect(h.launches[0]?.repoRoot).toBe(REPO)
    expect(h.launches[0]?.worktree).toBeNull()
    expect(h.preparer.prepare).not.toHaveBeenCalled()
  })

  it('fails the assignment and reports health when worktree preparation fails, then keeps draining the queue', async () => {
    const failing: TicketWorktreePreparer = {
      prepare: vi.fn(async () => ({
        ok: false as const,
        error: 'not-git-repo' as const,
        detail: 'fatal: not a git repository',
      })),
    }
    const h = makeHarness({ preparer: failing })
    h.domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    h.scheduler.applyPolicy()
    dispatch(h, 2)
    await flush()

    expect(h.launches).toHaveLength(0)
    expect(h.launchErrors).toHaveLength(2)
    for (const { err } of h.launchErrors) {
      expect(err).toMatchObject({ code: 'worktreeUnavailable' })
    }
    const assignments = Object.values(h.domain.state.assignments)
    expect(assignments).toHaveLength(2)
    for (const assignment of assignments) {
      expect(assignment.state).toBe('ended')
      expect(assignment.endedReason).toBe('failed')
    }
    // 调度不卡死：槽位已释放，队列清空
    expect(h.scheduler.queue().queued).toHaveLength(0)
    expect(h.scheduler.hasActiveWorkers()).toBe(false)
  })
})

describe('checkpoint before each launch', () => {
  it('saves a checkpoint of the repoRoot before launching a worker', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    expect(h.checkpoints.save).toHaveBeenCalledWith(REPO, expect.objectContaining({ head: 'abc123' }))
  })
})

describe('handoff slot release semantics', () => {
  function report(h: Harness, ticketId: string, kind: 'waiting' | 'progress' = 'waiting') {
    const assignment = Object.values(h.domain.state.assignments).find(
      (a) => a.ticketId === ticketId,
    )
    if (!assignment) throw new Error('no assignment')
    h.domain.report({
      ticketId,
      assignmentId: assignment.assignmentId,
      reportId: `report-${ticketId}-${assignment.assignmentId}`,
      kind,
      summary: kind,
    })
  }

  it('releases the slot early when all handoff conditions hold; launch settle does not double-release', async () => {
    const h = makeHarness()
    dispatch(h, 3)
    await waitForLaunches(h, 1)
    const first = h.launches[0].ticketId

    report(h, first)
    expect(h.scheduler.handoff(first, { turnEnded: true, backgroundWork: false })).toBe(true)

    // 槽位已释放：第二张立即占槽
    await waitForLaunches(h, 2)
    expect(h.scheduler.queue().running.map((e) => e.ticketId)).toEqual([h.launches[1]!.ticketId])

    // 第一张 launch 落定后不得重复释放（否则槽位计数被破坏、第三张会被误启动）
    h.launcherDeferreds.get(first)?.[0]?.resolve()
    await flush()
    expect(h.scheduler.queue().running).toHaveLength(1)
    expect(h.launches).toHaveLength(2)
  })

  it('keeps the slot while the turn is still active', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    const first = h.launches[0].ticketId
    report(h, first)
    expect(h.scheduler.handoff(first, { turnEnded: false, backgroundWork: false })).toBe(false)
    expect(h.scheduler.queue().running).toHaveLength(1)
  })

  it('keeps the slot while background work still occupies it (subagent not confirmed ended)', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    const first = h.launches[0].ticketId
    report(h, first)
    expect(h.scheduler.handoff(first, { turnEnded: true, backgroundWork: true })).toBe(false)
    expect(h.scheduler.queue().running).toHaveLength(1)
  })

  it('keeps the slot when the latest report is not a handoff kind (progress)', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    const first = h.launches[0].ticketId
    report(h, first, 'progress')
    expect(h.scheduler.handoff(first, { turnEnded: true, backgroundWork: false })).toBe(false)
    expect(h.scheduler.queue().running).toHaveLength(1)
  })

  it('keeps the slot when a human input arrived after the handoff report (wake-up pending)', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    const first = h.launches[0].ticketId
    report(h, first)
    h.domain.ticketMessage({ ticketId: first, requestId: 'msg-1', text: '继续' })
    expect(h.scheduler.handoff(first, { turnEnded: true, backgroundWork: false })).toBe(false)
    expect(h.scheduler.queue().running).toHaveLength(1)
  })

  it('returns false for a ticket without a reserved slot (idempotent, no double release)', async () => {
    const h = makeHarness()
    dispatch(h, 1)
    await waitForLaunches(h, 1)
    expect(h.scheduler.handoff('ticket-none', { turnEnded: true, backgroundWork: false })).toBe(false)
    const first = h.launches[0].ticketId
    report(h, first)
    expect(h.scheduler.handoff(first, { turnEnded: true, backgroundWork: false })).toBe(true)
    // 已释放后重复调用：无槽可放
    expect(h.scheduler.handoff(first, { turnEnded: true, backgroundWork: false })).toBe(false)
  })
})
