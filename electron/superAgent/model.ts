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

/**
 * T12 #82 执行策略：串行（默认，1 worker，共享根目录）与并行（显式开启，
 * 强制 per-ticket worktree）。worktree 由 mode 派生：并行不存在共享目录形态。
 */
export type SuperAgentExecutionMode = 'serial' | 'parallel'

export type SuperAgentWorktreeMode = 'none' | 'per-ticket'

export interface SuperAgentExecutionPolicy {
  mode: SuperAgentExecutionMode
  /** serial 固定 1；parallel 为 2–6。 */
  maxWorkers: number
  /** 由 mode 派生：serial → 'none'，parallel → 'per-ticket'。 */
  worktree: SuperAgentWorktreeMode
}

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
  /** T16 #86：语义 Eval 命中并随授权下发给 Worker 的 Policy 规则名。 */
  matchedRules: string[]
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
    model?: string
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
  /** 归属被释放的时间：工单结束收尾或 Worker handback 交回（T17 #87）。 */
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

// ── T18 #88：Outbox 与受控 reply ──────────────────────────────────────

/** 外发工作类别 —— launch/delivery/relay/reply/reviewReminder 各自限流保序。 */
export type SuperAgentOutboxKind =
  | 'launch'
  | 'delivery'
  | 'relay'
  | 'reply'
  | 'reviewReminder'

/** 受控 reply 的四种外发类型（§6.4 授权链）。 */
export type SuperAgentReplyType = 'acknowledgement' | 'answer' | 'result' | 'attention'

/** Outbox 消息状态：pending 待投递；sent 已回执；dropped 永久失败；withdrawn 已撤回。 */
export type SuperAgentOutboxStatus = 'pending' | 'sent' | 'dropped' | 'withdrawn'

/** reply 外发载荷：回答必须可追溯到 Worker 认领过的人问题。 */
export interface SuperAgentOutboxReplyPayload {
  kind: 'reply'
  replyType: SuperAgentReplyType
  text: string
  /** acknowledgement / answer 引用的人消息 Input。 */
  inReplyTo: string | null
  /** attention 引用的 Attention。 */
  attentionId: string | null
  /** result 引用的 Report。 */
  reportId: string | null
}

/** 外发载荷：kind 判别联合，内部 effect 与受控 reply 共用同一 Outbox。 */
export type SuperAgentOutboxPayload =
  | { kind: 'launch'; assignmentId: string }
  | { kind: 'delivery'; inputId: string; requestId: string }
  | { kind: 'relay'; reportId: string }
  | { kind: 'reviewReminder' }
  | SuperAgentOutboxReplyPayload

/** Outbox 消息（§9.2 先持久化后执行）。 */
export interface SuperAgentOutboxMessage {
  /** 稳定外发 ID：永久去重的幂等键，也是崩溃对账的凭据。 */
  messageId: string
  ticketId: string
  /** 投递通道（如 feishu:chat-1、github:issue-12、internal）。 */
  channel: string
  kind: SuperAgentOutboxKind
  /** 落库序号：同一 ticket+channel 内保序。 */
  ordinal: number
  status: SuperAgentOutboxStatus
  createdAt: string
  payload: SuperAgentOutboxPayload
  /** 投递尝试次数（waiting 回写时递增）。 */
  attempts: number
  /** 瞬时失败退避后的下次可试时间；null 表示立即可试。 */
  nextAttemptAt: string | null
  lastError: string | null
  sentAt: string | null
  /** 平台回执（平台 message id），崩溃对账的幂等凭据。 */
  receipt: string | null
  /** attention 被替换/清除时未发出消息的撤回时间。 */
  withdrawnAt: string | null
}

export interface SuperAgentIdempotencyEntry {
  kind: 'trigger' | 'ticket' | 'input' | 'report' | 'message'
  id: string
  /** 相同幂等键但载荷不同时用于判冲突。 */
  fingerprint: string
}

/**
 * T16 #86：自动接受模式。off=不进入语义 Eval（默认，外部事件只落库）；
 * observe=完整评估但只记录「本会接受」，不建单；auto=接受即建单。
 * Desktop 显式派工不依赖 acceptMode。
 */
export type SuperAgentAcceptMode = 'off' | 'observe' | 'auto'

/** T16 #86：Policy 规则 —— 语义 Eval 命中后写入 Mandate 并下发给 Worker。 */
export interface SuperAgentPolicyRule {
  name: string
  instruction: string
}

/**
 * T16 #86：每 Source 准入表 —— scope（channel 允许列表，空数组=整个 Source）×
 * 名单（actor allowlist）× @Agent 共同决定 explicit / inferred / 不进入。
 * bots 是 bot actor 名单：最多 inferred，不能显式请求、不能 stop；
 * 身份只在本 Source 内有效，跨 Source 不做映射。
 */
export interface SuperAgentSourceAdmission {
  source: string
  channels: string[]
  allowlist: string[]
  bots: string[]
}

/** T16 #86：版本化授权策略 —— 任一子项变化即 version+1，旧 Eval 全部丢弃重排。 */
export interface SuperAgentPolicy {
  version: number
  acceptMode: SuperAgentAcceptMode
  rules: SuperAgentPolicyRule[]
  admissions: SuperAgentSourceAdmission[]
}

/**
 * T16 #86：Eval 生命周期。
 * queued：已建批未送达（不计时）；delivered：候选已送 Router（deadline 计时）；
 * decided：已裁决（accept/stop/ignore）；requeued：超时或版本变化回队；
 * unavailable：连续第 3 次超时 / 模型自报不可评估，等待人工处置；
 * discarded：Policy 版本变化被丢弃；
 * reevaluated/dismissed：T20 #90 人工处置出口（重新评估回队 / 显式忽略释放）。
 */
export type SuperAgentEvalState =
  | 'queued'
  | 'delivered'
  | 'decided'
  | 'requeued'
  | 'unavailable'
  | 'discarded'
  | 'reevaluated'
  | 'dismissed'

/** T20 #90：unavailable Eval 的人工处置事实（审计用）。 */
export interface SuperAgentEvalDisposal {
  action: 'reevaluated' | 'dismissed'
  at: string
}

/** T16 #86：Eval 的裁决事实；observe 模式 accept 也落这里（不建单）。 */
export interface SuperAgentEvalDecision {
  action: SuperAgentDecisionAction
  at: string
  /** 命中的 Policy 规则名（提交时校验必须存在于当前 Policy）。 */
  matchedRules: string[]
  /** accept 建单时对应工单；observe/ignore/stop/unavailable 为 null。 */
  ticketId: string | null
}

/** T16 #86：按 Thread 串行的语义评估批次。 */
export interface SuperAgentEval {
  evalId: string
  threadId: string
  triggerIds: string[]
  /** 提交 Decision 时必须等于当前 Policy 版本，否则拒绝落地。 */
  policyVersion: number
  state: SuperAgentEvalState
  /** 批次聚合后的 Gate 判定（任一 bot → 整批按 bot 处理）。 */
  strength: SuperAgentMandateStrength
  basis: SuperAgentMandateBasis
  bot: boolean
  actor: string
  createdAt: string
  /** 候选真正送达 Router 的时刻；deadline 从这里起算，未送达不计时。 */
  deliveredAt: string | null
  deadlineAt: string | null
  decision: SuperAgentEvalDecision | null
  /** T20 #90：unavailable 后的人工处置事实；未处置为 null。 */
  disposal: SuperAgentEvalDisposal | null
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
  /**
   * T11 #81：项目暂停是持久领域事实（跨重启保持）。
   * 暂停期间阻止新 launch 与 delivery；活动 turn 不被静默打断。
   */
  paused: boolean
  /** T11 #81：最近一次进入暂停的时间；未暂停为 null。 */
  pausedAt: string | null
  /**
   * T12 #82：执行策略是持久领域事实（跨重启保持）。Scheduler 每次调度读取
   * 当前值，策略变更即时生效（运行中不热切换的闸门在 service/scheduler 层）。
   */
  executionPolicy: SuperAgentExecutionPolicy
  /**
   * T16 #86：版本化授权策略是持久领域事实（跨重启保持）。任一子项变化
   * version+1，运行中 Eval 全部丢弃重排。
   */
  policy: SuperAgentPolicy
  /** T16 #86：语义评估批次（按 Thread 串行），按 evalId 索引。 */
  evals: Record<string, SuperAgentEval>
  /**
   * T18 #88：Outbox 外发消息，按 messageId 索引。先持久化后执行，重启后
   * pending 续做、sent 不重复投递；messageId 为永久去重幂等键。
   */
  outbox: Record<string, SuperAgentOutboxMessage>
}
