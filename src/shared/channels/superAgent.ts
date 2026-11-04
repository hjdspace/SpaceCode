/**
 * Super Agent Channel 定义 — IPC 与 DTO 的单一真相源（T01 #71 起）。
 *
 * 命令：
 *   state      — 读取带 seq 水位的项目快照（无 Router 时是空快照）
 *   routerBind — 幂等绑定 Router 会话，重复调用返回同一 sessionId
 *   health     — 只读系统健康报告（T13 #83）
 *   workerBind   — 幂等绑定 Worker 只读镜像，返回稳定 sessionId 与代次分段快照（T07 #77）
 *   workerUnbind — 关闭镜像标签：只停观察，不影响后台推进（T07 #77）
 *   workerTakeover / workerRelease — 接管/交还 Worker 面板态，不改调度（T09 #79）
 *   workerMessage    — 接管输入：先落 Domain Input 再按调度投递，requestId 对账（T09 #79）
 *   attentions       — Attention 气泡全量看板（T08 #78）
 *   attentionAnswer  — 就地回答：先落 Domain Input 再投递给对应 Worker（T08 #78）
 * 事件：
 *   health-changed — 健康项变化时广播（repoRoot, report）
 *   takeover-changed — 接管/交还广播（repoRoot, event），takeover=null 表示已交还（T09 #79）
 *   attention-asked / attention-answered / attention-withdrawn — Attention 变化广播（T08 #78）
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

// ── 显式派工与串行调度（T05 #75）──────────────────────────────────

/** 「新建工单」动作的入参；requestId 是 UI 幂等键，重复派工返回原结果。 */
export interface SuperAgentDispatchCommand {
  requestId: string
  title: string
  text: string
  /** 派工时携带的 @ 上下文（相对路径）。 */
  contextPaths?: string[]
  attachments?: string[]
  actor?: string
}

export interface SuperAgentDispatchResult {
  ticketId: string
  assignmentId: string
  decisionId: string
  mandateId: string
  /** 0 表示已占槽执行中；>0 表示 FIFO 队列位置（从 1 起）。 */
  queuePosition: number
  duplicate: boolean
}

export interface SuperAgentQueueEntry {
  ticketId: string
  title: string
  /** running 为 0；queued 从 1 起。 */
  position: number
  state: 'running' | 'queued'
  /** launch 前脏区检查结果；queued 尚未检查为 null。 */
  dirty: boolean | null
}

export interface SuperAgentQueueSnapshot {
  repoRoot: string
  maxWorkers: number
  running: SuperAgentQueueEntry[]
  queued: SuperAgentQueueEntry[]
}

// ── 工单卡片投影（T06 #76）───────────────────────────────────────

/**
 * 卡片状态全集（设计 §10.3）：queued/preparing/working/idle/delivery/review/
 * answer/blocked/failed/completed/stopped/dropped。`preparing` 与 `delivery`
 * 是 progressProjector 维护的子态，不新增领域阶段；卡片必须同时用状态点
 * 颜色与短状态词（外加状态图标）双通道表达，不能只靠颜色区分。
 */
export type SuperAgentTicketCardState =
  | 'queued'
  | 'preparing'
  | 'working'
  | 'idle'
  | 'delivery'
  | 'review'
  | 'answer'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'stopped'
  | 'dropped'

export const SUPER_AGENT_TICKET_CARD_STATES = [
  'queued',
  'preparing',
  'working',
  'idle',
  'delivery',
  'review',
  'answer',
  'blocked',
  'failed',
  'completed',
  'stopped',
  'dropped',
] as const

/** 单行工单卡片投影；Report 只更新同 ticketId 的卡片，不重复发气泡。 */
export interface SuperAgentTicketCard {
  ticketId: string
  title: string
  state: SuperAgentTicketCardState
  /** 最新一次执行；null 表示尚未派生 Assignment。 */
  assignmentId: string | null
  /** 最新执行代次；0 表示尚未派生 Assignment。 */
  generation: number
  /** Mandate scope 相对路径；空数组 = 整个仓库。 */
  scopePaths: string[]
  createdAt: string
  updatedAt: string
  ended: { outcome: string; by: string; reason: string; at: string } | null
}

/** tickets 通道返回的完整看板；seq 是领域事实水位，断档重拉以此为基准。 */
export interface SuperAgentTicketBoard {
  repoRoot: string
  seq: number
  tickets: SuperAgentTicketCard[]
}

/**
 * ticket-updated 事件：fromSeq 是本次变更前的领域 seq，toSeq 是变更后的。
 * Renderer 发现 fromSeq 与本地水位不一致即判定断档，全量重拉 tickets；
 * payload 携带全量卡片，直接应用即幂等。
 */
export interface SuperAgentTicketUpdateEvent {
  repoRoot: string
  fromSeq: number
  toSeq: number
  tickets: SuperAgentTicketCard[]
}

/**
 * ticket-progress 事件：主进程归一化并做 1 秒节流，只含阶段/assignment/
 * currentTool/elapsed/toolCalls 等轻量事实，不含正文、推理或 diff。
 * seq 是独立的投影水位（与领域 seq 分开编号）；丢弃中间进度不触发重拉。
 */
export interface SuperAgentTicketProgress {
  repoRoot: string
  seq: number
  ticketId: string
  state: SuperAgentTicketCardState
  assignmentId: string | null
  currentTool: string | null
  elapsedMs: number | null
  toolCalls: number | null
  lastActivityAt: string | null
}

// ── Worker 只读镜像（T07 #77）────────────────────────────────────

/**
 * Worker 稳定会话 id：`superagent-worker-<ticketId>` 派生（设计 §5.3）。
 * 跨 Assignment、重试与主进程重启保持稳定；不得当作 assignmentId 或 Ticket 身份。
 */
export function superAgentWorkerSessionId(ticketId: string): string {
  return `superagent-worker-${ticketId}`
}

/** Assignment 代次分段：UI 按 ticketId 定卡片，按此分段定右侧执行代次。 */
export interface SuperAgentWorkerSegment {
  assignmentId: string
  /** 从 1 起；复用不递增，只有重试/重启恢复才 +1。 */
  generation: number
  state: 'pending' | 'running' | 'ended' | 'interrupted'
  endedReason: 'completed' | 'stopped' | 'failed' | 'interrupted' | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  /** 最新一份 Report 的 kind；历史 Report 只审计，不进分段。T06 接入前为 null。 */
  reportKind: 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped' | null
  reportSummary: string | null
}

/** Worker 只读镜像快照：workerBind 返回，重开标签时从它恢复。 */
export interface SuperAgentWorkerMirror {
  repoRoot: string
  ticketId: string
  title: string
  /** Worker 稳定会话 id；渲染层据此登记只读会话并复用既有 route event。 */
  sessionId: string
  /** 最新 Assignment 是否在执行中（不含排队）。 */
  running: boolean
  /** 该工单当前是否处于接管态（T09 #79）：面板据此切换只读/可写。 */
  takenOver: boolean
  /** 代次分段，按 generation 升序。 */
  segments: SuperAgentWorkerSegment[]
}

// ── 接管与交还（T09 #79）─────────────────────────────────────────

/** 接管态：同一项目同时至多一个；只切面板态，不改调度。 */
export interface SuperAgentTakeoverState {
  repoRoot: string
  ticketId: string
  at: string
}

/** 接管输入命令：先落 Domain Input 再按调度投递，requestId 为幂等/对账键。 */
export interface SuperAgentWorkerMessageCommand {
  requestId: string
  ticketId: string
  /** 消息正文；权限确认结果以结构化 JSON 文本投递（note 标记 permission-answer）。 */
  text: string
  note?: string | null
}

export interface SuperAgentWorkerMessageResult {
  inputId: string
  ticketId: string
  status: 'pending' | 'delivered' | 'read' | 'failed' | 'uncertain'
  delivered: boolean
  /** 被 blocked/failed 闸门拦下：只落库，不投递。 */
  gated: boolean
  duplicate: boolean
}

/** takeover-changed 事件载荷：交还/接管广播，takeover=null 表示已交还。 */
export interface SuperAgentTakeoverChangedEvent {
  repoRoot: string
  takeover: SuperAgentTakeoverState | null
}

// ── Attention 问答链路（T08 #78）─────────────────────────────────

/** Attention 气泡视图：工单溯源 + 问题 + 状态；answered 折叠保留审计。 */
export interface SuperAgentAttentionView {
  attentionId: string
  ticketId: string
  /** 工单标题，气泡溯源展示用。 */
  ticketTitle: string
  assignmentId: string
  kind: 'question' | 'permission' | 'delivery'
  question: string
  askedAt: string
  status: 'open' | 'answered' | 'withdrawn'
  /** 已提交（含已认领）的回答 inputId，按提交顺序。 */
  answers: string[]
  answeredAt: string | null
}

/** attentions 通道返回的完整 Attention 看板。 */
export interface SuperAgentAttentionBoard {
  repoRoot: string
  attentions: SuperAgentAttentionView[]
  /** 按工单去重后的待处理数（徽章/顶部计数）。 */
  pendingTickets: number
}

/** attention-changed 事件载荷：直接应用全量视图即幂等。 */
export interface SuperAgentAttentionEvent {
  repoRoot: string
  /** asked（新建或 open 期间视图更新，如补充回答）/ answered（认领关闭）/ withdrawn（替换/结束撤回）。 */
  reason: 'asked' | 'answered' | 'withdrawn'
  /** 触发本次事件的 Attention 视图。 */
  attention: SuperAgentAttentionView
  /** 全量视图（含已回答的审计折叠项）。 */
  attentions: SuperAgentAttentionView[]
  /** 按工单去重后的待处理数（徽章/顶部计数）。 */
  pendingTickets: number
}

/** 就地回答命令：回答作为领域 Input 投递给对应 Worker；requestId 为幂等键。 */
export interface SuperAgentAttentionAnswerCommand {
  requestId: string
  attentionId: string
  text: string
}

export interface SuperAgentAttentionAnswerResult {
  attentionId: string
  ticketId: string
  inputId: string
  status: 'pending' | 'delivered' | 'read' | 'failed' | 'uncertain'
  delivered: boolean
  /** 被 blocked/failed 闸门拦下：只落库，不投递。 */
  gated: boolean
  duplicate: boolean
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
    dispatch: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentDispatchCommand],
      res: null as unknown as SuperAgentDispatchResult,
    },
    queue: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentQueueSnapshot,
    },
    tickets: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentTicketBoard,
    },
    workerBind: {
      req: [] as unknown as [repoRoot: string, ticketId: string],
      res: null as unknown as SuperAgentWorkerMirror,
    },
    workerUnbind: {
      req: [] as unknown as [repoRoot: string, ticketId: string],
      res: null as unknown as true,
    },
    // 接管与交还（T09 #79）：只切面板态，不改调度；workerMessage 先落库再投递。
    workerTakeover: {
      req: [] as unknown as [repoRoot: string, ticketId: string],
      res: null as unknown as SuperAgentTakeoverState,
    },
    workerRelease: {
      req: [] as unknown as [repoRoot: string, ticketId: string],
      res: null as unknown as true,
    },
    workerMessage: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentWorkerMessageCommand],
      res: null as unknown as SuperAgentWorkerMessageResult,
    },
    // Attention 问答链路（T08 #78）：非模态气泡 + 就地回答。
    attentions: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentAttentionBoard,
    },
    attentionAnswer: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentAttentionAnswerCommand],
      res: null as unknown as SuperAgentAttentionAnswerResult,
    },
  },
  events: {
    onHealthChanged: {
      channel: 'health-changed',
      args: [] as unknown as [repoRoot: string, report: SuperAgentHealthReport],
    },
    onQueueChanged: {
      channel: 'queue-changed',
      args: [] as unknown as [repoRoot: string, snapshot: SuperAgentQueueSnapshot],
    },
    onTicketUpdated: {
      channel: 'ticket-updated',
      args: [] as unknown as [repoRoot: string, event: SuperAgentTicketUpdateEvent],
    },
    onTicketProgress: {
      channel: 'ticket-progress',
      args: [] as unknown as [repoRoot: string, progress: SuperAgentTicketProgress],
    },
    onTakeoverChanged: {
      channel: 'takeover-changed',
      args: [] as unknown as [repoRoot: string, event: SuperAgentTakeoverChangedEvent],
    },
    // Attention 问答链路（T08 #78）：question 触发 asked，认领触发 answered，
    // 替换/结束撤回触发 withdrawn；payload 携带全量视图，直接应用即幂等。
    onAttentionAsked: {
      channel: 'attention-asked',
      args: [] as unknown as [repoRoot: string, event: SuperAgentAttentionEvent],
    },
    onAttentionAnswered: {
      channel: 'attention-answered',
      args: [] as unknown as [repoRoot: string, event: SuperAgentAttentionEvent],
    },
    onAttentionWithdrawn: {
      channel: 'attention-withdrawn',
      args: [] as unknown as [repoRoot: string, event: SuperAgentAttentionEvent],
    },
  },
})

export type SuperAgentRendererApi = DeriveRendererApi<typeof superAgentNamespace.channels>
export type SuperAgentEventApi = DeriveEventApi<typeof superAgentNamespace.events>
