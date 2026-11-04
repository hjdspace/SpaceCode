/**
 * Super Agent 主进程服务（T01 #71 骨架，T13 #83 健康上报，T05 #75 显式派工）。
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
} from '@/shared/channels/superAgent'
import { createSuperAgentDomain, type SuperAgentDomain } from './domain'
import { serializeSuperAgentError } from './errors'
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
      project = { seq: 0, router: null, health, domain, scheduler }
      projects.set(repoRoot, project)
    }
    return project
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
