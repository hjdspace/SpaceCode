/**
 * Super Agent Channel 定义 — IPC 与 DTO 的单一真相源（T01 #71）。
 *
 * 当前只承载骨架所需的两条命令：
 *   state      — 读取带 seq 水位的项目快照（无 Router 时是空快照）
 *   routerBind — 幂等绑定 Router 会话，重复调用返回同一 sessionId
 *
 * 前缀 `super-agent:`。preload、renderer API、主进程 handler 均从这里派生。
 */
import { defineNamespace, type DeriveRendererApi } from '@/shared/channelMap'

export const SUPER_AGENT_PREFIX = 'super-agent:'

/** Router 会话的只读投影。T01 只有身份与运行状态，转录等内容留给后续阶段。 */
export interface SuperAgentRouterState {
  sessionId: string
  running: boolean
}

/** 项目快照。seq 是领域事件水位；asOf/staleAfterMs 让渲染层能判断快照是否过期。 */
export interface SuperAgentSnapshot {
  repoRoot: string
  seq: number
  asOf: number
  staleAfterMs: number
  router: SuperAgentRouterState | null
  attention: {
    unanswered: number
  }
}

export interface SuperAgentBindResult {
  sessionId: string
  running: boolean
  snapshot: SuperAgentSnapshot
}

export const superAgentNamespace = defineNamespace({
  channels: {
    state: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentSnapshot,
    },
    routerBind: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentBindResult,
    },
  },
  events: {},
})

export type SuperAgentRendererApi = DeriveRendererApi<typeof superAgentNamespace.channels>
