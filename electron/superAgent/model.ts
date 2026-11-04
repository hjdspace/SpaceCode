/**
 * Super Agent 领域对象模型（T03 #73）。
 *
 * 只描述主进程单写者持有的领域事实，不含 UI 投影：
 *   Trigger / Thread / Ticket / Assignment / Input / Mandate / Report / Attention。
 *
 * 阶段是派生值，不落 `ticket.stage` 字段，派生规则见 ./stage.ts。
 * 所有事实带 `ordinal`（单写者内单调递增序号），用于判断「某个事实之后是否
 * 又有新事实」，不依赖时钟精度；`at` 只用于展示与审计。
 */

export type SuperAgentTicketStage =
  | 'stopped'
  | 'completed'
  | 'dropped'
  | 'person/delivery'
  | 'person/answer'
  | 'person/review'
  | 'person/blocked'
  | 'person/failed'
  | 'working/queued'
  | 'working'
  | 'idle'

export type SuperAgentTicketOutcome = 'completed' | 'dropped' | 'stopped' | 'merged' | 'closed'

export type SuperAgentTicketState = 'open' | 'ended'

export type SuperAgentEndedBy = 'user' | 'worker' | 'policy'

export type SuperAgentTriggerAddress = 'mention' | 'direct'

/** Trigger 的去向事实：过滤原因、被哪些工单消费、是否回退给 Eval。 */
export interface SuperAgentTriggerDisposition {
  /** 程序层 Gate 的过滤原因码；未过滤为 null。 */
  filtered: string | null
  /** 接受该 Trigger 的工单（fan-out 主通路）。 */
  ticketIds: string[]
  /** 仅作为上下文投递给工单，不授予写权限。 */
  contextTicketIds: string[]
  /** 是否已重新排队给 Eval。 */
  requeued: boolean
  /** 是否已从工单释放、交回 Eval。 */
  handedBack: boolean
  ackedAt: string | null
}

/** 不可变事件。同一 `key` 重复接收只返回原 Trigger，不重复建单。 */
export interface SuperAgentTrigger {
  triggerId: string
  /** Source 事件键，也是幂等键。 */
  key: string
  ordinal: number
  source: string
  /** `threadIds[0]` 是主 Thread。 */
  threadIds: string[]
  actor: string
  human: boolean
  addressed: SuperAgentTriggerAddress | null
  channel: string | null
  url: string | null
  text: string
  at: string
  meta: Record<string, unknown>
  disposition: SuperAgentTriggerDisposition
}

export interface SuperAgentSubscription {
  ticketId: string
  attachedAt: string
  /** 仅上下文订阅：不新增写权限。 */
  contextOnly: boolean
}

/** 同一话题/工单对话中的有序 Trigger；同一 Thread 同时最多一个 Eval。 */
export interface SuperAgentThread {
  threadId: string
  source: string
  title: string | null
  triggerIds: string[]
  subscriptions: SuperAgentSubscription[]
  /** 只读上下文 Trigger。 */
  contextTriggerIds: string[]
  /** 尚未完成 Eval 的 Trigger。 */
  pendingTriggerIds: string[]
  evaluating: boolean
  /** 连续超时次数；到 3 次记 unavailable（Phase 2）。 */
  expired: number
  correlatedThreadIds: string[]
  meta: Record<string, unknown>
}

export type SuperAgentMandateStrength = 'explicit' | 'inferred'

/** Phase 2 续接前按 basis 重新校验授权。 */
export type SuperAgentMandateBasis = 'addressed' | 'followup' | 'admission' | 'bot'

export type SuperAgentDecisionAction = 'accept' | 'stop' | 'ignore' | 'unavailable'

/**
 * 派工决策事实（T05 #75）：一次授权裁决的主进程审计记录。
 * Desktop 显式派工固定 accept/explicit/addressed；Phase 2 的 Eval 复用同一对象。
 * basis 可追溯：Decision → Mandate → Assignment 的字段逐一对齐。
 */
export interface SuperAgentDecision {
  decisionId: string
  ticketId: string
  triggerId: string
  action: SuperAgentDecisionAction
  /** 决策来源事件流；Desktop 显式派工为 'desktop'。 */
  source: string
  actor: string
  human: boolean
  policyVersion: number
  strength: SuperAgentMandateStrength
  basis: SuperAgentMandateBasis
  at: string
}

export interface SuperAgentMandateScope {
  repoRoot: string
  paths: string[]
}

/** 不可变授权；扩大 scope 必须新建 Ticket。 */
export interface SuperAgentMandate {
  mandateId: string
  ticketId: string
  policyVersion: number
  strength: SuperAgentMandateStrength
  basis: SuperAgentMandateBasis
  actor: string
  scope: SuperAgentMandateScope
  createdAt: string
  revokedAt: string | null
}

export interface SuperAgentTicketDelivery {
  inputId: string
  error: string
  at: string
}

export interface SuperAgentTicketEnding {
  at: string
  by: SuperAgentEndedBy
  outcome: SuperAgentTicketOutcome
  reason: string
}

/** 一次授权工作；持有 Mandate、Thread、Input、Assignment 与结束信息。 */
export interface SuperAgentTicket {
  ticketId: string
  title: string
  state: SuperAgentTicketState
  createdAt: string
  origin: {
    triggerId: string
    triggerIds: string[]
  }
  mandateId: string
  threadId: string
  /** 按创建顺序排列的 Assignment。 */
  assignmentIds: string[]
  /** 按到达顺序排列的 Input。 */
  inputIds: string[]
  /** 被 Worker 用 `answers` 认领过的人消息 Input。 */
  answers: string[]
  /** 当前未回答的 Attention；已回答/撤回的只保留在 state.attentions 审计。 */
  attentionId: string | null
  execution: {
    name: string
    directory: string
    assignmentId: string | null
  }
  /** 跟随的 Thread（如 PR），只补上下文。 */
  follows: string[]
  /** 永久投递失败；瞬时退避保持 null。 */
  delivery: SuperAgentTicketDelivery | null
  undelivered: string[]
  /** review 超时提醒的持久水位；null 表示尚未提醒。 */
  reviewRemindedAt: string | null
  ended: SuperAgentTicketEnding | null
}

export type SuperAgentAssignmentState = 'pending' | 'running' | 'ended' | 'interrupted'

export type SuperAgentAssignmentEndReason = 'completed' | 'stopped' | 'failed' | 'interrupted'

/** Ticket 与一次 Worker 执行的绑定；`generation` 只在新建 Assignment 时递增。 */
export interface SuperAgentAssignment {
  assignmentId: string
  ticketId: string
  generation: number
  state: SuperAgentAssignmentState
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  endedReason: SuperAgentAssignmentEndReason | null
  createdOrdinal: number
  endedOrdinal: number | null
  /** 最新一份 Report；历史 Report 只追加到 state.reports 审计。 */
  report: SuperAgentReport | null
  deliveredAt: string | null
  idleAt: string | null
}

export type SuperAgentInputKind =
  | 'trigger'
  | 'text'
  | 'note'
  | 'policy-changed'
  | 'resumed'
  | 'reopen'

export type SuperAgentInputStatus = 'pending' | 'delivered' | 'read' | 'failed' | 'uncertain'

/** 投给 Ticket 的输入。只有 `human` 输入能解除 blocked/failed 闸门。 */
export interface SuperAgentInput {
  inputId: string
  ticketId: string
  ordinal: number
  kind: SuperAgentInputKind
  status: SuperAgentInputStatus
  /** 人消息（含桌面人工消息）；bot/CI/Router note 为 false。 */
  human: boolean
  /** 仅上下文，不可唤醒执行。 */
  context: boolean
  note: string | null
  text: string | null
  triggerId: string | null
  /** UI 幂等键。 */
  requestId: string | null
  at: string
  /** null 表示已到 Session 但未被 step 取走，或尚未投递。 */
  readAt: string | null
  deliveredTo: string | null
  deliveredAt: string | null
  /** 工单结束时被释放回 Eval 的时间。 */
  releasedAt: string | null
}

export type SuperAgentReportKind =
  | 'progress'
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'failed'
  | 'dropped'

/** 结构化执行事实；`question`/`answers` 遵守互斥与归属校验。 */
export interface SuperAgentReport {
  reportId: string
  assignmentId: string
  ticketId: string
  ordinal: number
  kind: SuperAgentReportKind
  summary: string
  at: string
  /** 结构化问题；不得与 `ready` 或 `answers` 同时出现。 */
  question: string | null
  /** 提出问题的输入（必须是到达本 Ticket 的人消息）。 */
  askedBy: string | null
  /** 本条 Report 认领回答的人消息 Input。 */
  answers: string[]
  /** 本条 Report 创建、回答或撤回的 Attention；重复 Report 幂等返回同一结果用。 */
  attentionId?: string | null
  details: string | null
  artifacts: string[]
}

/** 一个具体的人工问题或权限请求。同一问题只建一次，回答后折叠但保留审计。 */
export interface SuperAgentAttention {
  attentionId: string
  ticketId: string
  assignmentId: string
  kind: 'question' | 'permission' | 'delivery'
  question: string
  askedBy: string
  askedAt: string
  status: 'open' | 'answered' | 'withdrawn'
  answers: string[]
  answeredAt: string | null
  /** 权限请求的 Session/request 关联。 */
  sessionId: string | null
  requestId: string | null
}

export interface SuperAgentIdempotencyEntry {
  kind: 'trigger' | 'ticket' | 'input' | 'report' | 'message'
  id: string
  /** 相同幂等键但载荷不同时用于判冲突。 */
  fingerprint: string
}

/** 单写者持有的全部领域事实。 */
export interface SuperAgentDomainState {
  /** 事实序号水位，每次新增领域事实递增。 */
  seq: number
  triggers: Record<string, SuperAgentTrigger>
  threads: Record<string, SuperAgentThread>
  tickets: Record<string, SuperAgentTicket>
  assignments: Record<string, SuperAgentAssignment>
  /** 派工决策审计：按 ticketId 索引（MVP 每张工单一个决策）。 */
  decisions: Record<string, SuperAgentDecision>
  inputs: Record<string, SuperAgentInput>
  mandates: Record<string, SuperAgentMandate>
  reports: Record<string, SuperAgentReport>
  attentions: Record<string, SuperAgentAttention>
  idempotency: Record<string, SuperAgentIdempotencyEntry>
  /** 工单结束时释放回 Eval、尚未裁决的人消息 Input。 */
  handbacks: string[]
}
