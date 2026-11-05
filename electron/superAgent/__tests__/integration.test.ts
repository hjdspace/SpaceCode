// @vitest-environment node
/**
 * T14 #84 Phase 1 集成验收：真实 Store + fake Port 的全链路黄金路径。
 *
 * 与单元测试的差别：这里走 createSuperAgentService 完整装配（持久化 Store +
 * Domain + Scheduler + 双投影 + reviewReminder），launcher/workerDeliverer 是
 * fake Port（Executor 接缝），其余全部真实实现，不手抄桩。覆盖：
 *  - 黄金路径：建单 → 派工 → progress/Report → 卡片状态 → Attention 问答 →
 *    接管输入 → 验收/停止 → 崩溃重启恢复；
 *  - 串行调度：任意时刻最多一个活动 Worker，第二张在第一张结束后占槽，
 *    共享根目录与工作区现状注入首条消息；
 *  - 领域 seq 断档重拉（fromSeq/toSeq 连续性 + tickets() 全量权威看板）与
 *    派工/Report/回答的幂等；
 *  - blocked 后人工消息复用原 Assignment（不换代次、不新增分段）；
 *  - review 超时只提醒不自动完成；停止后自动事件不得重开；
 *  - 错误码经 noteError 序列化为稳定 i18n 键；zh-CN/en-US 语言包键与占位符
 *    对齐；super-agent 组件颜色全部走主题变量（暗色主题静态核验）。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  SuperAgentAttentionEvent,
  SuperAgentQueueSnapshot,
  SuperAgentTakeoverChangedEvent,
  SuperAgentTicketProgress,
  SuperAgentTicketUpdateEvent,
} from '@/shared/channels/superAgent'
import zhCN from '@/i18n/locales/zh-CN/superAgent'
import enUS from '@/i18n/locales/en-US/superAgent'
import {
  createSuperAgentService,
  type SuperAgentService,
  type SuperAgentWorkerDeliveryRequest,
} from '../service'
import { SUPER_AGENT_REPORT_FENCE } from '../reportParser'
import { SUPER_AGENT_ERROR_CODES } from '../errors'
import { superAgentWorkerEngineSessionId } from '../sessionId'
import type { WorkerLaunchRequest } from '../scheduler'
import type { ProjectStoreDeps } from '../store'

/** Store 的 projectKey 基于 repoRoot 的 realpath，目录必须真实存在。 */
const REPO = mkdtempSync(join(tmpdir(), 'spacecode-t14-repo-'))
mkdirSync(REPO, { recursive: true })

/** 模拟重启：旧进程已死，新实例可接管陈旧锁。 */
const RESTART_STORE_DEPS = {
  isProcessAlive: () => false,
  isLockHeldInProcess: () => false,
} as const

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function reportText(
  assignmentId: string,
  reportId: string,
  extra: Record<string, unknown> = {},
): string {
  return `\`\`\`${SUPER_AGENT_REPORT_FENCE}\n${JSON.stringify({
    assignmentId,
    reportId,
    kind: 'waiting',
    summary: '进行中',
    ...extra,
  })}\n\`\`\``
}

interface Harness {
  service: SuperAgentService
  launches: WorkerLaunchRequest[]
  deliveries: SuperAgentWorkerDeliveryRequest[]
  updates: SuperAgentTicketUpdateEvent[]
  progresses: SuperAgentTicketProgress[]
  attentionEvents: SuperAgentAttentionEvent[]
  queues: SuperAgentQueueSnapshot[]
  takeovers: SuperAgentTakeoverChangedEvent[]
  /** 释放某代次的 Worker 进程（launch promise 落定 = 进程退出）。 */
  release(assignmentId: string): void
}

/**
 * gated launcher：每次 launch 挂起直到显式 release —— 模拟真实 Worker 进程
 * 生命周期（启动后持续执行，退出时 promise 落定）。串行语义下槽位在 promise
 * 落定时才释放，因此能真实复现「任意时刻最多一个活动 Worker」。gate 按
 * assignmentId 键控：同一工单的重试/恢复代次各自独立。
 */
function makeHarness(options: {
  userDataDir: string
  deliverOutcome?: 'accepted' | 'notAccepted' | 'unknown'
  now?: () => Date
  /** 模拟重启：旧进程已死、可接管陈旧锁。 */
  storeDeps?: ProjectStoreDeps
}): Harness {
  const launches: WorkerLaunchRequest[] = []
  const deliveries: SuperAgentWorkerDeliveryRequest[] = []
  const updates: SuperAgentTicketUpdateEvent[] = []
  const progresses: SuperAgentTicketProgress[] = []
  const attentionEvents: SuperAgentAttentionEvent[] = []
  const queues: SuperAgentQueueSnapshot[] = []
  const takeovers: SuperAgentTakeoverChangedEvent[] = []
  const gates = new Map<string, () => void>()
  const launcher = {
    launch(request: WorkerLaunchRequest): Promise<void> {
      launches.push(request)
      return new Promise<void>((resolvePromise) => {
        gates.set(request.assignmentId, resolvePromise)
      })
    },
  }
  const outcome = options.deliverOutcome ?? 'accepted'
  const service = createSuperAgentService({
    userDataDir: options.userDataDir,
    storeDeps: options.storeDeps,
    launcher,
    workerDeliverer: async (request) => {
      deliveries.push({ ...request })
      return outcome
    },
    onTicketUpdated: (repoRoot, event) => {
      if (repoRoot === REPO) updates.push(event)
    },
    onTicketProgress: (repoRoot, progress) => {
      if (repoRoot === REPO) progresses.push(progress)
    },
    onAttentionEvent: (repoRoot, event) => {
      if (repoRoot === REPO) attentionEvents.push(event)
    },
    onQueueChanged: (repoRoot, snapshot) => {
      if (repoRoot === REPO) queues.push(snapshot)
    },
    onTakeoverChanged: (repoRoot, event) => {
      if (repoRoot === REPO) takeovers.push(event)
    },
    // 周期扫描挂起（验证走手动 sweep），避免测试期内定时器干扰
    reviewReminder: { hours: 24, now: options.now, sweepIntervalMs: 1_000_000 },
  })
  return {
    service,
    launches,
    deliveries,
    updates,
    progresses,
    attentionEvents,
    queues,
    takeovers,
    release: (assignmentId: string) => {
      gates.get(assignmentId)?.()
      gates.delete(assignmentId)
    },
  }
}

async function waitUntil(predicate: () => boolean, attempts = 300): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error('waitUntil: 条件在限定时间内未满足')
}

function dispatchTicket(
  service: SuperAgentService,
  requestId: string,
  title: string,
  text = '目标描述',
) {
  return service.dispatch(REPO, { requestId, title, text })
}

function cardOf(service: SuperAgentService, ticketId: string) {
  return service.tickets(REPO).tickets.find((card) => card.ticketId === ticketId)
}

/** 同步/异步命令统一取稳定错误码：不吞断言、不留 unhandled rejection。 */
async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn()
    return '<no-error>'
  } catch (err) {
    return (err as { code?: string }).code ?? '<no-code>'
  }
}

let userDataDir: string

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'spacecode-t14-'))
})

describe('T14 黄金路径：建单 → 派工 → Report → 卡片 → Attention → 接管 → 验收', () => {
  it('单张工单从派工到验收完成的全链路状态与事件一致', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h

    // 1. Router 绑定：会话建立，快照带水位
    const bound = service.routerBind(REPO)
    expect(bound.sessionId).toBeTruthy()
    expect(bound.snapshot.seq).toBeGreaterThan(0)

    // 2. 显式派工：审计链四件套 + 串行占槽启动
    const dispatched = dispatchTicket(service, 'req-a', '修复登录', '登录按钮点击无响应')
    expect(dispatched.duplicate).toBe(false)
    await waitUntil(() => h.launches.some((req) => req.ticketId === dispatched.ticketId))
    const queue = service.queue(REPO)
    expect(queue.maxWorkers).toBe(1)
    expect(queue.running.map((entry) => entry.ticketId)).toEqual([dispatched.ticketId])
    expect(cardOf(service, dispatched.ticketId)).toMatchObject({
      state: 'working',
      assignmentId: dispatched.assignmentId,
      generation: 1,
    })

    // 3. progress Report：卡片保持 working，轻量进度事件携带工具事实
    service.workerReport(REPO, {
      text: reportText(dispatched.assignmentId, 'rep-a-progress', {
        kind: 'progress',
        summary: '正在修改',
        currentTool: 'Edit',
        toolCalls: 3,
        elapsedMs: 1_200,
      }),
    })
    await waitUntil(() =>
      h.progresses.some((p) => p.ticketId === dispatched.ticketId && p.currentTool === 'Edit'),
    )
    expect(cardOf(service, dispatched.ticketId)?.state).toBe('working')

    // 4. 接管 → 人工消息：先落库再经 fake Port 投递，requestId/sessionId 对账键齐备
    const takeover = service.workerTakeover(REPO, dispatched.ticketId)
    expect(takeover.ticketId).toBe(dispatched.ticketId)
    expect(h.takeovers[h.takeovers.length - 1]?.takeover?.ticketId).toBe(dispatched.ticketId)
    const asker = await service.workerMessage(REPO, {
      ticketId: dispatched.ticketId,
      requestId: 'msg-a-1',
      text: '旧接口还要保留吗？',
    })
    expect(asker.status).toBe('delivered')
    expect(h.deliveries).toHaveLength(1)
    expect(h.deliveries[0]).toMatchObject({
      ticketId: dispatched.ticketId,
      requestId: 'msg-a-1',
      // 投递寻址用引擎会话 UUID（与 workerBind 镜像里同一个 id）
      sessionId: superAgentWorkerEngineSessionId(dispatched.ticketId),
    })

    // 5. question Report：Attention 气泡出现，徽章计数按工单去重
    const asked = service.workerReport(REPO, {
      text: reportText(dispatched.assignmentId, 'rep-a-question', {
        question: '旧接口还要保留吗？',
        askedBy: asker.inputId,
      }),
    })
    expect(asked.attentionId).toBeTruthy()
    await waitUntil(() => h.attentionEvents.some((e) => e.reason === 'asked'))
    expect(service.state(REPO).attention.unanswered).toBe(1)
    const board = service.attentions(REPO)
    expect(board.pendingTickets).toBe(1)
    expect(board.attentions[0]).toMatchObject({
      attentionId: asked.attentionId,
      status: 'open',
      kind: 'question',
    })

    // 6. 就地回答：落成领域 Input（requestId 幂等）
    const answer = await service.attentionAnswer(REPO, {
      requestId: 'ans-a-1',
      attentionId: asked.attentionId as string,
      text: '保留，别删',
    })
    expect(answer.delivered).toBe(true)
    expect(service.attentions(REPO).attentions[0].answers).toEqual([answer.inputId])

    // 7. Worker 认领回答：Attention 进入 answered，徽章清零
    service.workerReport(REPO, {
      text: reportText(dispatched.assignmentId, 'rep-a-claim', {
        summary: '已按回答继续',
        answers: [answer.inputId],
      }),
    })
    await waitUntil(() => h.attentionEvents.some((e) => e.reason === 'answered'))
    expect(service.state(REPO).attention.unanswered).toBe(0)
    expect(service.attentions(REPO).attentions[0].status).toBe('answered')

    // 8. ready Report：进入待验收（不自动完成）
    service.workerReport(REPO, {
      text: reportText(dispatched.assignmentId, 'rep-a-ready', {
        kind: 'ready',
        summary: '已完成修复',
      }),
    })
    expect(cardOf(service, dispatched.ticketId)).toMatchObject({ state: 'review' })
    expect(cardOf(service, dispatched.ticketId)?.canRetry).toBe(false)

    // 9. 验收：completed 收尾，Worker 镜像代次分段保留
    const accepted = service.ticketAccept(REPO, { ticketId: dispatched.ticketId })
    expect(accepted.outcome).toBe('completed')
    expect(cardOf(service, dispatched.ticketId)).toMatchObject({
      state: 'completed',
      ended: expect.objectContaining({ outcome: 'completed', by: 'user' }),
    })
    const mirror = service.workerBind(REPO, dispatched.ticketId)
    expect(mirror.segments).toHaveLength(1)
    expect(mirror.segments[0]).toMatchObject({
      generation: 1,
      state: 'ended',
      endedReason: 'completed',
      reportKind: 'ready',
      reportSummary: '已完成修复',
    })
    // 验收收尾后代次一并收尾：不出现「进程已退出但 Assignment 仍 running」
    expect(mirror.running).toBe(false)
    // 结束后 open Attention 全部撤回，无静默吞消息
    expect(service.attentions(REPO).pendingTickets).toBe(0)

    // 10. Worker 进程退出（launch promise 落定）：服务仍可派工
    h.release(dispatched.assignmentId)
    const next = dispatchTicket(service, 'req-a2', '后续工单')
    expect(next.ticketId).not.toBe(dispatched.ticketId)
    await waitUntil(() => h.launches.some((req) => req.ticketId === next.ticketId))
    h.release(next.assignmentId)
    await service.shutdown(REPO)
  })

  it('未接管输入被拒绝；同项目第二个接管冲突；交还与关闭标签释放接管', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-t1', '工单一')
    const b = dispatchTicket(service, 'req-t2', '工单二')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))

    // 未接管先输入：稳定错误码
    expect(
      await codeOf(() =>
        service.workerMessage(REPO, {
          ticketId: a.ticketId,
          requestId: 'msg-x',
          text: '未接管的输入',
        }),
      ),
    ).toBe('takeoverRequired')

    // 接管 A 后再接管 B：同项目互斥
    service.workerTakeover(REPO, a.ticketId)
    expect(await codeOf(() => service.workerTakeover(REPO, b.ticketId))).toBe('takeoverConflict')

    // 交还幂等；交还后可输入的是空文本校验而非接管校验
    expect(service.workerRelease(REPO, a.ticketId)).toBe(true)
    expect(service.workerRelease(REPO, a.ticketId)).toBe(true)
    expect(
      await codeOf(() =>
        service.workerMessage(REPO, {
          ticketId: a.ticketId,
          requestId: 'msg-y',
          text: 'x',
        }),
      ),
    ).toBe('takeoverRequired')

    // 关闭镜像标签一并释放接管：takeover-changed 广播空态
    service.workerTakeover(REPO, b.ticketId)
    service.workerBind(REPO, b.ticketId)
    service.workerUnbind(REPO, b.ticketId)
    expect(h.takeovers[h.takeovers.length - 1]?.takeover).toBeNull()

    // 收尾：释放占槽的 a，等待 b 接续后一并释放（避免在途 launch 拖住 shutdown）
    h.release(a.assignmentId)
    await waitUntil(() => h.launches.some((req) => req.ticketId === b.ticketId))
    h.release(b.assignmentId)
    await service.shutdown(REPO)
  })

  it('停止出口：Mandate 撤回、代次收尾，后续自动事件不得重开', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-stop', '要停止的工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))

    const stopped = service.ticketStop(REPO, { ticketId: a.ticketId, reason: '不需要了' })
    expect(stopped.outcome).toBe('stopped')
    expect(cardOf(service, a.ticketId)).toMatchObject({
      state: 'stopped',
      ended: expect.objectContaining({ outcome: 'stopped' }),
    })
    const mirror = service.workerBind(REPO, a.ticketId)
    expect(mirror.segments[0]).toMatchObject({ state: 'ended', endedReason: 'stopped' })

    // 迟到的 Worker Report 是自动事件：不得重开已停止工单
    expect(
      await codeOf(() =>
        service.workerReport(REPO, {
          text: reportText(a.assignmentId, 'rep-late', {
            kind: 'ready',
            summary: '迟到的完成报告',
          }),
        }),
      ),
    ).toBe('ticketEnded')
    // 停止后 Attention 清空、验收出口关闭
    expect(service.attentions(REPO).pendingTickets).toBe(0)
    expect(await codeOf(() => service.ticketAccept(REPO, { ticketId: a.ticketId }))).toBe(
      'ticketEnded',
    )

    // 人工 stop 后服务继续可用（下一张工单正常派工排队，释放槽位后启动）
    const next = dispatchTicket(service, 'req-after-stop', '停止后的新工单')
    expect(service.queue(REPO).queued.map((entry) => entry.ticketId)).toEqual([next.ticketId])
    h.release(a.assignmentId)
    await waitUntil(() => h.launches.some((req) => req.ticketId === next.ticketId))
    h.release(next.assignmentId)
    await service.shutdown(REPO)
  })

  it('验收出口只在待验收开放：working 阶段得到 notReady', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-notready', '执行中的工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    expect(await codeOf(() => service.ticketAccept(REPO, { ticketId: a.ticketId }))).toBe('notReady')
    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })
})

describe('T14 串行调度与共享工作区（验收清单 1/2/8）', () => {
  it('连续派工两张工单：任意时刻最多一个活动 Worker，第二张接续并看到共享工作区现状', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const first = dispatchTicket(service, 'req-s1', '第一张工单', '目标甲')
    await waitUntil(() => h.launches.some((req) => req.ticketId === first.ticketId))

    // 第一张执行中派第二张：立即受理（Router 不阻塞等待 Worker），FIFO 排队
    const second = dispatchTicket(service, 'req-s2', '第二张工单', '目标乙')
    expect(second.queuePosition).toBe(1)
    expect(service.queue(REPO).queued.map((entry) => entry.ticketId)).toEqual([second.ticketId])
    // 串行：任意时刻最多一个活动 Worker（历史队列快照里 running 至多 1）
    for (const snapshot of h.queues) {
      expect(snapshot.running.length).toBeLessThanOrEqual(1)
      expect(snapshot.maxWorkers).toBe(1)
    }

    // 第一张完成（ready Report + 进程退出释放槽位）→ 第二张占槽
    service.workerReport(REPO, {
      text: reportText(first.assignmentId, 'rep-s1-ready', {
        kind: 'ready',
        summary: '第一张完成',
      }),
    })
    h.release(first.assignmentId)
    await waitUntil(() => h.launches.some((req) => req.ticketId === second.ticketId))
    expect(cardOf(service, second.ticketId)?.state).toBe('working')

    // 共享根目录：两张工单的 Worker 在同一目录执行（串行无 worktree）
    const firstLaunch = h.launches.find((req) => req.ticketId === first.ticketId)
    const secondLaunch = h.launches.find((req) => req.ticketId === second.ticketId)
    expect(firstLaunch?.repoRoot).toBe(REPO)
    expect(secondLaunch?.repoRoot).toBe(REPO)
    expect(secondLaunch?.worktree).toBeNull()
    // 第二张的首条消息注入工单指派与共享工作区现状（能看到第一张结束后的目录状态）
    expect(secondLaunch?.firstMessage).toContain('工单指派：第二张工单')
    expect(secondLaunch?.firstMessage).toContain('目标乙')
    expect(secondLaunch?.firstMessage).toContain('共享工作区现状')

    h.release(second.assignmentId)
    await service.shutdown(REPO)
  })
})

describe('T14 断档重拉与幂等（集成层）', () => {
  it('ticket-updated 事件的 fromSeq/toSeq 链连续，断档时 tickets() 全量重拉幂等', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-gap', '断档验证工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-gap-ready', { kind: 'ready', summary: '完成' }),
    })
    service.ticketAccept(REPO, { ticketId: a.ticketId })
    expect(h.updates.length).toBeGreaterThanOrEqual(3)

    // 广播链连续：后一事件的 fromSeq 等于前一事件的 toSeq（无断档丢失）
    expect(h.updates[0].fromSeq).toBe(0)
    for (let i = 1; i < h.updates.length; i++) {
      expect(h.updates[i].fromSeq).toBe(h.updates[i - 1].toSeq)
    }
    // 最终权威看板与最后一个事件一致（seq 水位与卡片集合）
    const board = service.tickets(REPO)
    const lastUpdate = h.updates[h.updates.length - 1]
    expect(board.seq).toBe(lastUpdate?.toSeq)
    expect(board.tickets).toEqual(lastUpdate?.tickets)

    // 模拟渲染端丢失中间一个事件（updates[missedIndex] 未到达）：本地水位停留在
    // 丢失事件的前一个事件，收到的下一个事件 fromSeq 与本地水位不一致 →
    // 断档可被检出 → 触发 tickets() 全量重拉（watchTickets 的判定规则）
    const missedIndex = h.updates.length - 2
    const localSeq = h.updates[missedIndex - 1].toSeq
    const nextEvent = h.updates[missedIndex + 1]
    expect(nextEvent.fromSeq).not.toBe(localSeq)
    const repulled = service.tickets(REPO)
    expect(repulled.seq).toBe(nextEvent.toSeq)
    // 重拉幂等：连续两次全量拉取结果一致
    expect(service.tickets(REPO)).toEqual(repulled)

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })

  it('派工 / Report / 回答全部幂等：重复提交不推进领域 seq、不重复副作用', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const command = { requestId: 'req-idem', title: '幂等工单', text: '目标' }
    const first = service.dispatch(REPO, command)
    const duplicate = service.dispatch(REPO, command)
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.ticketId).toBe(first.ticketId)
    expect(duplicate.assignmentId).toBe(first.assignmentId)
    const seqAfterDispatch = service.tickets(REPO).seq

    await waitUntil(() => h.launches.some((req) => req.ticketId === first.ticketId))
    const readyText = reportText(first.assignmentId, 'rep-idem', {
      kind: 'ready',
      summary: '完成',
    })
    const reported = service.workerReport(REPO, { text: readyText })
    expect(reported.duplicate).toBe(false)
    const seqAfterReport = service.tickets(REPO).seq
    const attentionCountBefore = h.attentionEvents.length

    // 重复 Report（同 assignmentId + reportId）：幂等确认原结果，不推进 seq
    const again = service.workerReport(REPO, { text: readyText })
    expect(again.duplicate).toBe(true)
    expect(service.tickets(REPO).seq).toBe(seqAfterReport)
    expect(h.attentionEvents.length).toBe(attentionCountBefore)

    // 同载荷不同 requestId 的派工：另一张独立工单（不是冲突）
    const other = service.dispatch(REPO, {
      requestId: 'req-idem-2',
      title: '幂等工单',
      text: '目标',
    })
    expect(other.duplicate).toBe(false)
    expect(other.ticketId).not.toBe(first.ticketId)
    expect(service.tickets(REPO).seq).toBeGreaterThan(seqAfterReport)
    expect(seqAfterReport).toBeGreaterThan(seqAfterDispatch)

    h.release(first.assignmentId)
    await waitUntil(() => h.launches.some((req) => req.ticketId === other.ticketId))
    h.release(other.assignmentId)
    await service.shutdown(REPO)
  })
})

describe('T14 Assignment 复用与 review 超时提醒（验收清单 4/15）', () => {
  it('blocked 后人工消息复用原 Assignment：不新建、不递增 generation、不新增分段', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-reuse', '复用验证工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-reuse-blocked', {
        kind: 'blocked',
        summary: '被外部依赖挡住',
      }),
    })
    expect(cardOf(service, a.ticketId)).toMatchObject({ state: 'blocked', canRetry: true })

    // 人工消息解除 blocked：复用原 Assignment 回到 working
    const sent = await service.ticketMessage(REPO, {
      ticketId: a.ticketId,
      requestId: 'msg-reuse',
      text: '依赖已解除，继续',
    })
    expect(sent.status).toBe('delivered')
    expect(h.deliveries[h.deliveries.length - 1]).toMatchObject({ requestId: 'msg-reuse' })
    expect(cardOf(service, a.ticketId)?.state).toBe('working')
    // 身份不漂移：assignmentId/generation 不变，右侧执行分段不新增
    const mirror = service.workerBind(REPO, a.ticketId)
    expect(mirror.segments).toHaveLength(1)
    expect(mirror.segments[0]).toMatchObject({
      assignmentId: a.assignmentId,
      generation: 1,
      state: 'running',
    })

    // 复用后的 Report 覆盖阶段：同一 assignmentId 直接进待验收并验收完成
    service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-reuse-ready', {
        kind: 'ready',
        summary: '复用后完成',
      }),
    })
    expect(cardOf(service, a.ticketId)?.state).toBe('review')
    service.ticketAccept(REPO, { ticketId: a.ticketId })
    expect(cardOf(service, a.ticketId)?.state).toBe('completed')
    // 全程只有一个 Assignment：generation 从未递增
    expect(service.workerBind(REPO, a.ticketId).segments).toHaveLength(1)

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })

  it('review 超时只提醒不自动完成：每日最多一次，状态保持待验收', async () => {
    // 假时钟以真实当前时间为起点：Report 的 at 落在真实 now（service 不注入 at），
    // 提醒判定比较 now - readyAt，起点一致才能推进假时钟验证超时
    let clockMs = Date.now()
    const now = () => new Date(clockMs)
    const h = makeHarness({ userDataDir, now })
    const { service } = h
    const a = dispatchTicket(service, 'req-review', '待验收工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-review-ready', {
        kind: 'ready',
        summary: '完成待验收',
      }),
    })
    expect(cardOf(service, a.ticketId)?.state).toBe('review')

    // 未到 24 小时：不提醒
    expect(service.sweepReviewReminders(REPO)).toBe(0)
    expect(cardOf(service, a.ticketId)?.reviewRemindedAt).toBeNull()

    // 到点首次提醒：水位落库、徽章计数按工单去重，阶段不迁移
    clockMs += 25 * 3_600_000
    expect(service.sweepReviewReminders(REPO)).toBe(1)
    const remindedAt = cardOf(service, a.ticketId)?.reviewRemindedAt
    expect(remindedAt).toBeTruthy()
    expect(cardOf(service, a.ticketId)?.state).toBe('review')
    expect(service.state(REPO).review.reminded).toBe(1)

    // 同日再扫：不重复提醒（每日最多一次）
    clockMs += 3_600_000
    expect(service.sweepReviewReminders(REPO)).toBe(0)
    expect(cardOf(service, a.ticketId)?.reviewRemindedAt).toBe(remindedAt)
    expect(service.state(REPO).review.reminded).toBe(1)

    // 次日再扫：只补一条，仍不自动 accept
    clockMs += 24 * 3_600_000
    expect(service.sweepReviewReminders(REPO)).toBe(1)
    expect(cardOf(service, a.ticketId)?.state).toBe('review')

    // 提醒不改变出口：人工验收仍可完成
    service.ticketAccept(REPO, { ticketId: a.ticketId })
    expect(cardOf(service, a.ticketId)?.state).toBe('completed')

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })
})

describe('T14 投递对账（验收清单 5/6）', () => {
  it('投递结果未知：转 uncertain 并产生 delivery Attention，不盲目重投', async () => {
    const h = makeHarness({ userDataDir, deliverOutcome: 'unknown' })
    const { service } = h
    const a = dispatchTicket(service, 'req-unc', '投递未知工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    service.workerTakeover(REPO, a.ticketId)

    const sent = await service.workerMessage(REPO, {
      ticketId: a.ticketId,
      requestId: 'msg-unc',
      text: '结果未知的一次投递',
    })
    expect(sent.status).toBe('uncertain')
    // delivery Attention 让人看见，禁止盲目重投
    const board = service.attentions(REPO)
    expect(board.pendingTickets).toBe(1)
    expect(board.attentions[0]).toMatchObject({ kind: 'delivery', status: 'open' })
    expect(service.state(REPO).attention.unanswered).toBe(1)
    // 重复提交同一 requestId：幂等返回原 Input，不再产生第二条 Attention
    const again = await service.workerMessage(REPO, {
      ticketId: a.ticketId,
      requestId: 'msg-unc',
      text: '结果未知的一次投递',
    })
    expect(again.duplicate).toBe(true)
    expect(service.attentions(REPO).attentions).toHaveLength(1)

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })

  it('可证明未接受（notAccepted）：Input 退回 pending，下次路径重投', async () => {
    const h = makeHarness({ userDataDir, deliverOutcome: 'notAccepted' })
    const { service } = h
    const a = dispatchTicket(service, 'req-na', '未接受工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    service.workerTakeover(REPO, a.ticketId)

    const sent = await service.workerMessage(REPO, {
      ticketId: a.ticketId,
      requestId: 'msg-na',
      text: '未被接受的一次投递',
    })
    expect(sent.status).toBe('pending')
    expect(h.deliveries).toHaveLength(1)
    // 重发同 requestId：pending（未投出）允许重投
    const retry = await service.workerMessage(REPO, {
      ticketId: a.ticketId,
      requestId: 'msg-na',
      text: '未被接受的一次投递',
    })
    expect(retry.duplicate).toBe(true)
    expect(h.deliveries).toHaveLength(2)
    expect(retry.status).toBe('pending')

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })
})

describe('T14 崩溃重启恢复（验收清单 7/13）', () => {
  it('running 标 interrupted 并建恢复代次续跑；delivered 未读输入对账后只补投一次', async () => {
    const a = makeHarness({ userDataDir })
    const dispatched = dispatchTicket(a.service, 'req-crash', '崩溃前执行中的工单')
    await waitUntil(() => a.launches.some((req) => req.ticketId === dispatched.ticketId))
    a.service.workerTakeover(REPO, dispatched.ticketId)
    const sent = await a.service.workerMessage(REPO, {
      ticketId: dispatched.ticketId,
      requestId: 'msg-crash',
      text: '崩溃前的补充',
    })
    expect(sent.status).toBe('delivered')
    // 模拟崩溃：直接丢弃实例，不走 shutdown

    const b = makeHarness({ userDataDir, storeDeps: RESTART_STORE_DEPS })
    // 首次命令触发打开：锁接管 → 恢复对账 → 队列续跑
    b.service.state(REPO)
    await waitUntil(() => b.launches.some((req) => req.ticketId === dispatched.ticketId))

    // 恢复代次续跑：generation 2，旧代次 interrupted（不出现"进程已退出仍 running"）
    const mirror = b.service.workerBind(REPO, dispatched.ticketId)
    expect(mirror.segments).toHaveLength(2)
    expect(mirror.segments[0]).toMatchObject({ generation: 1, state: 'interrupted' })
    expect(mirror.segments[1]).toMatchObject({ generation: 2, state: 'running' })
    expect(mirror.running).toBe(true)

    // 未读输入对账：退回 pending 后，同 requestId 重发经幂等只补投一次
    b.service.workerTakeover(REPO, dispatched.ticketId)
    const resent = await b.service.workerMessage(REPO, {
      ticketId: dispatched.ticketId,
      requestId: 'msg-crash',
      text: '崩溃前的补充',
    })
    expect(resent.duplicate).toBe(true)
    expect(b.deliveries.filter((d) => d.requestId === 'msg-crash')).toHaveLength(1)
    expect(resent.status).toBe('delivered')

    // 恢复代次可正常完成验收：黄金路径在重启后仍闭环
    const gen2 = mirror.segments[1].assignmentId
    b.service.workerReport(REPO, {
      text: reportText(gen2, 'rep-crash-ready', { kind: 'ready', summary: '恢复后完成' }),
    })
    expect(cardOf(b.service, dispatched.ticketId)?.state).toBe('review')
    b.service.ticketAccept(REPO, { ticketId: dispatched.ticketId })
    expect(cardOf(b.service, dispatched.ticketId)?.state).toBe('completed')

    b.release(b.launches[0].assignmentId)
    await b.service.shutdown(REPO)
  })

  it('重启后已排队工单续跑原代次，不出现双 launch', async () => {
    const a = makeHarness({ userDataDir })
    const running = dispatchTicket(a.service, 'req-r1', '重启前执行中')
    await waitUntil(() => a.launches.some((req) => req.ticketId === running.ticketId))
    const queued = dispatchTicket(a.service, 'req-r2', '重启前排队中')
    expect(a.service.queue(REPO).queued.map((entry) => entry.ticketId)).toEqual([queued.ticketId])

    const b = makeHarness({ userDataDir, storeDeps: RESTART_STORE_DEPS })
    b.service.state(REPO)
    await waitUntil(() => b.launches.length >= 1)
    // 第一个占槽的 launch 挂起时第二个保持排队：串行不双启动
    const firstLaunched = b.launches[0].ticketId
    const countsAfterFirst = new Map<string, number>()
    for (const req of b.launches) {
      countsAfterFirst.set(req.ticketId, (countsAfterFirst.get(req.ticketId) ?? 0) + 1)
    }
    expect(countsAfterFirst.get(firstLaunched)).toBe(1)
    expect(b.launches).toHaveLength(1)
    // 释放第一个 Worker（进程退出）→ 第二张占槽
    b.release(b.launches[0].assignmentId)
    await waitUntil(() => b.launches.length >= 2)
    const counts = new Map<string, number>()
    for (const req of b.launches) counts.set(req.ticketId, (counts.get(req.ticketId) ?? 0) + 1)
    // 两张工单各只有一个活动代次，串行推进，无重复 launch
    expect(counts.get(running.ticketId)).toBe(1)
    expect(counts.get(queued.ticketId)).toBe(1)
    for (const snapshot of b.queues) {
      expect(snapshot.running.length).toBeLessThanOrEqual(1)
    }
    const runningMirror = b.service.workerBind(REPO, running.ticketId)
    expect(runningMirror.segments).toHaveLength(2)
    expect(runningMirror.segments[1].generation).toBe(2)
    const queuedMirror = b.service.workerBind(REPO, queued.ticketId)
    expect(queuedMirror.segments).toHaveLength(1)
    expect(queuedMirror.segments[0].generation).toBe(1)

    for (const req of b.launches) b.release(req.assignmentId)
    await b.service.shutdown(REPO)
  })
})

describe('T14 人工重试与执行策略（验收清单 6/8）', () => {
  it('人工重试新建 generation+1 代次、续用 Worker 会话与共享目录；重试只在人工阶段开放', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-retry', '重试工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))

    // working 阶段不可重试：重试只出现在 person/delivery/blocked/failed
    expect(await codeOf(() => service.ticketRetry(REPO, { ticketId: a.ticketId }))).toBe(
      'notRetryable',
    )

    service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-retry-blocked', {
        kind: 'blocked',
        summary: '外部依赖缺失',
      }),
    })
    expect(cardOf(service, a.ticketId)?.canRetry).toBe(true)

    const retry = service.ticketRetry(REPO, { ticketId: a.ticketId })
    // 该工单自身仍占槽（gen1 launch 在途）：queuePosition 0，新代次待槽位释放
    expect(retry).toMatchObject({ ticketId: a.ticketId, generation: 2, queuePosition: 0 })
    expect(retry.assignmentId).not.toBe(a.assignmentId)
    // 旧代次以 stopped 收尾，不悬挂 running；镜像两代按 generation 升序
    const mirror = service.workerBind(REPO, a.ticketId)
    expect(mirror.segments[0]).toMatchObject({
      generation: 1,
      state: 'ended',
      endedReason: 'stopped',
    })
    expect(mirror.segments[1]).toMatchObject({ generation: 2, state: 'pending' })

    // 旧 Worker 退出释放槽位 → 新代次续用同一共享目录启动
    h.release(a.assignmentId)
    await waitUntil(() => h.launches.some((req) => req.assignmentId === retry.assignmentId))
    const gen2Launch = h.launches.find((req) => req.assignmentId === retry.assignmentId)
    expect(gen2Launch?.repoRoot).toBe(REPO)
    expect(service.workerBind(REPO, a.ticketId).segments[1]).toMatchObject({ state: 'running' })

    // 新代次 Report 覆盖阶段并验收完成
    service.workerReport(REPO, {
      text: reportText(retry.assignmentId, 'rep-retry-ready', {
        kind: 'ready',
        summary: '重试后完成',
      }),
    })
    service.ticketAccept(REPO, { ticketId: a.ticketId })
    expect(cardOf(service, a.ticketId)?.state).toBe('completed')

    h.release(retry.assignmentId)
    await service.shutdown(REPO)
  })

  it('并行策略：运行中不热切换；未显式确认拒绝；非 git 共享目录拒绝', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-policy', '占位工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))

    // 有活动 Worker 占槽：不热切换
    expect(
      await codeOf(() =>
        service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 2, confirmed: true }),
      ),
    ).toBe('policyChangeBlocked')

    h.release(a.assignmentId)
    await new Promise((resolvePause) => setTimeout(resolvePause, 30))
    // 无占槽：切并行必须显式确认
    expect(
      await codeOf(() => service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 2 })),
    ).toBe('policyConfirmRequired')
    // 确认但共享目录不是 git 仓库：并行（per-ticket worktree）被代码拒绝
    expect(
      await codeOf(() =>
        service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 2, confirmed: true }),
      ),
    ).toBe('worktreeUnavailable')
    // 被拒后策略保持默认串行
    expect(service.executionPolicy(REPO).policy).toMatchObject({ mode: 'serial', maxWorkers: 1 })

    await service.shutdown(REPO)
  })
})

describe('T14 暂停跨重启（验收清单 13）', () => {
  it('暂停跨重启保持：不 launch；人工 resume 后才续跑', async () => {
    const a = makeHarness({ userDataDir })
    a.service.pause(REPO)
    const paused = dispatchTicket(a.service, 'req-pause', '暂停期间派工')
    // 暂停中派工受理但不启动（ absence 断言前留出异步窗口）
    await new Promise((resolvePause) => setTimeout(resolvePause, 150))
    expect(a.launches).toHaveLength(0)

    // 模拟崩溃重启：暂停是持久领域事实，重启后仍不 launch
    const b = makeHarness({ userDataDir, storeDeps: RESTART_STORE_DEPS })
    b.service.state(REPO)
    await new Promise((resolvePause) => setTimeout(resolvePause, 150))
    expect(b.launches).toHaveLength(0)

    // 人工 resume 后才续跑
    await b.service.resume(REPO)
    await waitUntil(() => b.launches.length >= 1)
    expect(b.launches[0].ticketId).toBe(paused.ticketId)
    b.release(b.launches[0].assignmentId)
    await b.service.shutdown(REPO)
  })
})

describe('T14 Report 交叉校验与 Attention 替换（验收清单 12）', () => {
  it('ready+question 互斥被拒；新问题替换旧气泡（withdrawn → asked）', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-cross', '交叉校验工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))
    service.workerTakeover(REPO, a.ticketId)
    const asker = await service.workerMessage(REPO, {
      ticketId: a.ticketId,
      requestId: 'msg-cross',
      text: '需要确认',
    })

    // ready 与 question 互斥：Report 交叉校验拒绝
    expect(
      await codeOf(() =>
        service.workerReport(REPO, {
          text: reportText(a.assignmentId, 'rep-cross-1', {
            kind: 'ready',
            summary: '完成',
            question: '完成时还要问',
            askedBy: asker.inputId,
          }),
        }),
      ),
    ).toBe('questionWithResult')

    // 第一次提问：open 气泡
    const first = service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-cross-2', {
        question: '第一个问题',
        askedBy: asker.inputId,
      }),
    })
    // 第二次提问替换：旧气泡撤回、只保留新气泡（同一问题只创建一次）
    const second = service.workerReport(REPO, {
      text: reportText(a.assignmentId, 'rep-cross-3', {
        question: '替换后的第二个问题',
        askedBy: asker.inputId,
      }),
    })
    expect(second.attentionId).not.toBe(first.attentionId)
    const reasons = h.attentionEvents.map((event) => event.reason)
    expect(reasons).toContain('withdrawn')
    expect(reasons[reasons.indexOf('withdrawn') + 1]).toBe('asked')
    const board = service.attentions(REPO)
    expect(board.pendingTickets).toBe(1)
    expect(board.attentions[board.attentions.length - 1]).toMatchObject({
      attentionId: second.attentionId,
      status: 'open',
    })
    expect(board.attentions.find((view) => view.attentionId === first.attentionId)?.status).toBe(
      'withdrawn',
    )

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })
})

describe('T14 错误码与双语核验', () => {
  it('黄金路径上的协议失败映射为稳定错误码与 i18n 键', async () => {
    const h = makeHarness({ userDataDir })
    const { service } = h
    const a = dispatchTicket(service, 'req-err', '错误码工单')
    await waitUntil(() => h.launches.some((req) => req.ticketId === a.ticketId))

    // 无报告块 / 报告块不唯一 / 伪造 assignmentId
    expect(
      await codeOf(() => service.workerReport(REPO, { text: '没有报告块的普通消息' })),
    ).toBe('reportMissing')
    const twoBlocks = [reportText(a.assignmentId, 'rep-1'), reportText(a.assignmentId, 'rep-2')].join(
      '\n',
    )
    expect(await codeOf(() => service.workerReport(REPO, { text: twoBlocks }))).toBe(
      'reportNotUnique',
    )
    expect(
      await codeOf(() => service.workerReport(REPO, { text: reportText('assignment-fake', 'rep-3') })),
    ).toBe('assignmentNotFound')

    // 序列化为稳定 payload：已知 code 携带 i18n 键，未知 code 回退通用文案
    const caught = ((): unknown => {
      try {
        service.workerReport(REPO, { text: 'x' })
      } catch (err) {
        return err
      }
      return new Error('unreachable')
    })()
    const known = service.noteError(REPO, caught)
    expect(known).toMatchObject({
      code: 'reportMissing',
      known: true,
      i18nKey: 'superAgent.errors.reportMissing',
    })
    const unknown = service.noteError(
      REPO,
      Object.assign(new Error('boom'), { code: 'futureCode' }),
    )
    expect(unknown).toMatchObject({ known: false, i18nKey: 'superAgent.errors.unknown' })
    expect(JSON.stringify(unknown)).not.toContain('boom')

    h.release(a.assignmentId)
    await service.shutdown(REPO)
  })

  it('zh-CN 与 en-US 语言包键结构完全对齐，且覆盖全部稳定错误码', () => {
    function flattenKeys(value: unknown, prefix = ''): string[] {
      if (typeof value !== 'object' || value === null) return [prefix]
      return Object.entries(value).flatMap(([key, child]) =>
        flattenKeys(child, prefix === '' ? key : `${prefix}.${key}`),
      )
    }
    expect(new Set(flattenKeys(zhCN))).toEqual(new Set(flattenKeys(enUS)))

    for (const code of SUPER_AGENT_ERROR_CODES) {
      expect(zhCN.errors[code as keyof typeof zhCN.errors], `zh-CN 缺少错误码 ${code}`).toBeTruthy()
      expect(enUS.errors[code as keyof typeof enUS.errors], `en-US 缺少错误码 ${code}`).toBeTruthy()
    }
    // 兜底文案键也在两侧
    expect(zhCN.errors.unknown).toBeTruthy()
    expect(enUS.errors.unknown).toBeTruthy()
  })

  it('占位符参数在 zh-CN 与 en-US 之间一致（漏参会渲染出裸花括号）', () => {
    function placeholders(value: unknown, prefix = ''): Array<[string, string[]]> {
      if (typeof value === 'string') {
        return [[prefix, [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()]]
      }
      if (typeof value !== 'object' || value === null) return []
      return Object.entries(value).flatMap(([key, child]) =>
        placeholders(child, prefix === '' ? key : `${prefix}.${key}`),
      )
    }
    const zh = new Map(placeholders(zhCN))
    for (const [key, enParams] of placeholders(enUS)) {
      expect(zh.get(key), `en-US 独有键 ${key}`).toBeDefined()
      expect(zh.get(key), `占位符不一致：${key}`).toEqual(enParams)
    }
  })
})

describe('T14 暗色主题静态核验', () => {
  it('super-agent 组件的颜色声明全部经由主题变量（var(--…)），不硬编码', () => {
    const componentDir = resolve(process.cwd(), 'src/components/superAgent')
    const files = readdirSync(componentDir).filter((name) => name.endsWith('.vue'))
    // 防止目录为空时静默通过；不与组件数量耦合（组件可增删）。
    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('SuperAgentView.vue')
    const violations: string[] = []
    for (const name of files) {
      const lines = readFileSync(join(componentDir, name), 'utf8').split('\n')
      lines.forEach((line, index) => {
        // box-shadow 的半透明黑在明暗主题下均为自然投影，不计入颜色声明
        if (/box-shadow/.test(line)) return
        const hasColorLiteral = /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line)
        if (hasColorLiteral && !/var\(--/.test(line)) {
          violations.push(`${name}:${index + 1} ${line.trim()}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})
