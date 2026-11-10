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
 *   authorizationPolicy     — 只读当前授权策略（版本化 Policy）（T25 #96）
 *   authorizationPolicySet  — 授权策略写入：任一子项变化 version+1 并丢弃重排 Eval（T25 #96）
 * 事件：
 *   health-changed — 健康项变化时广播（repoRoot, report）
 *   takeover-changed — 接管/交还广播（repoRoot, event），takeover=null 表示已交还（T09 #79）
 *   attention-asked / attention-answered / attention-withdrawn — Attention 变化广播（T08 #78）
 *
 * 前缀 `super-agent:`。preload、renderer API、主进程 handler 均从这里派生。
 */
import { defineNamespace, type DeriveEventApi, type DeriveRendererApi } from '@/shared/channelMap'

export const SUPER_AGENT_PREFIX = 'super-agent:'

/**
 * Router ↔ 宿主的建单协议围栏。
 *
 * Router 需要动手时在回复末尾输出这一个块，宿主解析后建单派工；它不是给人看的
 * 内容，IM 展示模式按此 info string 过滤（与 Worker 的 super-agent:report 同一做法）。
 */
export const SUPER_AGENT_ROUTE_FENCE = 'super-agent:route'

/**
 * Router ↔ 宿主的候选评估协议围栏（#99）。
 *
 * Eval 轮是宿主发起的内部准入评估，不是人的消息：它和 route 协议分开，回复里
 * 只应出现一个 eval 块，宿主据此落 Decision；不会被当成建单指令解析。
 */
export const SUPER_AGENT_EVAL_FENCE = 'super-agent:eval'

/**
 * Super Agent 自己拥有的会话种类。
 *
 * 这两类会话由主进程派生 id 并驱动，不是人发起的普通聊天，因此不得出现在侧边栏
 * 会话列表（见 docs/design/super-agent-implementation-plan.md 的 Router 可见性）。
 * 谁创建会话谁贴标签：推送通路与 JSONL 恢复通路都带这个字段，渲染层据此登记类型。
 */
export type SuperAgentSessionKind = 'superAgent' | 'superAgentWorker'

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
  review: {
    /** review 超时已提醒且仍在待验收的工单数（按工单去重，不按提醒次数）。 */
    reminded: number
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
  /** Router 的路由说明（≤30 字，不授权）；渲染端派工不带它。 */
  note?: string
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

/** #100：Worker 交回/退订/仅上下文订阅的折叠审计项（原因由 Worker 给出）。 */
export interface SuperAgentTicketPostAction {
  kind: 'handback' | 'threadUnrelated' | 'threadFollow'
  at: string
  reason: string | null
  triggerId: string | null
  threadId: string | null
}

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
  /** Worker 报告中的产物与文档，按执行目录解析后的绝对路径。 */
  artifacts?: string[]
  createdAt: string
  updatedAt: string
  ended: { outcome: string; by: string; reason: string; at: string } | null
  /** T10 #80：review 超时提醒水位；null 表示尚未提醒。 */
  reviewRemindedAt: string | null
  /** #100：最近 20 条 Worker 指令审计，工单详情折叠展示（旧快照缺省）。 */
  workerActions?: SuperAgentTicketPostAction[]
  /** T10 #80：是否允许人工重试（仅 open 的 delivery/blocked/failed）。 */
  canRetry: boolean
  /**
   * 是否允许人工停止：open 工单都成立（queued 撤指派、在跑收 Assignment 并停会话）。
   * 与 `canRetry` 同一做法由投影下发，卡片不自己从状态词推断。
   */
  canStop: boolean
}

/**
 * T10 #80 验收出口：ticketAccept 把 person/review 的工单以 completed 收尾。
 * 非待验收工单返回 notReady；已结束返回 ticketEnded。
 */
export interface SuperAgentTicketAcceptCommand {
  ticketId: string
}

export interface SuperAgentTicketActionResult {
  repoRoot: string
  ticketId: string
  outcome: 'completed' | 'stopped'
  endedAt: string
}

/** T10 #80 停止出口：Mandate 撤回、在途 Assignment 收尾、后续自动事件不得重开。 */
export interface SuperAgentTicketStopCommand {
  ticketId: string
  reason?: string
}

/** T10 #80 继续追问：review 的人消息复用原 Assignment 回到 working。 */
export interface SuperAgentTicketMessageCommand {
  /** UI 幂等键。 */
  requestId: string
  ticketId: string
  text: string
}

export interface SuperAgentTicketMessageResult {
  inputId: string
  ticketId: string
  status: 'pending' | 'delivered' | 'read' | 'failed' | 'uncertain'
  delivered: boolean
  gated: boolean
  duplicate: boolean
}

/** T10 #80 人工重试：只对 open 的 delivery/blocked/failed 开放，重试 generation+1。 */
export interface SuperAgentTicketRetryCommand {
  ticketId: string
}

export interface SuperAgentTicketRetryResult {
  ticketId: string
  assignmentId: string
  generation: number
  /** 0 表示已占槽执行中；>0 表示 FIFO 队列位置（从 1 起）。 */
  queuePosition: number
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
 * Worker 引擎会话 id 由 ticketId 稳定派生（UUIDv5），单一出处在
 * `electron/superAgent/sessionId.ts` —— 可读标签不能交给 CLI，故这里不再导出
 * 标签拼装函数；渲染端一律使用镜像 DTO 里带回的 sessionId。
 */

/**
 * Router 对话命令（设计 §4.2）：Router 会话归主进程所有，渲染端不能走普通
 * chatSession 的引擎发送路径 —— 那条路会把 Router 变成一条带全套写工具的日常聊天。
 */
export interface SuperAgentRouterMessageCommand {
  /** UI 幂等键；重复提交同键不重复起轮。 */
  requestId: string
  /** 交给 Router 会话的正文（含 @ 上下文 marker，与主聊天同一序列化）。 */
  text: string
  /**
   * 气泡里给人看的正文（marker 已还原成可读形式）。
   * 引擎不回显宿主写进 stdin 的人消息，气泡由主进程推送，所以要给它一份
   * 面向人的版本，而不是把 marker 原样贴进 IM 视图。
   */
  displayText?: string
  /** 图片附件（与 claudeCode sendMessage 同一形状）；Router 用它看截图。 */
  images?: unknown[]
  /**
   * 输入框当前选中的模型（显示名，与主聊天同一口径）。
   * Router 会话归主进程，起会话时只会读到设置页的 sonnet 槽位；不带它就会出现
   * 「下拉框选的是 A、message_start 报的是 B」。宿主按引擎解析后落进会话配置。
   */
  model?: string
}

export interface SuperAgentRouterMessageResult {
  sessionId: string
  running: boolean
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
  /** Executor 是否仍在活动（含占槽后台工作），不是 Assignment 的领域生命周期。 */
  running: boolean
  /** 工单投影状态：运行结束后区分待验收、等待与终态，不结束可复用的 Assignment。 */
  ticketState: SuperAgentTicketCard['state']
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
  /** 权限类 Attention 的审计锚点（来自引擎 permission_request 的会话与请求 id）。 */
  sessionId?: string | null
  requestId?: string | null
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

/** 就地回答命令：回答作为领域 Input 投递给对应 Worker；requestId 为幂等键。
 *  权限类 Attention 不落 Input，改用 decision 直接应答原 permission request；
 *  text 此时仅作拒绝理由。 */
export interface SuperAgentAttentionAnswerCommand {
  requestId: string
  attentionId: string
  text?: string
  decision?: 'allow' | 'deny'
}

export interface SuperAgentAttentionAnswerResult {
  attentionId: string
  ticketId: string
  /** 问题类回答落库后的 Input id；权限类直接应答原请求，没有 Input。 */
  inputId: string | null
  status: 'pending' | 'delivered' | 'read' | 'failed' | 'uncertain' | null
  delivered: boolean
  /** 被 blocked/failed 闸门拦下：只落库，不投递。 */
  gated: boolean
  duplicate: boolean
}

// ── 健康与 Eval 处置命令（T20 #90）───────────────────────────────

/** 重新评估：只对 unavailable 的 Eval 开放；Trigger 回队、连续超时计数清零。 */
export interface SuperAgentEvalReevaluateCommand {
  evalId: string
}

export interface SuperAgentEvalReevaluateResult {
  evalId: string
  /** 实际回队的 Trigger（已被其他工单消费的不抢归属）。 */
  requeuedTriggerIds: string[]
}

/** 忽略健康问题：eval 类别带 subjectId 时同时释放对应 unavailable Eval。 */
export interface SuperAgentProblemDismissCommand {
  category: SuperAgentHealthCategory
  /** 处置主体（Eval id）；null/省略表示系统级问题。 */
  subjectId?: string | null
}

/** 重试健康项：清零该类别的连续失败计数，之后失败从 1 次重新计数。 */
export interface SuperAgentHealthRetryCommand {
  category: SuperAgentHealthCategory
  /** 处置主体（Eval id）；null/省略表示系统级问题。 */
  subjectId?: string | null
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
  'workerAction',
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
  /**
   * 处置主体（T20 #90）：如 eval 类别对应的 Eval id；null 表示系统级问题。
   * 主体项按事件计数（不累计抖动），创建即 error（立即可处置）。
   */
  subjectId: string | null
}

/** T20 #90：健康处置审计 —— 每次重试/忽略/重新评估都落一条不可变记录。 */
export interface SuperAgentHealthDisposition {
  category: SuperAgentHealthCategory
  /** 处置主体；null 表示系统级（无 subject）。 */
  subjectId: string | null
  action: 'retry' | 'dismiss' | 'reevaluated'
  at: string
}

export interface SuperAgentHealthReport {
  repoRoot: string
  /** 升级为 error 的系统问题数（不含 reflectedOnTicket 的项）。 */
  problemCount: number
  /** 单次/两次抖动（degraded）计数，仅供汇总；不进入面板问题列表。 */
  degradedCount: number
  items: SuperAgentHealthItem[]
  /** 处置审计（T20 #90），按时间升序、封顶保留最近若干条。 */
  dispositions: SuperAgentHealthDisposition[]
  updatedAt: string
}

// ── Source 接入只读视图（T24 #93）────────────────────────────────────

/** 单个 Source 的运行时状态（游标、连续失败、隔离计数）。 */
export interface SuperAgentSourceStatus {
  sourceId: string
  running: boolean
  cursor: string | null
  consecutiveFailures: number
  lastError: string | null
  quarantined: number
  lastPolledAt: string | null
}

/**
 * 建单候选登记：经程序层 Gate 准入、且尚未被订阅消费的 Trigger。
 * 只登记候选事实，不在此建单 —— 语义 Eval / Policy 接管后续流程。
 */
export interface SuperAgentSourceCandidate {
  triggerId: string
  key: string
  /** 触发方式（addressed 类型）；名单/bot 的未 @ 候选为 null。 */
  reason: 'mention' | 'direct' | null
  strength: 'explicit' | 'inferred'
  basis: 'addressed' | 'followup' | 'admission' | 'bot'
  bot: boolean
  threadIds: string[]
  channel: string | null
  text: string
  at: string
}

/** 隔离的坏事件（结构性无法解析的原始负载），供只读排查。 */
export interface SuperAgentSourceQuarantineEntry {
  sourceId: string
  reason: string
  raw: string
  at: string
}

/** Source 只读视图：状态 + 候选登记 + 隔离报告。 */
export interface SuperAgentSourcesView {
  repoRoot: string
  sources: SuperAgentSourceStatus[]
  candidates: SuperAgentSourceCandidate[]
  quarantine: SuperAgentSourceQuarantineEntry[]
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
    // Router 对话（T21）：会话归主进程，渲染端只发文本与看状态。
    routerMessage: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentRouterMessageCommand],
      res: null as unknown as SuperAgentRouterMessageResult,
    },
    routerAbort: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as true,
    },
    health: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentHealthReport,
    },
    // T24 #93：Source 只读视图（运行状态 / 候选登记 / 隔离报告）。
    sources: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentSourcesView,
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
    // 验收、停止、继续追问与人工重试（T10 #80）：review 工单的三个显式出口，
    // 加上只对 delivery/blocked/failed 开放的重试（generation+1）。
    ticketAccept: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentTicketAcceptCommand],
      res: null as unknown as SuperAgentTicketActionResult,
    },
    ticketStop: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentTicketStopCommand],
      res: null as unknown as SuperAgentTicketActionResult,
    },
    ticketMessage: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentTicketMessageCommand],
      res: null as unknown as SuperAgentTicketMessageResult,
    },
    ticketRetry: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentTicketRetryCommand],
      res: null as unknown as SuperAgentTicketRetryResult,
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
    // 健康与 Eval 处置（T20 #90）：unavailable Eval 可重新评估或显式忽略；
    // 系统问题面板从只读升级为可操作（重试/忽略），处置都落审计。
    evalReevaluate: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentEvalReevaluateCommand],
      res: null as unknown as SuperAgentEvalReevaluateResult,
    },
    problemDismiss: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentProblemDismissCommand],
      res: null as unknown as SuperAgentHealthReport,
    },
    healthRetry: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentHealthRetryCommand],
      res: null as unknown as SuperAgentHealthReport,
    },
    // 暂停与恢复（T11 #81）：暂停是持久领域事实（跨重启保持），期间阻止新
    // launch/delivery；恢复时补投挂起输入并续跑队列。
    pause: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as true,
    },
    resume: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as true,
    },
    // 授权策略（T25 #96）：T16 的版本化 Policy —— acceptMode 默认 off，
    // 外部候选默认不建单，需要人显式在设置区开启；写入后 version 递增并
    // 重排运行中 Eval。命名刻意避开 executionPolicy（#92 已把 policy 留给授权）。
    authorizationPolicy: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentAuthorizationPolicyView,
    },
    authorizationPolicySet: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentAuthorizationPolicySetCommand],
      res: null as unknown as SuperAgentAuthorizationPolicySetResult,
    },
    // 执行策略与检查点（T12 #82）：串行（默认）与并行（强制 per-ticket worktree）
    // 策略变更即时生效且运行中不热切换；检查点只支持人工按文件显式回退。
    // 命名用 executionPolicy（#92），与领域层授权策略 setPolicy 区分开。
    executionPolicy: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentExecutionPolicyView,
    },
    executionPolicySet: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentPolicySetCommand],
      res: null as unknown as SuperAgentExecutionPolicyView,
    },
    checkpoint: {
      req: [] as unknown as [repoRoot: string],
      res: null as unknown as SuperAgentCheckpointInfo,
    },
    checkpointRollback: {
      req: [] as unknown as [repoRoot: string, command: SuperAgentCheckpointRollbackCommand],
      res: null as unknown as SuperAgentCheckpointRollbackResult,
    },
  },
  events: {
    onHealthChanged: {
      channel: 'health-changed',
      args: [] as unknown as [repoRoot: string, report: SuperAgentHealthReport],
    },
    // Router 轮次起止广播（T21）：IM 视图的 typing/计时与 Composer 的停止按钮靠它。
    onRouterStatus: {
      channel: 'router-status',
      args: [] as unknown as [repoRoot: string, router: SuperAgentRouterState],
    },
    onWorkerUpdated: {
      channel: 'worker-updated',
      args: [] as unknown as [repoRoot: string, mirror: SuperAgentWorkerMirror],
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

// ── 授权策略（T25 #96）───────────────────────────────────────────

/**
 * 自动接受模式（T16 #86）：off 不进入语义 Eval（默认，外部事件只落库）；
 * observe 完整评估但只记录「本会接受」，不建单；auto 接受即建单。
 * Desktop 显式派工不依赖 acceptMode。
 */
export type SuperAgentAcceptMode = 'off' | 'observe' | 'auto'

/** 语义 Eval 命中后写入 Mandate 并下发给 Worker 的规则。 */
export interface SuperAgentPolicyRule {
  name: string
  instruction: string
}

/** 每 Source 准入表：channels 空 = 整个 Source；bots 最多产生 inferred 候选。 */
export interface SuperAgentSourceAdmission {
  source: string
  channels: string[]
  allowlist: string[]
  bots: string[]
}

/** 版本化授权策略（领域事实的只读副本）。 */
export interface SuperAgentAuthorizationPolicy {
  /** 任一子项变化即 +1；旧版本 Eval 被丢弃重排。 */
  version: number
  acceptMode: SuperAgentAcceptMode
  rules: SuperAgentPolicyRule[]
  admissions: SuperAgentSourceAdmission[]
}

/** authorizationPolicy 通道返回的当前策略。 */
export interface SuperAgentAuthorizationPolicyView {
  repoRoot: string
  policy: SuperAgentAuthorizationPolicy
}

/** 策略变更命令：缺省子项保持原值（与领域 setPolicy 同语义）。 */
export interface SuperAgentAuthorizationPolicySetCommand {
  acceptMode?: SuperAgentAcceptMode
  rules?: SuperAgentPolicyRule[]
  admissions?: SuperAgentSourceAdmission[]
}

/** 写入结果：带上变化标记与被丢弃重排的 Eval，供 UI 提示。 */
export interface SuperAgentAuthorizationPolicySetResult extends SuperAgentAuthorizationPolicyView {
  /** 无变化时幂等：不推进 version，也不丢弃 Eval。 */
  changed: boolean
  /** 因版本变化被丢弃并重排回队的运行中 Eval。 */
  discardedEvalIds: string[]
}

// ── 执行策略与检查点（T12 #82）────────────────────────────────────

/** T12 #82：执行策略视图 —— worktree 由 mode 派生（并行强制 per-ticket）。 */
export interface SuperAgentExecutionPolicyView {
  repoRoot: string
  policy: {
    mode: 'serial' | 'parallel'
    /** serial 固定 1；parallel 为 2–6。 */
    maxWorkers: number
    /** serial → 'none'（共享根目录）；parallel → 'per-ticket'。 */
    worktree: 'none' | 'per-ticket'
  }
}

/** T12 #82：策略变更命令 —— 开启并行必须显式确认（UI 二次确认后传 confirmed）。 */
export interface SuperAgentPolicySetCommand {
  mode: 'serial' | 'parallel'
  /** 缺省：serial → 1，parallel → 2。 */
  maxWorkers?: number
  /** 切到 parallel 时必须 true；否则 policyConfirmRequired。 */
  confirmed?: boolean
}

/** T12 #82：检查点视图（每轮 launch 前保存，按 repoRoot 保留最新一份）。 */
export interface SuperAgentCheckpointView {
  savedAt: string
  head: string | null
  /** 保存时已脏文件（含 untracked）；这些文件不允许回退（用户自己的改动）。 */
  entries: string[]
}

/** T12 #82：检查点信息 —— 最新检查点 + 检查点之后新增的脏文件（回退候选）。 */
export interface SuperAgentCheckpointInfo {
  repoRoot: string
  checkpoint: SuperAgentCheckpointView | null
  changedFiles: string[]
}

/** T12 #82：按文件显式回退（不整仓 reset，不做任何自动回滚）。 */
export interface SuperAgentCheckpointRollbackCommand {
  files: string[]
}

export interface SuperAgentCheckpointRollbackResult {
  rolled: string[]
  skipped: { file: string; reason: 'dirty-at-checkpoint' | 'clean' }[]
}

export type SuperAgentRendererApi = DeriveRendererApi<typeof superAgentNamespace.channels>
export type SuperAgentEventApi = DeriveEventApi<typeof superAgentNamespace.events>
