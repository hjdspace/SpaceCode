/**
 * 串行调度器（T05 #75）。
 *
 * 默认 serial/maxWorkers=1、共享根目录、无 worktree；槽位在任何 await 之前
 * 同步预留（覆盖 prepare、启动、唤醒）。新工单按 createdOrdinal FIFO 排队，
 * 无槽位时排队且队列可见（queue() 快照 + onQueueChanged 通知）。
 *
 * launch 流程：脏区检查（提示 + 现状注入，不阻断）→ 上下文组装（Inline & Spill）
 * → pending→running → 调 launcher 接缝。launcher 为 null 表示 Executor 未接入，
 * 工单保持排队，不假装启动；launch 失败时 Assignment 结束为 failed、槽位释放、
 * 队列继续，并经 onLaunchError 上报健康（effect:launch）。
 */
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  SuperAgentDispatchResult,
  SuperAgentQueueEntry,
  SuperAgentQueueSnapshot,
} from '@/shared/channels/superAgent'
import { assembleWorkerFirstMessage, createFileSpillWriter, type SpillWriter } from './context'
import type { DispatchInput, DispatchResult, SuperAgentDomain } from './domain'
import { superAgentError } from './errors'
import { defaultWorkspaceProbe, type SuperAgentWorkspaceStatus, type WorkspaceProbe } from './workspace'

export interface WorkerLaunchRequest {
  ticketId: string
  assignmentId: string
  repoRoot: string
  firstMessage: string
  workspace: SuperAgentWorkspaceStatus
}

/** Executor 接缝：真实 Worker 会话启动由后续任务接入；测试注入 fake。 */
export interface WorkerLauncher {
  launch(request: WorkerLaunchRequest): Promise<void>
}

export interface SuperAgentSchedulerOptions {
  domain: SuperAgentDomain
  repoRoot: string
  /** null/缺省 = Executor 未接入，工单保持排队。 */
  launcher?: WorkerLauncher | null
  probe?: WorkspaceProbe
  spillWriter?: SpillWriter
  /** 默认 1；>1 必须显式 worktree，共享目录并行写被代码拒绝。 */
  maxWorkers?: number
  worktree?: boolean
  onQueueChanged?: (snapshot: SuperAgentQueueSnapshot) => void
  onLaunchError?: (ticketId: string, err: unknown) => void
  /** T06 #76：pending Assignment 已占槽、launch 尚未回报 → 卡片 preparing 子态。 */
  onPreparingChanged?: (ticketId: string, preparing: boolean) => void
  /** T06 #76：launch 生命周期改变领域事实/派生状态后通知投影同步。 */
  onDomainChanged?: () => void
  now?: () => Date
}

export interface SchedulerDispatchOutcome extends DispatchResult {
  /** 0 = 已占槽执行中；>0 = FIFO 队列位置。 */
  queuePosition: number
}

interface ReservedSlot {
  ticketId: string
  assignmentId: string
  dirty: boolean | null
}

const DEFAULT_MAX_WORKERS = 1

export function createSuperAgentScheduler(options: SuperAgentSchedulerOptions) {
  const {
    domain,
    repoRoot,
    launcher,
    probe = defaultWorkspaceProbe,
    spillWriter = createFileSpillWriter(join(tmpdir(), 'spacecode-super-agent-spill')),
    maxWorkers = DEFAULT_MAX_WORKERS,
    onQueueChanged,
    onLaunchError,
    onPreparingChanged,
    onDomainChanged,
  } = options

  // 共享目录（无 worktree）不允许并行写：代码拒绝，而不是靠提示词约束。
  if (maxWorkers > DEFAULT_MAX_WORKERS && !options.worktree) {
    throw superAgentError('slotUnavailable', { maxWorkers, worktree: 0 })
  }

  let active = 0
  const reserved = new Map<string, ReservedSlot>()
  /** T11 #81：在途 launch promise —— 显式 shutdown 有界等待的对象。 */
  const inFlightLaunches = new Set<Promise<void>>()
  /** T11 #81：shutdown 开始后不再启动新 launch（draining）。 */
  let stopping = false
  /** 派工时的 @ 上下文与附件：dispatch 落表，launch 时注入 Worker 首轮消息。 */
  const dispatchContext = new Map<string, { contextPaths: string[]; attachments: string[] }>()

  function pendingAssignments() {
    return Object.values(domain.state.assignments)
      .filter((assignment) => {
        if (assignment.state !== 'pending') return false
        const ticket = domain.state.tickets[assignment.ticketId]
        return ticket !== undefined && ticket.state === 'open'
      })
      .sort((a, b) => a.createdOrdinal - b.createdOrdinal)
  }

  function queue(): SuperAgentQueueSnapshot {
    const running: SuperAgentQueueEntry[] = [...reserved.values()].map((slot) => ({
      ticketId: slot.ticketId,
      title: domain.state.tickets[slot.ticketId]?.title ?? '',
      position: 0,
      state: 'running',
      dirty: slot.dirty,
    }))

    const queued: SuperAgentQueueEntry[] = pendingAssignments()
      .filter((assignment) => !reserved.has(assignment.ticketId))
      .map((assignment, index) => ({
        ticketId: assignment.ticketId,
        title: domain.state.tickets[assignment.ticketId]?.title ?? '',
        position: index + 1,
        state: 'queued',
        dirty: null,
      }))

    return { repoRoot, maxWorkers, running, queued }
  }

  function notify(): void {
    onQueueChanged?.(queue())
  }

  function queuePositionOf(ticketId: string): number {
    if (reserved.has(ticketId)) return 0
    const index = pendingAssignments()
      .filter((assignment) => !reserved.has(assignment.ticketId))
      .findIndex((assignment) => assignment.ticketId === ticketId)
    return index >= 0 ? index + 1 : 0
  }

  /** 槽位在任何 await 之前同步预留；后续的启动流程异步推进。 */
  function pump(): void {
    if (!launcher) return
    // T11 #81：shutdown draining 与项目暂停期间都不再启动新 launch
    // （暂停只阻止新 launch/delivery；活动 turn 不被静默打断）。
    if (stopping || domain.state.paused) return
    while (active < maxWorkers) {
      const next = pendingAssignments().find(
        (assignment) => !reserved.has(assignment.ticketId),
      )
      if (!next) break
      active += 1
      reserved.set(next.ticketId, { ticketId: next.ticketId, assignmentId: next.assignmentId, dirty: null })
      onPreparingChanged?.(next.ticketId, true)
      // 占槽即 preparing：seq 未变但卡片派生状态变了，投影据此发 ticket.updated
      onDomainChanged?.()
      const promise = launch(next.ticketId, next.assignmentId)
      inFlightLaunches.add(promise)
      void promise.then(
        () => {
          inFlightLaunches.delete(promise)
        },
        () => {
          inFlightLaunches.delete(promise)
        },
      )
    }
  }

  async function launch(ticketId: string, assignmentId: string): Promise<void> {
    const slot = reserved.get(ticketId)
    try {
      const workspace = await probe.probe(repoRoot)
      const ticket = domain.state.tickets[ticketId]
      const state = domain.state
      const firstMessage = assembleWorkerFirstMessage({
        ticket,
        mandate: state.mandates[ticket.mandateId],
        decision: state.decisions[ticketId],
        trigger: state.triggers[ticket.origin.triggerId],
        workspace,
        contextPaths: dispatchContext.get(ticketId)?.contextPaths ?? [],
        attachments: dispatchContext.get(ticketId)?.attachments ?? [],
        spillWriter,
      })
      domain.launchAssignment({ assignmentId })
      if (slot) slot.dirty = workspace.dirty
      // 已回报 assignmentStarted：preparing 子态结束，卡片回到领域阶段
      onPreparingChanged?.(ticketId, false)
      onDomainChanged?.()
      await launcher?.launch({
        ticketId,
        assignmentId,
        repoRoot,
        firstMessage: firstMessage.text,
        workspace,
      })
    } catch (err) {
      // 启动失败：Assignment 以 failed 收尾（不换 Assignment 的重试留给后续任务），
      // 槽位释放、队列继续，错误经接缝上报健康。
      try {
        domain.endAssignment({ assignmentId, reason: 'failed' })
      } catch {
        // endAssignment 幂等；此处失败不再向上传播
      }
      onPreparingChanged?.(ticketId, false)
      onLaunchError?.(ticketId, err)
      onDomainChanged?.()
    } finally {
      reserved.delete(ticketId)
      active -= 1
      // 先接续下一张再广播，保证快照反映 pump 后的队列现状
      pump()
      notify()
    }
  }

  function dispatch(input: DispatchInput): SchedulerDispatchOutcome {
    const result = domain.dispatch(input)
    dispatchContext.set(result.ticket.ticketId, {
      contextPaths: [...(input.contextPaths ?? [])],
      attachments: [...(input.attachments ?? [])],
    })
    pump()
    const queuePosition = queuePositionOf(result.ticket.ticketId)
    notify()
    return { ...result, queuePosition }
  }

  /**
   * T10 #80：人工重试。domain.retryTicket 校验闸门（只对 open 的
   * delivery/blocked/failed 开放）后新建 generation+1 的 pending Assignment；
   * pump 续跑队列（有槽位时新代次立即启动）。
   */
  function retry(input: { ticketId: string; at?: string }): {
    ticketId: string
    assignmentId: string
    generation: number
    queuePosition: number
  } {
    const result = domain.retryTicket({ ticketId: input.ticketId, at: input.at })
    pump()
    const queuePosition = queuePositionOf(result.ticket.ticketId)
    notify()
    onDomainChanged?.()
    return {
      ticketId: result.ticket.ticketId,
      assignmentId: result.assignment.assignmentId,
      generation: result.assignment.generation,
      queuePosition,
    }
  }

  /**
   * T11 #81：显式 shutdown —— 停止启动新 launch（draining），有界等待在途
   * launch 落定。超时直接返回 false（上层随之结束 shutdown 并释放锁），
   * 下次启动经恢复顺序生成恢复代次。
   */
  function settle(timeoutMs: number): Promise<boolean> {
    stopping = true
    if (inFlightLaunches.size === 0) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      void Promise.allSettled([...inFlightLaunches]).then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  /** T11 #81：恢复续跑 —— 重启恢复/解除暂停后补跑一次 pump 并广播队列现状。 */
  function resume(): void {
    pump()
    notify()
  }

  return { dispatch, queue, retry, settle, resume }
}

export type SuperAgentScheduler = ReturnType<typeof createSuperAgentScheduler>
