/**
 * Super Agent 主进程服务（T01 #71 骨架）。
 *
 * 以 repoRoot 为键维护每个项目的 Router 绑定：首次 routerBind 建会话并把领域
 * seq 推到 1，后续调用原样返回同一 sessionId；state 始终返回带 seq/asOf 的快照。
 * T01 不做持久化，进程重启后从空投影重新开始（持久化留给后续阶段）。
 */
import { randomUUID } from 'crypto'
import type {
  SuperAgentBindResult,
  SuperAgentSnapshot,
} from '@/shared/channels/superAgent'

const STALE_AFTER_MS = 5_000

interface ProjectState {
  seq: number
  router: { sessionId: string; running: boolean } | null
}

export interface SuperAgentService {
  state(repoRoot: string): SuperAgentSnapshot
  routerBind(repoRoot: string): SuperAgentBindResult
}

export function createSuperAgentService(): SuperAgentService {
  const projects = new Map<string, ProjectState>()

  function projectOf(repoRoot: string): ProjectState {
    let project = projects.get(repoRoot)
    if (!project) {
      project = { seq: 0, router: null }
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
  }
}
