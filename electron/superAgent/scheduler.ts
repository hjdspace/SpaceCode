/**
 * 调度器（T05 #75；T12 #82 扩展为策略驱动）。
 *
 * 执行策略是持久领域事实（domain.state.executionPolicy），每次调度动态读取，
 * 变更经 applyPolicy 即时生效。默认 serial/1、共享根目录、无 worktree；显式
 * 并行强制 per-ticket worktree（构造时校验持久状态不变量）。槽位在任何 await
 * 之前同步预留（覆盖 prepare、启动、唤醒）。新工单按 createdOrdinal FIFO 排队，
 * 无槽位时排队且队列可见（queue() 快照 + onQueueChanged 通知）。
 *
 * T12 #82 handoff 槽位释放语义：handoff Report（waiting/ready/blocked/failed/
 * dropped）先标记意图；对应 turn 已结束、Report 之后没有新 Input、且没有占槽
 * 后台工作（MVP 以 Worker 最终 Report 前确认子 agent 结束替代枚举）三个条件全
 * 满足后才经 handoff() 提前释放槽位 —— launch 落定时的释放幂等，不会二次扣减。
 *
 * launch 流程：检查点保存（每轮启动前）→ 脏区检查（提示 + 现状注入，不阻断）
 * → per-ticket worktree（并行策略）→ 上下文组装（Inline & Spill）→ pending→running
 * → 调 launcher 接缝。launcher 为 null 表示 Executor 未接入，工单保持排队，
 * 不假装启动；launch 失败时 Assignment 结束为 failed、槽位释放、队列继续，
 * 并经 onLaunchError 上报健康（effect:launch）。
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
import { createCheckpointStore, type SuperAgentCheckpointStore } from './checkpoint'
import { createTicketWorktreePreparer, type TicketWorktreePreparer } from './ticketWorktree'
import {
  createExecFileGitRunner,
  defaultWorkspaceProbe,
  type SuperAgentWorkspaceStatus,
  type WorkspaceProbe,
} from './workspace'

export interface WorkerWorktreeInfo {
  absolute: string
  relative: string
  branch: string
  reused: boolean
}

export interface WorkerLaunchRequest {
  ticketId: string
  assignmentId: string
  /** Worker 实际执行的根目录：串行 = repoRoot，并行 = per-ticket worktree。 */
  repoRoot: string
  firstMessage: string
  model?: string
  workspace: SuperAgentWorkspaceStatus
  /** T12 #82：per-ticket worktree 信息；串行为 null。 */
  worktree: WorkerWorktreeInfo | null
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
  /** T12 #82：每轮 launch 前保存检查点；缺省内建（按 repoRoot 保留最新一份）。 */
  checkpoints?: SuperAgentCheckpointStore
  /** T12 #82：per-ticket worktree 准备器；缺省复用 Factory worktree 基建。 */
  preparer?: TicketWorktreePreparer
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

/** T12 #82：Executor 通知 handoff 的状态 —— turn 已结束 + 后台工作占槽情况。 */
export interface SchedulerHandoffStatus {
  turnEnded: boolean
  /** MVP：Worker 最终 Report 前确认子 agent 已结束 → false；有占槽工作 → true。 */
  backgroundWork: boolean
}

interface ReservedSlot {
  ticketId: string
  assignmentId: string
  dirty: boolean | null
  /** T12 #82：handoff 提前释放标记 —— launch 落定时据此跳过二次扣减。 */
  released: boolean
}

/** handoff Report 种类：先标意图，满足释放条件后释放逻辑槽位。 */
const HANDOFF_REPORT_KINDS = new Set(['waiting', 'ready', 'blocked', 'failed', 'dropped'])

export function createSuperAgentScheduler(options: SuperAgentSchedulerOptions) {
  const {
    domain,
    repoRoot,
    launcher,
    probe = defaultWorkspaceProbe,
    spillWriter = createFileSpillWriter(join(tmpdir(), 'spacecode-super-agent-spill')),
    checkpoints = createCheckpointStore({ run: createExecFileGitRunner() }),
    preparer = createTicketWorktreePreparer(),
    onQueueChanged,
    onLaunchError,
    onPreparingChanged,
    onDomainChanged,
  } = options

  /** 策略是持久领域事实：每次调度读取当前值，变更即时生效。 */
  const policy = () => domain.state.executionPolicy

  // 并行必须 per-ticket worktree（共享目录并行写被代码拒绝）；正常路径由
  // domain.setExecutionPolicy 结构性保证，此处守住持久状态损坏的兜底。
  if (policy().mode === 'parallel' && policy().worktree !== 'per-ticket') {
    throw superAgentError('parallelRequiresWorktree', {
      mode: policy().mode,
      maxWorkers: policy().maxWorkers,
      worktree: policy().worktree,
    })
  }

  let active = 0
  const reserved = new Map<string, ReservedSlot>()
  /**
   * T23 #94：等权限的 Worker 释放了逻辑槽位；回答前要重新拿槽。
   * 槽位全满时排队（优先于新工单），避免串行队列自锁。
   */
  const permissionWaiters: Array<{
    ticketId: string
    resolvers: Array<(acquired: boolean) => void>
  }> = []
  /** T11 #81：在途 launch promise —— 显式 shutdown 有界等待的对象。 */
  const inFlightLaunches = new Set<Promise<void>>()
  /** T11 #81：shutdown 开始后不再启动新 launch（draining）。 */
  let stopping = false
  /** 派工时的 @ 上下文、附件与路由说明：dispatch 落表，launch 时注入 Worker 首轮消息。 */
  const dispatchContext = new Map<
    string,
    { contextPaths: string[]; attachments: string[]; note: string | null }
  >()

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

    return { repoRoot, maxWorkers: policy().maxWorkers, running, queued }
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

  /** T23 #94：权限回答只对仍在跑的当次执行有效；找不到就不占槽。 */
  function answerableAssignmentOf(ticketId: string) {
    const candidates = Object.values(domain.state.assignments)
      .filter((assignment) => assignment.ticketId === ticketId && assignment.state === 'running')
      .sort((a, b) => a.createdOrdinal - b.createdOrdinal)
    return candidates[candidates.length - 1]
  }

  /** T23 #94：回答前重新预留槽位（同步预留，先于任何 await）。 */
  function reserveSlot(ticketId: string, assignmentId: string): void {
    active += 1
    reserved.set(ticketId, { ticketId, assignmentId, dirty: null, released: false })
  }

  /** 槽位在任何 await 之前同步预留；后续的启动流程异步推进。 */
  function pump(): void {
    if (!launcher) return
    // T11 #81：shutdown draining 与项目暂停期间都不再启动新 launch
    // （暂停只阻止新 launch/delivery；活动 turn 不被静默打断）。
    if (stopping || domain.state.paused) return
    // T23 #94：等权限回答的 Worker 优先回到槽位，其次才是新工单
    while (active < policy().maxWorkers && permissionWaiters.length > 0) {
      const waiter = permissionWaiters.shift()!
      const assignment = answerableAssignmentOf(waiter.ticketId)
      if (!assignment) {
        for (const resolve of waiter.resolvers) resolve(false)
        continue
      }
      reserveSlot(waiter.ticketId, assignment.assignmentId)
      for (const resolve of waiter.resolvers) resolve(true)
    }
    while (active < policy().maxWorkers) {
      const next = pendingAssignments().find(
        (assignment) => !reserved.has(assignment.ticketId),
      )
      if (!next) break
      active += 1
      reserved.set(next.ticketId, {
        ticketId: next.ticketId,
        assignmentId: next.assignmentId,
        dirty: null,
        released: false,
      })
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

  /**
   * T12 #82：释放槽位（幂等）。handoff 提前释放与 launch 落定释放共用；
   * 已释放（slot.released）直接返回，绝二次扣减 active。
   */
  function releaseSlot(slot: ReservedSlot): void {
    if (slot.released) return
    slot.released = true
    reserved.delete(slot.ticketId)
    active -= 1
    // 先接续下一张再广播，保证快照反映 pump 后的队列现状
    pump()
    notify()
  }

  /**
   * T12 #82：handoff 槽位释放语义 —— handoff Report（waiting/ready/blocked/
   * failed/dropped）先标意图；Executor 确认「turn 已结束」与「无占槽后台工作」
   * （MVP：Worker 最终 Report 前确认子 agent 已结束）后调用本方法提前释放槽位。
   *
   * 释放条件（全部满足才释放）：
   *  1. 该 ticket 占着未释放的槽位；
   *  2. 最新 Report 是 handoff 种类（progress 不算）；
   *  3. turn 已结束（turnEnded）；
   *  4. handoff Report 之后没有新 Input（有 → 需要唤醒，槽位保留）；
   *  5. 无占槽后台工作（backgroundWork=false）。
   *
   * 返回 true 表示槽位已释放（下一张排队工单立即占槽）。
   */
  function handoff(ticketId: string, status: SchedulerHandoffStatus): boolean {
    const slot = reserved.get(ticketId)
    if (!slot || slot.released) return false
    if (!status.turnEnded) return false
    if (status.backgroundWork) return false
    const assignment = domain.state.assignments[slot.assignmentId]
    const report = assignment?.report ?? null
    if (!report || !HANDOFF_REPORT_KINDS.has(report.kind)) return false
    const ticket = domain.state.tickets[ticketId]
    const hasLaterInput = (ticket?.inputIds ?? []).some((inputId) => {
      const input = domain.state.inputs[inputId]
      return input !== undefined && input.ordinal > report.ordinal
    })
    if (hasLaterInput) return false
    releaseSlot(slot)
    return true
  }

  /**
   * T23 #94：Worker 等权限请求时释放逻辑槽位，进程现场保留。
   * 与 handoff 不同，这里没有 handoff Report，也不要求 turn 结束 —— 引擎正卡在
   * permission request 上，这一轮不可能自行收尾。
   */
  function holdForPermission(ticketId: string): boolean {
    const slot = reserved.get(ticketId)
    if (!slot || slot.released) return false
    releaseSlot(slot)
    return true
  }

  /**
   * T23 #94：回答权限前重新取得槽位。槽位空闲立即预留；全满则排队，由
   * releaseSlot → pump 按「先等权限、后新工单」的次序唤醒（串行也不自锁）。
   * 返回 false 表示该工单已没有可回答的在跑执行（已 stop/收尾）。
   */
  function acquireForPermissionAnswer(ticketId: string): Promise<boolean> {
    const current = reserved.get(ticketId)
    if (current && !current.released) return Promise.resolve(true)
    if (stopping || domain.state.paused || !launcher) return Promise.resolve(false)
    const assignment = answerableAssignmentOf(ticketId)
    if (!assignment) return Promise.resolve(false)
    if (active < policy().maxWorkers) {
      reserveSlot(ticketId, assignment.assignmentId)
      notify()
      return Promise.resolve(true)
    }
    // 同一工单只排一个等待位：回答与取消可能同时来，重复排队会重复占槽。
    const pending = permissionWaiters.find((waiter) => waiter.ticketId === ticketId)
    if (pending) {
      return new Promise<boolean>((resolve) => pending.resolvers.push(resolve))
    }
    return new Promise<boolean>((resolve) => {
      permissionWaiters.push({ ticketId, resolvers: [resolve] })
    })
  }

  async function launch(ticketId: string, assignmentId: string): Promise<void> {
    const slot = reserved.get(ticketId)
    try {
      const workspace = await probe.probe(repoRoot)
      // T12 #82：每轮启动前保存检查点（HEAD/status/untracked/diff），供按文件人工回退
      if (workspace.head) {
        await checkpoints.save(repoRoot, workspace)
      }
      const ticket = domain.state.tickets[ticketId]
      const state = domain.state
      // T12 #82：并行策略强制 per-ticket worktree —— Worker 在独立工作树执行
      let workerRoot = repoRoot
      let worktree: WorkerWorktreeInfo | null = null
      if (state.executionPolicy.worktree === 'per-ticket') {
        const prepared = await preparer.prepare(repoRoot, ticketId)
        if (!prepared.ok) {
          throw superAgentError('worktreeUnavailable', {
            ticketId,
            detail: prepared.detail ?? prepared.error,
          })
        }
        worktree = prepared.worktree
        workerRoot = prepared.worktree.absolute
      }
      const workerWorkspace = worktree ? await probe.probe(workerRoot) : workspace
      const firstMessage = assembleWorkerFirstMessage({
        ticket,
        mandate: state.mandates[ticket.mandateId],
        decision: state.decisions[ticketId],
        trigger: state.triggers[ticket.origin.triggerId],
        workspace: workerWorkspace,
        contextPaths: dispatchContext.get(ticketId)?.contextPaths ?? [],
        attachments: dispatchContext.get(ticketId)?.attachments ?? [],
        note: dispatchContext.get(ticketId)?.note ?? null,
        policyRules: state.policy.rules,
        spillWriter,
      })
      domain.launchAssignment({ assignmentId })
      const origin = state.triggers[ticket.origin.triggerId]
      if (origin.human && !ticket.inputIds.some((id) => state.inputs[id]?.triggerId === origin.triggerId)) {
        domain.addInput({
          ticketId,
          requestId: `worker-origin:${ticketId}`,
          kind: 'trigger',
          human: true,
          triggerId: origin.triggerId,
          text: origin.text,
        })
      }
      if (slot) slot.dirty = workerWorkspace.dirty
      // 已回报 assignmentStarted：preparing 子态结束，卡片回到领域阶段
      onPreparingChanged?.(ticketId, false)
      onDomainChanged?.()
      await launcher?.launch({
        ticketId,
        assignmentId,
        repoRoot: workerRoot,
        firstMessage: firstMessage.text,
        model: ticket.execution.model,
        workspace: workerWorkspace,
        worktree,
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
      // 可能已经 hold 后重新预留过：释放「当前」槽位，别让重预留泄漏。
      const current = reserved.get(ticketId)
      if (current) {
        releaseSlot(current)
      } else {
        pump()
        notify()
      }
    }
  }

  function dispatch(input: DispatchInput): SchedulerDispatchOutcome {
    const result = domain.dispatch(input)
    dispatchContext.set(result.ticket.ticketId, {
      contextPaths: [...(input.contextPaths ?? [])],
      attachments: [...(input.attachments ?? [])],
      note: input.note ?? null,
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
    // 停机时不再有人回答权限：挂起的等待者立即失败，不留悬空 Promise。
    for (const waiter of permissionWaiters.splice(0)) {
      for (const resolve of waiter.resolvers) resolve(false)
    }
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

  /**
   * T12 #82：策略变更即时生效 —— service 在 setExecutionPolicy 落领域后调用，
   * 按新上限补跑 pump 并广播队列现状。
   */
  function applyPolicy(): void {
    pump()
    notify()
  }

  /** T12 #82：是否有 Worker 占槽（策略热切换闸门：运行中不热切换）。 */
  function hasActiveWorkers(): boolean {
    return reserved.size > 0
  }

  return {
    dispatch,
    queue,
    retry,
    settle,
    resume,
    handoff,
    holdForPermission,
    acquireForPermissionAnswer,
    applyPolicy,
    hasActiveWorkers,
  }
}

export type SuperAgentScheduler = ReturnType<typeof createSuperAgentScheduler>
