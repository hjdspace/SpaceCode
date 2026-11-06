// @vitest-environment node
/**
 * T11 #81 服务级崩溃恢复、显式 shutdown 与暂停持久化：
 *  - 重启（旧进程视为已死）后：状态从磁盘恢复、running 标 interrupted、
 *    busy 工单建新代次并续跑、review 工单保持原状态不自动 launch、
 *    delivered 未读输入对账后经 requestId 重投，且只投一次；
 *  - 显式 shutdown：停止接受命令 → 有界等待在途 launch → 关 Store 释放锁；
 *  - 关闭 Super Agent 标签只停镜像，不触发 shutdown；
 *  - 暂停跨重启保持：重启后不 launch，恢复后队列续跑。
 */
import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSuperAgentService, type SuperAgentService } from '../service'
import { openProjectStore } from '../store'
import { createFakeBridge, reportFence, routeFence } from './fakeBridge'
import { superAgentRouterEngineSessionId, superAgentWorkerEngineSessionId } from '../sessionId'

const REPO = join(tmpdir(), 'spacecode-recovery-repo')
// T11 #81：Store 的 projectKey 基于 repoRoot 的 realpath，目录必须真实存在
mkdirSync(REPO, { recursive: true })
mkdirSync(join(REPO, 'b'), { recursive: true })

function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spacecode-recovery-'))
}

/** 模拟重启：旧进程已死，新实例可接管陈旧锁（含同进程活跃锁检查一并模拟）。 */
const RESTART_STORE_DEPS = {
  isProcessAlive: () => false,
  isLockHeldInProcess: () => false,
} as const

interface LaunchRecord { ticketId: string; assignmentId: string }

function makeLauncher() {
  const requests: LaunchRecord[] = []
  const launcher = {
    async launch(request: { ticketId: string; assignmentId: string }): Promise<void> {
      requests.push({ ticketId: request.ticketId, assignmentId: request.assignmentId })
    },
  }
  return { launcher, requests }
}

function makeGatedLauncher() {
  const started: string[] = []
  let release: () => void = () => {}
  const inFlight = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    started,
    release,
    launcher: {
      launch: (request: { ticketId: string }) => {
        started.push(request.ticketId)
        return inFlight
      },
    },
  }
}

async function waitUntil(predicate: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('waitUntil: 条件在限定时间内未满足')
}

function dispatchOf(service: SuperAgentService, requestId: string, title: string) {
  return service.dispatch(REPO, { requestId, title, text: '目标' })
}

function lastSegments(service: SuperAgentService, ticketId: string) {
  return service.workerBind(REPO, ticketId).segments
}

function readyReportText(assignmentId: string): string {
  return [
    '```super-agent:report',
    JSON.stringify({ assignmentId, reportId: 'rep-ready', kind: 'ready', summary: '已完成' }),
    '```',
  ].join('\n')
}

let userDataDir: string

beforeEach(() => {
  userDataDir = makeUserDataDir()
})

describe('重启恢复（跨实例模拟）', () => {
  it('排队工单重启后仍使用派工时选中的模型', async () => {
    const a = createFakeBridge()
    const serviceA = createSuperAgentService({ userDataDir, bridge: a.bridge })
    serviceA.pause(REPO)
    await serviceA.routerMessage(REPO, { requestId: 'queued-model', text: '分析覆盖率', model: 'haiku' })
    const routerSession = superAgentRouterEngineSessionId(REPO)
    a.emit(routerSession, 'result', { result: routeFence([{ kind: 'accept', title: '覆盖率' }]) })
    const ticket = serviceA.tickets(REPO).tickets[0]!
    expect(ticket.state).toBe('queued')
    await serviceA.routerMessage(REPO, { requestId: 'later-model', text: '你好', model: 'opus' })
    a.emit(routerSession, 'result', { result: routeFence([{ kind: 'ignore' }]) })
    await serviceA.shutdown(REPO)

    const b = createFakeBridge()
    const serviceB = createSuperAgentService({ userDataDir, bridge: b.bridge })
    await serviceB.resume(REPO)
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)
    await waitUntil(() => b.sent.some((call) => call.sessionId === workerSession))
    expect(b.started.find((call) => call.sessionId === workerSession)?.config?.model).toBe('haiku')
    b.emit(workerSession, 'result', { result: reportFence({ assignmentId: ticket.assignmentId, reportId: 'done', kind: 'ready', summary: '完成' }) })
    await waitUntil(() => b.sent.some((call) => call.sessionId === routerSession))
    b.emit(routerSession, 'result', { result: '已完成，等待验收。' })
    await serviceB.shutdown(REPO)
  })

  it('busy 工单恢复新代次续跑，review 工单保持原状态，未读输入只投一次', async () => {
    const a = makeLauncher()
    const delivererA = vi.fn(async () => 'accepted' as const)
    const serviceA = createSuperAgentService({
      userDataDir,
      launcher: a.launcher,
      workerDeliverer: delivererA,
      shutdownTimeoutMs: 100,
    })

    const busy = dispatchOf(serviceA, 'r-busy', '修复中')
    await waitUntil(() => a.requests.some((item) => item.ticketId === busy.ticketId))
    serviceA.workerTakeover(REPO, busy.ticketId)
    const sent = await serviceA.workerMessage(REPO, {
      ticketId: busy.ticketId,
      requestId: 'msg-busy',
      text: '补充',
    })
    expect(sent.status).toBe('delivered')

    const review = dispatchOf(serviceA, 'r-review', '已完成')
    await waitUntil(() => a.requests.some((item) => item.ticketId === review.ticketId))
    const reviewAssignmentId = serviceA
      .workerBind(REPO, review.ticketId)
      .segments[0].assignmentId
    serviceA.workerReport(REPO, { text: readyReportText(reviewAssignmentId) })

    // 模拟崩溃：直接丢弃实例，不走 shutdown

    const b = makeLauncher()
    const delivererB = vi.fn(async () => 'accepted' as const)
    const serviceB = createSuperAgentService({
      userDataDir,
      launcher: b.launcher,
      workerDeliverer: delivererB,
      storeDeps: RESTART_STORE_DEPS,
      shutdownTimeoutMs: 100,
    })

    // 首次命令触发打开：锁接管 → 恢复对账 → 队列续跑
    serviceB.state(REPO)

    // busy：generation 2 恢复代次已建并续跑；review：不自动 launch
    await waitUntil(() => b.requests.some((item) => item.ticketId === busy.ticketId))
    expect(b.requests.map((item) => item.ticketId)).not.toContain(review.ticketId)

    const busySegments = lastSegments(serviceB, busy.ticketId)
    expect(busySegments).toHaveLength(2)
    expect(busySegments[0]).toMatchObject({ generation: 1, state: 'interrupted' })
    expect(busySegments[1]).toMatchObject({ generation: 2, state: 'running' })
    expect(serviceB.workerBind(REPO, busy.ticketId).running).toBe(true)

    // review：原代次保持（仅标 interrupted），报告事实仍在
    const mirror = serviceB.workerBind(REPO, review.ticketId)
    expect(mirror.segments).toHaveLength(1)
    expect(mirror.segments[0]).toMatchObject({
      assignmentId: reviewAssignmentId,
      state: 'interrupted',
      reportKind: 'ready',
    })
    expect(mirror.running).toBe(false)

    // 未读输入对账：对账后重发同 requestId 经 requestId 幂等只再投一次
    serviceB.workerTakeover(REPO, busy.ticketId)
    const resent = await serviceB.workerMessage(REPO, {
      ticketId: busy.ticketId,
      requestId: 'msg-busy',
      text: '补充',
    })
    expect(resent.duplicate).toBe(true)
    expect(delivererB).toHaveBeenCalledTimes(1)
    expect(delivererB).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'msg-busy' }),
    )
    expect(resent.status).toBe('delivered')

    await serviceB.shutdown(REPO)
  })

  it('重启前已排队（pending）的工单重启后续跑原代次', async () => {
    const serviceA = createSuperAgentService({ userDataDir })
    const queued = dispatchOf(serviceA, 'r-queued', '排队')

    const b = makeLauncher()
    const serviceB = createSuperAgentService({
      userDataDir,
      launcher: b.launcher,
      storeDeps: RESTART_STORE_DEPS,
    })
    serviceB.state(REPO)

    await waitUntil(() => b.requests.some((item) => item.ticketId === queued.ticketId))
    const segments = lastSegments(serviceB, queued.ticketId)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ generation: 1, state: 'running' })
    await serviceB.shutdown(REPO)
  })

  it('旧进程仍在时获取项目锁失败：命令得到 projectStoreUnavailable 而非静默双写', async () => {
    const serviceA = createSuperAgentService({ userDataDir })
    serviceA.state(REPO)

    const serviceB = createSuperAgentService({ userDataDir })
    expect(() => serviceB.state(REPO)).toThrowError(/projectStoreUnavailable/)

    await serviceA.shutdown(REPO)
  })
})

describe('显式 shutdown', () => {
  it('shutdown 有界完成并释放锁：等待在途 launch 落定后可再次打开目录', async () => {
    const gate = makeGatedLauncher()
    const service = createSuperAgentService({
      userDataDir,
      launcher: gate.launcher,
      shutdownTimeoutMs: 2_000,
    })
    dispatchOf(service, 'r-1', '标题')
    await waitUntil(() => gate.started.length === 1)

    const shutdownPromise = service.shutdown(REPO)
    gate.release()
    await expect(shutdownPromise).resolves.toMatchObject({
      repoRoot: REPO,
      settledWithinBound: true,
    })

    // 锁已释放：不等旧进程死亡也能直接再次打开目录
    const reopened = openProjectStore<{ seq: number }>({
      userDataDir,
      repoRoot: REPO,
      initialState: { seq: 0 },
      reduce: (state) => state,
    })
    reopened.close()
  })

  it('超时的在途 launch 直接结束 shutdown 并释放锁，下次启动生成恢复代次', async () => {
    const service = createSuperAgentService({
      userDataDir,
      launcher: { launch: () => new Promise<void>(() => {}) },
      shutdownTimeoutMs: 30,
    })
    const ticket = dispatchOf(service, 'r-1', '标题')
    await waitUntil(() => service.workerBind(REPO, ticket.ticketId).running === true)

    const result = await service.shutdown(REPO)
    expect(result.settledWithinBound).toBe(false)

    const b = makeLauncher()
    const serviceB = createSuperAgentService({
      userDataDir,
      launcher: b.launcher,
      storeDeps: RESTART_STORE_DEPS,
    })
    serviceB.state(REPO)
    await waitUntil(() => b.requests.some((item) => item.ticketId === ticket.ticketId))
    const segments = lastSegments(serviceB, ticket.ticketId)
    expect(segments[0]).toMatchObject({ generation: 1, state: 'interrupted' })
    expect(segments[1]).toMatchObject({ generation: 2 })
    await serviceB.shutdown(REPO)
  })

  it('shutdown 期间停止接受命令：dispatch/ticketMessage 被拒绝且给出 shuttingDown 错误码', async () => {
    const gate = makeGatedLauncher()
    const service = createSuperAgentService({
      userDataDir,
      launcher: gate.launcher,
      shutdownTimeoutMs: 5_000,
    })
    const ticket = dispatchOf(service, 'r-1', '标题')
    await waitUntil(() => gate.started.length === 1)

    const shutdownPromise = service.shutdown(REPO)
    expect(() => dispatchOf(service, 'r-2', 'x')).toThrowError(/shuttingDown/)
    await expect(
      service.ticketMessage(REPO, { ticketId: ticket.ticketId, requestId: 'm-1', text: 'hi' }),
    ).rejects.toThrowError(/shuttingDown/)

    gate.release()
    await shutdownPromise

    // 关闭完成后仍拒绝新命令；重复 shutdown 幂等成功
    expect(() => dispatchOf(service, 'r-3', 'x')).toThrowError(/shuttingDown/)
    await expect(service.shutdown(REPO)).resolves.toMatchObject({ settledWithinBound: true })
  })

  it('关闭 Super Agent 标签只停镜像：workerUnbind 不触发 shutdown，后台仍可推进', async () => {
    const a = makeLauncher()
    const service = createSuperAgentService({ userDataDir, launcher: a.launcher })
    const ticket = dispatchOf(service, 'r-1', '标题')
    await waitUntil(() => a.requests.some((item) => item.ticketId === ticket.ticketId))
    service.workerTakeover(REPO, ticket.ticketId)
    service.workerBind(REPO, ticket.ticketId)

    service.workerUnbind(REPO, ticket.ticketId)

    // 未 shutdown：仍可接受新派工命令（后台推进不受面板关闭影响）
    const next = dispatchOf(service, 'r-2', '继续')
    expect(next).toBeTruthy()
    expect(service.workerTakeover(REPO, ticket.ticketId)).toMatchObject({
      ticketId: ticket.ticketId,
    })
    await service.shutdown(REPO)
  })

  it('shutdownAll 有界关闭全部项目', async () => {
    const otherRepo = join(REPO, 'b')
    const service = createSuperAgentService({ userDataDir, shutdownTimeoutMs: 100 })
    service.state(REPO)
    service.state(otherRepo)

    const results = await service.shutdownAll()

    expect(results).toHaveLength(2)
    expect(results.every((item) => item.settledWithinBound)).toBe(true)
    expect(() => dispatchOf(service, 'r-1', 'x')).toThrowError(/shuttingDown/)
  })
})

describe('暂停跨重启持久化', () => {
  it('重启后仍处于暂停：派工只入队不 launch；恢复后队列续跑', async () => {
    const a = makeLauncher()
    const serviceA = createSuperAgentService({ userDataDir, launcher: a.launcher })
    const paused = dispatchOf(serviceA, 'r-1', '标题')
    await waitUntil(() => a.requests.some((item) => item.ticketId === paused.ticketId))
    serviceA.pause(REPO)

    const b = makeLauncher()
    const serviceB = createSuperAgentService({
      userDataDir,
      launcher: b.launcher,
      storeDeps: RESTART_STORE_DEPS,
    })
    const queued = dispatchOf(serviceB, 'r-2', '排队')
    expect(b.requests).toHaveLength(0)

    serviceB.resume(REPO)
    await waitUntil(() => b.requests.some((item) => item.ticketId === queued.ticketId))
    await serviceB.shutdown(REPO)
  })
})
