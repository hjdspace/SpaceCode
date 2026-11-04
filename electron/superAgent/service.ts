/**
 * Super Agent 主进程服务（T01 #71 骨架，T13 #83 健康上报，T05 #75 显式派工，
 * T07 #77 Worker 只读镜像）。
 *
 * 以 repoRoot 为键维护每个项目的 Router 绑定：首次 routerBind 建会话并把领域
 * seq 推到 1，后续调用原样返回同一 sessionId；state 始终返回带 seq/asOf 的快照。
 * T01 不做持久化，进程重启后从空投影重新开始（持久化留给后续阶段）。
 *
 * T13：每项目挂一个健康 tracker。record* 是主进程内部接缝（引擎/Effect/Source
 * 等模块上报失败与恢复）；渲染端只经 health 通道只读拉取 + health.changed 广播。
 * noteError 把未知错误码计入健康并返回稳定 payload，MVP 不提供处置命令。
 *
 * T05：每项目挂一个 domain + 串行 scheduler。「新建工单」经 dispatch 产生
 * Decision/Mandate/pending Assignment 并排队；queue() 只读拉取队列快照。
 * launcher 默认为 null（Executor 未接入），工单保持排队，不假启动。
 *
 * T07：workerBind 幂等挂 Worker 只读镜像 —— 稳定 sessionId（跨代次/重启不变）、
 * running 状态与按 generation 升序的 Assignment 代次分段快照；workerUnbind
 * 只摘掉观察登记，不动领域状态（关闭标签不影响后台推进）。Executor 接入后
 * 转录事件按观察登记决定是否向渲染端镜像。
 *
 * T06：每项目挂 progressProjector。workerReport 是 Executor 的主进程内部
 * 接缝：严格解析 Worker 消息中的唯一 Report JSON 块 → Domain.report 状态
 * 迁移 → 投影同步（ticket.updated 即时、ticket.progress 1 秒节流）。
 * tickets 返回全量卡片看板，供 Renderer 断档全量重拉。
 *
 * T09 #79 接管与交还：每项目同时至多一个接管（多面板不互抢），只切面板态、
 * 不改调度；接管输入 workerMessage 先落 Domain Input 再经 workerDeliverer
 * 接缝投递（null = Executor 未接入，不假投递）。requestId 是对账键：可证明
 * 未接受（pending）才重投，结果未知转 uncertain 并产生 delivery Attention，
 * 禁止盲目重投。关闭镜像标签（workerUnbind）一并释放接管，不残留面板态。
 */
import { randomUUID } from 'crypto'
import type {
  SuperAgentAttentionAnswerCommand,
  SuperAgentAttentionAnswerResult,
  SuperAgentAttentionBoard,
  SuperAgentAttentionEvent,
  SuperAgentBindResult,
  SuperAgentDispatchCommand,
  SuperAgentDispatchResult,
  SuperAgentErrorPayload,
  SuperAgentHealthCategory,
  SuperAgentHealthReport,
  SuperAgentQueueSnapshot,
  SuperAgentSnapshot,
  SuperAgentTakeoverChangedEvent,
  SuperAgentTakeoverState,
  SuperAgentTicketAcceptCommand,
  SuperAgentTicketActionResult,
  SuperAgentTicketBoard,
  SuperAgentTicketMessageCommand,
  SuperAgentTicketMessageResult,
  SuperAgentTicketProgress,
  SuperAgentTicketRetryCommand,
  SuperAgentTicketRetryResult,
  SuperAgentTicketStopCommand,
  SuperAgentTicketUpdateEvent,
  SuperAgentWorkerMessageCommand,
  SuperAgentWorkerMessageResult,
  SuperAgentWorkerMirror,
} from '@/shared/channels/superAgent'
import { superAgentWorkerSessionId } from '@/shared/channels/superAgent'
import { createSuperAgentDomain, type AddInputResult, type SuperAgentDomain } from './domain'
import type { SuperAgentReportKind, SuperAgentTicket } from './model'
import { superAgentError, serializeSuperAgentError } from './errors'
import {
  createSuperAgentAttentionProjector,
  type SuperAgentAttentionProjector,
} from './attentionProjector'
import {
  createSuperAgentHealthTracker,
  type SuperAgentHealthFailureInput,
  type SuperAgentHealthTracker,
} from './health'
import { createSuperAgentProgressProjector, type SuperAgentProgressProjector } from './progressProjector'
import { parseSuperAgentReportText } from './reportParser'
import { createSuperAgentReviewReminder, type SuperAgentReviewReminder } from './reviewReminder'
import { createSuperAgentScheduler, type WorkerLauncher } from './scheduler'

const STALE_AFTER_MS = 5_000

interface ProjectState {
  seq: number
  router: { sessionId: string; running: boolean } | null
  health: SuperAgentHealthTracker
  domain: SuperAgentDomain
  scheduler: ReturnType<typeof createSuperAgentScheduler>
  /** T06 #76：卡片投影（ticket.updated / ticket.progress 的主进程归一化源）。 */
  projector: SuperAgentProgressProjector
  /** T08 #78：Attention 投影（attention.asked/answered/withdrawn 广播源）。 */
  attentionProjector: SuperAgentAttentionProjector
  /** 正在被只读镜像观察的 ticketId；Executor 接入后据此决定是否广播转录事件。 */
  observedWorkers: Set<string>
  /** T09 #79：当前接管态；每项目同时至多一个，交还/关闭标签时清空。 */
  takeover: { ticketId: string; at: string } | null
  /** T10 #80：review 超时提醒引擎（持久水位 + 周期扫描）。 */
  reviewReminder: SuperAgentReviewReminder
}

export interface SuperAgentServiceOptions {
  /** 健康项变化时回调（IPC 层据此广播 health.changed）。 */
  onHealthChanged?: (repoRoot: string, report: SuperAgentHealthReport) => void
  /** 队列变化时回调（IPC 层据此广播 queue-changed）。 */
  onQueueChanged?: (repoRoot: string, snapshot: SuperAgentQueueSnapshot) => void
  /** T06 #76：领域事实变化时回调（IPC 层据此广播 ticket-updated）。 */
  onTicketUpdated?: (repoRoot: string, event: SuperAgentTicketUpdateEvent) => void
  /** T06 #76：节流后的轻量进度回调（IPC 层据此广播 ticket-progress）。 */
  onTicketProgress?: (repoRoot: string, progress: SuperAgentTicketProgress) => void
  /** T09 #79：接管/交还时回调（IPC 层据此广播 takeover-changed）。 */
  onTakeoverChanged?: (repoRoot: string, event: SuperAgentTakeoverChangedEvent) => void
  /** T08 #78：Attention 变化时回调（IPC 层据此广播 attention-asked/answered/withdrawn）。 */
  onAttentionEvent?: (repoRoot: string, event: SuperAgentAttentionEvent) => void
  /** Worker 启动接缝；null/缺省 = Executor 未接入，工单保持排队。 */
  launcher?: WorkerLauncher | null
  /** T09 #79：接管输入投递接缝；null/缺省 = Executor 未接入，不假投递。 */
  workerDeliverer?: SuperAgentWorkerDeliverer | null
  /**
   * T10 #80：review 超时提醒配置。hours 缺省取提案默认 24（待产品最终确认，
   * 唯一出处见 reviewReminder.ts 的 DEFAULT_REVIEW_REMINDER_HOURS）；
   * now/sweepIntervalMs 是测试注入接缝。
   */
  reviewReminder?: { hours?: number; now?: () => Date; sweepIntervalMs?: number }
}

/** T09 #79：workerMessage 的投递请求（Executor 接入前接缝为 null）。 */
export interface SuperAgentWorkerDeliveryRequest {
  ticketId: string
  /** 已落库 Domain Input 的 inputId：先落库再投递。 */
  inputId: string
  /** 幂等/对账键。 */
  requestId: string
  /** Worker 稳定会话 ID。 */
  sessionId: string
  text: string
}

/**
 * 'accepted' 已接受；'notAccepted' 可证明未接受（允许退回 pending 重投）；
 * 'unknown' 结果未知（转 uncertain + Attention，禁止盲目重投）。
 */
export type SuperAgentWorkerDeliveryOutcome = 'accepted' | 'notAccepted' | 'unknown'

export type SuperAgentWorkerDeliverer = (
  request: SuperAgentWorkerDeliveryRequest,
) => Promise<SuperAgentWorkerDeliveryOutcome>

/** T06 #76：workerReport 的确认结果（幂等确认原结果，duplicate=true）。 */
export interface SuperAgentWorkerReportResult {
  ticketId: string
  reportId: string
  kind: SuperAgentReportKind
  summary: string
  at: string
  duplicate: boolean
  attentionId: string | null
}

export interface SuperAgentService {
  state(repoRoot: string): SuperAgentSnapshot
  routerBind(repoRoot: string): SuperAgentBindResult
  health(repoRoot: string): SuperAgentHealthReport
  dispatch(repoRoot: string, command: SuperAgentDispatchCommand): SuperAgentDispatchResult
  queue(repoRoot: string): SuperAgentQueueSnapshot
  /** T06 #76：全量卡片看板 + 领域 seq 水位（断档重拉的基准）。 */
  tickets(repoRoot: string): SuperAgentTicketBoard
  /**
   * T06 #76：Executor 的主进程内部接缝 —— 严格解析 Worker 消息中的唯一
   * Report JSON 块并驱动状态迁移；协议失败抛稳定错误码，由调用方审计。
   */
  workerReport(repoRoot: string, input: { text: string }): SuperAgentWorkerReportResult
  /** 幂等挂 Worker 只读镜像；未知 ticket 抛稳定 ticketNotFound。 */
  workerBind(repoRoot: string, ticketId: string): SuperAgentWorkerMirror
  /** 只停镜像观察，不动领域状态；幂等。 */
  workerUnbind(repoRoot: string, ticketId: string): true
  /** T09 #79：接管 Worker 面板态；同 ticket 幂等，异 ticket 抛 takeoverConflict。 */
  workerTakeover(repoRoot: string, ticketId: string): SuperAgentTakeoverState
  /** T09 #79：交还；幂等，不残留接管态。 */
  workerRelease(repoRoot: string, ticketId: string): true
  /**
   * T09 #79：接管输入 —— 先落 Domain Input（requestId 幂等）再按调度投递；
   * 未接管抛 takeoverRequired。requestId 对账：可证明未接受才重投，
   * 无法确定转 uncertain 并产生 Attention，不盲目重投。
   */
  workerMessage(
    repoRoot: string,
    command: SuperAgentWorkerMessageCommand,
  ): Promise<SuperAgentWorkerMessageResult>
  /** T08 #78：Attention 气泡全量看板（含已回答的审计折叠项）。 */
  attentions(repoRoot: string): SuperAgentAttentionBoard
  /**
   * T08 #78：就地回答 Attention —— 回答作为领域 Input 投递给对应 Worker；
   * 幂等键 requestId，Attention 保持 open 直到 Worker 用 answers 认领。
   */
  attentionAnswer(
    repoRoot: string,
    command: SuperAgentAttentionAnswerCommand,
  ): SuperAgentAttentionAnswerResult
  /** T10 #80：接受验收 —— person/review 的显式出口（→ completed）。 */
  ticketAccept(repoRoot: string, command: SuperAgentTicketAcceptCommand): SuperAgentTicketActionResult
  /** T10 #80：停止出口 —— Mandate 撤回 + 工单 stopped，后续自动事件不得重开。 */
  ticketStop(repoRoot: string, command: SuperAgentTicketStopCommand): SuperAgentTicketActionResult
  /**
   * T10 #80：继续追问 —— review 的人消息复用原 Assignment 回到 working；
   * 与 workerMessage 同一套 requestId 对账投递。
   */
  ticketMessage(
    repoRoot: string,
    command: SuperAgentTicketMessageCommand,
  ): Promise<SuperAgentTicketMessageResult>
  /** T10 #80：人工重试 —— 只对 open 的 delivery/blocked/failed 开放，generation+1。 */
  ticketRetry(repoRoot: string, command: SuperAgentTicketRetryCommand): SuperAgentTicketRetryResult
  /** T10 #80：手动扫描一次 review 超时提醒（周期扫描之外的对账/测试接缝）。 */
  sweepReviewReminders(repoRoot: string): number
  recordHealthSuccess(repoRoot: string, category: SuperAgentHealthCategory): void
  recordHealthFailure(
    repoRoot: string,
    category: SuperAgentHealthCategory,
    detail?: SuperAgentHealthFailureInput,
  ): void
  /** 序列化任意错误为稳定 payload；未知 code 计入健康。 */
  noteError(repoRoot: string, err: unknown): SuperAgentErrorPayload
}

export function createSuperAgentService(options: SuperAgentServiceOptions = {}): SuperAgentService {
  const projects = new Map<string, ProjectState>()

  function projectOf(repoRoot: string): ProjectState {
    let project = projects.get(repoRoot)
    if (!project) {
      const health = createSuperAgentHealthTracker({ repoRoot })
      health.subscribe((report) => options.onHealthChanged?.(repoRoot, report))
      const domain = createSuperAgentDomain()
      const projector = createSuperAgentProgressProjector({
        domain,
        repoRoot,
        onTicketUpdated: (event) => options.onTicketUpdated?.(repoRoot, event),
        onTicketProgress: (progress) => options.onTicketProgress?.(repoRoot, progress),
      })
      const attentionProjector = createSuperAgentAttentionProjector({
        domain,
        repoRoot,
        onAttentionEvent: (event) => options.onAttentionEvent?.(repoRoot, event),
      })
      const scheduler = createSuperAgentScheduler({
        domain,
        repoRoot,
        launcher: options.launcher ?? null,
        onQueueChanged: (snapshot) => options.onQueueChanged?.(repoRoot, snapshot),
        onPreparingChanged: (ticketId, preparing) => projector.setPreparing(ticketId, preparing),
        onDomainChanged: () => {
          projector.sync()
          attentionProjector.sync()
        },
        onLaunchError: (ticketId, err) => {
          // launch 失败计入健康（effect:launch），错误信息带 ticketId 便于追溯
          health.recordFailure('effect:launch', {
            code: 'engineLaunchFailed',
            ticketId,
          })
        },
      })
      // T10 #80：review 超时提醒引擎 —— 水位写入领域后同步投影，
      // 卡片的 reviewRemindedAt 变化经既有 ticket.updated 广播到渲染端。
      const reviewReminder = createSuperAgentReviewReminder({
        domain,
        hours: options.reviewReminder?.hours,
        now: options.reviewReminder?.now,
        sweepIntervalMs: options.reviewReminder?.sweepIntervalMs,
        onRemind: () => {
          projector.sync()
        },
      })
      project = {
        seq: 0,
        router: null,
        health,
        domain,
        scheduler,
        projector,
        attentionProjector,
        observedWorkers: new Set(),
        takeover: null,
        reviewReminder,
      }
      projects.set(repoRoot, project)
      // 持久化 scheduled effect：项目一落地即开始周期扫描（含一次即时重建扫描）
      reviewReminder.start()
    }
    return project
  }

  /** Worker 只读镜像快照：稳定 sessionId + running + 按 generation 升序的代次分段。 */
  function workerMirrorOf(
    repoRoot: string,
    project: ProjectState,
    ticketId: string,
    ticket: SuperAgentTicket,
  ): SuperAgentWorkerMirror {
    const state = project.domain.state
    const segments = ticket.assignmentIds
      .map((id) => state.assignments[id])
      .filter((assignment) => assignment !== undefined)
      .sort((a, b) => a.generation - b.generation)
      .map((assignment) => ({
        assignmentId: assignment.assignmentId,
        generation: assignment.generation,
        state: assignment.state,
        endedReason: assignment.endedReason,
        createdAt: assignment.createdAt,
        startedAt: assignment.startedAt,
        endedAt: assignment.endedAt,
        reportKind: assignment.report?.kind ?? null,
        reportSummary: assignment.report?.summary ?? null,
      }))
    return {
      repoRoot,
      ticketId,
      title: ticket.title,
      sessionId: superAgentWorkerSessionId(ticketId),
      running: segments.some((segment) => segment.state === 'running'),
      takenOver: project.takeover?.ticketId === ticketId,
      segments,
    }
  }

  /**
   * T09/T10 共用：先落库后投递的 requestId 对账 —— 可证明未接受（pending）
   * 才重投；delivered/read 已接受跳过；uncertain 禁止盲目重投并产生 Attention。
   */
  async function settleWorkerInputDelivery(
    project: ProjectState,
    command: { ticketId: string; requestId: string; text: string },
    added: AddInputResult,
  ): Promise<SuperAgentWorkerMessageResult> {
    const deliverer = options.workerDeliverer ?? null
    if (deliverer) {
      // duplicate 路径的 gated 是「未投出」而非「闸门拦截」，按 status 判断即可
      const shouldDeliver = added.duplicate
        ? added.input.status === 'pending'
        : added.delivered && !added.gated
      if (shouldDeliver) {
        const outcome = await deliverer({
          ticketId: command.ticketId,
          inputId: added.input.inputId,
          requestId: command.requestId,
          sessionId: superAgentWorkerSessionId(command.ticketId),
          text: command.text,
        })
        if (outcome === 'accepted') {
          // 接受事实落盘后才标 delivered（重投成功时从 pending 转回 delivered）
          project.domain.deliverInput({ inputId: added.input.inputId })
        } else if (outcome === 'notAccepted') {
          project.domain.requeueInput({ inputId: added.input.inputId })
        } else if (outcome === 'unknown') {
          project.domain.markInputUncertain({
            inputId: added.input.inputId,
            reason: 'deliveryUnknown',
          })
        }
        // Input 状态变化是领域事实：卡片即时投影
        project.projector.sync()
        // uncertain 会产生 delivery Attention：气泡同步投影（T08 #78）
        project.attentionProjector.sync()
      }
    }

    const input = project.domain.state.inputs[added.input.inputId]
    return {
      inputId: input.inputId,
      ticketId: input.ticketId,
      status: input.status,
      delivered: input.status === 'delivered' || input.status === 'read',
      gated: added.gated,
      duplicate: added.duplicate,
    }
  }

  /** T09 #79：接管/交还广播 —— 各面板据此同步，避免多面板互抢。 */
  function notifyTakeoverChanged(repoRoot: string, project: ProjectState): void {
    options.onTakeoverChanged?.(repoRoot, {
      repoRoot,
      takeover: project.takeover
        ? { repoRoot, ticketId: project.takeover.ticketId, at: project.takeover.at }
        : null,
    })
  }

  function snapshotOf(repoRoot: string, project: ProjectState): SuperAgentSnapshot {
    // T10 #80：仍在待验收且已超时提醒过的工单数（按工单去重，不按提醒次数计）。
    const reminded = Object.values(project.domain.state.tickets).filter(
      (ticket) =>
        ticket.state === 'open' &&
        ticket.reviewRemindedAt !== null &&
        project.domain.stageOf(ticket.ticketId) === 'person/review',
    ).length
    return {
      repoRoot,
      seq: project.seq,
      asOf: Date.now(),
      staleAfterMs: STALE_AFTER_MS,
      router: project.router ? { ...project.router } : null,
      // T08 #78：按工单去重的待处理 Attention 数（徽章/顶部计数联动）。
      attention: { unanswered: project.attentionProjector.pendingTickets() },
      review: { reminded },
    }
  }

  return {
    state(repoRoot) {
      return snapshotOf(repoRoot, projectOf(repoRoot))
    },

    routerBind(repoRoot) {
      const project = projectOf(repoRoot)
      if (!project.router) {
        project.router = { sessionId: randomUUID(), running: false }
        project.seq += 1
      }
      return {
        sessionId: project.router.sessionId,
        running: project.router.running,
        snapshot: snapshotOf(repoRoot, project),
      }
    },

    health(repoRoot) {
      return projectOf(repoRoot).health.report()
    },

    dispatch(repoRoot, command) {
      const project = projectOf(repoRoot)
      const outcome = project.scheduler.dispatch({
        requestId: command.requestId,
        title: command.title,
        repoRoot,
        text: command.text,
        actor: command.actor ?? 'desktop-user',
        contextPaths: command.contextPaths ?? [],
        attachments: command.attachments ?? [],
      })
      // T06 #76：新建工单是领域事实，派生卡片即时投影（launcher 为 null 时
      // scheduler 不会回调 onDomainChanged，这里兜底）
      project.projector.sync()
      project.attentionProjector.sync()
      return {
        ticketId: outcome.ticket.ticketId,
        assignmentId: outcome.assignment.assignmentId,
        decisionId: outcome.decision.decisionId,
        mandateId: outcome.mandate.mandateId,
        queuePosition: outcome.queuePosition,
        duplicate: outcome.duplicate,
      }
    },

    queue(repoRoot) {
      return projectOf(repoRoot).scheduler.queue()
    },

    tickets(repoRoot) {
      const project = projectOf(repoRoot)
      // 读路径先同步一次：若存在未投影的领域变化（如后台 launch 回调竞态），
      // 借此自愈并保证 seq 水位与卡片一致
      project.projector.sync()
      return {
        repoRoot,
        seq: project.domain.state.seq,
        tickets: project.projector.cards(),
      }
    },

    workerReport(repoRoot, input) {
      const project = projectOf(repoRoot)
      const parsed = parseSuperAgentReportText(input.text)
      const assignment = project.domain.state.assignments[parsed.assignmentId]
      if (!assignment) {
        // 伪造/错位：assignmentId 不属于本项目的任何执行，稳定拒绝
        throw superAgentError('assignmentNotFound', { assignmentId: parsed.assignmentId })
      }
      const result = project.domain.report({
        ticketId: assignment.ticketId,
        assignmentId: parsed.assignmentId,
        reportId: parsed.reportId,
        kind: parsed.kind,
        summary: parsed.summary,
        question: parsed.question,
        askedBy: parsed.askedBy,
        answers: parsed.answers,
        details: parsed.details,
        artifacts: parsed.artifacts,
      })
      if (parsed.progress) {
        project.projector.recordProgress(assignment.ticketId, parsed.progress)
      }
      // Report 是领域事实：卡片即时投影（现有卡片原位更新，不重复发气泡）
      project.projector.sync()
      // question/answers 变化驱动 Attention 气泡（T08 #78）
      project.attentionProjector.sync()
      return {
        ticketId: assignment.ticketId,
        reportId: result.report.reportId,
        kind: result.report.kind,
        summary: result.report.summary,
        at: result.report.at,
        duplicate: result.duplicate,
        attentionId: result.attentionId,
      }
    },

    workerBind(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      const ticket = project.domain.state.tickets[ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId })
      }
      project.observedWorkers.add(ticketId)
      return workerMirrorOf(repoRoot, project, ticketId, ticket)
    },

    workerUnbind(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      // 幂等：观察不存在也返回成功；领域状态不受影响，后台推进继续
      project.observedWorkers.delete(ticketId)
      // 关闭镜像标签一并释放接管：面板没了，不残留接管态（T09 #79）
      if (project.takeover?.ticketId === ticketId) {
        project.takeover = null
        notifyTakeoverChanged(repoRoot, project)
      }
      return true
    },

    workerTakeover(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      const ticket = project.domain.state.tickets[ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId })
      }
      if (project.takeover && project.takeover.ticketId !== ticketId) {
        // 同一项目同时至多一个接管：多面板不互抢
        throw superAgentError('takeoverConflict', {
          ticketId,
          activeTicketId: project.takeover.ticketId,
        })
      }
      if (!project.takeover) {
        // 只切面板态：不动领域、不动队列、不触发调度
        project.takeover = { ticketId, at: new Date().toISOString() }
        notifyTakeoverChanged(repoRoot, project)
      }
      return { repoRoot, ticketId, at: project.takeover.at }
    },

    workerRelease(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      if (project.takeover?.ticketId === ticketId) {
        project.takeover = null
        notifyTakeoverChanged(repoRoot, project)
      }
      // 幂等：未接管/重复交还都成功，交还不残留接管态
      return true
    },

    async workerMessage(repoRoot, command) {
      const project = projectOf(repoRoot)
      if (project.takeover?.ticketId !== command.ticketId) {
        throw superAgentError('takeoverRequired', { ticketId: command.ticketId })
      }
      if (typeof command.text !== 'string' || command.text.trim() === '') {
        throw superAgentError('invalidWorkerMessage', { ticketId: command.ticketId })
      }
      const ticket = project.domain.state.tickets[command.ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId: command.ticketId })
      }

      // 先落库：requestId 幂等，重复提交返回原 Input（对账依据）
      const added = project.domain.addInput({
        ticketId: command.ticketId,
        requestId: command.requestId,
        kind: 'text',
        human: true,
        text: command.text,
        note: command.note ?? null,
      })

      // 再投递：与 ticketMessage 共用 requestId 对账（settleWorkerInputDelivery）
      return settleWorkerInputDelivery(project, command, added)
    },

    attentions(repoRoot) {
      const project = projectOf(repoRoot)
      // 读路径先同步一次：与 tickets 一致的自愈语义，保证看板不落后于领域事实
      project.attentionProjector.sync()
      return project.attentionProjector.board()
    },

    attentionAnswer(repoRoot, command) {
      const project = projectOf(repoRoot)
      // 回答经 domain.ts 既有接缝（answerAttention → addInput）落库并投递；
      // 协议失败抛稳定错误码（notAttention/notQuestion/invalidAnswer），由 IPC 层序列化
      const answered = project.domain.answerAttention({
        attentionId: command.attentionId,
        requestId: command.requestId,
        text: command.text,
      })
      // 回答已追加到 open Attention 的 answers：气泡视图刷新（asked）
      project.attentionProjector.sync()
      return {
        attentionId: command.attentionId,
        ticketId: answered.attention.ticketId,
        inputId: answered.input.inputId,
        status: answered.input.status,
        delivered: answered.delivered,
        gated: answered.gated,
        duplicate: answered.duplicate,
      }
    },

    ticketAccept(repoRoot, command) {
      const project = projectOf(repoRoot)
      const result = project.domain.ticketAccept({ ticketId: command.ticketId })
      // 工单结束是领域事实：卡片（→ completed）与 Attention（撤回）即时投影
      project.projector.sync()
      project.attentionProjector.sync()
      return {
        repoRoot,
        ticketId: result.ticket.ticketId,
        outcome: 'completed',
        endedAt: result.ticket.ended?.at ?? '',
      }
    },

    ticketStop(repoRoot, command) {
      const project = projectOf(repoRoot)
      const result = project.domain.ticketStop({
        ticketId: command.ticketId,
        reason: command.reason,
      })
      project.projector.sync()
      project.attentionProjector.sync()
      return {
        repoRoot,
        ticketId: result.ticket.ticketId,
        outcome: 'stopped',
        endedAt: result.ticket.ended?.at ?? '',
      }
    },

    async ticketMessage(repoRoot, command) {
      const project = projectOf(repoRoot)
      const ticket = project.domain.state.tickets[command.ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId: command.ticketId })
      }
      // 先落库（空文本由领域抛 invalidTicketMessage）：复用原 Assignment 回到 working
      const added = project.domain.ticketMessage({
        ticketId: command.ticketId,
        requestId: command.requestId,
        text: command.text,
      })
      // 再投递：与 workerMessage 共用 requestId 对账（settleWorkerInputDelivery）
      return settleWorkerInputDelivery(project, command, added)
    },

    ticketRetry(repoRoot, command) {
      const project = projectOf(repoRoot)
      // scheduler.retry：domain.retryTicket 校验闸门后新建 generation+1，
      // 并经 onDomainChanged 回调投影同步 + 队列广播
      return project.scheduler.retry({ ticketId: command.ticketId })
    },

    sweepReviewReminders(repoRoot) {
      return projectOf(repoRoot).reviewReminder.sweep()
    },

    recordHealthSuccess(repoRoot, category) {
      projectOf(repoRoot).health.recordSuccess(category)
    },

    recordHealthFailure(repoRoot, category, detail) {
      projectOf(repoRoot).health.recordFailure(category, detail)
    },

    noteError(repoRoot, err) {
      const payload = serializeSuperAgentError(err)
      if (!payload.known) {
        projectOf(repoRoot).health.recordFailure('unknownError', { code: payload.code })
      }
      return payload
    },
  }
}
