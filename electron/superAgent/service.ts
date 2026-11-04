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
 */
import { randomUUID } from 'crypto'
import type {
  SuperAgentBindResult,
  SuperAgentDispatchCommand,
  SuperAgentDispatchResult,
  SuperAgentErrorPayload,
  SuperAgentHealthCategory,
  SuperAgentHealthReport,
  SuperAgentQueueSnapshot,
  SuperAgentSnapshot,
  SuperAgentWorkerMirror,
} from '@/shared/channels/superAgent'
import { superAgentWorkerSessionId } from '@/shared/channels/superAgent'
import type { SuperAgentTicket } from './model'
import type { SuperAgentReportKind, SuperAgentTicket } from './model'
import { superAgentError, serializeSuperAgentError } from './errors'
import {
  createSuperAgentHealthTracker,
  type SuperAgentHealthFailureInput,
  type SuperAgentHealthTracker,
} from './health'
import { createSuperAgentScheduler, type WorkerLauncher } from './scheduler'

const STALE_AFTER_MS = 5_000

interface ProjectState {
  seq: number
  router: { sessionId: string; running: boolean } | null
  health: SuperAgentHealthTracker
  domain: SuperAgentDomain
  scheduler: ReturnType<typeof createSuperAgentScheduler>
  /** 正在被只读镜像观察的 ticketId；Executor 接入后据此决定是否广播转录事件。 */
  observedWorkers: Set<string>
}

export interface SuperAgentServiceOptions {
  /** 健康项变化时回调（IPC 层据此广播 health.changed）。 */
  onHealthChanged?: (repoRoot: string, report: SuperAgentHealthReport) => void
  /** 队列变化时回调（IPC 层据此广播 queue-changed）。 */
  onQueueChanged?: (repoRoot: string, snapshot: SuperAgentQueueSnapshot) => void
  /** Worker 启动接缝；null/缺省 = Executor 未接入，工单保持排队。 */
  launcher?: WorkerLauncher | null
}

export interface SuperAgentService {
  state(repoRoot: string): SuperAgentSnapshot
  routerBind(repoRoot: string): SuperAgentBindResult
  health(repoRoot: string): SuperAgentHealthReport
  dispatch(repoRoot: string, command: SuperAgentDispatchCommand): SuperAgentDispatchResult
  queue(repoRoot: string): SuperAgentQueueSnapshot
  /** 幂等挂 Worker 只读镜像；未知 ticket 抛稳定 ticketNotFound。 */
  workerBind(repoRoot: string, ticketId: string): SuperAgentWorkerMirror
  /** 只停镜像观察，不动领域状态；幂等。 */
  workerUnbind(repoRoot: string, ticketId: string): true
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
      const scheduler = createSuperAgentScheduler({
        domain,
        repoRoot,
        launcher: options.launcher ?? null,
        onQueueChanged: (snapshot) => options.onQueueChanged?.(repoRoot, snapshot),
        onLaunchError: (ticketId, err) => {
          // launch 失败计入健康（effect:launch），错误信息带 ticketId 便于追溯
          health.recordFailure('effect:launch', {
            code: 'engineLaunchFailed',
            ticketId,
          })
        },
      })
      project = { seq: 0, router: null, health, domain, scheduler, observedWorkers: new Set() }
      projects.set(repoRoot, project)
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
      segments,
    }
  }

  function snapshotOf(repoRoot: string, project: ProjectState): SuperAgentSnapshot {
    return {
      repoRoot,
      seq: project.seq,
      asOf: Date.now(),
      staleAfterMs: STALE_AFTER_MS,
      router: project.router ? { ...project.router } : null,
      attention: { unanswered: 0 },
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
      const outcome = projectOf(repoRoot).scheduler.dispatch({
        requestId: command.requestId,
        title: command.title,
        repoRoot,
        text: command.text,
        actor: command.actor ?? 'desktop-user',
        contextPaths: command.contextPaths ?? [],
        attachments: command.attachments ?? [],
      })
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
      // 幂等：观察不存在也返回成功；领域状态不受影响，后台推进继续
      projectOf(repoRoot).observedWorkers.delete(ticketId)
      return true
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
