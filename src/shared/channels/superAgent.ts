/**
 * Super Agent Channel 定义 — IPC 与 DTO 的单一真相源（T01 #71 起）。
 *
 * 命令：
 *   state      — 读取带 seq 水位的项目快照（无 Router 时是空快照）
 *   routerBind — 幂等绑定 Router 会话，重复调用返回同一 sessionId
 *   health     — 只读系统健康报告（T13 #83）
 * 事件：
 *   health-changed — 健康项变化时广播（repoRoot, report）
 *
 * 前缀 `super-agent:`。preload、renderer API、主进程 handler 均从这里派生。
 */
import { defineNamespace, type DeriveEventApi, type DeriveRendererApi } from '@/shared/channelMap'

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

// ── 健康模型（T13 #83）───────────────────────────────────────────

/**
 * 健康项类别。设计要求的六类：
 *   Effect 各类（launch/delivery/relay/reply/reviewReminder）、Source 游标与读取、
 *   Eval 的 unavailable、引擎/模型可用性、项目锁、迁移；
 * `unknownError` 是未知错误码的累计项（验收：未知 code 回退通用文案并计入健康）。
 */
export const SUPER_AGENT_HEALTH_CATEGORIES = [
  'effect:launch',
  'effect:delivery',
  'effect:relay',
  'effect:reply',
  'effect:reviewReminder',
  'source',
  'eval',
  'engine',
  'projectLock',
  'migration',
  'unknownError',
] as const

export type SuperAgentHealthCategory = (typeof SUPER_AGENT_HEALTH_CATEGORIES)[number] | (string & {})

export type SuperAgentHealthStatus = 'ok' | 'degraded' | 'error'

export interface SuperAgentHealthItem {
  category: SuperAgentHealthCategory
  status: SuperAgentHealthStatus
  /** 同类连续失败次数；成功即清零。 */
  consecutiveFailures: number
  /** 最后一次失败的稳定错误码；null 表示尚无失败记录。 */
  code: string | null
  /** 错误文案 i18n 键；未知 code 回退 superAgent.errors.unknown。 */
  codeI18nKey: string
  lastFailedAt: string | null
  /** 关联工单（如 delivery 永久失败）；null 表示系统级问题。 */
  ticketId: string | null
  /** 永久投递失败已显示在工单卡片上，不重复计入系统问题汇总。 */
  reflectedOnTicket: boolean
}

export interface SuperAgentHealthReport {
  repoRoot: string
  /** 升级为 error 的系统问题数（不含 reflectedOnTicket 的项）。 */
  problemCount: number
  /** 单次/两次抖动（degraded）计数，仅供汇总；不进入面板问题列表。 */
  degradedCount: number
  items: SuperAgentHealthItem[]
  updatedAt: string
}

/**
 * 稳定错误码的一等 DTO（T13 #83）：Domain/IPC 共用。
 * 未知 code 时 known 为 false、i18nKey 回退通用文案，不得把英文异常直接显示给用户。
 * 定义在 electron/superAgent/errors.ts，从这里再导出，保持渲染层单一进口。
 */
export type { SuperAgentErrorPayload } from '@electron/superAgent/errors'

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
    health: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentHealthReport,
    },
  },
  events: {
    onHealthChanged: {
      channel: 'health-changed',
      args: [] as unknown as [repoRoot: string, report: SuperAgentHealthReport],
    },
  },
})

export type SuperAgentRendererApi = DeriveRendererApi<typeof superAgentNamespace.channels>
export type SuperAgentEventApi = DeriveEventApi<typeof superAgentNamespace.events>
