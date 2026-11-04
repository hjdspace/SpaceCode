/**
 * Super Agent 单写者领域状态机（T03 #73）。
 *
 * 一个 Domain 实例独占一份 `SuperAgentDomainState`，所有变更只能经公开命令进入；
 * 命令只追加领域事实，阶段由 ./stage.ts 派生。持久化与 IPC 由后续票接入，
 * 本模块不读写磁盘。
 *
 * 幂等：事件键 / UI requestId / Report 的 assignmentId+reportId / Outbox messageId。
 * 重复事实返回原结果；同一键但载荷不同属于冲突（除 Source 事件键，它由 Source
 * 负责重放语义，重复投递一律返回原 Trigger）。
 */
import { randomUUID } from 'crypto'
import { superAgentError } from './errors'
import { idempotencyKey } from './idempotency'
export { idempotencyKey } from './idempotency'
import {
  clonePolicyAdmissions,
  clonePolicyRules,
  cloneSuperAgentPolicy,
  DEFAULT_SUPER_AGENT_POLICY,
  gateTrigger,
  type SuperAgentGateAdmission,
} from './policy'
export { DEFAULT_SUPER_AGENT_POLICY, gateTrigger } from './policy'
import {
  canRetryTicket,
  deriveTicketStage,
  latestAssignmentOf,
  waitsForPerson,
  type TicketStageFacts,
} from './stage'
import type {
  SuperAgentAcceptMode,
  SuperAgentAssignment,
  SuperAgentAssignmentEndReason,
  SuperAgentAttention,
  SuperAgentDecision,
  SuperAgentDomainState,
  SuperAgentEndedBy,
  SuperAgentEval,
  SuperAgentExecutionMode,
  SuperAgentExecutionPolicy,
  SuperAgentIdempotencyEntry,
  SuperAgentInput,
  SuperAgentInputKind,
  SuperAgentMandate,
  SuperAgentMandateBasis,
  SuperAgentMandateStrength,
  SuperAgentOutboxMessage,
  SuperAgentOutboxPayload,
  SuperAgentPolicy,
  SuperAgentPolicyRule,
  SuperAgentReplyType,
  SuperAgentReport,
  SuperAgentReportKind,
  SuperAgentSourceAdmission,
  SuperAgentThread,
  SuperAgentTicket,
  SuperAgentTicketOutcome,
  SuperAgentTicketStage,
  SuperAgentTrigger,
  SuperAgentTriggerAddress,
  SuperAgentWorktreeMode,
} from './model'

/** T12 #82：默认串行（1 worker，共享根目录）—— 与 T05 行为一致。 */
export const DEFAULT_EXECUTION_POLICY: SuperAgentExecutionPolicy = {
  mode: 'serial',
  maxWorkers: 1,
  worktree: 'none',
}

const PARALLEL_MIN_WORKERS = 2
const PARALLEL_MAX_WORKERS = 6

/** T17 #87：订阅寿命 —— 已结束（非 stopped）工单的订阅最多保留两周（§6.2）。 */
const DEFAULT_SUBSCRIPTION_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** T18 #88：waiting 回写指数退避基准与封顶（30s 起、每尝试翻倍、15min 封顶）。 */
export const SUPER_AGENT_OUTBOX_BACKOFF_BASE_MS = 30_000
export const SUPER_AGENT_OUTBOX_BACKOFF_CAP_MS = 15 * 60_000

export interface TriggerDraft {
  /** Source 事件键；同一键重复投递只返回原 Trigger。 */
  key: string
  source: string
  /** 空数组表示由 Ticket 创建自己的 Thread（Desktop 显式派工）。 */
  threadIds: string[]
  actor: string
  human: boolean
  addressed?: SuperAgentTriggerAddress | null
  channel?: string | null
  url?: string | null
  text: string
  at?: string
  meta?: Record<string, unknown>
}

export interface TriggerIntakeResult {
  trigger: SuperAgentTrigger
  duplicate: boolean
}

export interface CreateTicketInput {
  /** UI 幂等键。 */
  requestId: string
  title: string
  repoRoot: string
  trigger: TriggerDraft
  scopePaths?: string[]
  policyVersion?: number
  strength?: SuperAgentMandateStrength
  basis?: SuperAgentMandateBasis
  at?: string
}

export interface CreateTicketResult {
  ticket: SuperAgentTicket
  mandate: SuperAgentMandate
  thread: SuperAgentThread
  duplicate: boolean
}

export interface StartAssignmentInput {
  ticketId: string
  at?: string
}

/** 显式派工（T05 #75）：「新建工单」独立动作产生的 Decision/Mandate/pending Assignment。 */
export interface DispatchInput {
  /** UI 幂等键；同一键重复派工返回原结果，载荷不同视为冲突。 */
  requestId: string
  title: string
  repoRoot: string
  /** 工单目标描述；超预算部分由 Scheduler 落 Spill（见 context.ts）。 */
  text: string
  actor: string
  /** 派工时携带的 @ 上下文（相对路径），注入 Worker 首轮消息。 */
  contextPaths?: string[]
  attachments?: string[]
  policyVersion?: number
  at?: string
}

export interface DispatchResult {
  ticket: SuperAgentTicket
  decision: SuperAgentDecision
  mandate: SuperAgentMandate
  assignment: SuperAgentAssignment
  duplicate: boolean
}

export interface LaunchAssignmentInput {
  assignmentId: string
  at?: string
}

export interface EndAssignmentInput {
  assignmentId: string
  reason: SuperAgentAssignmentEndReason
  at?: string
}

export interface AddInputCommand {
  ticketId: string
  /** UI 幂等键。 */
  requestId: string
  kind: SuperAgentInputKind
  human: boolean
  context?: boolean
  note?: string | null
  text?: string | null
  triggerId?: string | null
  at?: string
}

export interface AddInputResult {
  input: SuperAgentInput
  /** 被 blocked/failed 闸门拦下：只落库，不投递。 */
  gated: boolean
  delivered: boolean
  duplicate: boolean
}

export interface FailDeliveryInput {
  inputId: string
  error: string
  at?: string
}

/** T08 #78：人对 Attention 气泡的就地回答 —— 落成领域 Input 并投递给对应 Worker。 */
export interface AnswerAttentionCommand {
  attentionId: string
  /** UI 幂等键。 */
  requestId: string
  text: string
  at?: string
}

/** T08 #78：回答结果。Attention 保持 open，直到 Worker 用 answers 认领。 */
export interface AnswerAttentionResult {
  attention: SuperAgentAttention
  input: SuperAgentInput
  /** 被 blocked/failed 闸门拦下：只落库，不投递。 */
  gated: boolean
  delivered: boolean
  duplicate: boolean
}

/** T09 #79：可证明未接受才允许重投 —— 把已投未读的 Input 退回 pending。 */
export interface RequeueInputInput {
  inputId: string
  at?: string
}

/** T09 #79：接受事实落盘后才标 delivered —— 把 pending 的 Input 标为已投递。 */
export interface DeliverInputInput {
  inputId: string
  at?: string
}

/** T09 #79：投递结果未知（无法证明已接受或未接受）时标记 uncertain。 */
export interface MarkInputUncertainInput {
  inputId: string
  reason?: string
  at?: string
}

export interface MarkInputUncertainResult {
  input: SuperAgentInput
  /** 本次产生（或已存在）的 delivery Attention；工单结束时为 null。 */
  attentionId: string | null
  duplicate: boolean
}

/** T11 #81：重启恢复专用 —— latest interrupted 的 busy 工单建 generation+1。 */
export interface TicketRecoveryInput {
  ticketId: string
  at?: string
}

/** T11 #81：Executor 步取走输入的对账游标。 */
export interface MarkInputReadInput {
  inputId: string
  at?: string
}

export interface ReportCommand {
  ticketId: string
  assignmentId: string
  reportId: string
  kind: SuperAgentReportKind
  summary: string
  at?: string
  question?: string | null
  askedBy?: string | null
  answers?: string[]
  details?: string | null
  artifacts?: string[]
}

export interface ReportResult {
  report: SuperAgentReport
  duplicate: boolean
  /** 本次创建、回答或撤回的 Attention；没有则为 null。 */
  attentionId: string | null
}

export interface EndTicketCommand {
  ticketId: string
  outcome: SuperAgentTicketOutcome
  by: SuperAgentEndedBy
  reason: string
  at?: string
}

export interface EndTicketResult {
  ticket: SuperAgentTicket
  releasedInputIds: string[]
  withdrawnAttentionIds: string[]
}

/**
 * T19 #89：Thread 终止（PR 合并/关闭）—— 按 followsDone 结束跟随工单。
 *  - 命中范围：来源 Thread（ticket.threadId）或 follows 该 Thread 的开放工单；
 *  - 结束结果 merged/closed 原样落库，不压成 completed（阶段展示才等价已完成）；
 *  - 幂等：重复报告同一 Thread 终止时已结束工单直接跳过。
 */
export interface FollowsDoneInput {
  /** 被终止的 Thread（如 github:pr:owner/repo:123）。 */
  threadId: string
  /** 合并 → merged；关闭未合并 → closed。 */
  outcome: 'merged' | 'closed'
  /** 结束人；缺省 'user'（外部 PR 事件在宿主看来是人）。 */
  by?: SuperAgentEndedBy
  /** 结束原因码；缺省 pr-merged / pr-closed。 */
  reason?: string
  at?: string
}

export interface FollowsDoneEndedTicket {
  ticket: SuperAgentTicket
  releasedInputIds: string[]
  withdrawnAttentionIds: string[]
}

export interface FollowsDoneResult {
  threadId: string
  outcome: 'merged' | 'closed'
  /** 本次结束的工单；重放同一终止（已全部结束）返回空数组。 */
  endedTickets: FollowsDoneEndedTicket[]
}

/** T10 #80：接受验收 —— review 的显式出口。 */
export interface TicketAcceptInput {
  ticketId: string
  at?: string
}

/** T10 #80：停止出口 —— Mandate 撤回、在途 Assignment 收尾、工单 stopped。 */
export interface TicketStopInput {
  ticketId: string
  reason?: string
  at?: string
}

/** T10 #80：继续追问 —— review 的人消息复用原 Assignment 回到 working。 */
export interface TicketMessageInput {
  ticketId: string
  /** UI 幂等键。 */
  requestId: string
  text: string
  at?: string
}

/** T10 #80：人工重试 —— 只对 person/delivery、person/blocked、person/failed 开放。 */
export interface RetryTicketInput {
  ticketId: string
  at?: string
}

export interface RetryTicketResult {
  ticket: SuperAgentTicket
  /** 新代次 Assignment（generation+1，pending 待 Scheduler 启动）。 */
  assignment: SuperAgentAssignment
}

/** T10 #80：review 超时提醒水位外发（持久化 scheduled effect，见 reviewReminder.ts）。 */
export interface MarkReviewRemindedInput {
  ticketId: string
  at?: string
}

/** T12 #82：执行策略变更 —— worktree 由 mode 派生，运行中不热切换的闸门在上层。 */
export interface SetExecutionPolicyInput {
  mode: SuperAgentExecutionMode
  /** 缺省：serial → 1，parallel → 2。 */
  maxWorkers?: number
  at?: string
}

export interface SetExecutionPolicyResult {
  policy: SuperAgentExecutionPolicy
  /** 相同策略重复设置不推进 seq。 */
  changed: boolean
}

/** T16 #86：Policy 变更 —— 缺省子项保持原值；任一变化 version+1 并丢弃重排运行中 Eval。 */
export interface SetPolicyInput {
  acceptMode?: SuperAgentAcceptMode
  rules?: SuperAgentPolicyRule[]
  admissions?: SuperAgentSourceAdmission[]
  at?: string
}

export interface SetPolicyResult {
  policy: SuperAgentPolicy
  /** 无变化时幂等：不推进 version，也不丢弃 Eval。 */
  changed: boolean
  /** 因版本变化被丢弃并重排的 Eval。 */
  discardedEvalIds: string[]
}

/** T16 #86：程序层过滤落库 —— Trigger 记原因码并退出 Eval 候选。 */
export interface FilterTriggerInput {
  triggerId: string
  reason: string
}

/** T16 #86：按 Thread 建批 —— 批次 = 该 Thread 当前全部 pending 候选，Gate 重新判定。 */
export interface StartEvalInput {
  threadId: string
  at?: string
}

/** T16 #86：候选送达 Router —— deadline 从这一刻起算。 */
export interface DeliverEvalInput {
  evalId: string
  at?: string
}

/** T16 #86：deadline 到点检查 —— 暂停期间/未到点为 no-op，返回实际处置结果。 */
export interface ExpireEvalInput {
  evalId: string
  at?: string
}

export interface ExpireEvalResult {
  eval: SuperAgentEval
  outcome: 'requeued' | 'unavailable' | 'ignored'
}

/** T16 #86：Router 提交语义裁决 —— 重新校验 Policy 版本、去重与 bot 限制。 */
export interface SubmitEvalDecisionInput {
  evalId: string
  action: 'accept' | 'stop' | 'ignore' | 'unavailable'
  /** auto 模式 accept 建单所需（Mandate scope 根目录）。 */
  repoRoot?: string
  /** 命中的 Policy 规则名；提交时校验必须存在于当前 Policy。 */
  matchedRules?: string[]
  at?: string
}

export interface SubmitEvalDecisionResult {
  eval: SuperAgentEval
  /** auto 模式 accept 创建的工单；其余为 null。 */
  ticket: SuperAgentTicket | null
  /** accept 建单时的审计 Decision；其余为 null。 */
  decision: SuperAgentDecision | null
  /** 已裁决的 Eval 重复提交时返回原结果。 */
  duplicate: boolean
}

/** T20 #90：unavailable Eval 重新评估 —— 批次 Trigger 回队、连续超时计数清零。 */
export interface ReevaluateEvalInput {
  evalId: string
  at?: string
}

export interface ReevaluateEvalResult {
  eval: SuperAgentEval
  /** 实际回队的 Trigger（已被其他工单消费的不抢归属）。 */
  requeuedTriggerIds: string[]
}

/** T20 #90：unavailable Eval 显式忽略 —— Trigger 释放不回队，不阻塞 Thread。 */
export interface DismissEvalInput {
  evalId: string
  at?: string
}

/** T16 #86：续接前重校验 —— 按 Mandate 来源 Trigger 在当前 Policy 下重新过 Gate。 */
export interface RevalidateTicketResult {
  valid: boolean
  /** 失效原因码（Gate 过滤原因 / 'revoked'），有效为 null。 */
  reason: string | null
}

/** T17 #87：Worker 交回一条人消息 —— 放弃本工单对该消息的裁决权（订阅保留）。 */
export interface HandbackInputInput {
  ticketId: string
  inputId: string
  at?: string
}

export interface HandbackInputResult {
  input: SuperAgentInput
  /** 交回后仍持有该消息的存活 owner。 */
  ownersRemaining: string[]
  /** 是否已回流 Eval（最后一个 owner 交回时恰一次）。 */
  requeued: boolean
}

/** T17 #87：Worker 发现 Thread 无关 —— 退掉自己的订阅并交回该 Thread 的人消息。 */
export interface MarkUnrelatedInput {
  ticketId: string
  threadId: string
  at?: string
}

export interface MarkUnrelatedResult {
  ticket: SuperAgentTicket
  thread: SuperAgentThread
  /** 本次交回的人消息 Input。 */
  releasedInputIds: string[]
  /** 其中已回流 Eval 的（最后一个 owner 交回）。 */
  requeuedInputIds: string[]
}

/** T17 #87：Router attach —— 显式引用的消息挂接工单并订阅整条 Thread。 */
export interface AttachTicketInput {
  ticketId: string
  triggerId: string
  at?: string
}

export interface AttachTicketResult {
  ticket: SuperAgentTicket
  trigger: SuperAgentTrigger
  /** 新增的工单输入；重复 attach（已消费）为 null。 */
  input: SuperAgentInput | null
  duplicate: boolean
}

/**
 * T18 #88：Outbox 入列。受控 reply 的授权链在此校验（§6.4）：
 * acknowledgement 指向本工单人消息且未结束；answer 指向 Worker 认领过的
 * 人问题；result 只在 ready/completed/merged/dropped 允许且 progress 不得
 * 冒充；attention 必须匹配当前 open Attention 文本。
 */
export interface EnqueueOutboxInput {
  /** 稳定外发 ID：永久去重的幂等键，重复入列返回原消息。 */
  messageId: string
  ticketId: string
  /** 投递通道；内部 effect 用 'internal'。 */
  channel: string
  payload: SuperAgentOutboxPayload
  at?: string
}

export interface EnqueueOutboxResult {
  message: SuperAgentOutboxMessage
  /** messageId（或同一 Attention 的 attention 回复）重复入列时为 true。 */
  duplicate: boolean
}

/** T18 #88：Channel 回写（receipt）。sent 带 platform message id 供崩溃对账。 */
export interface SettleOutboxInput {
  messageId: string
  outcome: 'sent' | 'waiting' | 'gone'
  /** sent 的平台回执；waiting/gone 的错误摘要（仅供日志）。 */
  receipt?: string | null
  error?: string | null
  at?: string
}

export interface SettleOutboxResult {
  message: SuperAgentOutboxMessage
  /** 消息已终态（sent/dropped/withdrawn）后重复回写时为 true。 */
  duplicate: boolean
}

export interface SuperAgentDomainOptions {
  now?: () => Date
  newId?: (kind: string) => string
  /**
   * T16 #86：Eval 的 deadline 时限（候选送达 Router 起算）。缺省 60 秒。
   */
  evalTtlMs?: number
  /**
   * T17 #87：已结束（非 stopped）工单订阅的保留时长 —— 期满后订阅被清理，
   * Source 不再为该 Thread 轮询。缺省两周（§6.2）。
   */
  subscriptionTtlMs?: number
  /**
   * T11 #81：从持久化快照重水化。缺失字段补默认（前向兼容），
   * 未知字段按结构透传保留（§9.4 未见过的字段必须可被忽略）。
   */
  initialState?: SuperAgentDomainState
}

export interface SuperAgentDomain {
  readonly state: SuperAgentDomainState
  intakeTrigger(draft: TriggerDraft): TriggerIntakeResult
  createTicket(input: CreateTicketInput): CreateTicketResult
  dispatch(input: DispatchInput): DispatchResult
  startAssignment(input: StartAssignmentInput): SuperAgentAssignment
  launchAssignment(input: LaunchAssignmentInput): SuperAgentAssignment
  endAssignment(input: EndAssignmentInput): SuperAgentAssignment
  addInput(command: AddInputCommand): AddInputResult
  /** T08 #78：就地回答 Attention，回答作为领域 Input 投递给对应 Worker。 */
  answerAttention(command: AnswerAttentionCommand): AnswerAttentionResult
  requeueInput(input: RequeueInputInput): SuperAgentInput
  deliverInput(input: DeliverInputInput): SuperAgentInput
  markInputUncertain(input: MarkInputUncertainInput): MarkInputUncertainResult
  failDelivery(input: FailDeliveryInput): SuperAgentTicket
  report(command: ReportCommand): ReportResult
  endTicket(command: EndTicketCommand): EndTicketResult
  /** T10 #80：接受验收（→ completed，by user）。 */
  ticketAccept(input: TicketAcceptInput): EndTicketResult
  /** T10 #80：停止出口（→ stopped，Mandate 撤回，后续自动事件不得重开）。 */
  ticketStop(input: TicketStopInput): EndTicketResult
  /** T10 #80：继续追问 —— 复用原 Assignment 回到 working。 */
  ticketMessage(input: TicketMessageInput): AddInputResult
  /** T10 #80：人工重试 —— 新建 generation+1 的 pending Assignment。 */
  retryTicket(input: RetryTicketInput): RetryTicketResult
  /**
   * T11 #81：重启恢复 —— 最新代次为 interrupted 的 busy 工单新建
   * generation+1 的 pending 恢复 Assignment。只有主进程重启这一恢复
   * 路径使用；人工重试走 retryTicket。
   */
  recoverTicket(input: TicketRecoveryInput): RetryTicketResult
  /** T11 #81：Executor 步取走输入时标已读（对账游标：已 read 不重复投递）。 */
  markInputRead(input: MarkInputReadInput): SuperAgentInput
  /** T11 #81：项目暂停（持久事实）—— 暂停期间新 Input 只落库不投递。 */
  pauseProject(input?: { at?: string }): SuperAgentDomainState
  /** T11 #81：恢复暂停 —— 后续 launch/delivery 由上层续跑。 */
  resumeProject(input?: { at?: string }): SuperAgentDomainState
  /** T10 #80：review 超时提醒水位外发（只前进，离开 review/结束拒绝）。 */
  markReviewReminded(input: MarkReviewRemindedInput): SuperAgentTicket
  /**
   * T12 #82：执行策略变更（持久领域事实）。worktree 由 mode 派生：并行强制
   * per-ticket worktree，串行回到共享根目录；上限校验 serial=1、parallel=2–6。
   * 运行中不热切换（有 Worker 活动时拒绝）的闸门在 service/scheduler 层。
   */
  setExecutionPolicy(input: SetExecutionPolicyInput): SetExecutionPolicyResult
  /**
   * T16 #86：Policy 变更（持久领域事实）。任一子项变化 version+1，并丢弃
   * 运行中（queued/delivered）Eval，把批次 Trigger 按新版本重排回队；
   * 无变化幂等，不推进 version。
   */
  setPolicy(input: SetPolicyInput): SetPolicyResult
  /** T16 #86：程序层过滤落库 —— Trigger 记原因码并退出 Eval 候选（幂等）。 */
  filterTrigger(input: FilterTriggerInput): SuperAgentTrigger
  /**
   * T16 #86：按 Thread 建批进入语义 Eval（串行：同一 Thread 同时最多一个）。
   * off 模式拒绝；批次 = 该 Thread 全部 pending Trigger，经当前 Policy 重新过
   * Gate（inferred 聚合规则见实现）。未送达不计时。
   */
  startEval(input: StartEvalInput): SuperAgentEval
  /** T16 #86：候选送达 Router —— deadline 从这一刻起算（未送达的 Eval 不超时）。 */
  deliverEval(input: DeliverEvalInput): SuperAgentEval
  /**
   * T16 #86：deadline 到点检查。暂停期间不超时；未到点 no-op。超时重排 2 次，
   * 第 3 次记 unavailable（Trigger 扣住等待人工处置，不回队）。
   */
  expireEval(input: ExpireEvalInput): ExpireEvalResult
  /**
   * T16 #86：Router 提交语义裁决。重新校验 Policy 版本（旧版本不得落地）、
   * 触发器去重与 bot 限制；observe 只记录「本会接受」，auto 建单并落
   * Decision → Mandate → pending Assignment 审计链。
   */
  submitEvalDecision(input: SubmitEvalDecisionInput): SubmitEvalDecisionResult
  /** T20 #90：unavailable Eval 重新评估 —— Trigger 回队、计数清零、落处置审计。 */
  reevaluateEval(input: ReevaluateEvalInput): ReevaluateEvalResult
  /** T20 #90：unavailable Eval 显式忽略 —— Trigger 释放不回队、落处置审计。 */
  dismissEval(input: DismissEvalInput): SuperAgentEval
  /**
   * T16 #86：续接前 revalidate —— 按 Mandate 的来源 Trigger 在当前 Policy 下
   * 重新过 Gate；失效（名单移除/scope 收紧/bot 化/已撤回）则续接被拒。
   */
  revalidateTicket(ticketId: string): RevalidateTicketResult
  /**
   * T17 #87：当前仍可裁决这条人消息的工单（存活非 contextOnly 订阅 +
   * 未交回、未认领的人消息输入）。人消息先归这些工单，Router 只能 stop。
   */
  followupOwners(triggerId: string): string[]
  /** T17 #87：Trigger 是否已被存活的可裁决订阅消费（fast path 生效，不进 Eval）。 */
  fastPathConsumed(triggerId: string): boolean
  /**
   * T17 #87：Worker 交回人消息 —— 交回一次（重复拒绝），订阅保留；
   * 最后一个 owner 交回后消息回流 Eval 恰一次。
   */
  handbackInput(input: HandbackInputInput): HandbackInputResult
  /**
   * T17 #87：Worker 退掉自己对某 Thread 的订阅（只退自己；来源 Thread 与
   * follows 除外）并交回该 Thread 未裁决的人消息。
   */
  markUnrelated(input: MarkUnrelatedInput): MarkUnrelatedResult
  /**
   * T17 #87：Router attach —— 订阅 Trigger 的全部 Thread 并把消息挂接为工单
   * 输入；人消息归存活 owner 期间被代码拒绝（只能 stop）。
   */
  attachTicket(input: AttachTicketInput): AttachTicketResult
  /**
   * T17 #87：清理过期订阅 —— stopped 立即失效，已结束工单最多保留
   * subscriptionTtlMs（缺省两周）；之后 Source 不再为该 Thread 轮询。
   */
  pruneExpiredSubscriptions(input?: { at?: string }): string[]
  /**
   * T19 #89：Thread 终止（PR 合并/关闭）—— 按来源或 follows 关系结束开放
   * 工单，outcome 落 merged/closed（不压成 completed），follows 保留审计。
   * 幂等：已结束的工单跳过，重放同一终止返回空 endedTickets。
   */
  followsDone(input: FollowsDoneInput): FollowsDoneResult
  /**
   * T18 #88：Outbox 入列（先持久化后执行）。受控 reply 授权链在此校验；
   * messageId 永久去重，同一 open Attention 的 attention 回复只入列一次。
   */
  enqueueOutboxMessage(input: EnqueueOutboxInput): EnqueueOutboxResult
  /** T18 #88：Channel 回写 —— sent 记平台回执、waiting 指数退避、gone 记 dropped。 */
  settleOutboxMessage(input: SettleOutboxInput): SettleOutboxResult
  stageOf(ticketId: string): SuperAgentTicketStage
}

/** 稳定序列化：同一载荷不同键序视为同一事实。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function newThread(threadId: string, source: string): SuperAgentThread {
  return {
    threadId,
    source,
    title: null,
    triggerIds: [],
    subscriptions: [],
    contextTriggerIds: [],
    pendingTriggerIds: [],
    evaluating: false,
    expired: 0,
    correlatedThreadIds: [],
    meta: {},
  }
}

/**
 * T12 #82：解析目标执行策略（纯函数）—— worktree 由 mode 派生，上限校验
 * serial=1、parallel=2–6。setExecutionPolicy 与 service 闸门共用，保证派生
 * 逻辑单一出处。
 */
export function resolveExecutionPolicy(input: SetExecutionPolicyInput): SuperAgentExecutionPolicy {
  const mode: SuperAgentExecutionMode = input.mode
  if (mode !== 'serial' && mode !== 'parallel') {
    throw superAgentError('invalidWorkerLimit', { mode })
  }
  const maxWorkers = input.maxWorkers ?? (mode === 'parallel' ? PARALLEL_MIN_WORKERS : 1)
  if (
    !Number.isInteger(maxWorkers) ||
    (mode === 'serial'
      ? maxWorkers !== 1
      : maxWorkers < PARALLEL_MIN_WORKERS || maxWorkers > PARALLEL_MAX_WORKERS)
  ) {
    throw superAgentError('invalidWorkerLimit', { maxWorkers, mode })
  }
  // 并行强制 per-ticket worktree（共享目录并行写被代码拒绝）；
  // 串行回共享根目录。
  const worktree: SuperAgentWorktreeMode = mode === 'parallel' ? 'per-ticket' : 'none'
  if (mode === 'parallel' && worktree !== 'per-ticket') {
    // 结构上不可达（worktree 由 mode 派生）；保留防御以守住「并行必须 worktree」
    throw superAgentError('parallelRequiresWorktree', { mode })
  }
  return { mode, maxWorkers, worktree }
}

export function createSuperAgentDomain(options: SuperAgentDomainOptions = {}): SuperAgentDomain {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? ((kind: string) => `${kind}-${randomUUID()}`)
  const evalTtlMs = options.evalTtlMs ?? 60_000
  const subscriptionTtlMs = options.subscriptionTtlMs ?? DEFAULT_SUBSCRIPTION_TTL_MS
  const fresh = (): SuperAgentDomainState => ({
    seq: 0,
    triggers: {},
    threads: {},
    tickets: {},
    assignments: {},
    decisions: {},
    inputs: {},
    mandates: {},
    reports: {},
    attentions: {},
    idempotency: {},
    handbacks: [],
    paused: false,
    pausedAt: null,
    executionPolicy: { ...DEFAULT_EXECUTION_POLICY },
    policy: cloneSuperAgentPolicy(DEFAULT_SUPER_AGENT_POLICY),
    evals: {},
    outbox: {},
  })
  const state: SuperAgentDomainState = options.initialState
    ? // 重水化：缺失字段补默认，已有事实原样保留；未知字段透传（前向兼容）。
      { ...fresh(), ...options.initialState }
    : fresh()

  // T20 #90：旧快照的 Eval 记录缺失 disposal 字段时补 null（缺失字段补默认）。
  for (const evalRecord of Object.values(state.evals)) {
    if (evalRecord.disposal === undefined) evalRecord.disposal = null
  }

  const atNow = (at?: string): string => at ?? now().toISOString()

  function nextOrdinal(): number {
    state.seq += 1
    return state.seq
  }

  function ensureThread(threadId: string, source: string): SuperAgentThread {
    let thread = state.threads[threadId]
    if (!thread) {
      thread = newThread(threadId, source)
      state.threads[threadId] = thread
    }
    return thread
  }

  function requireTicket(ticketId: string): SuperAgentTicket {
    const ticket = state.tickets[ticketId]
    if (!ticket) throw superAgentError('ticketNotFound', { ticketId })
    return ticket
  }

  function factsOf(ticket: SuperAgentTicket): TicketStageFacts {
    return {
      ticket,
      assignments: ticket.assignmentIds.map((id) => state.assignments[id]),
      inputs: ticket.inputIds.map((id) => state.inputs[id]),
      attentions: Object.values(state.attentions).filter(
        (attention) => attention.ticketId === ticket.ticketId,
      ),
    }
  }

  function stageOf(ticketId: string): SuperAgentTicketStage {
    return deriveTicketStage(factsOf(requireTicket(ticketId)))
  }

  function findByIdempotencyKey(key: string): SuperAgentIdempotencyEntry | undefined {
    return state.idempotency[key]
  }

  /** 已存在相同键时校验载荷；不同则冲突，相同则由调用方返回原结果。 */
  function assertSameFact(existing: SuperAgentIdempotencyEntry, fingerprint: string): void {
    if (existing.fingerprint !== fingerprint) throw superAgentError('conflict', { key: existing.kind })
  }

  function intakeTrigger(draft: TriggerDraft): TriggerIntakeResult {
    const key = idempotencyKey('event', draft.key)
    const fingerprint = canonical(draft)
    const existing = findByIdempotencyKey(key)
    if (existing) {
      // Source 负责事件去重：重复投递即使携带了不同快照文本，也返回原 Trigger。
      return { trigger: state.triggers[existing.id], duplicate: true }
    }

    const at = atNow(draft.at)
    const trigger: SuperAgentTrigger = {
      triggerId: newId('trigger'),
      key: draft.key,
      ordinal: nextOrdinal(),
      source: draft.source,
      threadIds: [...draft.threadIds],
      actor: draft.actor,
      human: draft.human,
      addressed: draft.addressed ?? null,
      channel: draft.channel ?? null,
      url: draft.url ?? null,
      text: draft.text,
      at,
      meta: draft.meta ?? {},
      disposition: {
        filtered: null,
        ticketIds: [],
        contextTicketIds: [],
        requeued: false,
        handedBack: false,
        ackedAt: null,
      },
    }

    for (const threadId of trigger.threadIds) {
      const thread = ensureThread(threadId, draft.source)
      thread.triggerIds.push(trigger.triggerId)
      thread.pendingTriggerIds.push(trigger.triggerId)
    }

    state.triggers[trigger.triggerId] = trigger
    state.idempotency[key] = { kind: 'trigger', id: trigger.triggerId, fingerprint }
    return { trigger, duplicate: false }
  }

  /** 建单核心（无幂等登记）：createTicket 与 dispatch 共用，幂等由各命令自己负责。 */
  function createTicketUnchecked(
    input: CreateTicketInput,
    key: string | null,
    fingerprint: string,
  ): CreateTicketResult {
    const at = atNow(input.at)
    const ticketId = newId('ticket')
    const threadId = input.trigger.threadIds[0] ?? newId('thread')
    const thread = ensureThread(threadId, input.trigger.source)
    thread.title = input.title

    const intake = intakeTrigger({
      ...input.trigger,
      threadIds: input.trigger.threadIds.length > 0 ? input.trigger.threadIds : [threadId],
      at,
    })
    const trigger = intake.trigger
    if (!trigger.disposition.ticketIds.includes(ticketId)) {
      trigger.disposition.ticketIds.push(ticketId)
    }
    const pendingIndex = thread.pendingTriggerIds.indexOf(trigger.triggerId)
    if (pendingIndex >= 0) thread.pendingTriggerIds.splice(pendingIndex, 1)

    const mandate: SuperAgentMandate = {
      mandateId: newId('mandate'),
      ticketId,
      policyVersion: input.policyVersion ?? 1,
      strength: input.strength ?? 'explicit',
      basis: input.basis ?? 'addressed',
      actor: input.trigger.actor,
      scope: { repoRoot: input.repoRoot, paths: input.scopePaths ?? [] },
      matchedRules: [],
      createdAt: at,
      revokedAt: null,
    }

    const ticket: SuperAgentTicket = {
      ticketId,
      title: input.title,
      state: 'open',
      createdAt: at,
      origin: { triggerId: trigger.triggerId, triggerIds: [trigger.triggerId] },
      mandateId: mandate.mandateId,
      threadId,
      assignmentIds: [],
      inputIds: [],
      answers: [],
      attentionId: null,
      execution: { name: 'main', directory: input.repoRoot, assignmentId: null },
      follows: [],
      delivery: null,
      undelivered: [],
      reviewRemindedAt: null,
      ended: null,
    }

    thread.subscriptions.push({ ticketId, attachedAt: at, contextOnly: false })

    state.mandates[mandate.mandateId] = mandate
    state.tickets[ticketId] = ticket
    if (key !== null) state.idempotency[key] = { kind: 'ticket', id: ticketId, fingerprint }

    return { ticket, mandate, thread, duplicate: false }
  }

  function createTicket(input: CreateTicketInput): CreateTicketResult {
    const key = idempotencyKey('request', input.requestId)
    const fingerprint = canonical({
      title: input.title,
      repoRoot: input.repoRoot,
      trigger: input.trigger,
      scopePaths: input.scopePaths ?? [],
      policyVersion: input.policyVersion ?? 1,
      strength: input.strength ?? 'explicit',
      basis: input.basis ?? 'addressed',
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const ticket = state.tickets[existing.id]
      return {
        ticket,
        mandate: state.mandates[ticket.mandateId],
        thread: state.threads[ticket.threadId],
        duplicate: true,
      }
    }

    return createTicketUnchecked(input, key, fingerprint)
  }

  function newAssignmentForTicket(
    ticket: SuperAgentTicket,
    at: string,
    initialState: 'pending' | 'running',
  ): SuperAgentAssignment {
    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    const assignment: SuperAgentAssignment = {
      assignmentId: newId('assignment'),
      ticketId: ticket.ticketId,
      generation: latest ? latest.generation + 1 : 1,
      state: initialState,
      createdAt: at,
      startedAt: initialState === 'running' ? at : null,
      endedAt: null,
      endedReason: null,
      createdOrdinal: nextOrdinal(),
      endedOrdinal: null,
      report: null,
      deliveredAt: null,
      idleAt: null,
    }
    state.assignments[assignment.assignmentId] = assignment
    ticket.assignmentIds.push(assignment.assignmentId)
    ticket.execution.assignmentId = assignment.assignmentId
    return assignment
  }

  function dispatch(input: DispatchInput): DispatchResult {
    if (input.title.trim() === '' || input.text.trim() === '') {
      throw superAgentError('invalidDispatch', { requestId: input.requestId })
    }

    const key = idempotencyKey('request', input.requestId)
    const fingerprint = canonical({
      kind: 'dispatch',
      title: input.title,
      repoRoot: input.repoRoot,
      text: input.text,
      contextPaths: input.contextPaths ?? [],
      attachments: input.attachments ?? [],
      policyVersion: input.policyVersion ?? 1,
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const ticket = state.tickets[existing.id]
      const assignment = state.assignments[ticket.assignmentIds[0]]
      return {
        ticket,
        decision: state.decisions[ticket.ticketId],
        mandate: state.mandates[ticket.mandateId],
        assignment,
        duplicate: true,
      }
    }

    const at = atNow(input.at)
    // Desktop 显式派工：source='desktop'、strength='explicit'、basis='addressed'，
    // 产生 Decision → Mandate → pending Assignment 的审计链。
    const created = createTicketUnchecked(
      {
        requestId: input.requestId,
        title: input.title,
        repoRoot: input.repoRoot,
        trigger: {
          key: `desktop-dispatch:${input.requestId}`,
          source: 'desktop',
          threadIds: [],
          actor: input.actor,
          human: true,
          addressed: 'direct',
          text: input.text,
          at,
        },
        policyVersion: input.policyVersion,
      },
      key,
      fingerprint,
    )

    const decision: SuperAgentDecision = {
      decisionId: newId('decision'),
      ticketId: created.ticket.ticketId,
      triggerId: created.ticket.origin.triggerId,
      action: 'accept',
      source: 'desktop',
      actor: input.actor,
      human: true,
      policyVersion: created.mandate.policyVersion,
      strength: created.mandate.strength,
      basis: created.mandate.basis,
      at,
    }
    state.decisions[created.ticket.ticketId] = decision

    const assignment = newAssignmentForTicket(created.ticket, at, 'pending')

    return {
      ticket: created.ticket,
      decision,
      mandate: created.mandate,
      assignment,
      duplicate: false,
    }
  }

  function startAssignment(input: StartAssignmentInput): SuperAgentAssignment {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    if (latest && (latest.state === 'pending' || latest.state === 'running')) {
      throw superAgentError('notRetryable', { ticketId: ticket.ticketId })
    }

    return newAssignmentForTicket(ticket, atNow(input.at), 'running')
  }

  /** Scheduler 专用：把 pending Assignment 标记为 running 并落 startedAt。 */
  function launchAssignment(input: LaunchAssignmentInput): SuperAgentAssignment {
    const assignment = state.assignments[input.assignmentId]
    if (!assignment) {
      throw superAgentError('assignmentNotFound', { assignmentId: input.assignmentId })
    }
    if (assignment.state !== 'pending') {
      throw superAgentError('assignmentNotPending', { assignmentId: input.assignmentId })
    }

    assignment.state = 'running'
    assignment.startedAt = atNow(input.at)
    return assignment
  }

  function endAssignment(input: EndAssignmentInput): SuperAgentAssignment {
    const assignment = state.assignments[input.assignmentId]
    if (!assignment) {
      throw superAgentError('assignmentNotFound', { assignmentId: input.assignmentId })
    }
    if (assignment.state === 'ended' || assignment.state === 'interrupted') return assignment

    const at = atNow(input.at)
    assignment.state = input.reason === 'interrupted' ? 'interrupted' : 'ended'
    assignment.endedAt = at
    assignment.endedReason = input.reason
    assignment.endedOrdinal = nextOrdinal()
    if (assignment.idleAt === null) assignment.idleAt = at
    return assignment
  }

  function bindTriggerToTicket(
    ticket: SuperAgentTicket,
    triggerId: string,
    context: boolean,
    at: string,
  ): void {
    const trigger = state.triggers[triggerId]
    if (!trigger) return
    const target = context ? trigger.disposition.contextTicketIds : trigger.disposition.ticketIds
    if (!target.includes(ticket.ticketId)) target.push(ticket.ticketId)
    trigger.disposition.ackedAt = at
    const threadId = trigger.threadIds[0]
    const thread = threadId ? state.threads[threadId] : undefined
    if (thread) {
      const pendingIndex = thread.pendingTriggerIds.indexOf(triggerId)
      if (pendingIndex >= 0) thread.pendingTriggerIds.splice(pendingIndex, 1)
    }
  }

  function addInput(command: AddInputCommand): AddInputResult {
    const ticket = requireTicket(command.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const key = idempotencyKey('request', command.requestId)
    const fingerprint = canonical({
      ticketId: command.ticketId,
      kind: command.kind,
      human: command.human,
      context: command.context ?? false,
      note: command.note ?? null,
      text: command.text ?? null,
      triggerId: command.triggerId ?? null,
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const input = state.inputs[existing.id]
      return {
        input,
        gated: input.status === 'pending',
        delivered: input.status === 'delivered' || input.status === 'read',
        duplicate: true,
      }
    }

    const facts = factsOf(ticket)
    const gateWasClosed = waitsForPerson(facts)
    // 仅上下文输入不投递、不唤醒，也不能替人解除 blocked/failed。
    const wakesTicket = command.human && !(command.context ?? false)
    const gated = gateWasClosed && !wakesTicket
    const latest = latestAssignmentOf(facts.assignments)
    const canDeliver = latest !== null && (latest.state === 'pending' || latest.state === 'running')
    // T11 #81：暂停期间新 Input 只落库不投递（活动 turn 不打断，消息不丢）。
    const delivered = !gated && canDeliver && !state.paused
    const at = atNow(command.at)

    if (command.triggerId && !state.triggers[command.triggerId]) {
      throw superAgentError('triggerNotFound', { triggerId: command.triggerId })
    }

    const input: SuperAgentInput = {
      inputId: newId('input'),
      ticketId: ticket.ticketId,
      ordinal: nextOrdinal(),
      kind: command.kind,
      status: delivered ? 'delivered' : 'pending',
      human: command.human,
      context: command.context ?? false,
      note: command.note ?? null,
      text: command.text ?? null,
      triggerId: command.triggerId ?? null,
      requestId: command.requestId,
      at,
      readAt: null,
      deliveredTo: delivered ? latest?.assignmentId ?? null : null,
      deliveredAt: delivered ? at : null,
      releasedAt: null,
    }

    state.inputs[input.inputId] = input
    ticket.inputIds.push(input.inputId)
    if (input.triggerId) bindTriggerToTicket(ticket, input.triggerId, input.context, at)
    state.idempotency[key] = { kind: 'input', id: input.inputId, fingerprint }

    // 人工消息解除 blocked/failed 时复用原 Assignment：不新建、不递增 generation。
    if (gateWasClosed && command.human && delivered) {
      ticket.execution.assignmentId = latest?.assignmentId ?? ticket.execution.assignmentId
    }

    return { input, gated, delivered, duplicate: false }
  }

  /**
   * T08 #78：就地回答 Attention。回答经 addInput 既有接缝落成领域 Input 并
   * 投递给对应 Worker；Attention 保持 open 直到 Worker 用 answers 认领，
   * 认领前允许补充回答（追加到 attention.answers）。
   */
  function answerAttention(command: AnswerAttentionCommand): AnswerAttentionResult {
    const attention = state.attentions[command.attentionId]
    if (!attention) {
      throw superAgentError('notAttention', { attentionId: command.attentionId })
    }

    // 幂等重试：返回原输入与 Attention 当前状态（可能已被认领/撤回）。
    const key = idempotencyKey('request', command.requestId)
    const existing = state.idempotency[key]
    if (existing) {
      if (existing.kind !== 'input') throw superAgentError('conflict', { key: existing.kind })
      const input = state.inputs[existing.id]
      if (
        !input ||
        input.ticketId !== attention.ticketId ||
        input.kind !== 'text' ||
        !input.human ||
        input.text !== command.text
      ) {
        throw superAgentError('conflict', { key: existing.kind })
      }
      return {
        attention,
        input,
        delivered: input.status === 'delivered' || input.status === 'read',
        gated: input.status === 'pending',
        duplicate: true,
      }
    }

    if (attention.status !== 'open') {
      throw superAgentError('notAttention', { attentionId: command.attentionId })
    }
    if (attention.kind !== 'question') {
      throw superAgentError('notQuestion', { attentionId: command.attentionId })
    }
    if (command.text.trim() === '') {
      throw superAgentError('invalidAnswer', { attentionId: command.attentionId })
    }

    const added = addInput({
      ticketId: attention.ticketId,
      requestId: command.requestId,
      kind: 'text',
      human: true,
      text: command.text,
      at: command.at,
    })
    if (!attention.answers.includes(added.input.inputId)) {
      attention.answers.push(added.input.inputId)
    }
    return {
      attention,
      input: added.input,
      delivered: added.delivered,
      gated: added.gated,
      duplicate: added.duplicate,
    }
  }

  /** T09 #79：requestId 对账可证明未接受（已投未读退回 pending）时才允许重投。 */
  function requeueInput(input: RequeueInputInput): SuperAgentInput {
    const target = state.inputs[input.inputId]
    if (!target) throw superAgentError('inputNotFound', { inputId: input.inputId })
    const ticket = requireTicket(target.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (target.status !== 'delivered') {
      throw superAgentError('conflict', { inputId: target.inputId, status: target.status })
    }

    target.status = 'pending'
    target.deliveredTo = null
    target.deliveredAt = null
    return target
  }

  /** T09 #79：投递被接受后把 pending 的 Input 落盘为 delivered；已 delivered 幂等。 */
  function deliverInput(input: DeliverInputInput): SuperAgentInput {
    const target = state.inputs[input.inputId]
    if (!target) throw superAgentError('inputNotFound', { inputId: input.inputId })
    const ticket = requireTicket(target.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (target.status === 'delivered') return target
    if (target.status !== 'pending') {
      throw superAgentError('conflict', { inputId: target.inputId, status: target.status })
    }
    const facts = factsOf(ticket)
    const latest = latestAssignmentOf(facts.assignments)
    if (!latest || (latest.state !== 'pending' && latest.state !== 'running')) {
      throw superAgentError('assignmentNotPending', { assignmentId: latest?.assignmentId ?? '' })
    }
    const at = atNow(input.at)
    target.status = 'delivered'
    target.deliveredTo = latest.assignmentId
    target.deliveredAt = at
    return target
  }

  /**
   * T09 #79：投递结果未知时标 uncertain 并产生 delivery Attention，让人看见，
   * 禁止盲目重投；重复标记幂等，不新建第二条 Attention。
   */
  function markInputUncertain(input: MarkInputUncertainInput): MarkInputUncertainResult {
    const target = state.inputs[input.inputId]
    if (!target) throw superAgentError('inputNotFound', { inputId: input.inputId })
    const ticket = requireTicket(target.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const existing = Object.values(state.attentions).find(
      (candidate) =>
        candidate.ticketId === ticket.ticketId &&
        candidate.kind === 'delivery' &&
        candidate.status === 'open' &&
        candidate.askedBy === target.inputId,
    )
    if (target.status === 'uncertain' || existing) {
      target.status = 'uncertain'
      return { input: target, attentionId: existing?.attentionId ?? null, duplicate: true }
    }

    target.status = 'uncertain'
    const facts = factsOf(ticket)
    const latest = latestAssignmentOf(facts.assignments)
    const attention: SuperAgentAttention = {
      attentionId: newId('attention'),
      ticketId: ticket.ticketId,
      assignmentId: target.deliveredTo ?? latest?.assignmentId ?? target.inputId,
      kind: 'delivery',
      question: input.reason ?? 'delivery-uncertain',
      askedBy: target.inputId,
      askedAt: atNow(input.at),
      status: 'open',
      answers: [],
      answeredAt: null,
      sessionId: null,
      requestId: null,
    }
    state.attentions[attention.attentionId] = attention
    ticket.attentionId = ticket.attentionId ?? attention.attentionId
    return { input: target, attentionId: attention.attentionId, duplicate: false }
  }

  function failDelivery(input: FailDeliveryInput): SuperAgentTicket {
    const failed = state.inputs[input.inputId]
    if (!failed) throw superAgentError('inputNotFound', { inputId: input.inputId })
    const ticket = requireTicket(failed.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const at = atNow(input.at)
    failed.status = 'failed'
    ticket.delivery = { inputId: failed.inputId, error: input.error, at }
    if (!ticket.undelivered.includes(failed.inputId)) ticket.undelivered.push(failed.inputId)
    return ticket
  }

  /**
   * T18 #88：Attention 被替换/清除时，未发出的 attention 回复从 Outbox 撤回
   * （回写为 withdrawn），保证「同一问题只提醒一次」且不外发已失效的问题。
   */
  function withdrawPendingAttentionReplies(ticketId: string, at: string): void {
    for (const message of Object.values(state.outbox)) {
      if (
        message.status === 'pending' &&
        message.ticketId === ticketId &&
        message.payload.kind === 'reply' &&
        message.payload.replyType === 'attention'
      ) {
        message.status = 'withdrawn'
        message.withdrawnAt = at
      }
    }
  }

  function withdrawOpenAttentions(
    ticket: SuperAgentTicket,
    at: string,
  ): string[] {
    const withdrawn: string[] = []
    for (const attention of Object.values(state.attentions)) {
      if (attention.ticketId === ticket.ticketId && attention.status === 'open') {
        attention.status = 'withdrawn'
        withdrawn.push(attention.attentionId)
      }
    }
    ticket.attentionId = null
    withdrawPendingAttentionReplies(ticket.ticketId, at)
    return withdrawn
  }

  /**
   * T17 #87：释放一条人消息的归属 —— 从 Trigger 消费方移除本工单；无其他
   * 消费方时回流 Eval 恰一次（pending 重排 + handbacks 落库）。工单结束收尾
   * 与 Worker handback 共用此路径，保证「回流恰一次」语义单一出处。
   * 返回是否已回流 Eval。
   */
  function releaseHumanInput(ticket: SuperAgentTicket, input: SuperAgentInput, at: string): boolean {
    input.releasedAt = at

    // 非 Trigger 派生的人消息没有其他 owner，直接回流 Eval；Trigger 消息要等最后一个
    // 工单/上下文订阅释放后才回流，否则会重复触发 Eval。
    let handedBackToEval = input.triggerId === null
    if (input.triggerId) {
      const trigger = state.triggers[input.triggerId]
      if (trigger) {
        trigger.disposition.ticketIds = trigger.disposition.ticketIds.filter(
          (ticketId) => ticketId !== ticket.ticketId,
        )
        trigger.disposition.contextTicketIds = trigger.disposition.contextTicketIds.filter(
          (ticketId) => ticketId !== ticket.ticketId,
        )
        const hasOtherOwner =
          trigger.disposition.ticketIds.length > 0 ||
          trigger.disposition.contextTicketIds.length > 0
        if (!hasOtherOwner) {
          handedBackToEval = true
          trigger.disposition.handedBack = true
          const threadId = trigger.threadIds[0]
          const thread = threadId ? state.threads[threadId] : undefined
          if (thread && !thread.pendingTriggerIds.includes(trigger.triggerId)) {
            thread.pendingTriggerIds.push(trigger.triggerId)
          }
        }
      }
    }
    if (handedBackToEval && !state.handbacks.includes(input.inputId)) {
      state.handbacks.push(input.inputId)
    }
    return handedBackToEval
  }

  function endTicketInternal(
    ticket: SuperAgentTicket,
    command: { outcome: SuperAgentTicketOutcome; by: SuperAgentEndedBy; reason: string; at: string },
  ): EndTicketResult {
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    ticket.state = 'ended'
    ticket.ended = {
      at: command.at,
      by: command.by,
      outcome: command.outcome,
      reason: command.reason,
    }

    // T14 #84：工单收尾时最新代次一并收尾（endAssignment 对已收尾代次幂等）。
    // 否则 completed 工单的 Worker 只读镜像永远显示 running —— 正是
    // 「不出现『进程已退出但 Assignment 仍 running』」要杜绝的脏状态。
    const latestAssignmentId = ticket.execution?.assignmentId
    if (latestAssignmentId && state.assignments[latestAssignmentId]) {
      endAssignment({
        assignmentId: latestAssignmentId,
        reason: command.outcome === 'stopped' ? 'stopped' : 'completed',
        at: command.at,
      })
    }

    const withdrawnAttentionIds = withdrawOpenAttentions(ticket, command.at)
    ticket.delivery = null

    const releasedInputIds: string[] = []
    for (const inputId of ticket.inputIds) {
      const input = state.inputs[inputId]
      if (!input || !input.human) continue
      // 未读、未确认、未回答、未交回的人消息才回流；已 read 或已被 answers 认领的不动。
      if (input.readAt !== null) continue
      if (ticket.answers.includes(inputId)) continue
      if (input.releasedAt !== null) continue

      releaseHumanInput(ticket, input, command.at)
      releasedInputIds.push(inputId)
    }

    ticket.undelivered = []
    return { ticket, releasedInputIds, withdrawnAttentionIds }
  }

  function endTicket(command: EndTicketCommand): EndTicketResult {
    const ticket = requireTicket(command.ticketId)
    return endTicketInternal(ticket, {
      outcome: command.outcome,
      by: command.by,
      reason: command.reason,
      at: atNow(command.at),
    })
  }

  /** T10 #80：接受验收 —— 只有 person/review 的工单可完成；结束前未读人消息照常回流。 */
  function ticketAccept(input: TicketAcceptInput): EndTicketResult {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (stageOf(ticket.ticketId) !== 'person/review') {
      throw superAgentError('notReady', { ticketId: ticket.ticketId })
    }
    return endTicketInternal(ticket, {
      outcome: 'completed',
      by: 'user',
      reason: 'ticket-accept',
      at: atNow(input.at),
    })
  }

  /** T10 #80：停止出口 —— 撤回 Mandate、在途 Assignment 以 stopped 收尾、工单 stopped。 */
  function ticketStop(input: TicketStopInput): EndTicketResult {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })

    const at = atNow(input.at)
    const mandate = state.mandates[ticket.mandateId]
    if (mandate) mandate.revokedAt = at

    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    if (latest && (latest.state === 'pending' || latest.state === 'running')) {
      endAssignment({ assignmentId: latest.assignmentId, reason: 'stopped', at })
    }

    return endTicketInternal(ticket, {
      outcome: 'stopped',
      by: 'user',
      reason: input.reason ?? 'ticket-stop',
      at,
    })
  }

  /** T10 #80：继续追问 —— review 的人消息复用原 Assignment 回到 working（不换代次）。 */
  function ticketMessage(input: TicketMessageInput): AddInputResult {
    if (typeof input.text !== 'string' || input.text.trim() === '') {
      throw superAgentError('invalidTicketMessage', { ticketId: input.ticketId })
    }
    // T16 #86：续接前 revalidate —— Policy 已不再承认该 Mandate 的来源授权时拒绝续接。
    assertMandateAdmitsContinuation(input.ticketId)
    return addInput({
      ticketId: input.ticketId,
      requestId: input.requestId,
      kind: 'text',
      human: true,
      text: input.text,
      at: input.at,
    })
  }

  /** T10 #80：人工重试 —— 只对投递失败/受阻/失败开放，新建 generation+1 的 pending Assignment。 */
  function retryTicket(input: RetryTicketInput): RetryTicketResult {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (!canRetryTicket(factsOf(ticket))) {
      throw superAgentError('notRetryable', { ticketId: ticket.ticketId })
    }
    // T16 #86：人工续接（重试）前 revalidate。
    assertMandateAdmitsContinuation(input.ticketId)

    const at = atNow(input.at)
    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    if (latest && (latest.state === 'pending' || latest.state === 'running')) {
      // 人工重试取代旧代次：旧 Assignment 以 stopped 收尾，不再悬挂 running。
      endAssignment({ assignmentId: latest.assignmentId, reason: 'stopped', at })
    }
    // 永久投递失败随重试清除：新代次从 working/queued 重新开始。
    ticket.delivery = null
    ticket.undelivered = []

    const assignment = newAssignmentForTicket(ticket, at, 'pending')
    return { ticket, assignment }
  }

  /** T10 #80：review 超时提醒水位 —— 只前进，离开 review 或已结束拒绝（幂等安全）。 */
  function markReviewReminded(input: MarkReviewRemindedInput): SuperAgentTicket {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (stageOf(ticket.ticketId) !== 'person/review') {
      throw superAgentError('notReady', { ticketId: ticket.ticketId })
    }
    const at = atNow(input.at)
    if (ticket.reviewRemindedAt === null || at > ticket.reviewRemindedAt) {
      ticket.reviewRemindedAt = at
      nextOrdinal()
    }
    return ticket
  }

  /** T11 #81：步取走对账游标 —— 已投递输入标已读；已读幂等，未投递拒绝。 */
  function markInputRead(input: MarkInputReadInput): SuperAgentInput {
    const record = state.inputs[input.inputId]
    if (!record) throw superAgentError('inputNotFound', { inputId: input.inputId })
    if (record.status === 'read') return record
    if (record.status !== 'delivered') {
      throw superAgentError('conflict', { inputId: input.inputId, status: record.status })
    }
    record.status = 'read'
    record.readAt = atNow(input.at)
    nextOrdinal()
    return record
  }

  /**
   * T11 #81：重启恢复 —— 仅最新代次为 interrupted 的工单可建 generation+1
   * 的 pending 恢复代次（busy 判定由 recovery 模块负责）。不复制旧代次状态：
   * 恢复代次从 working 语义重新开始，历史输入经对账回队首。
   */
  function recoverTicket(input: TicketRecoveryInput): RetryTicketResult {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    const latest = latestAssignmentOf(ticket.assignmentIds.map((id) => state.assignments[id]))
    if (!latest || latest.state !== 'interrupted') {
      throw superAgentError('notRetryable', { ticketId: ticket.ticketId })
    }
    // T16 #86：人工续接（恢复）前 revalidate。
    assertMandateAdmitsContinuation(input.ticketId)
    const assignment = newAssignmentForTicket(ticket, atNow(input.at), 'pending')
    return { ticket, assignment }
  }

  /** T11 #81：项目暂停（幂等）—— 持久领域事实，阻止新 launch/delivery。 */
  function pauseProject(input: { at?: string } = {}): SuperAgentDomainState {
    if (!state.paused) {
      state.paused = true
      state.pausedAt = atNow(input.at)
      nextOrdinal()
    }
    return state
  }

  /** T11 #81：恢复暂停（幂等）—— 后续 launch/delivery 由上层续跑。 */
  function resumeProject(input: { at?: string } = {}): SuperAgentDomainState {
    if (state.paused) {
      const resumedAt = atNow(input.at)
      // T16 #86：恢复时把运行中 Eval 的 deadline 顺延一个暂停时长 ——
      // 暂停期间不计时，等于把暂停窗口原样补回评估时限。
      const pausedAt = state.pausedAt
      if (pausedAt !== null) {
        const pauseMs = Date.parse(resumedAt) - Date.parse(pausedAt)
        for (const evalRecord of Object.values(state.evals)) {
          if (evalRecord.state === 'delivered' && evalRecord.deadlineAt !== null) {
            evalRecord.deadlineAt = new Date(
              Date.parse(evalRecord.deadlineAt) + pauseMs,
            ).toISOString()
          }
        }
      }
      state.paused = false
      state.pausedAt = null
      nextOrdinal()
    }
    return state
  }

  /**
   * T12 #82：执行策略变更。worktree 由 mode 派生（并行强制 per-ticket，
   * 串行共享根目录），上限 serial=1、parallel=2–6；相同策略幂等不推进 seq。
   */
  function setExecutionPolicy(input: SetExecutionPolicyInput): SetExecutionPolicyResult {
    const next = resolveExecutionPolicy(input)
    const changed =
      state.executionPolicy.mode !== next.mode ||
      state.executionPolicy.maxWorkers !== next.maxWorkers ||
      state.executionPolicy.worktree !== next.worktree
    if (changed) {
      state.executionPolicy = next
      nextOrdinal()
    }
    return { policy: state.executionPolicy, changed }
  }

  // ------------------------------------------------------------------
  // T16 #86：程序层 Gate → 语义 Eval → Decision（Policy 三模式与版本化）
  // ------------------------------------------------------------------

  /** T16 #86：超时重排 2 次，连续第 3 次记 unavailable。 */
  const MAX_EVAL_TIMEOUTS = 3

  function requireEval(evalId: string): SuperAgentEval {
    const evalRecord = state.evals[evalId]
    if (!evalRecord) throw superAgentError('evalNotFound', { evalId })
    return evalRecord
  }

  /** 校验 Policy 子项并归一成新快照（不落库）。 */
  function normalizePolicy(
    acceptMode: SuperAgentAcceptMode | undefined,
    rules: SuperAgentPolicyRule[] | undefined,
    admissions: SuperAgentSourceAdmission[] | undefined,
  ): Pick<SuperAgentPolicy, 'acceptMode' | 'rules' | 'admissions'> {
    const invalid = (field: string) => superAgentError('invalidPolicy', { field })
    if (acceptMode === undefined) acceptMode = state.policy.acceptMode
    if (acceptMode !== 'off' && acceptMode !== 'observe' && acceptMode !== 'auto') {
      throw invalid('acceptMode')
    }
    const nextRules = rules ?? state.policy.rules
    const ruleNames = new Set<string>()
    for (const rule of nextRules) {
      if (typeof rule?.name !== 'string' || rule.name.trim() === '') throw invalid('rules')
      if (typeof rule?.instruction !== 'string' || rule.instruction.trim() === '') {
        throw invalid('rules')
      }
      if (ruleNames.has(rule.name)) throw invalid('rules')
      ruleNames.add(rule.name)
    }
    const nextAdmissions = admissions ?? state.policy.admissions
    const sources = new Set<string>()
    for (const entry of nextAdmissions) {
      if (typeof entry?.source !== 'string' || entry.source.trim() === '') {
        throw invalid('admissions')
      }
      if (sources.has(entry.source)) throw invalid('admissions')
      sources.add(entry.source)
      for (const list of [entry.channels, entry.allowlist, entry.bots]) {
        if (!Array.isArray(list) || list.some((id) => typeof id !== 'string' || id === '')) {
          throw invalid('admissions')
        }
      }
    }
    return {
      acceptMode,
      rules: clonePolicyRules(nextRules),
      admissions: clonePolicyAdmissions(nextAdmissions),
    }
  }

  /**
   * T16 #86：Policy 变更。任一子项变化 version+1，并丢弃运行中
   * （queued/delivered）Eval：批次 Trigger 按新版本重排回队，
   * 旧版本的评估结果在提交口被拒绝（evalPolicyStale）。
   */
  function setPolicy(input: SetPolicyInput): SetPolicyResult {
    const next = normalizePolicy(input.acceptMode, input.rules, input.admissions)
    const changed =
      canonical(next) !==
      canonical({
        acceptMode: state.policy.acceptMode,
        rules: state.policy.rules,
        admissions: state.policy.admissions,
      })
    const discardedEvalIds: string[] = []
    if (changed) {
      state.policy = { version: state.policy.version + 1, ...next }
      for (const evalRecord of Object.values(state.evals)) {
        if (evalRecord.state !== 'queued' && evalRecord.state !== 'delivered') continue
        evalRecord.state = 'discarded'
        const thread = state.threads[evalRecord.threadId]
        if (thread) {
          thread.evaluating = false
          // 丢弃不是超时：按新版本重排后的批次重新获得完整的重排配额。
          thread.expired = 0
          requeueTriggers(thread, evalRecord.triggerIds)
        }
        discardedEvalIds.push(evalRecord.evalId)
      }
      nextOrdinal()
    }
    return { policy: state.policy, changed, discardedEvalIds }
  }

  /** T16 #86：程序层过滤落库 —— Trigger 记原因码并退出 Eval 候选（幂等，首个原因码生效）。 */
  function filterTrigger(input: FilterTriggerInput): SuperAgentTrigger {
    const trigger = state.triggers[input.triggerId]
    if (!trigger) throw superAgentError('triggerNotFound', { triggerId: input.triggerId })
    // 已过滤（含断档重放/策略变化后原因码不同）幂等返回：首个原因码为准，
    // 不因重放换码而报错 —— 否则重放会被 Ingestor 误判为坏事件进隔离区。
    if (trigger.disposition.filtered !== null) return trigger
    trigger.disposition.filtered = input.reason
    for (const thread of Object.values(state.threads)) {
      const pendingIndex = thread.pendingTriggerIds.indexOf(trigger.triggerId)
      if (pendingIndex >= 0) thread.pendingTriggerIds.splice(pendingIndex, 1)
    }
    nextOrdinal()
    return trigger
  }

  /** 批次 Trigger 回队（保持时序；已在队中不重复入队）。 */
  function requeueTriggers(thread: SuperAgentThread, triggerIds: string[]): void {
    for (const triggerId of triggerIds) {
      const trigger = state.triggers[triggerId]
      if (trigger) trigger.disposition.requeued = true
      if (!thread.pendingTriggerIds.includes(triggerId)) thread.pendingTriggerIds.push(triggerId)
    }
  }

  /**
   * T16 #86：按 Thread 建批进入语义 Eval（串行）。批次 = 该 Thread 全部
   * pending 候选，经当前 Policy 重新过程序层 Gate：不再准入的落原因码，
   * 准入的聚合批次强度（任一 bot → 整批按 bot 处理，不能借批次显式请求）。
   */
  function startEval(input: StartEvalInput): SuperAgentEval {
    const thread = state.threads[input.threadId]
    if (!thread) throw superAgentError('threadNotFound', { threadId: input.threadId })
    if (thread.evaluating) throw superAgentError('evalBusy', { threadId: input.threadId })
    if (state.policy.acceptMode === 'off') {
      throw superAgentError('acceptModeOff', { threadId: input.threadId })
    }

    const at = atNow(input.at)
    const admitted: { triggerId: string; gate: Exclude<SuperAgentGateAdmission, { admitted: false }> }[] = []
    let anyExplicit = false
    for (const triggerId of [...thread.pendingTriggerIds]) {
      const trigger = state.triggers[triggerId]
      if (!trigger) continue
      // T17 #87 fast path 防御：仍有存活 owner 的人消息归 Worker 裁决，
      // 不进 Eval（正常流程不会入队；此处兜底拦下陈旧队列里的持有消息）。
      if (trigger.human && followupOwners(triggerId).length > 0) continue
      const gate = gateTrigger(state.policy, trigger)
      if (!gate.admitted) {
        filterTrigger({ triggerId, reason: gate.filtered })
        continue
      }
      if (gate.strength === 'explicit') anyExplicit = true
      admitted.push({ triggerId, gate })
    }
    if (admitted.length === 0) throw superAgentError('evalEmpty', { threadId: input.threadId })

    // 聚合：整批都是 bot 才按 bot 处理（bot 不能借批次显式请求/停止）；
    // 混入人消息的批次按人消息授权判定。
    const allBots = admitted.every((item) => item.gate.bot)
    const strength: SuperAgentMandateStrength = allBots || !anyExplicit ? 'inferred' : 'explicit'
    const basis: SuperAgentMandateBasis = allBots
      ? 'bot'
      : anyExplicit
        ? 'addressed'
        : 'admission'
    const primary = state.triggers[admitted[0]!.triggerId]!
    const evalRecord: SuperAgentEval = {
      evalId: newId('eval'),
      threadId: thread.threadId,
      triggerIds: admitted.map((item) => item.triggerId),
      policyVersion: state.policy.version,
      state: 'queued',
      strength,
      basis,
      bot: allBots,
      actor: primary.actor,
      createdAt: at,
      deliveredAt: null,
      deadlineAt: null,
      decision: null,
      disposal: null,
    }
    state.evals[evalRecord.evalId] = evalRecord
    const admittedIds = new Set(evalRecord.triggerIds)
    thread.pendingTriggerIds = thread.pendingTriggerIds.filter((id) => !admittedIds.has(id))
    thread.evaluating = true
    nextOrdinal()
    return evalRecord
  }

  /** T16 #86：候选送达 Router —— deadline 从这一刻起算（未送达不计时）。 */
  function deliverEval(input: DeliverEvalInput): SuperAgentEval {
    const evalRecord = requireEval(input.evalId)
    if (evalRecord.state !== 'queued') {
      throw superAgentError('conflict', { evalId: input.evalId, state: evalRecord.state })
    }
    const at = atNow(input.at)
    evalRecord.state = 'delivered'
    evalRecord.deliveredAt = at
    evalRecord.deadlineAt = new Date(Date.parse(at) + evalTtlMs).toISOString()
    nextOrdinal()
    return evalRecord
  }

  /**
   * T16 #86：deadline 到点检查。暂停期间不超时（恢复时顺延）；未到点/未送达
   * no-op。超时重排 2 次；连续第 3 次记 unavailable —— Trigger 扣住不回队，
   * 等待人工处置（unavailable 不是 ignore）。
   */
  function expireEval(input: ExpireEvalInput): ExpireEvalResult {
    const evalRecord = requireEval(input.evalId)
    if (evalRecord.state !== 'delivered' || evalRecord.deadlineAt === null) {
      return { eval: evalRecord, outcome: 'ignored' }
    }
    if (state.paused) return { eval: evalRecord, outcome: 'ignored' }
    const at = atNow(input.at)
    if (Date.parse(at) < Date.parse(evalRecord.deadlineAt)) {
      return { eval: evalRecord, outcome: 'ignored' }
    }
    const thread = state.threads[evalRecord.threadId]
    if (!thread) return { eval: evalRecord, outcome: 'ignored' }

    thread.expired += 1
    if (thread.expired >= MAX_EVAL_TIMEOUTS) {
      evalRecord.state = 'unavailable'
      evalRecord.decision = { action: 'unavailable', at, matchedRules: [], ticketId: null }
      thread.evaluating = false
      nextOrdinal()
      return { eval: evalRecord, outcome: 'unavailable' }
    }

    evalRecord.state = 'requeued'
    requeueTriggers(thread, evalRecord.triggerIds)
    thread.evaluating = false
    nextOrdinal()
    return { eval: evalRecord, outcome: 'requeued' }
  }

  /**
   * T20 #90：unavailable Eval 的人工处置 —— 重新评估。批次里未被其他工单
   * 消费的 Trigger 回队，连续超时计数清零（重新评估重置计数），Thread 可
   * 立即开新一轮评估；处置事实落 disposal 审计。
   */
  function reevaluateEval(input: ReevaluateEvalInput): ReevaluateEvalResult {
    const evalRecord = requireEval(input.evalId)
    if (evalRecord.state !== 'unavailable') {
      throw superAgentError('evalNotUnavailable', {
        evalId: input.evalId,
        state: evalRecord.state,
      })
    }
    const at = atNow(input.at)
    const thread = state.threads[evalRecord.threadId]
    if (!thread) throw superAgentError('threadNotFound', { threadId: evalRecord.threadId })

    // 已被其他工单消费的 Trigger 不抢归属（与 accept 去重同规则）。
    const requeuedTriggerIds = evalRecord.triggerIds.filter((triggerId) => {
      const trigger = state.triggers[triggerId]
      return trigger !== undefined && trigger.disposition.ticketIds.length === 0
    })
    requeueTriggers(thread, requeuedTriggerIds)
    thread.expired = 0
    thread.evaluating = false
    evalRecord.state = 'reevaluated'
    evalRecord.disposal = { action: 'reevaluated', at }
    nextOrdinal()
    return { eval: evalRecord, requeuedTriggerIds }
  }

  /**
   * T20 #90：unavailable Eval 的人工处置 —— 显式忽略。扣住的 Trigger
   * 释放但不回队（不阻塞 Thread、不再提示），处置事实落 disposal 审计。
   */
  function dismissEval(input: DismissEvalInput): SuperAgentEval {
    const evalRecord = requireEval(input.evalId)
    if (evalRecord.state !== 'unavailable') {
      throw superAgentError('evalNotUnavailable', {
        evalId: input.evalId,
        state: evalRecord.state,
      })
    }
    const at = atNow(input.at)
    const thread = state.threads[evalRecord.threadId]
    if (!thread) throw superAgentError('threadNotFound', { threadId: evalRecord.threadId })

    thread.expired = 0
    thread.evaluating = false
    evalRecord.state = 'dismissed'
    evalRecord.disposal = { action: 'dismissed', at }
    nextOrdinal()
    return evalRecord
  }

  /** auto 模式 accept 建单：Decision → Mandate（含命中规则）→ pending Assignment。 */
  function createEvalTicket(
    evalRecord: SuperAgentEval,
    triggerIds: string[],
    input: SubmitEvalDecisionInput,
    at: string,
  ): { ticket: SuperAgentTicket; decision: SuperAgentDecision } {
    const repoRoot = input.repoRoot as string
    const primary = state.triggers[triggerIds[0]]!
    const thread = state.threads[evalRecord.threadId]!
    const ticketId = newId('ticket')
    const mandate: SuperAgentMandate = {
      mandateId: newId('mandate'),
      ticketId,
      policyVersion: state.policy.version,
      strength: evalRecord.strength,
      basis: evalRecord.basis,
      actor: evalRecord.actor,
      scope: { repoRoot, paths: [] },
      matchedRules: [...new Set(input.matchedRules ?? [])],
      createdAt: at,
      revokedAt: null,
    }
    const ticket: SuperAgentTicket = {
      ticketId,
      title: primary.text,
      state: 'open',
      createdAt: at,
      origin: { triggerId: triggerIds[0], triggerIds: [...triggerIds] },
      mandateId: mandate.mandateId,
      threadId: evalRecord.threadId,
      assignmentIds: [],
      inputIds: [],
      answers: [],
      attentionId: null,
      execution: { name: 'main', directory: repoRoot, assignmentId: null },
      follows: [],
      delivery: null,
      undelivered: [],
      reviewRemindedAt: null,
      ended: null,
    }
    for (const triggerId of triggerIds) {
      const trigger = state.triggers[triggerId]
      if (!trigger) continue
      if (!trigger.disposition.ticketIds.includes(ticketId)) {
        trigger.disposition.ticketIds.push(ticketId)
      }
      trigger.disposition.ackedAt = at
    }
    thread.subscriptions.push({ ticketId, attachedAt: at, contextOnly: false })
    state.mandates[mandate.mandateId] = mandate
    state.tickets[ticketId] = ticket

    const decision: SuperAgentDecision = {
      decisionId: newId('decision'),
      ticketId,
      triggerId: triggerIds[0],
      action: 'accept',
      source: primary.source,
      actor: evalRecord.actor,
      human: primary.human,
      policyVersion: state.policy.version,
      strength: evalRecord.strength,
      basis: evalRecord.basis,
      at,
    }
    state.decisions[ticketId] = decision

    newAssignmentForTicket(ticket, at, 'pending')
    return { ticket, decision }
  }

  /**
   * T16 #86：Router 提交语义裁决。重新校验 Policy 版本（旧版本不得落地）、
   * matchedRules 合法性、bot 限制与触发器去重；observe 只记录「本会接受」，
   * auto 建单；stop 结束订阅该 Thread 的开放工单（bot 拒绝，无对象降级 ignore）。
   */
  function submitEvalDecision(input: SubmitEvalDecisionInput): SubmitEvalDecisionResult {
    const evalRecord = requireEval(input.evalId)
    if (evalRecord.state === 'decided') {
      const ticket = evalRecord.decision?.ticketId
        ? (state.tickets[evalRecord.decision.ticketId] ?? null)
        : null
      const decision = ticket ? (state.decisions[ticket.ticketId] ?? null) : null
      return { eval: evalRecord, ticket, decision, duplicate: true }
    }
    if (evalRecord.policyVersion !== state.policy.version) {
      throw superAgentError('evalPolicyStale', {
        evalId: input.evalId,
        evalPolicyVersion: evalRecord.policyVersion,
        policyVersion: state.policy.version,
      })
    }
    if (evalRecord.state !== 'delivered') {
      throw superAgentError('evalNotDelivered', {
        evalId: input.evalId,
        state: evalRecord.state,
      })
    }
    const at = atNow(input.at)
    const matchedRules = [...new Set(input.matchedRules ?? [])]
    if (
      matchedRules.some((name) => !state.policy.rules.some((rule) => rule.name === name))
    ) {
      throw superAgentError('invalidPolicy', { evalId: input.evalId, field: 'matchedRules' })
    }
    const thread = state.threads[evalRecord.threadId]
    if (!thread) throw superAgentError('threadNotFound', { threadId: evalRecord.threadId })

    let action = input.action
    let ticket: SuperAgentTicket | null = null
    let decision: SuperAgentDecision | null = null

    if (action === 'stop') {
      // bot 不能显式请求、不能 stop。
      if (evalRecord.bot) throw superAgentError('botForbidden', { evalId: input.evalId })
      const openTickets = thread.subscriptions
        .filter((subscription) => !subscription.contextOnly)
        .map((subscription) => state.tickets[subscription.ticketId])
        .filter((target): target is SuperAgentTicket => target !== undefined && target.state === 'open')
      if (openTickets.length === 0) {
        // 无对象 stop 降级为 ignore 落档（人工 stop 需要存活工单）。
        action = 'ignore'
      } else {
        for (const target of openTickets) {
          endTicketInternal(target, {
            outcome: 'stopped',
            by: 'policy',
            reason: 'eval-stop',
            at,
          })
        }
      }
    }

    if (action === 'accept') {
      if (state.policy.acceptMode === 'off') {
        throw superAgentError('acceptModeOff', { evalId: input.evalId })
      }
      if (state.policy.acceptMode === 'observe') {
        // observe：只记录「本会接受」，不建单（适合观察模型路由质量）。
      } else {
        // auto：去重 —— 已被其他工单消费的 Trigger 不参与建单。
        const included = evalRecord.triggerIds.filter((triggerId) => {
          const trigger = state.triggers[triggerId]
          return trigger !== undefined && trigger.disposition.ticketIds.length === 0
        })
        if (included.length === 0) {
          action = 'ignore'
        } else {
          if (typeof input.repoRoot !== 'string' || input.repoRoot === '') {
            throw superAgentError('invalidDispatch', { requestId: input.evalId })
          }
          ;({ ticket, decision } = createEvalTicket(evalRecord, included, input, at))
        }
      }
    }

    evalRecord.state = action === 'unavailable' ? 'unavailable' : 'decided'
    evalRecord.decision = { action, at, matchedRules, ticketId: ticket?.ticketId ?? null }
    thread.evaluating = false
    // Router 真实响应（含模型自报 unavailable）打断连续超时序列，计数清零；
    // 超时路径（expireEval）保持计数作为升级护栏。
    thread.expired = 0
    nextOrdinal()
    return { eval: evalRecord, ticket, decision, duplicate: false }
  }

  /**
   * T16 #86：续接前 revalidate —— 按 Mandate 的来源 Trigger 在当前 Policy
   * 下重新过程序层 Gate；撤回/不再准入/授权被降级（显式 → 推断，或被 bot 化）判失效。
   */
  function revalidateTicket(ticketId: string): RevalidateTicketResult {
    const ticket = requireTicket(ticketId)
    const mandate = state.mandates[ticket.mandateId]
    if (!mandate || mandate.revokedAt !== null) return { valid: false, reason: 'revoked' }
    const trigger = state.triggers[ticket.origin.triggerId]
    if (!trigger) return { valid: false, reason: 'missing' }
    const gate = gateTrigger(state.policy, trigger)
    if (!gate.admitted) return { valid: false, reason: gate.filtered }
    if (mandate.strength === 'explicit' && (gate.bot || gate.strength !== 'explicit')) {
      return { valid: false, reason: 'downgraded' }
    }
    return { valid: true, reason: null }
  }

  /** T16 #86：人工续接入口的公共闸门：revalidate 失效即拒绝续接。 */
  function assertMandateAdmitsContinuation(ticketId: string): void {
    const check = revalidateTicket(ticketId)
    if (!check.valid) {
      throw superAgentError('mandateRevoked', {
        ticketId,
        reason: check.reason ?? 'revoked',
      })
    }
  }

  // ── T17 #87：订阅 fast path 与 owner 语义（§6.2） ──────────────────

  /** 当前仍可裁决这条人消息的工单：存活非 contextOnly 订阅 + 未交回、未认领的人消息输入。 */
  function followupOwners(triggerId: string): string[] {
    const trigger = state.triggers[triggerId]
    if (!trigger || !trigger.human) return []
    const owners = new Set<string>()
    for (const threadId of trigger.threadIds) {
      const thread = state.threads[threadId]
      if (!thread) continue
      for (const subscription of thread.subscriptions) {
        // context-only 订阅只提供上下文，不赋予 follow-up 所有权。
        if (subscription.contextOnly) continue
        const ticket = state.tickets[subscription.ticketId]
        if (!ticket || ticket.state !== 'open') continue
        const holds = ticket.inputIds.some((inputId) => {
          const record = state.inputs[inputId]
          return (
            record !== undefined &&
            record.triggerId === triggerId &&
            record.human &&
            !record.context &&
            record.releasedAt === null &&
            !ticket.answers.includes(inputId)
          )
        })
        if (holds) owners.add(ticket.ticketId)
      }
    }
    return [...owners]
  }

  /** Trigger 是否已被存活的可裁决订阅消费（fast path 生效，不进 Eval、不重复建单）。 */
  function fastPathConsumed(triggerId: string): boolean {
    const trigger = state.triggers[triggerId]
    if (!trigger) return false
    return trigger.threadIds.some((threadId) => {
      const thread = state.threads[threadId]
      if (!thread) return false
      return thread.subscriptions.some((subscription) => {
        if (subscription.contextOnly) return false
        const ticket = state.tickets[subscription.ticketId]
        if (!ticket || ticket.state !== 'open') return false
        return (
          trigger.disposition.ticketIds.includes(subscription.ticketId) ||
          trigger.disposition.contextTicketIds.includes(subscription.ticketId)
        )
      })
    })
  }

  function handbackInput(input: HandbackInputInput): HandbackInputResult {
    const target = state.inputs[input.inputId]
    if (!target) throw superAgentError('inputNotFound', { inputId: input.inputId })
    const ticket = requireTicket(input.ticketId)
    if (target.ticketId !== ticket.ticketId) {
      throw superAgentError('notHandbackable', {
        ticketId: input.ticketId,
        inputId: target.inputId,
      })
    }
    if (ticket.state === 'ended') {
      throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    }
    // 只有 fan-out/attach 投递的、可裁决（非 context）人消息才能交回；
    // 已被 answers 认领的消息是 Worker 的回答义务，不能交回。
    if (!target.human || target.context || target.triggerId === null) {
      throw superAgentError('notHandbackable', { inputId: target.inputId })
    }
    if (target.releasedAt !== null) {
      throw superAgentError('handedBack', { inputId: target.inputId })
    }
    if (ticket.answers.includes(target.inputId)) {
      throw superAgentError('notHandbackable', { inputId: target.inputId })
    }

    const requeued = releaseHumanInput(ticket, target, atNow(input.at))
    nextOrdinal()
    return { input: target, ownersRemaining: followupOwners(target.triggerId), requeued }
  }

  function markUnrelated(input: MarkUnrelatedInput): MarkUnrelatedResult {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') {
      throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    }
    // 来源 Thread 与工单自己 follow 的 Thread（如 PR）不允许退订。
    if (input.threadId === ticket.threadId || ticket.follows.includes(input.threadId)) {
      throw superAgentError('subscriptionProtected', {
        ticketId: ticket.ticketId,
        threadId: input.threadId,
      })
    }
    const thread = state.threads[input.threadId]
    if (!thread) throw superAgentError('threadNotFound', { threadId: input.threadId })
    const subIndex = thread.subscriptions.findIndex(
      (subscription) => subscription.ticketId === ticket.ticketId,
    )
    if (subIndex < 0) {
      throw superAgentError('notSubscribed', {
        ticketId: ticket.ticketId,
        threadId: input.threadId,
      })
    }
    // 只退自己的订阅：其他工单在同 Thread 的订阅不受影响。
    thread.subscriptions.splice(subIndex, 1)

    // 交回本工单从该 Thread 的 Trigger 派生、未裁决的人消息。
    const at = atNow(input.at)
    const releasedInputIds: string[] = []
    const requeuedInputIds: string[] = []
    for (const inputId of [...ticket.inputIds]) {
      const candidate = state.inputs[inputId]
      if (!candidate || !candidate.human || candidate.context || candidate.triggerId === null) {
        continue
      }
      if (candidate.releasedAt !== null) continue
      if (ticket.answers.includes(inputId)) continue
      const trigger = state.triggers[candidate.triggerId]
      if (!trigger || !trigger.threadIds.includes(input.threadId)) continue
      if (releaseHumanInput(ticket, candidate, at)) requeuedInputIds.push(inputId)
      releasedInputIds.push(inputId)
    }
    nextOrdinal()
    return { ticket, thread, releasedInputIds, requeuedInputIds }
  }

  function attachTicket(input: AttachTicketInput): AttachTicketResult {
    const ticket = requireTicket(input.ticketId)
    if (ticket.state === 'ended') {
      throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    }
    const trigger = state.triggers[input.triggerId]
    if (!trigger) throw superAgentError('triggerNotFound', { triggerId: input.triggerId })

    const consumedBySelf =
      trigger.disposition.ticketIds.includes(ticket.ticketId) ||
      trigger.disposition.contextTicketIds.includes(ticket.ticketId)
    // attach 订阅整条 Thread：Trigger 的全部 threadIds 都补上可裁决订阅（幂等）。
    const at = atNow(input.at)
    const ensureSubscriptions = (): void => {
      for (const threadId of trigger.threadIds) {
        const thread = ensureThread(threadId, trigger.source)
        if (!thread.subscriptions.some((subscription) => subscription.ticketId === ticket.ticketId)) {
          thread.subscriptions.push({
            ticketId: ticket.ticketId,
            attachedAt: at,
            contextOnly: false,
          })
        }
      }
    }

    if (consumedBySelf) {
      // 已消费过（含建单来源）：只补齐订阅，不重复投递；带回既有输入（若有）。
      ensureSubscriptions()
      const existing =
        ticket.inputIds
          .map((inputId) => state.inputs[inputId])
          .find((record) => record !== undefined && record.triggerId === trigger.triggerId) ?? null
      return { ticket, trigger, input: existing, duplicate: true }
    }

    // 人消息归存活 owner 期间，Router 只能 stop —— attach 被代码拒绝
    // （显式引用的语义判断在 Router，域层拦机械约束）。
    const owners = followupOwners(trigger.triggerId)
    if (owners.length > 0) {
      throw superAgentError('workerDecides', { triggerId: trigger.triggerId })
    }

    ensureSubscriptions()
    const added = addInput({
      ticketId: ticket.ticketId,
      requestId: `attach:${trigger.triggerId}:${ticket.ticketId}`,
      kind: 'trigger',
      human: trigger.human,
      context: !trigger.human,
      text: trigger.text,
      triggerId: trigger.triggerId,
      at,
    })
    return { ticket, trigger, input: added.input, duplicate: added.duplicate }
  }

  function pruneExpiredSubscriptions(input: { at?: string } = {}): string[] {
    const at = atNow(input.at)
    const pruned: string[] = []
    for (const thread of Object.values(state.threads)) {
      const alive = thread.subscriptions.filter((subscription) => {
        const ticket = state.tickets[subscription.ticketId]
        if (!ticket) return false
        if (ticket.state === 'open' || ticket.ended === null) return true
        // 人工停止的 Ticket 不再接收自动输入：订阅立即失效。
        if (ticket.ended.outcome === 'stopped') return false
        // 其余结束态：最多保留订阅寿命（缺省两周），期满停止轮询。
        return Date.parse(at) - Date.parse(ticket.ended.at) <= subscriptionTtlMs
      })
      if (alive.length !== thread.subscriptions.length) {
        for (const subscription of thread.subscriptions) {
          if (!alive.includes(subscription)) pruned.push(`${thread.threadId}:${subscription.ticketId}`)
        }
        thread.subscriptions = alive
      }
    }
    if (pruned.length > 0) nextOrdinal()
    return pruned
  }

  // ── T19 #89：PR 合并/关闭按 Thread 结束（followsDone） ────────────────

  /**
   * Thread 终止：结束来源或 follows 该 Thread 的开放工单，outcome 落
   * merged/closed（自然结束：Mandate 不撤回、订阅保留至寿命，follows
   * 保留审计）；与其它结束出口共用收尾（释放人消息、撤回 Attention、
   * 在途 Assignment 一并收尾）。
   */
  function followsDone(input: FollowsDoneInput): FollowsDoneResult {
    const at = atNow(input.at)
    const endedTickets: FollowsDoneEndedTicket[] = []
    for (const ticket of Object.values(state.tickets)) {
      if (ticket.state === 'ended') continue
      if (ticket.threadId !== input.threadId && !ticket.follows.includes(input.threadId)) continue
      const result = endTicketInternal(ticket, {
        outcome: input.outcome,
        by: input.by ?? 'user',
        reason: input.reason ?? (input.outcome === 'merged' ? 'pr-merged' : 'pr-closed'),
        at,
      })
      endedTickets.push({
        ticket: result.ticket,
        releasedInputIds: result.releasedInputIds,
        withdrawnAttentionIds: result.withdrawnAttentionIds,
      })
    }
    if (endedTickets.length > 0) nextOrdinal()
    return { threadId: input.threadId, outcome: input.outcome, endedTickets }
  }

  // ── T18 #88：Outbox 入列与回写（受控 reply 授权链见 §6.4） ─────────

  function requireHumanInputOfTicket(ticket: SuperAgentTicket, inputId: string | null): SuperAgentInput {
    const input = inputId !== null ? state.inputs[inputId] : undefined
    if (!input || input.ticketId !== ticket.ticketId || !input.human) {
      throw superAgentError('notAsker', { ticketId: ticket.ticketId, inputId: inputId ?? '' })
    }
    return input
  }

  /**
   * 受控 reply 授权链：
   *  - acknowledgement：指向到达本工单的人消息，工单已结束拒绝（ackEnded）；
   *  - answer：指向 Worker 用 answers 认领过的人问题（未认领 → noAnswer）；
   *  - result：只在 ready / completed / merged / dropped 允许，progress 不冒充
   *    结果（引用的 Report kind 必须是 ready/dropped，否则 notReady）；
   *  - attention：必须匹配当前未清除 Attention 的文本（notAttention）。
   */
  function validateOutboxReply(
    ticket: SuperAgentTicket,
    payload: Extract<SuperAgentOutboxPayload, { kind: 'reply' }>,
  ): void {
    if (payload.text.trim() === '') {
      throw superAgentError('invalidOutbound', { ticketId: ticket.ticketId })
    }

    if (payload.replyType === 'acknowledgement') {
      if (ticket.state === 'ended') {
        throw superAgentError('ackEnded', { ticketId: ticket.ticketId })
      }
      requireHumanInputOfTicket(ticket, payload.inReplyTo)
      return
    }

    if (payload.replyType === 'answer') {
      if (ticket.state === 'ended') {
        throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
      }
      const input = requireHumanInputOfTicket(ticket, payload.inReplyTo)
      if (!ticket.answers.includes(input.inputId)) {
        throw superAgentError('noAnswer', { ticketId: ticket.ticketId, inputId: input.inputId })
      }
      return
    }

    if (payload.replyType === 'result') {
      if (ticket.state === 'ended') {
        const outcome = ticket.ended?.outcome
        if (outcome !== 'completed' && outcome !== 'merged' && outcome !== 'dropped') {
          throw superAgentError('notReady', { ticketId: ticket.ticketId })
        }
      } else if (stageOf(ticket.ticketId) !== 'person/review') {
        throw superAgentError('notReady', { ticketId: ticket.ticketId })
      }
      const reportId = payload.reportId
      const report =
        reportId !== null
          ? Object.values(state.reports).find(
              (candidate) =>
                candidate.ticketId === ticket.ticketId && candidate.reportId === reportId,
            )
          : undefined
      if (!report) {
        throw superAgentError('invalidOutbound', { ticketId: ticket.ticketId })
      }
      // progress 不外发为结果：只有 ready/dropped 报告可以作为结果引用
      if (report.kind !== 'ready' && report.kind !== 'dropped') {
        throw superAgentError('notReady', { ticketId: ticket.ticketId })
      }
      return
    }

    // replyType === 'attention'
    const attentionId = payload.attentionId
    const attention = attentionId !== null ? state.attentions[attentionId] : undefined
    if (
      !attention ||
      attention.ticketId !== ticket.ticketId ||
      attention.status !== 'open' ||
      attention.question !== payload.text
    ) {
      throw superAgentError('notAttention', { attentionId: attentionId ?? '' })
    }
  }

  function enqueueOutboxMessage(input: EnqueueOutboxInput): EnqueueOutboxResult {
    const ticket = requireTicket(input.ticketId)
    const channel = input.channel.trim()
    if (channel === '') {
      throw superAgentError('invalidOutbound', { messageId: input.messageId })
    }
    const payload = input.payload

    // messageId 永久去重：即使消息已 sent/withdrawn，重复入列仍返回原消息
    const key = idempotencyKey('message', input.messageId)
    const fingerprint = canonical({ ticketId: ticket.ticketId, channel, payload })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      return { message: state.outbox[existing.id], duplicate: true }
    }

    switch (payload.kind) {
      case 'launch': {
        const assignment = state.assignments[payload.assignmentId]
        if (!assignment || assignment.ticketId !== ticket.ticketId) {
          throw superAgentError('assignmentNotFound', { assignmentId: payload.assignmentId })
        }
        if (ticket.state === 'ended') {
          throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
        }
        break
      }
      case 'delivery': {
        const target = state.inputs[payload.inputId]
        if (!target || target.ticketId !== ticket.ticketId) {
          throw superAgentError('inputNotFound', { inputId: payload.inputId })
        }
        if (ticket.state === 'ended') {
          throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
        }
        break
      }
      case 'relay': {
        const relayed = Object.values(state.reports).find(
          (candidate) =>
            candidate.ticketId === ticket.ticketId && candidate.reportId === payload.reportId,
        )
        if (!relayed) {
          throw superAgentError('invalidOutbound', { messageId: input.messageId })
        }
        if (ticket.state === 'ended') {
          throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
        }
        break
      }
      case 'reviewReminder': {
        if (ticket.state === 'ended') {
          throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
        }
        break
      }
      case 'reply': {
        validateOutboxReply(ticket, payload)
        // 同一问题只提醒一次：同一 open Attention 已有未发出的 attention
        // 回复时，不同 messageId 的重复外发也返回原消息
        if (payload.replyType === 'attention' && payload.attentionId !== null) {
          const sameAttention = Object.values(state.outbox).find(
            (candidate) =>
              candidate.status === 'pending' &&
              candidate.payload.kind === 'reply' &&
              candidate.payload.replyType === 'attention' &&
              candidate.payload.attentionId === payload.attentionId,
          )
          if (sameAttention) return { message: sameAttention, duplicate: true }
        }
        break
      }
    }

    const at = atNow(input.at)
    const message: SuperAgentOutboxMessage = {
      messageId: input.messageId,
      ticketId: ticket.ticketId,
      channel,
      kind: payload.kind,
      ordinal: nextOrdinal(),
      status: 'pending',
      createdAt: at,
      payload,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      sentAt: null,
      receipt: null,
      withdrawnAt: null,
    }
    state.outbox[message.messageId] = message
    state.idempotency[key] = { kind: 'message', id: message.messageId, fingerprint }
    return { message, duplicate: false }
  }

  function settleOutboxMessage(input: SettleOutboxInput): SettleOutboxResult {
    const message = state.outbox[input.messageId]
    if (!message) {
      throw superAgentError('invalidOutbound', { messageId: input.messageId })
    }
    // 终态幂等：sent/dropped/withdrawn 的重复回写返回原消息
    if (message.status !== 'pending') return { message, duplicate: true }

    const at = atNow(input.at)
    if (input.outcome === 'sent') {
      message.status = 'sent'
      message.sentAt = at
      message.receipt = input.receipt ?? null
    } else if (input.outcome === 'waiting') {
      message.attempts += 1
      const backoffMs = Math.min(
        SUPER_AGENT_OUTBOX_BACKOFF_BASE_MS * 2 ** (message.attempts - 1),
        SUPER_AGENT_OUTBOX_BACKOFF_CAP_MS,
      )
      message.nextAttemptAt = new Date(Date.parse(at) + backoffMs).toISOString()
      message.lastError = input.error ?? null
    } else {
      message.status = 'dropped'
      message.lastError = input.error ?? null
      message.nextAttemptAt = null
    }
    return { message, duplicate: false }
  }

  function report(command: ReportCommand): ReportResult {
    const ticket = requireTicket(command.ticketId)
    const assignment = state.assignments[command.assignmentId]
    if (!assignment || assignment.ticketId !== ticket.ticketId) {
      throw superAgentError('assignmentNotFound', { assignmentId: command.assignmentId })
    }

    const answers = [...new Set(command.answers ?? [])]
    const key = idempotencyKey('report', command.assignmentId, command.reportId)
    const fingerprint = canonical({
      ticketId: command.ticketId,
      assignmentId: command.assignmentId,
      reportId: command.reportId,
      kind: command.kind,
      summary: command.summary,
      question: command.question ?? null,
      askedBy: command.askedBy ?? null,
      answers,
      details: command.details ?? null,
      artifacts: command.artifacts ?? [],
    })
    const existing = findByIdempotencyKey(key)
    if (existing) {
      assertSameFact(existing, fingerprint)
      const original = state.reports[existing.id]
      return { report: original, duplicate: true, attentionId: original.attentionId ?? null }
    }

    if (ticket.state === 'ended') throw superAgentError('ticketEnded', { ticketId: ticket.ticketId })
    if (assignment.state === 'ended' || assignment.state === 'interrupted') {
      throw superAgentError('assignmentEnded', { assignmentId: assignment.assignmentId })
    }

    const question = command.question ?? null
    const askedBy = command.askedBy ?? null

    if (question !== null && (command.kind === 'ready' || answers.length > 0)) {
      throw superAgentError('questionWithResult', { ticketId: ticket.ticketId })
    }

    if (question !== null && !askedBy) {
      throw superAgentError('askerWithoutQuestion', { ticketId: ticket.ticketId })
    }

    if (askedBy !== null) {
      const asker = state.inputs[askedBy]
      if (!asker || asker.ticketId !== ticket.ticketId || !asker.human) {
        throw superAgentError('notAsker', { ticketId: ticket.ticketId, inputId: askedBy })
      }
    }

    for (const inputId of answers) {
      const input = state.inputs[inputId]
      if (!input || input.ticketId !== ticket.ticketId || !input.human) {
        throw superAgentError('notAnswerable', { ticketId: ticket.ticketId, inputId })
      }
      if (ticket.answers.includes(inputId)) {
        throw superAgentError('notAnswerable', { ticketId: ticket.ticketId, inputId })
      }
      const attention = Object.values(state.attentions).find(
        (candidate) =>
          candidate.ticketId === ticket.ticketId &&
          candidate.status === 'open' &&
          (candidate.askedBy === inputId || candidate.answers.includes(inputId)),
      )
      if (!attention) {
        throw superAgentError('notAnswerable', { ticketId: ticket.ticketId, inputId })
      }
    }

    const at = atNow(command.at)
    const report: SuperAgentReport = {
      reportId: command.reportId,
      assignmentId: assignment.assignmentId,
      ticketId: ticket.ticketId,
      ordinal: nextOrdinal(),
      kind: command.kind,
      summary: command.summary,
      at,
      question,
      askedBy,
      answers,
      attentionId: null,
      details: command.details ?? null,
      artifacts: command.artifacts ?? [],
    }

    state.reports[key] = report
    state.idempotency[key] = { kind: 'report', id: key, fingerprint }
    assignment.report = report
    if (command.kind === 'waiting') assignment.idleAt = at

    let attentionId: string | null = null

    if (answers.length > 0) {
      for (const inputId of answers) {
        for (const attention of Object.values(state.attentions)) {
          if (
            attention.ticketId === ticket.ticketId &&
            attention.status === 'open' &&
            (attention.askedBy === inputId || attention.answers.includes(inputId))
          ) {
            attention.status = 'answered'
            // 认领的回答并入审计：保留已提交的补充回答，不覆盖。
            if (!attention.answers.includes(inputId)) attention.answers.push(inputId)
            attention.answeredAt = at
            attentionId = attention.attentionId
            if (ticket.attentionId === attention.attentionId) ticket.attentionId = null
          }
        }
        if (!ticket.answers.includes(inputId)) ticket.answers.push(inputId)
      }
    }

    if (question !== null) {
      // 相同问题只提醒一次：同工单同文本的问题仍处于 open 时不新建、不撤回。
      const existingOpen = Object.values(state.attentions).find(
        (candidate) =>
          candidate.ticketId === ticket.ticketId &&
          candidate.kind === 'question' &&
          candidate.status === 'open' &&
          candidate.question === question,
      )
      if (existingOpen) {
        attentionId = existingOpen.attentionId
      } else {
        // 新问题替换旧问题：旧的未发出问题必须撤回，不能出现两条矛盾气泡。
        withdrawOpenAttentions(ticket, at)
        const attention: SuperAgentAttention = {
          attentionId: newId('attention'),
          ticketId: ticket.ticketId,
          assignmentId: assignment.assignmentId,
          kind: 'question',
          question,
          askedBy: askedBy as string,
          askedAt: at,
          status: 'open',
          answers: [],
          answeredAt: null,
          sessionId: null,
          requestId: null,
        }
        state.attentions[attention.attentionId] = attention
        ticket.attentionId = attention.attentionId
        attentionId = attention.attentionId
      }
    } else if (command.kind === 'ready') {
      withdrawOpenAttentions(ticket, at)
      attentionId = null
    }

    if (command.kind === 'dropped') {
      endTicketInternal(ticket, {
        outcome: 'dropped',
        by: 'worker',
        reason: command.summary,
        at,
      })
      attentionId = null
    }

    report.attentionId = attentionId
    return { report, duplicate: false, attentionId }
  }

  return {
    state,
    intakeTrigger,
    createTicket,
    dispatch,
    startAssignment,
    launchAssignment,
    endAssignment,
    addInput,
    answerAttention,
    requeueInput,
    deliverInput,
    markInputUncertain,
    failDelivery,
    report,
    endTicket,
    ticketAccept,
    ticketStop,
    ticketMessage,
    retryTicket,
    recoverTicket,
    markInputRead,
    pauseProject,
    resumeProject,
    markReviewReminded,
    setExecutionPolicy,
    setPolicy,
    filterTrigger,
    startEval,
    deliverEval,
    expireEval,
    reevaluateEval,
    dismissEval,
    submitEvalDecision,
    revalidateTicket,
    followupOwners,
    fastPathConsumed,
    handbackInput,
    markUnrelated,
    attachTicket,
    pruneExpiredSubscriptions,
    followsDone,
    enqueueOutboxMessage,
    settleOutboxMessage,
    stageOf,
  }
}
