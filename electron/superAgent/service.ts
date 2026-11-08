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
 *
 * T06：每项目挂 progressProjector。workerReport 是 Executor 的主进程内部
 * 接缝：严格解析 Worker 消息中的唯一 Report JSON 块 → Domain.report 状态
 * 迁移 → 投影同步（ticket.updated 即时、ticket.progress 1 秒节流）。
 * tickets 返回全量卡片看板，供 Renderer 断档全量重拉。
 *
 * T09 #79 接管与交还：每项目同时至多一个接管（多面板不互抢），只切面板态、
 * 不改调度；接管输入 workerMessage 先落 Domain Input 再经 workerDeliverer
 * 接缝投递（null = Executor 未接入，不假投递）。requestId 是对账键：可证明
 * 未接受（pending）才重投，结果未知转 uncertain 并产生 delivery Attention，
 * 禁止盲目重投。关闭镜像标签（workerUnbind）一并释放接管，不残留面板态。
 *
 * T11 #81 崩溃恢复与退出收尾：提供 userDataDir 时每项目经 Store 持久化
 * （迁移 → 锁 → seq 重放），打开即按恢复顺序对账（running 标 interrupted →
 * busy 建新代次 → delivered 未读回队首）并续跑队列；显式 shutdown 停止接受
 * 命令 → 有界等待在途 launch → 关 Store 释放锁；暂停是持久领域事实，跨重启
 * 保持。未提供 userDataDir 时保持纯内存行为（测试/旧用例）。
 *
 * T24 #93 Source 接入：项目级配置落在 project.json 的 `sources` 字段；
 * 项目落地即装配并启动 Source 轮询（未配置 = 不启动，行为与接入前一致）。
 * 飞书凭据复用 electron/im 的适配器配置边界，不另造凭据存储。轮询失败计入
 * health 的 `source:<id>` 类别，隔离报告与候选登记经只读 `sources` 视图暴露；
 * 候选只登记、不在此建单（语义 Eval / Policy 接管后续流程）。
 */
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  SuperAgentAttentionAnswerCommand,
  SuperAgentAttentionAnswerResult,
  SuperAgentAttentionBoard,
  SuperAgentAttentionEvent,
  SuperAgentAuthorizationPolicySetCommand,
  SuperAgentAuthorizationPolicySetResult,
  SuperAgentAuthorizationPolicyView,
  SuperAgentBindResult,
  SuperAgentCheckpointInfo,
  SuperAgentCheckpointRollbackCommand,
  SuperAgentCheckpointRollbackResult,
  SuperAgentDispatchCommand,
  SuperAgentDispatchResult,
  SuperAgentErrorPayload,
  SuperAgentEvalReevaluateCommand,
  SuperAgentEvalReevaluateResult,
  SuperAgentExecutionPolicyView,
  SuperAgentHealthCategory,
  SuperAgentHealthReport,
  SuperAgentHealthRetryCommand,
  SuperAgentPolicySetCommand,
  SuperAgentProblemDismissCommand,
  SuperAgentQueueSnapshot,
  SuperAgentRouterMessageCommand,
  SuperAgentRouterMessageResult,
  SuperAgentRouterState,
  SuperAgentSnapshot,
  SuperAgentSourceCandidate,
  SuperAgentSourcesView,
  SuperAgentTakeoverChangedEvent,
  SuperAgentTakeoverState,
  SuperAgentTicketAcceptCommand,
  SuperAgentTicketActionResult,
  SuperAgentTicketBoard,
  SuperAgentTicketMessageCommand,
  SuperAgentTicketMessageResult,
  SuperAgentTicketProgress,
  SuperAgentTicketRetryCommand,
  SuperAgentTicketRetryResult,
  SuperAgentTicketStopCommand,
  SuperAgentTicketUpdateEvent,
  SuperAgentWorkerMessageCommand,
  SuperAgentWorkerMessageResult,
  SuperAgentWorkerMirror,
} from '@/shared/channels/superAgent'
import {
  createSuperAgentDomain,
  resolveExecutionPolicy,
  type AddInputResult,
  type AttachTicketResult,
  type EnqueueOutboxInput,
  type SuperAgentDomain,
} from './domain'
import type { SuperAgentAttention, SuperAgentOutboxKind, SuperAgentOutboxMessage, SuperAgentOutboxReplyPayload, SuperAgentOutboxStatus, SuperAgentReportKind, SuperAgentTicket } from './model'
import {
  SuperAgentDomainError,
  isSuperAgentDomainError,
  superAgentError,
  serializeSuperAgentError,
} from './errors'
import {
  parseSuperAgentWorkerActions,
  resolveSuperAgentHandbackInputId,
  type ParsedSuperAgentWorkerActions,
} from './workerActions'
import { createCheckpointStore, parsePorcelainEntry, type SuperAgentCheckpointStore } from './checkpoint'
import { cloneSuperAgentPolicy } from './policy'
import {
  createSuperAgentAttentionProjector,
  type SuperAgentAttentionProjector,
} from './attentionProjector'
import {
  createSuperAgentHealthTracker,
  type SuperAgentHealthFailureInput,
  type SuperAgentHealthTracker,
} from './health'
import { createSuperAgentProgressProjector, type SuperAgentProgressProjector } from './progressProjector'
import { parseSuperAgentReportText } from './reportParser'
import { createSuperAgentReviewReminder, type SuperAgentReviewReminder } from './reviewReminder'
import { createSuperAgentScheduler, type WorkerLauncher } from './scheduler'
import {
  createSuperAgentOutbox,
  type SuperAgentOutbox,
  type SuperAgentOutboxChannel,
  type SuperAgentOutboxLimits,
} from './outbox'
import {
  DESKTOP_OUTBOX_CHANNEL,
  createSuperAgentDesktopOutboxChannel,
} from './desktopChannel'
import {
  createDefaultExternalOutboxChannels,
  createSuperAgentOutboxChannelRouter,
  type SuperAgentOutboxChannelRegistration,
} from './outboxChannelRouter'
import { FEISHU_OUTBOX_CHANNEL_PREFIX } from './feishuChannel'
import { GITHUB_OUTBOX_CHANNEL_PREFIX } from './githubChannel'
import { resolveSuperAgentReplyChannel } from './replyTarget'
import { openPersistedSuperAgentProject } from './persistence'
import { runStartupRecovery, type StartupRecoveryResult } from './recovery'
import { projectDirOf, projectKeyOf, type ProjectStore, type ProjectStoreDeps } from './store'
import { buildExternalSources } from './sources/assembly'
import {
  parseSuperAgentSourcesConfig,
  type SuperAgentSourcesConfig,
} from './sources/config'
import {
  extractPrReferences,
  GITHUB_PR_SOURCE_ID,
  githubPrThreadId,
} from './sources/githubPr'
import { createSourceCursorStore } from './sources/cursorStore'
import {
  createSourceIngestor,
  type SourceCandidate,
  type SourceIngestor,
} from './sources/ingestor'
import { createSourceQuarantine } from './sources/quarantine'
import type { ExternalSource } from './sources/types'
import type { SuperAgentDomainState } from './model'
import { latestAssignmentOf, waitsForPerson } from './stage'
import {
  createExecFileGitRunner,
  defaultWorkspaceProbe,
  type WorkspaceProbe,
} from './workspace'
import {
  createSuperAgentExecutor,
  isSuperAgentHandoffReport,
  type SuperAgentExecutor,
  type SuperAgentExecutorIngestResult,
} from './executor'
import {
  createSuperAgentBackgroundJobs,
  readBackgroundOutputTail,
  type SuperAgentBackgroundJob,
  type SuperAgentBackgroundJobs,
  type SuperAgentBackgroundTimeout,
} from './backgroundJobs'
import {
  createSuperAgentRouterRunner,
  type SuperAgentRouterRunner,
} from './routerRunner'
import { createSuperAgentEvalDriver, type SuperAgentEvalDriver } from './evalDriver'
import {
  renderSuperAgentRouterEvent,
  renderSuperAgentRouterStatusContext,
  renderSuperAgentRouteRejected,
} from './prompts'
import { createSuperAgentSessionStatusQuery } from './sessionStatusQuery'
import {
  superAgentRouterEngineSessionId,
  superAgentWorkerEngineSessionId,
} from './sessionId'
import type { SuperAgentEngineBridge } from './engineBridge'

const STALE_AFTER_MS = 5_000
/** T11 #81：显式 shutdown 的在途 Effect 有界等待参考值（§9.5，10 秒）。 */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000
/** T20 #90：unavailable Eval 的处置窗口（§10.4：24 小时内可重新评估或显式忽略）。 */
const EVAL_DISPOSAL_WINDOW_MS = 24 * 60 * 60 * 1000
/** T24 #93：候选登记上限（只读视图，防止长期运行无限增长）。 */
const MAX_SOURCE_CANDIDATES = 50

/** T18 #88：Outbox 各类投递对应的健康类别（effect:<kind>）。 */
const OUTBOX_HEALTH_CATEGORY: Record<SuperAgentOutboxKind, SuperAgentHealthCategory> = {
  launch: 'effect:launch',
  delivery: 'effect:delivery',
  relay: 'effect:relay',
  reply: 'effect:reply',
  reviewReminder: 'effect:reviewReminder',
}

interface ProjectState {
  seq: number
  router: { sessionId: string; running: boolean } | null
  health: SuperAgentHealthTracker
  domain: SuperAgentDomain
  scheduler: ReturnType<typeof createSuperAgentScheduler>
  /** T06 #76：卡片投影（ticket.updated / ticket.progress 的主进程归一化源）。 */
  projector: SuperAgentProgressProjector
  /** T08 #78：Attention 投影（attention.asked/answered/withdrawn 广播源）。 */
  attentionProjector: SuperAgentAttentionProjector
  /** 正在被只读镜像观察的 ticketId；Executor 接入后据此决定是否广播转录事件。 */
  observedWorkers: Set<string>
  /** T09 #79：当前接管态；每项目同时至多一个，交还/关闭标签时清空。 */
  takeover: { ticketId: string; at: string } | null
  /** T10 #80：review 超时提醒引擎（持久水位 + 周期扫描）。 */
  reviewReminder: SuperAgentReviewReminder
  /**
   * #104：Worker 后台作业注册表（turn 结束后的槽位保留、30 分钟上限、完成唤醒）。
   * 真源是引擎事件（引擎无枚举能力时如实 unknown，见 backgroundJobs.ts 的能力边界）。
   */
  backgroundJobs: SuperAgentBackgroundJobs
  /** #104：刚投递完成后台完成 Input、等新 turn 收尾的工单（防提前释放 hold）。 */
  pendingBackgroundWake: Set<string>
  /**
   * T18 #88：Outbox durable Effect runner。channel 接缝未配置时为 null
   * （消息仍可入列持久化，Channel 适配器接入后续做）。
   */
  outbox: SuperAgentOutbox | null
  /** T11 #81：项目状态 Store（userDataDir 未提供时为 null，纯内存）。 */
  store: ProjectStore<SuperAgentDomainState> | null
  /** T11 #81：open → draining（停止接受命令，有界等在途）→ closed（锁已释放）。 */
  phase: 'open' | 'draining' | 'closed'
  /** T11 #81：本次打开时的启动恢复结果（无持久化时为 null）。 */
  startupRecovery: StartupRecoveryResult | null
  /** T12 #82：检查点存储引用（scheduler 保存、checkpointRollback 回退共用）。 */
  checkpoints: SuperAgentCheckpointStore
  /**
   * Worker 运行时（launcher/投递/停止的真身）。Executor 需要 project 的
   * domain 与 scheduler，只能在 project 落地后挂上；挂上前工单保持排队。
   */
  executor: SuperAgentExecutor | null
  /** Router 运行时：会话归属主进程，建单由回复尾部的协议块驱动。 */
  routerRunner: SuperAgentRouterRunner | null
  /**
   * #99：候选 → Router 评估 → Decision 的闭环驱动；Entities 只有配了引擎接缝
   * （Router 可用）才存在，否则候选只登记不评估。
   */
  evalDriver: SuperAgentEvalDriver | null
  /** T24 #93：Source 轮询器；未配置或装配失败时为 null（不启动任何轮询）。 */
  sourceIngestor: SourceIngestor | null
  /** T24 #93：候选登记（有界）；只暴露事实，不在 service 内建单。 */
  sourceCandidates: SuperAgentSourceCandidate[]
}

export interface SuperAgentServiceOptions {
  /** 健康项变化时回调（IPC 层据此广播 health.changed）。 */
  onHealthChanged?: (repoRoot: string, report: SuperAgentHealthReport) => void
  /** T21：Router 轮次起止时回调（IPC 层据此广播 router-status）。 */
  onRouterStatusChanged?: (repoRoot: string, router: SuperAgentRouterState) => void
  /**
   * T21：引擎接缝（Executor / RouterRunner 共用）。由生产入口
   * `createBroadcastingSuperAgentService` 注入真实通路；未注入时不建运行时，
   * 工单保持排队、Router 不建会话 —— 领域用例不必加载引擎链路，也不假装启动。
   */
  bridge?: SuperAgentEngineBridge
  /** T20 #90：处置窗口对账用的时钟；测试注入接缝。 */
  now?: () => Date
  /** 队列变化时回调（IPC 层据此广播 queue-changed）。 */
  onQueueChanged?: (repoRoot: string, snapshot: SuperAgentQueueSnapshot) => void
  /** T06 #76：领域事实变化时回调（IPC 层据此广播 ticket-updated）。 */
  onTicketUpdated?: (repoRoot: string, event: SuperAgentTicketUpdateEvent) => void
  /** T06 #76：节流后的轻量进度回调（IPC 层据此广播 ticket-progress）。 */
  onTicketProgress?: (repoRoot: string, progress: SuperAgentTicketProgress) => void
  /** T09 #79：接管/交还时回调（IPC 层据此广播 takeover-changed）。 */
  onTakeoverChanged?: (repoRoot: string, event: SuperAgentTakeoverChangedEvent) => void
  /** T08 #78：Attention 变化时回调（IPC 层据此广播 attention-asked/answered/withdrawn）。 */
  onAttentionEvent?: (repoRoot: string, event: SuperAgentAttentionEvent) => void
  /** Worker 启动接缝；null/缺省 = Executor 未接入，工单保持排队。 */
  launcher?: WorkerLauncher | null
  /** T09 #79：接管输入投递接缝；null/缺省 = Executor 未接入，不假投递。 */
  workerDeliverer?: SuperAgentWorkerDeliverer | null
  /**
   * T10 #80：review 超时提醒配置。hours 缺省取提案默认 24（待产品最终确认，
   * 唯一出处见 reviewReminder.ts 的 DEFAULT_REVIEW_REMINDER_HOURS）；
   * now/sweepIntervalMs 是测试注入接缝。
   */
  reviewReminder?: { hours?: number; now?: () => Date; sweepIntervalMs?: number }
  /**
   * #104：后台作业上限/清扫配置。默认 30 分钟常量（设计 §7.2）；now/maxAgeMs/
   * sweepIntervalMs 是测试注入接缝，不暴露 UI 开关 —— 取值理由见 backgroundJobs.ts。
   */
  backgroundJobs?: { now?: () => number; maxAgeMs?: number; sweepIntervalMs?: number }
  /**
   * T18 #88：Outbox durable Effect 配置。channel 为投递通道接缝（Desktop/
   * IM/GitHub），未提供时不建 runner（消息仍可入列持久化，接入后续做）；
   * limits/now/sweepIntervalMs 是限流与测试注入接缝。
   */
  outbox?: {
    channel?: SuperAgentOutboxChannel | null
    /**
     * #101：启用 desktop 通道 —— 受控 reply 作为 IM 气泡推回 Router 会话。
     * 生产入口 `createBroadcastingSuperAgentService` 打开；未启用时不产生 reply。
     */
    desktop?: boolean
    /**
     * #103：飞书 / GitHub 外部通道发送器。缺省时由 `external` 决定是否按既有
     * 凭据边界（electron/im adapters.json、gh CLI）装配；显式 null 表示禁用。
     */
    feishu?: SuperAgentOutboxChannel | null
    github?: SuperAgentOutboxChannel | null
    /** #103：启用飞书 / GitHub 外部通道（生产入口打开）。 */
    external?: boolean
    limits?: Partial<SuperAgentOutboxLimits>
    now?: () => Date
    sweepIntervalMs?: number
  }
  /**
   * T11 #81：提供后启用每项目持久化与重启恢复（迁移 → 锁 → seq 重放 →
   * 启动恢复顺序）。未提供时保持纯内存行为。
   */
  userDataDir?: string
  /** T11 #81：显式 shutdown 的在途 launch 有界等待；缺省 10 秒。 */
  shutdownTimeoutMs?: number
  /** T11 #81：Store 依赖注入（测试模拟旧进程死亡/陈旧锁）。 */
  storeDeps?: ProjectStoreDeps
  /**
   * T12 #82：工作区探针（开启并行时验证 git 仓库、检查点候选清单用）；
   * 缺省 defaultWorkspaceProbe。
   */
  probe?: WorkspaceProbe
  /**
   * T12 #82：检查点存储（每轮 launch 前保存、按文件人工回退）。内部按
   * repoRoot 分键，跨项目共享单实例；缺省内建（真实 git）。
   */
  checkpoints?: SuperAgentCheckpointStore
  /**
   * T24 #93：项目级 Source 配置。提供 userDataDir 时以 project.json 的
   * `sources` 字段为准；显式提供时覆盖并落盘（首次配置/测试注入）。
   */
  sources?: SuperAgentSourcesConfig
  /**
   * T24 #93：Source 装配接缝。缺省按配置装配飞书 IM HTTP client（凭据复用
   * electron/im 的适配器配置边界）；测试注入可避免真实网络与凭据。
   */
  sourceFactory?: (
    config: SuperAgentSourcesConfig,
    context: { repoRoot: string },
  ) => ExternalSource[]
}

/** T09 #79：workerMessage 的投递请求（Executor 接入前接缝为 null）。 */
export interface SuperAgentWorkerDeliveryRequest {
  ticketId: string
  /** 已落库 Domain Input 的 inputId：先落库再投递。 */
  inputId: string
  /**
   * #100：消息所属 Trigger。宿主上下文里带给 Worker，handback 围栏据此引用；
   * 桌面接管输入没有 Trigger，为 null。
   */
  triggerId?: string | null
  /** 幂等/对账键。 */
  requestId: string
  /** 项目根：Executor 需要它按同一档配置重新拉起空闲的 Worker 会话。 */
  repoRoot: string
  /** Worker 引擎会话 id（UUIDv5 派生，跨代次与重启稳定）。 */
  sessionId: string
  text: string
}

/**
 * 'accepted' 已接受；'notAccepted' 可证明未接受（允许退回 pending 重投）；
 * 'unknown' 结果未知（转 uncertain + Attention，禁止盲目重投）。
 */
export type SuperAgentWorkerDeliveryOutcome = 'accepted' | 'notAccepted' | 'unknown'

export type SuperAgentWorkerDeliverer = (
  request: SuperAgentWorkerDeliveryRequest,
) => Promise<SuperAgentWorkerDeliveryOutcome>

/** T06 #76：workerReport 的确认结果（幂等确认原结果，duplicate=true）。 */
export interface SuperAgentWorkerReportResult {
  ticketId: string
  reportId: string
  kind: SuperAgentReportKind
  summary: string
  at: string
  duplicate: boolean
  attentionId: string | null
}

/** T11 #81：显式 shutdown 结果 —— 是否在有界时间内完成。 */
export interface SuperAgentShutdownResult {
  repoRoot: string
  /** false = 在途 launch 超时，直接结束 shutdown（下次启动生成恢复代次）。 */
  settledWithinBound: boolean
}

export interface SuperAgentService {
  state(repoRoot: string): SuperAgentSnapshot
  routerBind(repoRoot: string): SuperAgentBindResult
  /**
   * Router 对话（T21）：文本交给主进程 RouterRunner —— 会话工具面为空，
   * Router 只能回答与建单，不能自己动代码。Promise 只表示已受理，不表示回复完成。
   */
  routerMessage(
    repoRoot: string,
    command: SuperAgentRouterMessageCommand,
  ): Promise<SuperAgentRouterMessageResult>
  /** 中止 Router 当前轮次；不影响任何 Worker。 */
  routerAbort(repoRoot: string): Promise<true>
  health(repoRoot: string): SuperAgentHealthReport
  /** T24 #93：Source 只读视图（运行状态 / 候选登记 / 隔离报告）。 */
  sources(repoRoot: string): SuperAgentSourcesView
  /** T20 #90：重新评估 unavailable Eval —— Trigger 回队、计数清零、落审计。 */
  evalReevaluate(
    repoRoot: string,
    command: SuperAgentEvalReevaluateCommand,
  ): SuperAgentEvalReevaluateResult
  /** T20 #90：忽略健康问题 —— eval 主体同时释放对应 Eval；返回最新报告。 */
  problemDismiss(repoRoot: string, command: SuperAgentProblemDismissCommand): SuperAgentHealthReport
  /** T20 #90：重试健康项 —— 清零连续失败计数；返回最新报告。 */
  healthRetry(repoRoot: string, command: SuperAgentHealthRetryCommand): SuperAgentHealthReport
  dispatch(repoRoot: string, command: SuperAgentDispatchCommand): SuperAgentDispatchResult
  queue(repoRoot: string): SuperAgentQueueSnapshot
  /** T06 #76：全量卡片看板 + 领域 seq 水位（断档重拉的基准）。 */
  tickets(repoRoot: string): SuperAgentTicketBoard
  /**
   * T06 #76：Executor 的主进程内部接缝 —— 严格解析 Worker 消息中的唯一
   * Report JSON 块并驱动状态迁移；协议失败抛稳定错误码，由调用方审计。
   */
  workerReport(repoRoot: string, input: { text: string }): SuperAgentWorkerReportResult
  /** 幂等挂 Worker 只读镜像；未知 ticket 抛稳定 ticketNotFound。 */
  workerBind(repoRoot: string, ticketId: string): SuperAgentWorkerMirror
  /** 只停镜像观察，不动领域状态；幂等。 */
  workerUnbind(repoRoot: string, ticketId: string): true
  /** T09 #79：接管 Worker 面板态；同 ticket 幂等，异 ticket 抛 takeoverConflict。 */
  workerTakeover(repoRoot: string, ticketId: string): SuperAgentTakeoverState
  /** T09 #79：交还；幂等，不残留接管态。 */
  workerRelease(repoRoot: string, ticketId: string): true
  /**
   * T09 #79：接管输入 —— 先落 Domain Input（requestId 幂等）再按调度投递；
   * 未接管抛 takeoverRequired。requestId 对账：可证明未接受才重投，
   * 无法确定转 uncertain 并产生 Attention，不盲目重投。
   */
  workerMessage(
    repoRoot: string,
    command: SuperAgentWorkerMessageCommand,
  ): Promise<SuperAgentWorkerMessageResult>
  /** T08 #78：Attention 气泡全量看板（含已回答的审计折叠项）。 */
  attentions(repoRoot: string): SuperAgentAttentionBoard
  /**
   * T08 #78：就地回答 Attention —— 回答作为领域 Input 投递给对应 Worker；
   * 幂等键 requestId，Attention 保持 open 直到 Worker 用 answers 认领。
   */
  attentionAnswer(
    repoRoot: string,
    command: SuperAgentAttentionAnswerCommand,
  ): Promise<SuperAgentAttentionAnswerResult>
  /** T10 #80：接受验收 —— person/review 的显式出口（→ completed）。 */
  ticketAccept(repoRoot: string, command: SuperAgentTicketAcceptCommand): SuperAgentTicketActionResult
  /** T10 #80：停止出口 —— Mandate 撤回 + 工单 stopped，后续自动事件不得重开。 */
  ticketStop(repoRoot: string, command: SuperAgentTicketStopCommand): SuperAgentTicketActionResult
  /**
   * T10 #80：继续追问 —— review 的人消息复用原 Assignment 回到 working；
   * 与 workerMessage 同一套 requestId 对账投递。
   */
  ticketMessage(
    repoRoot: string,
    command: SuperAgentTicketMessageCommand,
  ): Promise<SuperAgentTicketMessageResult>
  /** T10 #80：人工重试 —— 只对 open 的 delivery/blocked/failed 开放，generation+1。 */
  ticketRetry(repoRoot: string, command: SuperAgentTicketRetryCommand): SuperAgentTicketRetryResult
  /** T10 #80：手动扫描一次 review 超时提醒（周期扫描之外的对账/测试接缝）。 */
  sweepReviewReminders(repoRoot: string): number
  /**
   * T18 #88：主进程内部接缝 —— Outbox 入列（先持久化后执行）。受控 reply
   * 的授权链在 Domain 校验；入列成功后立即泵送（channel 未配置时仅落库）。
   * Router / Channel 适配器后续经此投递 acknowledgement/answer/result/
   * attention 与 launch/delivery/relay/reviewReminder。
   */
  outboxEnqueue(
    repoRoot: string,
    command: EnqueueOutboxInput,
  ): { messageId: string; status: SuperAgentOutboxStatus; duplicate: boolean }
  /** T18 #88：读接缝 —— Outbox 全量消息（按落库序），供主进程审计/测试。 */
  outboxQueue(repoRoot: string): SuperAgentOutboxMessage[]
  /** T18 #88：手动泵送一次（测试接缝）；返回本次派发数。 */
  sweepOutbox(repoRoot: string): number
  recordHealthSuccess(repoRoot: string, category: SuperAgentHealthCategory): void
  recordHealthFailure(
    repoRoot: string,
    category: SuperAgentHealthCategory,
    detail?: SuperAgentHealthFailureInput,
  ): void
  /** 序列化任意错误为稳定 payload；未知 code 计入健康。 */
  noteError(repoRoot: string, err: unknown): SuperAgentErrorPayload
  /**
   * T11 #81：显式 shutdown —— 停止接受命令 → 取消在途 launch 调度 →
   * 有界等待在途 Effect 落定 → 关 Store 释放锁。幂等：重复调用直接返回。
   */
  shutdown(repoRoot: string): Promise<SuperAgentShutdownResult>
  /** T11 #81：应用退出时有界关闭全部已打开项目。 */
  shutdownAll(): Promise<SuperAgentShutdownResult[]>
  /** T11 #81：项目暂停（持久领域事实，跨重启保持；阻止新 launch/delivery）。 */
  pause(repoRoot: string): true
  /** T11 #81：解除暂停 —— 补投挂起的 pending 输入并续跑队列。 */
  resume(repoRoot: string): Promise<true>
  /**
   * T25 #96：读取授权策略（T16 的版本化 Policy）。
   * acceptMode 默认 off：外部候选默认不建单，需要显式开启。
   */
  authorizationPolicy(repoRoot: string): SuperAgentAuthorizationPolicyView
  /**
   * T25 #96：授权策略写入 —— 薄封装 domain.setPolicy（缺省子项保持原值、
   * 任一变化 version+1 并丢弃重排运行中 Eval），随后同步投影。
   */
  authorizationPolicySet(
    repoRoot: string,
    command: SuperAgentAuthorizationPolicySetCommand,
  ): Promise<SuperAgentAuthorizationPolicySetResult>
  /** T12 #82：读取执行策略（串行/并行、上限、worktree 形态）。 */
  executionPolicy(repoRoot: string): SuperAgentExecutionPolicyView
  /**
   * T12 #82：执行策略变更 —— 校验顺序：结构校验（resolveExecutionPolicy）→
   * 运行中不热切换（policyChangeBlocked）→ 并行需显式确认（policyConfirmRequired）
   * 与 git 仓库（worktreeUnavailable）→ 落领域事实（持久化）→ applyPolicy 即时生效。
   */
  setExecutionPolicy(
    repoRoot: string,
    command: SuperAgentPolicySetCommand,
  ): Promise<SuperAgentExecutionPolicyView>
  /** T12 #82：最新检查点 + 检查点之后新增的脏文件清单（按文件回退候选）。 */
  checkpoint(repoRoot: string): Promise<SuperAgentCheckpointInfo>
  /** T12 #82：按文件显式回退到检查点状态（不整仓 reset，不做任何自动回滚）。 */
  checkpointRollback(
    repoRoot: string,
    command: SuperAgentCheckpointRollbackCommand,
  ): Promise<SuperAgentCheckpointRollbackResult>
}

/** T12 #82：检查点时已脏文件集合（这些是用户自己的改动，不允许回退）。 */
function checkpointDirtyOf(cp: ReturnType<SuperAgentCheckpointStore['latest']> | null): Set<string> {
  return new Set((cp?.entries ?? []).map((entry) => entry.replace(/\\/g, '/')))
}

export function createSuperAgentService(options: SuperAgentServiceOptions = {}): SuperAgentService {
  const projects = new Map<string, ProjectState>()
  /** T12 #82：策略闸门与检查点候选清单共用的探针；检查点存储按 repoRoot 分键共享。 */
  const probe = options.probe ?? defaultWorkspaceProbe
  const checkpoints = options.checkpoints ?? createCheckpointStore({ run: createExecFileGitRunner() })

  /**
   * T11 #81：shutdown 期间停止接受新命令 —— draining 与 closed 都拒绝；
   * 读路径（state/health/queue/tickets/attentions）不设闸。
   */
  function assertCommandsAllowed(project: ProjectState, repoRoot: string): void {
    if (project.phase !== 'open') {
      throw superAgentError('shuttingDown', { repoRoot })
    }
  }

  /** T20 #90：处置窗口时钟（测试注入接缝）。 */
  const now = options.now ?? (() => new Date())

  /**
   * T20 #90：把领域里 undisposed 的 unavailable Eval 对账进健康报告。
   * 超过 24 小时未处置的自动释放（dismiss 审计）——不再提示、不阻塞 Thread；
   * 窗口内的按主体项上报（evalUnavailable），供面板重新评估/忽略。
   */
  function syncEvalHealth(project: ProjectState): void {
    const nowMs = now().getTime()
    for (const evalRecord of Object.values(project.domain.state.evals)) {
      if (evalRecord.state !== 'unavailable') continue
      const unavailableAtMs = Date.parse(evalRecord.decision?.at ?? evalRecord.createdAt)
      if (Number.isNaN(unavailableAtMs)) continue
      if (nowMs - unavailableAtMs > EVAL_DISPOSAL_WINDOW_MS) {
        project.domain.dismissEval({
          evalId: evalRecord.evalId,
          at: new Date(nowMs).toISOString(),
        })
        project.health.dismiss('eval', evalRecord.evalId)
        continue
      }
      project.health.recordFailure('eval', {
        code: 'evalUnavailable',
        subjectId: evalRecord.evalId,
        at: new Date(unavailableAtMs).toISOString(),
      })
    }
  }

  /** T24 #93：Source 游标/隔离文件与项目状态同目录（无 userDataDir 时退到临时目录）。 */
  function sourceDataDirOf(repoRoot: string): string {
    const root = options.userDataDir ?? join(tmpdir(), 'spacecode-super-agent-sources')
    return projectDirOf(root, projectKeyOf(repoRoot))
  }

  /** T24 #93：把 Ingestor 的候选裁剪成只读视图 DTO（不携带完整领域引用）。 */
  function candidateViewOf(candidate: SourceCandidate): SuperAgentSourceCandidate {
    return {
      triggerId: candidate.trigger.triggerId,
      key: candidate.trigger.key,
      reason: candidate.reason,
      strength: candidate.strength,
      basis: candidate.basis,
      bot: candidate.bot,
      threadIds: [...candidate.trigger.threadIds],
      channel: candidate.trigger.channel,
      text: candidate.trigger.text,
      at: candidate.trigger.at,
    }
  }

  /**
   * T24 #93：按项目级配置装配 Source。
   * 未配置 → null（行为与接入前完全一致）；配置非法/凭据缺失 → 计入健康并
   * 保持不轮询，绝不带空凭据启动；装配成功 → 返回待启动的 Ingestor。
   */
  function buildSourceIngestor(
    repoRoot: string,
    domain: SuperAgentDomain,
    health: SuperAgentHealthTracker,
    store: ProjectStore<SuperAgentDomainState> | null,
    onCandidate: (candidate: SourceCandidate) => void,
  ): SourceIngestor | null {
    const parsed =
      options.sources !== undefined
        ? parseSuperAgentSourcesConfig(options.sources)
        : parseSuperAgentSourcesConfig(store?.project.sources)
    if (parsed.kind === 'absent') return null
    if (parsed.kind === 'invalid') {
      health.recordFailure('source', { code: 'sourceConfigInvalid' })
      return null
    }
    try {
      const factory = options.sourceFactory ?? ((config: SuperAgentSourcesConfig) => buildExternalSources({ config }))
      const sources = factory(parsed.config, { repoRoot })
      if (sources.length === 0) return null
      const dir = sourceDataDirOf(repoRoot)
      return createSourceIngestor({
        domain,
        sources,
        cursorStore: createSourceCursorStore(dir),
        quarantine: createSourceQuarantine(dir),
        pollIntervalMs:
          parsed.config.feishuIm?.pollIntervalMs ?? parsed.config.githubPr?.pollIntervalMs,
        onCandidate,
        onStatus: (status) => {
          const category = `source:${status.sourceId}`
          if (status.consecutiveFailures > 0) {
            health.recordFailure(category, { code: 'sourceReadFailed' })
          } else {
            health.recordSuccess(category)
          }
        },
      })
    } catch (err) {
      // 配置/凭据错误是可见的系统问题；保持不轮询，不静默吞掉。
      const payload = serializeSuperAgentError(err)
      health.recordFailure('source', { code: payload.code })
      return null
    }
  }

  function projectOf(repoRoot: string): ProjectState {
    let project = projects.get(repoRoot)
    if (!project) {
      // T20 #90：处置审计时间戳与处置窗口共用服务时钟（测试注入接缝）。
      const health = createSuperAgentHealthTracker({ repoRoot, now })
      health.subscribe((report) => options.onHealthChanged?.(repoRoot, report))
      // T11 #81：迁移 → 锁 → seq 重放由 Store 完成后按恢复顺序对账；
      // Store 打不开（锁被活进程持有/迁移失败/损坏）抛 projectStoreUnavailable，
      // 不静默降级成无持久化双写。未配置 userDataDir 时保持纯内存。
      let domain: SuperAgentDomain
      let store: ProjectStore<SuperAgentDomainState> | null = null
      let startupRecovery: StartupRecoveryResult | null = null
      if (options.userDataDir) {
        const persisted = openPersistedSuperAgentProject({
          userDataDir: options.userDataDir,
          repoRoot,
          deps: options.storeDeps,
          sources: options.sources,
        })
        store = persisted.store
        domain = persisted.domain
        startupRecovery = runStartupRecovery(domain)
      } else {
        domain = createSuperAgentDomain()
      }
      const projector = createSuperAgentProgressProjector({
        domain,
        repoRoot,
        onTicketUpdated: (event) => options.onTicketUpdated?.(repoRoot, event),
        onTicketProgress: (progress) => options.onTicketProgress?.(repoRoot, progress),
      })
      const attentionProjector = createSuperAgentAttentionProjector({
        domain,
        repoRoot,
        onAttentionEvent: (event) => options.onAttentionEvent?.(repoRoot, event),
      })
      const scheduler = createSuperAgentScheduler({
        domain,
        repoRoot,
        launcher: resolveLauncher(repoRoot),
        checkpoints,
        onQueueChanged: (snapshot) => options.onQueueChanged?.(repoRoot, snapshot),
        onPreparingChanged: (ticketId, preparing) => projector.setPreparing(ticketId, preparing),
        onDomainChanged: () => {
          projector.sync()
          attentionProjector.sync()
        },
        // #101：accept 建单时的 origin 人消息此刻才落成 Input（授权链要求），
        // 受控 acknowledgement 必须指向它。
        onOriginHumanInput: (ticketId, inputId) => {
          enqueueSuperAgentReply(repoRoot, ticketId, `reply:ack:${inputId}`, (project) => {
            const input = project.domain.state.inputs[inputId]
            if (!input) return null
            return {
              kind: 'reply',
              replyType: 'acknowledgement',
              text: `收到：${superAgentExcerpt(input.text)}。已交给 Worker 处理。`,
              inReplyTo: inputId,
              attentionId: null,
              reportId: null,
            }
          })
        },
        onLaunchError: (ticketId, err) => {
          // launch 失败计入健康（effect:launch），错误信息带 ticketId 便于追溯
          health.recordFailure('effect:launch', {
            code: 'engineLaunchFailed',
            ticketId,
          })
        },
      })
      // T10 #80：review 超时提醒引擎 —— 水位写入领域后同步投影，
      // 卡片的 reviewRemindedAt 变化经既有 ticket.updated 广播到渲染端。
      const reviewReminder = createSuperAgentReviewReminder({
        domain,
        hours: options.reviewReminder?.hours,
        now: options.reviewReminder?.now,
        sweepIntervalMs: options.reviewReminder?.sweepIntervalMs,
        onRemind: () => {
          projector.sync()
        },
      })
      // T18 #88：Outbox runner —— sent 记健康恢复；waiting/dropped 计入对应
      // effect:<kind> 健康项（失败信息带 ticketId 便于追溯）。
      // #101：desktop 通道——reply 作为 IM 气泡推回 Router 会话。用稳定
      // messageId + startTurn:false，重复投递由渲染端按 id 去重，且不额外触发
      // 一轮 Router 对话。role:'assistant' 是这条气泡的归属：它是宿主替 Agent
      // 说给人听的话，落成 user 会被当成人在说话（渲染成用户气泡、重试时重发）。
      const desktopChannel =
        options.outbox?.desktop && options.bridge
          ? createSuperAgentDesktopOutboxChannel({
              push: (message) => {
                const target =
                  projects.get(repoRoot)?.router?.sessionId ??
                  superAgentRouterEngineSessionId(repoRoot)
                options.bridge!.pushUserMessage({
                  sessionId: target,
                  content: message.payload.kind === 'reply' ? message.payload.text : '',
                  title: 'Super Agent',
                  projectPath: repoRoot,
                  sessionType: 'superAgent',
                  messageId: message.messageId,
                  startTurn: false,
                  role: 'assistant',
                })
              },
            })
          : null
      const defaultExternal = options.outbox?.external
        ? createDefaultExternalOutboxChannels()
        : null
      const feishuChannel = options.outbox?.feishu === undefined
        ? (defaultExternal?.feishu ?? null)
        : options.outbox.feishu
      const githubChannel = options.outbox?.github === undefined
        ? (defaultExternal?.github ?? null)
        : options.outbox.github
      const registrations: SuperAgentOutboxChannelRegistration[] = []
      if (desktopChannel) {
        registrations.push({ exact: DESKTOP_OUTBOX_CHANNEL, channel: desktopChannel })
      }
      if (feishuChannel) {
        registrations.push({ prefix: FEISHU_OUTBOX_CHANNEL_PREFIX, channel: feishuChannel })
      }
      if (githubChannel) {
        registrations.push({ prefix: GITHUB_OUTBOX_CHANNEL_PREFIX, channel: githubChannel })
      }
      const routedChannel = registrations.length > 0
        ? createSuperAgentOutboxChannelRouter(registrations)
        : null
      const outboxChannel = options.outbox?.channel ?? routedChannel
      const outbox = outboxChannel
        ? createSuperAgentOutbox({
            domain,
            channel: outboxChannel,
            limits: options.outbox?.limits,
            now: options.outbox?.now,
            sweepIntervalMs: options.outbox?.sweepIntervalMs,
            onSettled: (message) => {
              const category = OUTBOX_HEALTH_CATEGORY[message.kind]
              if (message.status === 'sent') {
                health.recordSuccess(category)
              } else if (message.status === 'dropped') {
                health.recordFailure(category, {
                  code: 'outboxDropped',
                  ticketId: message.ticketId,
                })
              } else if (message.status === 'pending' && message.attempts > 0) {
                health.recordFailure(category, {
                  code: 'outboxWaiting',
                  ticketId: message.ticketId,
                })
              }
            },
          })
        : null
      // T24 #93：Source 接入 —— 未配置则不装配；启用的 Source 在项目落地后启动。
      // 候选只登记事实（有界、只读视图），不在此建单。
      const sourceCandidates: SuperAgentSourceCandidate[] = []
      const sourceIngestor = buildSourceIngestor(repoRoot, domain, health, store, (candidate) => {
        sourceCandidates.push(candidateViewOf(candidate))
        if (sourceCandidates.length > MAX_SOURCE_CANDIDATES) {
          sourceCandidates.splice(0, sourceCandidates.length - MAX_SOURCE_CANDIDATES)
        }
        // #99：候选到达即尝试建批；没有 Router（未接引擎）时由 evalDriver 为 null 忽略。
        projects.get(repoRoot)?.evalDriver?.pump()
      })
      // #104：后台作业注册表 —— 作业事件由 Executor 识别、这里落生命周期。
      // 引擎没有枚举能力（Gateway 答 unknown），所以注册表只认引擎事件证明过的作业。
      const backgroundJobs = createSuperAgentBackgroundJobs({
        now: options.backgroundJobs?.now,
        maxAgeMs: options.backgroundJobs?.maxAgeMs,
        sweepIntervalMs: options.backgroundJobs?.sweepIntervalMs,
        onKill: (job) => {
          const current = project
          if (!options.bridge || !current) return
          void options.bridge.stopEngineTask(job.sessionId, job.jobId).catch(() => {
            current.health.recordFailure('effect:launch', {
              code: 'backgroundJobKillFailed',
              ticketId: job.ticketId,
            })
          })
        },
        onCompleted: (job) => {
          const current = project
          if (!current) return
          // shell 完成 → 新 Input 唤醒；函数体在首个 await 前同步登记 pending 标记，
          // 让紧接着的 onDrained 不提前释放 Executor 的 hold。
          void wakeWorkerForBackgroundCompletion(repoRoot, current, job)
        },
        onTimeout: (event) => {
          const current = project
          if (!current) return
          reportBackgroundTimeout(current, event)
        },
        onDrained: (ticketId) => {
          const current = project
          if (!current) return
          if (current.pendingBackgroundWake.has(ticketId)) return
          current.executor?.releaseBackgroundHold(ticketId)
        },
      })
      project = {
        seq: 0,
        router: null,
        health,
        domain,
        scheduler,
        projector,
        attentionProjector,
        observedWorkers: new Set(),
        takeover: null,
        reviewReminder,
        backgroundJobs,
        pendingBackgroundWake: new Set(),
        outbox,
        store,
        phase: 'open',
        startupRecovery,
        checkpoints,
        executor: null,
        routerRunner: null,
        evalDriver: null,
        sourceIngestor,
        sourceCandidates,
      }
      projects.set(repoRoot, project)
      wireRuntime(project, repoRoot)
      // T24 #93：Source 轮询跨项目独立；未配置时 sourceIngestor 为 null，不启动。
      sourceIngestor?.start()
      // 持久化 scheduled effect：项目一落地即开始周期扫描（含一次即时重建扫描）
      reviewReminder.start()
      // #104：后台作业周期扫描（30 分钟上限）随项目启动。
      backgroundJobs.start()
      // T18 #88：Outbox 落地即续做 —— pending 消息重启后立即恢复投递
      outbox?.start()
      // T11 #81：恢复续跑 —— 持久化项目启动即补跑队列（busy 恢复代次与
      // 重启前已排队的 pending），并把恢复后的卡片/注意力现状推给已连接面板。
      if (startupRecovery) {
        project.scheduler.resume()
        project.projector.sync()
        project.attentionProjector.sync()
      }
    }
    return project
  }

  /**
   * 调度器的 launcher 接缝。
   *
   * 注入的 fake 优先（领域用例）；否则只有配了引擎接缝才给一个「延迟取 Executor」
   * 的 launcher —— Executor 反过来要用 scheduler，只能在 project 落地之后才存在，
   * 而 launcher 在 scheduler 构造时就得传进去。两者都没配 → null：工单如实排队，
   * 不假装启动。
   */
  function resolveLauncher(repoRoot: string): WorkerLauncher | null {
    if (options.launcher !== undefined) return options.launcher ?? null
    if (!options.bridge) return null
    return {
      launch: (request) => {
        const executor = projects.get(repoRoot)?.executor
        if (!executor) {
          return Promise.reject(superAgentError('engineLaunchFailed', { repoRoot }))
        }
        return executor.launch(request)
      },
    }
  }

  /**
   * T25 #97：派工/工单消息里的显式 PR 引用（`owner/repo#42`）立即建立
   * follows 订阅 —— 映射 threadId 即闭环，自动绑定留后续。
   */
  function bindExplicitPrFollows(
    project: ProjectState,
    ticketId: string,
    text: string,
  ): void {
    for (const pr of extractPrReferences(text)) {
      project.domain.followThread({
        ticketId,
        threadId: githubPrThreadId(pr),
        source: GITHUB_PR_SOURCE_ID,
      })
    }
  }

  /**
   * 派工落领域 + 投影同步。公开的 `dispatch` 与 Router 建单协议共用同一条路径，
   * Decision/Mandate 与幂等键都由领域生成 —— 模型拿不到授权（设计 §8.4）。
   */
  function applyDispatch(
    repoRoot: string,
    project: ProjectState,
    command: SuperAgentDispatchCommand & { model?: string },
  ): SuperAgentDispatchResult {
    const outcome = project.scheduler.dispatch({
      requestId: command.requestId,
      title: command.title,
      repoRoot,
      text: command.text,
      note: command.note,
      model: command.model,
      actor: command.actor ?? 'desktop-user',
      contextPaths: command.contextPaths ?? [],
      attachments: command.attachments ?? [],
    })
    // T25 #97：显式 PR 引用建立 follows，后续 PR 评审/评论唤醒这张单。
    if (outcome.ticket.state !== 'ended') {
      bindExplicitPrFollows(
        project,
        outcome.ticket.ticketId,
        [command.title, command.text, command.note ?? ''].join('\n'),
      )
    }
    // T06 #76：新建工单是领域事实，派生卡片即时投影
    project.projector.sync()
    project.attentionProjector.sync()
    return {
      ticketId: outcome.ticket.ticketId,
      assignmentId: outcome.assignment.assignmentId,
      decisionId: outcome.decision.decisionId,
      mandateId: outcome.mandate.mandateId,
      queuePosition: outcome.queuePosition,
      duplicate: outcome.duplicate,
    }
  }

  /**
   * 停止工单（T10 #80）：先持久化停止意图，再 abort 在跑的一轮。
   *
   * 命令保持同步 —— 渲染端与 Router 都不等引擎收尾；停止事实已经落库，
   * 引擎没停下来只留健康痕迹，不复活已停的工单。
   */
  function applyTicketStop(
    repoRoot: string,
    project: ProjectState,
    command: { ticketId: string; reason?: string },
  ): SuperAgentTicketActionResult {
    assertCommandsAllowed(project, repoRoot)
    const result = project.domain.ticketStop({
      ticketId: command.ticketId,
      reason: command.reason,
    })
    project.projector.sync()
    project.attentionProjector.sync()
    // #104：Assignment 结束 —— 不再接受新作业冠名，shell 中止、subagent 释放。
    const latest = latestAssignmentOf(
      (project.domain.state.tickets[command.ticketId]?.assignmentIds ?? [])
        .map((assignmentId) => project.domain.state.assignments[assignmentId])
        .filter((assignment) => assignment !== undefined),
    )
    project.backgroundJobs.endAssignment({
      ticketId: command.ticketId,
      assignmentId: latest?.assignmentId ?? null,
    })
    project.pendingBackgroundWake.delete(command.ticketId)
    void project.executor?.stopTicket(command.ticketId).catch(() => {
      project.health.recordFailure('effect:launch', {
        code: 'engineLaunchFailed',
        ticketId: command.ticketId,
      })
    })
    return {
      repoRoot,
      ticketId: result.ticket.ticketId,
      outcome: 'stopped',
      endedAt: result.ticket.ended?.at ?? '',
    }
  }

  /** attachTicket 的既有输入 → settleWorkerInputDelivery 的对账形状。 */
  function toAttachInputResult(attached: AttachTicketResult): AddInputResult | null {
    const input = attached.input
    if (!input) return null
    return {
      input,
      gated: false,
      delivered: input.status === 'delivered' || input.status === 'read',
      duplicate: attached.duplicate,
    }
  }

  /**
   * Router 的 attach（T21）：把这轮人的原话作为人消息投给一张活着的工单。
   *
   * 走的是「继续追问」同一条路径（domain.ticketMessage + requestId 对账投递），
   * 所以已结束或被闸门锁住的工单会按领域既有语义拒绝。
   */
  function applyRouterAttach(
    repoRoot: string,
    project: ProjectState,
    command: { ticketId: string; requestId: string; text: string; triggerId?: string },
  ): void {
    assertCommandsAllowed(project, repoRoot)
    const ticket = project.domain.state.tickets[command.ticketId]
    if (!ticket) {
      throw superAgentError('ticketNotFound', { ticketId: command.ticketId })
    }
    // attach 的前提是那张单有活着的执行能收这条消息。代次已经 ended/interrupted 时
    // addInput 只会把它落成一条永久 pending 的死信：Worker 收不到，阶段还被这条
    // 没送出去的消息刷成"执行中"，连重试入口一起没了。重跑是 retry 的活，不是这里。
    const latest = latestAssignmentOf(
      ticket.assignmentIds
        .map((id) => project.domain.state.assignments[id])
        .filter((assignment) => assignment !== undefined),
    )
    if (!latest || (latest.state !== 'pending' && latest.state !== 'running')) {
      throw superAgentError('assignmentEnded', {
        ticketId: command.ticketId,
        assignmentId: latest?.assignmentId ?? '',
      })
    }
    // 外部 Source Trigger（评估候选/评论）带 triggerId：走 attachTicket 绑定
    // Trigger + 订阅整条 Thread；桌面消息没有 triggerId，保持 ticketMessage 路径。
    const added: AddInputResult | null = command.triggerId
      ? toAttachInputResult(
          project.domain.attachTicket({
            ticketId: command.ticketId,
            triggerId: command.triggerId,
          }),
        )
      : project.domain.ticketMessage({
          ticketId: command.ticketId,
          requestId: command.requestId,
          text: command.text,
        })
    project.projector.sync()
    project.attentionProjector.sync()
    // 已消费的 Trigger（含建单来源）没有新 Input，补齐订阅即可，不再投递。
    if (!added) return
    // 投递是有界的异步收尾：失败按 Input 状态落定（delivered/pending/uncertain），
    // 不回灌 Router —— 它不能替引擎确认消息到了没有。
    void settleWorkerInputDelivery(
      repoRoot,
      project,
      { ...command, text: added.input.text ?? command.text },
      added,
    ).catch(() => {
      project.health.recordFailure('effect:delivery', {
        code: 'deliveryUnknown',
        ticketId: command.ticketId,
        subjectId: added.input.inputId,
      })
    })
  }

  /**
   * Router 的 retry：让一张 open 但已失败的工单以新一代重跑，复用同一个 Worker 会话。
   *
   * 走 scheduler.retry —— 与 UI 上那个「重试」按钮同一条出口（domain.retryTicket 校验
   * 闸门、generation+1、pump 起新执行；sessionId 按 ticketId 派生，跨代次稳定，引擎自己
   * --resume 原转录）。这个出口原本只长在人手上，Router 拿不到就只能用 attach 假装重跑。
   * 没有 note 字段：新一代的目标仍是人的原话，路由旁注在这里没有可落的位置。
   */
  function applyRouterRetry(
    repoRoot: string,
    project: ProjectState,
    command: { ticketId: string },
  ): void {
    assertCommandsAllowed(project, repoRoot)
    if (!project.domain.state.tickets[command.ticketId]) {
      throw superAgentError('ticketNotFound', { ticketId: command.ticketId })
    }
    // #104：旧 Assignment 结束（释放旧代次后台作业），再开新一代。
    const latest = latestAssignmentOf(
      (project.domain.state.tickets[command.ticketId]?.assignmentIds ?? [])
        .map((assignmentId) => project.domain.state.assignments[assignmentId])
        .filter((assignment) => assignment !== undefined),
    )
    project.backgroundJobs.endAssignment({
      ticketId: command.ticketId,
      assignmentId: latest?.assignmentId ?? null,
    })
    project.pendingBackgroundWake.delete(command.ticketId)
    project.scheduler.retry({ ticketId: command.ticketId })
  }

  /**
   * #100：把 Worker 指令逐条落到领域。解析已在进函数前完成（坏指令 = 协议失败）；
   * 这里拒绝的是「指令本身越权/对象不存在」，不推翻同一轮已经有效的 Report。
   */
  function applyWorkerActions(
    project: ProjectState,
    ticketId: string,
    parsed: ParsedSuperAgentWorkerActions,
  ): void {
    if (parsed.actions.length === 0) return
    const state = project.domain.state
    let handbackApplied = false
    let applied = 0
    for (const action of parsed.actions) {
      try {
        if (action.kind === 'handback') {
          const inputId = resolveSuperAgentHandbackInputId(project.domain.state, ticketId, action.triggerId)
          project.domain.handbackInput({ ticketId, inputId, reason: action.reason })
          handbackApplied = true
        } else if (action.kind === 'threadUnrelated') {
          project.domain.markUnrelated({ ticketId, threadId: action.threadId, reason: action.reason })
        } else {
          project.domain.followForContext({ ticketId, threadId: action.threadId })
        }
        applied += 1
      } catch (error) {
        if (!isSuperAgentDomainError(error)) throw error
        project.health.recordFailure('workerAction', { code: error.code, ticketId })
      }
    }
    if (applied > 0) {
      project.projector.sync()
      project.attentionProjector.sync()
    }
    // 交回的人消息回到候选池，由 Eval 重新裁决（off 模式没有 Eval，保持待评估）。
    if (handbackApplied && state.policy.acceptMode !== 'off') project.evalDriver?.pump()
  }

  /**
   * Worker 消息 → Report 事实。Executor 的事件回灌与内部接缝共用；
   * 协议失败抛稳定错误码，由调用方（Executor）按失败收尾并上报健康。
   */
  function applyWorkerReport(
    repoRoot: string,
    project: ProjectState,
    input: { text: string },
  ): SuperAgentWorkerReportResult {
    const parsed = parseSuperAgentReportText(input.text)
    // #100：先把整条消息的指令块解析完再落任何事实 —— 坏指令是协议失败，
    // 不能留下「Report 已生效、动作解析到一半」的半截状态。
    const actions = parseSuperAgentWorkerActions(input.text)
    const assignment = project.domain.state.assignments[parsed.assignmentId]
    if (!assignment) {
      // 伪造/错位：assignmentId 不属于本项目的任何执行，稳定拒绝
      throw superAgentError('assignmentNotFound', { assignmentId: parsed.assignmentId })
    }
    const result = project.domain.report({
      ticketId: assignment.ticketId,
      assignmentId: parsed.assignmentId,
      reportId: parsed.reportId,
      kind: parsed.kind,
      summary: parsed.summary,
      question: parsed.question,
      askedBy: parsed.askedBy,
      answers: parsed.answers,
      details: parsed.details,
      artifacts: parsed.artifacts,
    })
    if (parsed.progress) {
      project.projector.recordProgress(assignment.ticketId, parsed.progress)
    }
    // #104：一次 turn 已产出 Report → 唤醒轮收尾，不再阻止 hold 释放；
    // 最终（handoff）Report 同时是后台作业 30 分钟上限的起算点。
    if (!result.duplicate) {
      project.pendingBackgroundWake.delete(assignment.ticketId)
      if (isSuperAgentHandoffReport(result.report.kind)) {
        project.backgroundJobs.markTurnEnded(assignment.ticketId, result.report.kind)
      }
    }
    // Report 是领域事实：卡片即时投影（现有卡片原位更新，不重复发气泡）
    project.projector.sync()
    // question/answers 变化驱动 Attention 气泡（T08 #78）
    project.attentionProjector.sync()
    // #101：受控 reply 的 Router 侧产生点 —— result / attention / answer 都经
    // Outbox 外发（desktop 通道），不再依赖 Router 自己说话。重复 Report 不重复产生。
    if (!result.duplicate) {
      const ticket = project.domain.state.tickets[assignment.ticketId]
      if (ticket) {
        const kind = result.report.kind
        if (kind === 'ready' || kind === 'dropped') {
          enqueueSuperAgentReply(
            repoRoot,
            assignment.ticketId,
            `reply:result:${result.report.reportId}`,
            () => ({
              kind: 'reply',
              replyType: 'result',
              text: `「${ticket.title}」${kind === 'ready' ? '已完成' : '已放弃'}：${result.report.summary}`,
              inReplyTo: null,
              attentionId: null,
              reportId: result.report.reportId,
            }),
          )
        }
        if (result.attentionId) {
          const attention = project.domain.state.attentions[result.attentionId]
          if (attention?.status === 'open') {
            enqueueSuperAgentReply(
              repoRoot,
              assignment.ticketId,
              `reply:attention:${attention.attentionId}`,
              () => ({
                kind: 'reply',
                replyType: 'attention',
                text: attention.question,
                inReplyTo: attention.askedBy,
                attentionId: attention.attentionId,
                reportId: result.report.reportId,
              }),
            )
          }
        }
        // answer 只在 Worker 通过 answers 认领人消息之后才外发
        for (const inputId of parsed.answers) {
          enqueueSuperAgentReply(
            repoRoot,
            assignment.ticketId,
            `reply:answer:${inputId}`,
            () => ({
              kind: 'reply',
              replyType: 'answer',
              text: `已按你的回答处理：${result.report.summary}`,
              inReplyTo: inputId,
              attentionId: null,
              reportId: result.report.reportId,
            }),
          )
        }
      }
    }
    // #100：再逐条执行 Worker 指令（Report 优先；越权动作拒绝但不毁掉 Report）
    applyWorkerActions(project, assignment.ticketId, actions)
    return {
      ticketId: assignment.ticketId,
      reportId: result.report.reportId,
      kind: result.report.kind,
      summary: result.report.summary,
      at: result.report.at,
      duplicate: result.duplicate,
      attentionId: result.attentionId,
    }
  }

  /**
   * Router 投影落地（幂等）。
   *
   * 会话 id 由项目根稳定派生（设计 §5.3）：重启后仍是同一条 Router 会话，
   * 引擎按已有 transcript --resume，IM 历史不会每次从零开始。
   */
  function ensureRouterProjection(
    project: ProjectState,
    repoRoot: string,
  ): { sessionId: string; running: boolean } {
    if (!project.router) {
      project.router = {
        sessionId: superAgentRouterEngineSessionId(repoRoot),
        running: project.routerRunner?.isRunning() ?? false,
      }
      project.seq += 1
    }
    return project.router
  }

  /**
   * Router 轮次状态收敛：把 Runner 的真值写回 router 投影再广播。
   *
   * 投影只反映 Router 自己，不动领域 seq —— 卡片断档重拉看的是领域水位，
   * 与 typing 状态无关，把两者混在一起会让每次闲聊都触发全量重拉。
   */
  function notifyRouterStatus(project: ProjectState, repoRoot: string): void {
    if (!project.router) return
    project.router.running = project.routerRunner?.isRunning() ?? false
    options.onRouterStatusChanged?.(repoRoot, { ...project.router })
  }

  /**
   * 运行时接线（设计 §4.2、§7.1）。
   *
   * Executor 与 RouterRunner 反过来都要用 project 的 domain/scheduler/projector，
   * 只能在 project 落地后创建 —— 在此之前 launcher/workerDeliverer 是 null，
   * 工单保持排队而不假装启动。注入接缝（options.launcher / options.workerDeliverer /
   * options.bridge）保留给测试：给了就不再用真实引擎通路。
   */
  function wireRuntime(project: ProjectState, repoRoot: string): void {
    const bridge = options.bridge
    // 没有引擎接缝 = 没有运行时可接（领域用例、未接线的环境）：launcher 保持
    // null，工单如实排队；Router 会话也不会被拉起。
    if (!bridge) return

    // 注入了 fake launcher 的用例不建真实 Executor（它的事件订阅会白挂着）；
    // 只有走引擎接缝时才需要。
    if (options.launcher === undefined) {
      project.executor = createSuperAgentExecutor({
        bridge,
        resolveGeneration: (assignmentId) =>
          project.domain.state.assignments[assignmentId]?.generation ?? 1,
        titleOf: (ticketId) => project.domain.state.tickets[ticketId]?.title ?? ticketId,
        modelOf: (ticketId) => project.domain.state.tickets[ticketId]?.execution.model,
        humanInputIds: (ticketId) =>
          (project.domain.state.tickets[ticketId]?.inputIds ?? [])
            .filter((id) => project.domain.state.inputs[id]?.human === true),
        hooks: {
          ingest: (text) => {
            const report = applyWorkerReport(repoRoot, project, { text })
            return {
              final: isSuperAgentHandoffReport(report.kind),
              kind: report.kind,
              summary: report.summary,
              ticketId: report.ticketId,
            }
          },
          onProtocolFailure: (context) => {
            // 协议失败按设计 §7.4 落一份 failed Report（原文只进日志，不进领域），
            // reportId 绑定 assignmentId：同一执行的重复失败被幂等确认，不刷屏。
            try {
              project.domain.report({
                ticketId: context.ticketId,
                assignmentId: context.assignmentId,
                reportId: `protocol-failure:${context.assignmentId}`,
                kind: 'failed',
                summary: '本轮结束没有有效的最终 Report（汇报协议失败）',
              })
            } catch {
              // 执行已结束等非法迁移：只留健康，不伪造事实
            }
            project.health.recordFailure('effect:launch', {
              // #100：Worker 指令块解析失败时按稳定错误码上报，不统一写成 reportInvalid。
              code: context.code ?? 'reportInvalid',
              ticketId: context.ticketId,
            })
            project.projector.sync()
            project.attentionProjector.sync()
            project.routerRunner?.relay(renderSuperAgentRouterEvent({
              ticketId: context.ticketId,
              title: project.domain.state.tickets[context.ticketId]?.title ?? context.ticketId,
              kind: 'failed',
              summary: '本轮结束没有有效的最终 Report（汇报协议失败），请打开 Worker 查看详情。',
            }))
          },
          onInterrupted: (context) => {
            project.health.recordFailure('effect:launch', {
              code: 'engineLaunchFailed',
              ticketId: context.ticketId,
            })
          },
          relay: (info) => {
            const ticket = project.domain.state.tickets[info.ticketId]
            project.routerRunner?.relay(
              renderSuperAgentRouterEvent({
                ticketId: info.ticketId,
                title: ticket?.title ?? info.ticketId,
                kind: info.kind,
                summary: info.summary,
              }),
            )
          },
          onPermissionRequest: (context) => {
            try {
              project.domain.requestPermission({
                ticketId: context.ticketId,
                assignmentId: context.assignmentId,
                sessionId: context.sessionId,
                requestId: context.requestId,
                question: context.question,
              })
            } catch {
              // 工单已结束/执行已换代：不补建 Attention，进程由 stop 路径收尾
            }
            // 等权限不占逻辑槽位（进程现场仍由 Executor 持有），下一张可以开跑；
            // 回答时会经 Scheduler 重新取槽再应答。
            project.scheduler.holdForPermission(context.ticketId)
            project.attentionProjector.sync()
          },
          onPermissionCancelled: (context) => {
            project.domain.withdrawPermission({
              sessionId: context.sessionId,
              requestId: context.requestId,
            })
            // 若请求是被引擎侧自动裁决（而非中止/退出），Worker 会继续跑：
            // 重新占住槽位，避免「已释放但实际在跑」的调度账错位。
            void project.scheduler.acquireForPermissionAnswer(context.ticketId)
            project.attentionProjector.sync()
          },
          // #104：引擎事件 → 后台作业注册表（注册/完成；未知工单由注册表忽略）。
          onBackgroundJob: (context) => {
            project.backgroundJobs.apply(context)
          },
          // #104：turn 结束仍占槽的后台作业 → Executor 保留活动状态；收尾时再 handoff。
          hasBackgroundWork: (ticketId) => project.backgroundJobs.hasBackgroundWork(ticketId),
          onBackgroundHandoff: (ticketId) => {
            project.scheduler.handoff(ticketId, { turnEnded: true, backgroundWork: false })
          },
        },
      })
    }

    const statusQuery = createSuperAgentSessionStatusQuery({
      repoRoot,
      domain: project.domain,
      cards: () => project.projector.cards(),
      queue: () => project.scheduler.queue(),
      progress: (ticketId) => project.projector.peekProgress(ticketId),
    })

    const routerRunner = createSuperAgentRouterRunner({
      repoRoot,
      sessionId: superAgentRouterEngineSessionId(repoRoot),
      bridge,
      hooks: {
        dispatch: (input) =>
          applyDispatch(repoRoot, project, {
            requestId: input.requestId,
            title: input.title,
            text: input.text,
            note: input.note ?? undefined,
            model: input.model,
            actor: 'router',
          }),
        attach: (input) => applyRouterAttach(repoRoot, project, input),
        retry: (input) => applyRouterRetry(repoRoot, project, { ticketId: input.ticketId }),
        stop: (input) =>
          // reason 用旁注：人在快照上看到的是卡片，被停的原因留在工单事实里。
          applyTicketStop(repoRoot, project, {
            ticketId: input.ticketId,
            reason: input.note ?? undefined,
          }),
        onStatusChanged: () => notifyRouterStatus(project, repoRoot),
        onFailure: (code) => project.health.recordFailure('effect:relay', { code }),
        // 路由指令被拒时只累计健康计数的话，人听到的仍是 Router 按承诺编好的那句话。
        // 把"这条没执行、为什么"作为事实送回会话尾部，让它有机会如实交代；
        // 计数已经由 onFailure 做过，这里不再重复计入，避免同一失败敲两下阶梯。
        // 中继轮（本轮没有人的原话）不回灌，否则一条被拒的中继会引出下一条中继。
        onRouteRejected: (rejection) => {
          if (!rejection.humanTurn) return
          project.routerRunner?.relay(renderSuperAgentRouteRejected(rejection))
        },
        sourceRequests: (requestId) => {
          const sources = Object.values(project.domain.state.triggers)
            .filter((trigger) => trigger.source === 'desktop-router' && trigger.human)
            .sort((a, b) => a.ordinal - b.ordinal)
          const current = sources.findIndex((trigger) => trigger.meta.requestId === requestId)
          if (current < 0) return []
          return sources.slice(Math.max(0, current - 19), current + 1).map((trigger) => ({
            requestId: String(trigger.meta.requestId),
            text: trigger.text,
          }))
        },
        // 每轮把人正问的"有哪些活在跑"的答案送到模型面前（§8.1）。读路径先同步
        // 一次投影，卡片水位与领域事实不一致时自愈，而不是注入一份过期快照。
        statusContext: () => {
          project.projector.sync()
          return renderSuperAgentRouterStatusContext(statusQuery.statusQuery())
        },
      },
    })

    project.routerRunner = routerRunner

    // #99：Eval 闭环 —— 候选按 Thread 建批，经 Router 评估后落 Decision。
    // 领域事实变化复用既有投影/调度路径；协议失败与 unavailable 进 'eval' 健康项，
    // 新一轮成功裁决时清掉该项的连续失败。
    project.evalDriver = createSuperAgentEvalDriver({
      domain: project.domain,
      repoRoot,
      router: { evaluate: (turn) => routerRunner.evaluate(turn) },
      onChanged: () => {
        project.projector.sync()
        project.attentionProjector.sync()
        syncEvalHealth(project)
        project.scheduler.resume()
      },
      onFailure: (code, evalId) => {
        project.health.recordFailure('eval', { code, subjectId: evalId || null })
      },
      onDecided: () => project.health.recordSuccess('eval'),
    })
    project.evalDriver.start()
    // 恢复既有 pending 候选（重启后不依赖下一条 Source 事件才开评估）。
    project.evalDriver.pump()
  }

  /**
   * T23 #94：权限类 Attention 的回答不走 addInput —— 先重新取得 Scheduler 槽位，
   * 再向原 permission request 应答（allow/deny），最后关闭 Attention。
   * 引擎应答失败时退回 hold（Worker 仍卡在权限处），Attention 保持 open 可重试。
   */
  async function answerPermissionAttention(
    project: ProjectState,
    command: SuperAgentAttentionAnswerCommand,
    attention: SuperAgentAttention,
  ): Promise<SuperAgentAttentionAnswerResult> {
    if (attention.status === 'answered') {
      const duplicate = project.domain.answerPermission({ attentionId: attention.attentionId })
      project.attentionProjector.sync()
      return {
        attentionId: attention.attentionId,
        ticketId: attention.ticketId,
        inputId: null,
        status: null,
        delivered: true,
        gated: false,
        duplicate: duplicate.duplicate,
      }
    }
    if (attention.status !== 'open' || !attention.sessionId || !attention.requestId) {
      throw superAgentError('notAttention', { attentionId: attention.attentionId })
    }
    if (!command.decision) throw superAgentError('invalidAnswer', { attentionId: attention.attentionId })
    if (!options.bridge) throw superAgentError('engineLaunchFailed', { ticketId: attention.ticketId })

    const acquired = await project.scheduler.acquireForPermissionAnswer(attention.ticketId)
    if (!acquired) throw superAgentError('slotUnavailable', { ticketId: attention.ticketId })

    try {
      if (command.decision === 'allow') {
        await options.bridge.allowPermission(attention.sessionId, attention.requestId)
      } else {
        await options.bridge.denyPermission(
          attention.sessionId,
          attention.requestId,
          command.text?.trim() || '用户拒绝',
          { interrupt: false },
        )
      }
    } catch (err) {
      // 应答没送出去：Worker 仍在等权限，槽位退回 hold，气泡保持可回答
      project.scheduler.holdForPermission(attention.ticketId)
      throw err
    }

    const answered = project.domain.answerPermission({ attentionId: attention.attentionId })
    project.attentionProjector.sync()
    return {
      attentionId: attention.attentionId,
      ticketId: attention.ticketId,
      inputId: null,
      status: null,
      delivered: true,
      gated: false,
      duplicate: answered.duplicate,
    }
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
      // 引擎会话 id（UUIDv5 派生，见 sessionId.ts）：渲染端按它登记只读会话，
      // 事件与 transcript 都挂在同一个 id 上；可读标签 superagent-worker-<ticket>
      // 不能直接交给 CLI。
      sessionId: superAgentWorkerEngineSessionId(ticketId),
      running: segments.some((segment) => segment.state === 'running'),
      takenOver: project.takeover?.ticketId === ticketId,
      segments,
    }
  }

  /**
   * #104：后台 shell 作业完成 → 转成该工单的新 Input，经既有投递/闸门路径唤醒。
   *
   * 只在外层 `working`/`idle` 阶段唤醒：review/answer 归人，后台结果只留审计；
   * 迟到完成（Assignment 已结束）在注册表层已被忽略，不会走到这里。
   */
  async function wakeWorkerForBackgroundCompletion(
    repoRoot: string,
    project: ProjectState,
    job: SuperAgentBackgroundJob,
  ): Promise<void> {
    const ticket = project.domain.state.tickets[job.ticketId]
    if (!ticket || ticket.state !== 'open') return
    const latest = latestAssignmentOf(
      ticket.assignmentIds
        .map((assignmentId) => project.domain.state.assignments[assignmentId])
        .filter((assignment) => assignment !== undefined),
    )
    if (!latest || latest.state !== 'running') return
    const stage = project.domain.stageOf(job.ticketId)
    if (stage !== 'working' && stage !== 'idle') return

    const requestId = `background:${job.jobId}`
    const outputTail = job.outputTail ?? readBackgroundOutputTail(job.outputPath)
    const text = [
      '[后台作业完成]',
      `作业 ${job.jobId}（${job.kind === 'shell' ? '后台 shell' : 'subagent'}）已结束。`,
      outputTail
        ? `最后输出摘录：${outputTail}`
        : '没有可用的输出摘录；如需细节请用引擎的作业输出工具查看。',
      '请据此继续本工单；需要汇报时仍按 super-agent:report 围栏输出。',
    ].join('\n')
    let added: AddInputResult
    try {
      added = project.domain.addInput({
        ticketId: job.ticketId,
        requestId,
        kind: 'note',
        human: false,
        text,
      })
    } catch {
      // 工单已结束/闸门锁死：不唤醒，也不猜投递成功。
      return
    }
    project.projector.sync()
    project.attentionProjector.sync()
    if (!added.delivered && !added.duplicate) return

    // 首个 await 之前同步登记：紧接着的 onDrained 不能提前释放 Executor 的 hold。
    project.pendingBackgroundWake.add(job.ticketId)
    const result = await settleWorkerInputDelivery(
      repoRoot,
      project,
      { ticketId: job.ticketId, requestId, text },
      added,
    )
    if (!result.delivered) {
      // 没投出去就没有新 turn 会来收尾，立刻释放 hold 并把槽位还回去。
      project.pendingBackgroundWake.delete(job.ticketId)
      project.executor?.releaseBackgroundHold(job.ticketId)
    }
  }

  /**
   * #104：30 分钟上限的落账 —— 中止 shell 作业、释放 subagent，并让工单报 waiting。
   * 只有「等后台工作」的 waiting 报告会被改写成超时说明；review/blocked 归人，不动。
   */
  function reportBackgroundTimeout(project: ProjectState, event: SuperAgentBackgroundTimeout): void {
    project.health.recordFailure('effect:launch', {
      code: 'backgroundJobTimeout',
      ticketId: event.ticketId,
    })
    const ticket = project.domain.state.tickets[event.ticketId]
    if (!ticket || ticket.state !== 'open') {
      project.pendingBackgroundWake.delete(event.ticketId)
      return
    }
    const latest = latestAssignmentOf(
      ticket.assignmentIds
        .map((assignmentId) => project.domain.state.assignments[assignmentId])
        .filter((assignment) => assignment !== undefined),
    )
    if (!latest || latest.state !== 'running') {
      project.pendingBackgroundWake.delete(event.ticketId)
      project.executor?.releaseBackgroundHold(event.ticketId)
      return
    }
    if (!latest.report || latest.report.kind !== 'waiting') {
      // 报告不是 waiting（review/blocked 等）时超时只做审计，不把人手上的工单拉走。
      project.pendingBackgroundWake.delete(event.ticketId)
      project.executor?.releaseBackgroundHold(event.ticketId)
      return
    }
    const summary = renderBackgroundTimeoutSummary(event)
    try {
      project.domain.report({
        ticketId: event.ticketId,
        assignmentId: latest.assignmentId,
        reportId: `background-timeout:${latest.assignmentId}:${event.at}`,
        kind: 'waiting',
        summary,
      })
    } catch {
      // 报告竞争失败（例如同一刻被别的出口改过）：审计已留，不硬覆盖。
    }
    project.pendingBackgroundWake.delete(event.ticketId)
    project.projector.sync()
    project.attentionProjector.sync()
    project.routerRunner?.relay(
      renderSuperAgentRouterEvent({
        ticketId: event.ticketId,
        title: ticket.title,
        kind: 'waiting',
        summary,
      }),
    )
    project.executor?.releaseBackgroundHold(event.ticketId)
  }

  function renderBackgroundTimeoutSummary(event: SuperAgentBackgroundTimeout): string {
    const lines = ['后台作业超过 30 分钟上限。']
    if (event.killed.length > 0) {
      lines.push(`已中止 shell 作业 ${event.killed.length} 个：`)
      for (const job of event.killed) {
        const tail = job.outputTail ?? readBackgroundOutputTail(job.outputPath)
        lines.push(`- ${job.jobId}${tail ? `：最后输出 ${tail}` : '：未获得输出摘录'}`)
      }
    }
    if (event.released.length > 0) {
      lines.push(
        `已释放归属、允许自行收尾的 subagent：${event.released.map((job) => job.jobId).join(', ')}。`,
      )
    }
    lines.push('请检查上述作业结果后继续或结束本工单。')
    return lines.join('\n')
  }

  /**
   * 投递接缝：注入的 fake 优先（测试），否则用本项目的 Executor。
   * 两者都没有（Executor 尚未接线）才返回 null —— 输入只落库不假投。
   */
  function resolveWorkerDeliverer(
    project: ProjectState,
  ): SuperAgentWorkerDeliverer | null {
    if (options.workerDeliverer !== undefined) return options.workerDeliverer ?? null
    return project.executor?.deliver ?? null
  }

  /**
   * T09/T10 共用：先落库后投递的 requestId 对账 —— 可证明未接受（pending）
   * 才重投；delivered/read 已接受跳过；uncertain 禁止盲目重投并产生 Attention。
   */
  async function settleWorkerInputDelivery(
    repoRoot: string,
    project: ProjectState,
    command: { ticketId: string; requestId: string; text: string },
    added: AddInputResult,
  ): Promise<SuperAgentWorkerMessageResult> {
    const deliverer = resolveWorkerDeliverer(project)
    if (deliverer) {
      // duplicate 路径的 gated 是「未投出」而非「闸门拦截」，按 status 判断即可
      const shouldDeliver = added.duplicate
        ? added.input.status === 'pending'
        : added.delivered && !added.gated
      if (shouldDeliver) {
        const outcome = await deliverer({
          ticketId: command.ticketId,
          inputId: added.input.inputId,
          triggerId: added.input.triggerId,
          requestId: command.requestId,
          repoRoot,
          sessionId: superAgentWorkerEngineSessionId(command.ticketId),
          text: command.text,
        })
        if (outcome === 'accepted') {
          // 接受事实落盘后才标 delivered（重投成功时从 pending 转回 delivered）
          project.domain.deliverInput({ inputId: added.input.inputId })
          // #104：新 turn 由这条消息开始，后台作业的 30 分钟计时从下一次 turn 结束再起算。
          project.backgroundJobs.markTurnStarted(command.ticketId)
        } else if (outcome === 'notAccepted') {
          // 可证明未接受：已投出的（delivered）退回 pending；重投路径本来就是
          // pending 的保持不动（requeueInput 只接受 delivered → pending）
          if (project.domain.state.inputs[added.input.inputId]?.status === 'delivered') {
            project.domain.requeueInput({ inputId: added.input.inputId })
          }
        } else if (outcome === 'unknown') {
          project.domain.markInputUncertain({
            inputId: added.input.inputId,
            reason: 'deliveryUnknown',
          })
        }
        // Input 状态变化是领域事实：卡片即时投影
        project.projector.sync()
        // uncertain 会产生 delivery Attention：气泡同步投影（T08 #78）
        project.attentionProjector.sync()
      }
    }

    const input = project.domain.state.inputs[added.input.inputId]
    return {
      inputId: input.inputId,
      ticketId: input.ticketId,
      status: input.status,
      delivered: input.status === 'delivered' || input.status === 'read',
      gated: added.gated,
      duplicate: added.duplicate,
    }
  }

  /** T09 #79：接管/交还广播 —— 各面板据此同步，避免多面板互抢。 */
  function notifyTakeoverChanged(repoRoot: string, project: ProjectState): void {
    options.onTakeoverChanged?.(repoRoot, {
      repoRoot,
      takeover: project.takeover
        ? { repoRoot, ticketId: project.takeover.ticketId, at: project.takeover.at }
        : null,
    })
  }

  function snapshotOf(repoRoot: string, project: ProjectState): SuperAgentSnapshot {
    // T10 #80：仍在待验收且已超时提醒过的工单数（按工单去重，不按提醒次数计）。
    const reminded = Object.values(project.domain.state.tickets).filter(
      (ticket) =>
        ticket.state === 'open' &&
        ticket.reviewRemindedAt !== null &&
        project.domain.stageOf(ticket.ticketId) === 'person/review',
    ).length
    return {
      repoRoot,
      seq: project.seq,
      asOf: Date.now(),
      staleAfterMs: STALE_AFTER_MS,
      router: project.router ? { ...project.router } : null,
      // T08 #78：按工单去重的待处理 Attention 数（徽章/顶部计数联动）。
      attention: { unanswered: project.attentionProjector.pendingTickets() },
      review: { reminded },
    }
  }

  /**
   * T11 #81：解除暂停后补投挂起的 pending 输入（暂停期间到达的人消息不丢）。
   * 只投当前闸门已开、最新代次 pending/running 的工单；notAccepted 保持
   * pending（下次路径重投），unknown 转 uncertain + Attention，禁止盲目重投。
   */
  async function drainPendingInputs(
    repoRoot: string,
    project: ProjectState,
  ): Promise<void> {
    const deliverer = resolveWorkerDeliverer(project)
    if (!deliverer) return
    const state = project.domain.state
    for (const ticket of Object.values(state.tickets)) {
      if (ticket.state !== 'open') continue
      const latest = state.assignments[ticket.assignmentIds[ticket.assignmentIds.length - 1]]
      if (!latest || (latest.state !== 'pending' && latest.state !== 'running')) continue
      const facts = {
        ticket,
        assignments: ticket.assignmentIds
          .map((id) => state.assignments[id])
          .filter((assignment) => assignment !== undefined),
        inputs: ticket.inputIds
          .map((id) => state.inputs[id])
          .filter((input) => input !== undefined),
        attentions: Object.values(state.attentions).filter(
          (attention) => attention.ticketId === ticket.ticketId,
        ),
      }
      // blocked/failed 闸门未开的人消息不投：等人工解除后再走常规路径
      if (waitsForPerson(facts)) continue
      for (const inputId of [...ticket.inputIds]) {
        const input = state.inputs[inputId]
        if (
          !input ||
          input.status !== 'pending' ||
          input.context ||
          input.text === null ||
          input.requestId === null
        )
          continue
        const outcome = await deliverer({
          ticketId: ticket.ticketId,
          inputId,
          triggerId: input.triggerId,
          requestId: input.requestId,
          repoRoot,
          sessionId: superAgentWorkerEngineSessionId(ticket.ticketId),
          text: input.text,
        })
        if (outcome === 'accepted') {
          project.domain.deliverInput({ inputId })
        } else if (outcome === 'unknown') {
          project.domain.markInputUncertain({ inputId, reason: 'deliveryUnknown' })
        }
      }
    }
    project.projector.sync()
    project.attentionProjector.sync()
  }

  /** T11 #81：显式 shutdown 顺序（停止接受命令 → 有界等待 → 关 Store 释放锁）。 */
  async function shutdownProject(repoRoot: string): Promise<SuperAgentShutdownResult> {
    // shutdown 不创建项目：从未打开过的 repoRoot 直接视为已落定（幂等）
    const project = projects.get(repoRoot)
    if (!project || project.phase !== 'open') {
      return { repoRoot, settledWithinBound: true }
    }
    // 1. 停止接受新命令：draining 起所有写命令被拒绝（workerReport 例外至落定）
    project.phase = 'draining'
    // 2. 停止周期扫描类 scheduled effect
    project.reviewReminder.stop()
    project.backgroundJobs.stop()
    project.evalDriver?.stop()
    if (project.outbox) project.outbox.stop()
    // T24 #93：Source 轮询同样是周期 effect —— 显式 shutdown 立即停止；
    // 已保存的游标保证下次打开从断点续读，不重放已消费事件。
    project.sourceIngestor?.stop()
    project.sourceIngestor = null
    const bound = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    // 3. 有界等待在途 launch 落定；超时直接结束（下次启动生成恢复代次）
    const schedulerSettled = await project.scheduler.settle(bound)
    // T18 #88：Outbox 在途 Channel 派发同样有界等待回写
    const outboxSettled = project.outbox ? await project.outbox.settle(bound) : true
    const settledWithinBound = schedulerSettled && outboxSettled
    // 4. 关闭完成：停运行时订阅（在途 launch 已由 scheduler.settle 收口），
    //    关 Store 释放项目锁
    project.phase = 'closed'
    project.routerRunner?.dispose()
    project.executor?.dispose()
    project.routerRunner = null
    project.executor = null
    project.evalDriver = null
    project.store?.close()
    return { repoRoot, settledWithinBound }
  }

  /**
   * #101：受控 reply 的入列点。授权链 / 竞态拒绝不阻断主流程（记
   * effect:reply 健康项，便于看板发现异常）。
   *
   * #103：channel 按 reply 目标解析（设计 §6.4）—— ack/answer/attention 回到
   * 人消息所在会话，result 回到工单发起会话；未启用的通道直接跳过，不误发。
   */
  function enqueueSuperAgentReply(
    repoRoot: string,
    ticketId: string,
    messageId: string,
    build: (project: ProjectState) => SuperAgentOutboxReplyPayload | null,
  ): void {
    const project = projects.get(repoRoot)
    if (!project?.outbox) return
    if (project.domain.state.outbox[messageId]) return
    const payload = build(project)
    if (!payload) return
    const ticket = project.domain.state.tickets[ticketId]
    if (!ticket) return
    const channel = resolveSuperAgentReplyChannel({
      ticket,
      payload,
      state: project.domain.state,
    })
    if (!replyChannelEnabled(channel)) return
    try {
      project.domain.enqueueOutboxMessage({
        messageId,
        ticketId,
        channel,
        payload,
      })
      project.outbox.pump()
    } catch (err) {
      if (!(err instanceof SuperAgentDomainError)) throw err
      project.health.recordFailure('effect:reply', { code: err.code, ticketId })
    }
  }

  function replyChannelEnabled(channel: string): boolean {
    if (options.outbox?.channel) return true
    if (channel === DESKTOP_OUTBOX_CHANNEL) return options.outbox?.desktop === true
    if (channel.startsWith(FEISHU_OUTBOX_CHANNEL_PREFIX)) {
      return options.outbox?.feishu === undefined
        ? options.outbox?.external === true
        : options.outbox.feishu !== null
    }
    if (channel.startsWith(GITHUB_OUTBOX_CHANNEL_PREFIX)) {
      return options.outbox?.github === undefined
        ? options.outbox?.external === true
        : options.outbox.github !== null
    }
    return false
  }

  function superAgentExcerpt(text: string | null | undefined, limit = 80): string {
    const normalized = (text ?? '').replace(/\s+/g, ' ').trim()
    if (normalized === '') return '（无内容）'
    return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
  }

  return {
    state(repoRoot) {
      return snapshotOf(repoRoot, projectOf(repoRoot))
    },

    routerBind(repoRoot) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const router = ensureRouterProjection(project, repoRoot)
      return {
        sessionId: router.sessionId,
        running: project.routerRunner?.isRunning() ?? false,
        snapshot: snapshotOf(repoRoot, project),
      }
    },

    async routerMessage(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const runner = project.routerRunner
      if (!runner) {
        throw superAgentError('engineLaunchFailed', { repoRoot })
      }
      if (typeof command.text !== 'string' || command.text.trim() === '') {
        throw superAgentError('invalidRouterMessage', { repoRoot })
      }
      // 先落地投影再起轮：running 广播挂在投影上，投影不在就没人收 typing 状态
      const router = ensureRouterProjection(project, repoRoot)
      project.domain.intakeTrigger({
        key: `desktop-router:${command.requestId}`,
        source: 'desktop-router',
        threadIds: [],
        actor: 'desktop-user',
        human: true,
        addressed: 'direct',
        text: command.text,
        meta: { requestId: command.requestId },
      })
      await runner.message({
        requestId: command.requestId,
        text: command.text,
        displayText: command.displayText,
        images: command.images,
        model: command.model,
      })
      return {
        sessionId: router.sessionId,
        running: runner.isRunning(),
      }
    },

    async routerAbort(repoRoot) {
      const project = projectOf(repoRoot)
      // 只中止 Router 这一轮：Worker 不受影响（设计 §10.2）
      await project.routerRunner?.abortTurn()
      return true
    },

    health(repoRoot) {
      const project = projectOf(repoRoot)
      // T20 #90：读报告前先对账 unavailable Eval（24h 窗口），保证面板看到
      // 的 eval 主体项与领域事实一致。
      syncEvalHealth(project)
      return project.health.report()
    },

    sources(repoRoot) {
      const project = projectOf(repoRoot)
      // T24 #93：只读视图 —— 运行状态 + 候选登记 + 隔离报告。
      // 未配置/已 shutdown 时 ingestor 为 null，视图如实为空。
      return {
        repoRoot,
        sources: project.sourceIngestor?.status() ?? [],
        candidates: project.sourceCandidates.map((candidate) => ({
          ...candidate,
          threadIds: [...candidate.threadIds],
        })),
        quarantine: project.sourceIngestor?.quarantineReport() ?? [],
      }
    },

    evalReevaluate(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      // 先对账处置窗口：超过 24 小时的 unavailable 已被自动释放，
      // 重新评估会被拒绝（evalNotUnavailable），符合「24 小时内可重新评估」。
      syncEvalHealth(project)
      const result = project.domain.reevaluateEval({ evalId: command.evalId })
      // 健康主体项随之解除，落 reevaluated 审计。
      project.health.resolve('eval', command.evalId)
      // Trigger 已回队：立即按新批次重新评估，不等下一条 Source 事件。
      project.evalDriver?.pump()
      return {
        evalId: result.eval.evalId,
        requeuedTriggerIds: result.requeuedTriggerIds,
      }
    },

    problemDismiss(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const subjectId = command.subjectId ?? null
      if (command.category === 'eval' && subjectId !== null) {
        syncEvalHealth(project)
        try {
          // 显式忽略：领域侧释放扣住的 Trigger（不阻塞 Thread），落处置审计。
          project.domain.dismissEval({ evalId: subjectId })
        } catch (err) {
          // 已被处置（如 24 小时自动释放）：幂等忽略，健康条目照常清除。
          if (!(err instanceof SuperAgentDomainError && err.code === 'evalNotUnavailable')) {
            throw err
          }
        }
      }
      project.health.dismiss(command.category, subjectId)
      return project.health.report()
    },

    healthRetry(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      // 与 health()/problemDismiss 一致：先对账 unavailable Eval，再处置，
      // 返回的报告即面板最新状态（状态回显）。
      syncEvalHealth(project)
      project.health.retry(command.category, command.subjectId ?? null)
      return project.health.report()
    },

    dispatch(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      return applyDispatch(repoRoot, project, command)
    },

    queue(repoRoot) {
      return projectOf(repoRoot).scheduler.queue()
    },

    tickets(repoRoot) {
      const project = projectOf(repoRoot)
      // 读路径先同步一次：若存在未投影的领域变化（如后台 launch 回调竞态），
      // 借此自愈并保证 seq 水位与卡片一致
      project.projector.sync()
      return {
        repoRoot,
        seq: project.domain.state.seq,
        tickets: project.projector.cards(),
      }
    },

    workerReport(repoRoot, input) {
      const project = projectOf(repoRoot)
      // T11 #81：draining 期间仍接受 workerReport（在途 Effect 落定的自然路径），
      // closed（Store 已关）后拒绝，避免对已关 Store 的写入
      if (project.phase === 'closed') {
        throw superAgentError('shuttingDown', { repoRoot })
      }
      return applyWorkerReport(repoRoot, project, input)
    },

    workerBind(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const ticket = project.domain.state.tickets[ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId })
      }
      project.observedWorkers.add(ticketId)
      return workerMirrorOf(repoRoot, project, ticketId, ticket)
    },

    workerUnbind(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      // 幂等：观察不存在也返回成功；领域状态不受影响，后台推进继续
      project.observedWorkers.delete(ticketId)
      // 关闭镜像标签一并释放接管：面板没了，不残留接管态（T09 #79）
      if (project.takeover?.ticketId === ticketId) {
        project.takeover = null
        notifyTakeoverChanged(repoRoot, project)
      }
      return true
    },

    workerTakeover(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const ticket = project.domain.state.tickets[ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId })
      }
      if (project.takeover && project.takeover.ticketId !== ticketId) {
        // 同一项目同时至多一个接管：多面板不互抢
        throw superAgentError('takeoverConflict', {
          ticketId,
          activeTicketId: project.takeover.ticketId,
        })
      }
      if (!project.takeover) {
        // 只切面板态：不动领域、不动队列、不触发调度
        project.takeover = { ticketId, at: new Date().toISOString() }
        notifyTakeoverChanged(repoRoot, project)
      }
      return { repoRoot, ticketId, at: project.takeover.at }
    },

    workerRelease(repoRoot, ticketId) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      if (project.takeover?.ticketId === ticketId) {
        project.takeover = null
        notifyTakeoverChanged(repoRoot, project)
      }
      // 幂等：未接管/重复交还都成功，交还不残留接管态
      return true
    },

    async workerMessage(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      if (project.takeover?.ticketId !== command.ticketId) {
        throw superAgentError('takeoverRequired', { ticketId: command.ticketId })
      }
      if (typeof command.text !== 'string' || command.text.trim() === '') {
        throw superAgentError('invalidWorkerMessage', { ticketId: command.ticketId })
      }
      const ticket = project.domain.state.tickets[command.ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId: command.ticketId })
      }

      // 先落库：requestId 幂等，重复提交返回原 Input（对账依据）
      const added = project.domain.addInput({
        ticketId: command.ticketId,
        requestId: command.requestId,
        kind: 'text',
        human: true,
        text: command.text,
        note: command.note ?? null,
      })

      // 再投递：与 ticketMessage 共用 requestId 对账（settleWorkerInputDelivery）
      return settleWorkerInputDelivery(repoRoot, project, command, added)
    },

    attentions(repoRoot) {
      const project = projectOf(repoRoot)
      // 读路径先同步一次：与 tickets 一致的自愈语义，保证看板不落后于领域事实
      project.attentionProjector.sync()
      return project.attentionProjector.board()
    },

    async attentionAnswer(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const attention = project.domain.state.attentions[command.attentionId]
      if (attention?.kind === 'permission') {
        return answerPermissionAttention(project, command, attention)
      }
      if (command.decision) throw superAgentError('invalidAnswer', { attentionId: command.attentionId })
      if (typeof command.text !== 'string') {
        throw superAgentError('invalidAnswer', { attentionId: command.attentionId })
      }
      // 回答经 domain.ts 既有接缝（answerAttention → addInput）落库并投递；
      // 协议失败抛稳定错误码（notAttention/notQuestion/invalidAnswer），由 IPC 层序列化
      const answered = project.domain.answerAttention({
        attentionId: command.attentionId,
        requestId: command.requestId,
        text: command.text,
      })
      // 回答已追加到 open Attention 的 answers：气泡视图刷新（asked）
      project.attentionProjector.sync()
      return {
        attentionId: command.attentionId,
        ticketId: answered.attention.ticketId,
        inputId: answered.input.inputId,
        status: answered.input.status,
        delivered: answered.delivered,
        gated: answered.gated,
        duplicate: answered.duplicate,
      }
    },

    ticketAccept(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const result = project.domain.ticketAccept({ ticketId: command.ticketId })
      // 工单结束是领域事实：卡片（→ completed）与 Attention（撤回）即时投影
      project.projector.sync()
      project.attentionProjector.sync()
      return {
        repoRoot,
        ticketId: result.ticket.ticketId,
        outcome: 'completed',
        endedAt: result.ticket.ended?.at ?? '',
      }
    },

    ticketStop(repoRoot, command) {
      return applyTicketStop(repoRoot, projectOf(repoRoot), command)
    },

    async ticketMessage(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const ticket = project.domain.state.tickets[command.ticketId]
      if (!ticket) {
        throw superAgentError('ticketNotFound', { ticketId: command.ticketId })
      }
      // 先落库（空文本由领域抛 invalidTicketMessage）：复用原 Assignment 回到 working
      const added = project.domain.ticketMessage({
        ticketId: command.ticketId,
        requestId: command.requestId,
        text: command.text,
      })
      // T25 #97：继续追问里显式引用的 PR 同样建立 follows 订阅。
      bindExplicitPrFollows(project, command.ticketId, command.text)
      // 再投递：与 workerMessage 共用 requestId 对账（settleWorkerInputDelivery）
      return settleWorkerInputDelivery(repoRoot, project, command, added)
    },

    ticketRetry(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      // scheduler.retry：domain.retryTicket 校验闸门后新建 generation+1，
      // 并经 onDomainChanged 回调投影同步 + 队列广播
      return project.scheduler.retry({ ticketId: command.ticketId })
    },

    sweepReviewReminders(repoRoot) {
      return projectOf(repoRoot).reviewReminder.sweep()
    },

    outboxEnqueue(repoRoot, command) {
      const project = projectOf(repoRoot)
      const { message, duplicate } = project.domain.enqueueOutboxMessage(command)
      // 入列成功立即泵送；channel 未配置（runner 为 null）时仅落库待后续做
      project.outbox?.pump()
      return { messageId: message.messageId, status: message.status, duplicate }
    },

    outboxQueue(repoRoot) {
      return Object.values(projectOf(repoRoot).domain.state.outbox).sort(
        (a, b) => a.ordinal - b.ordinal,
      )
    },

    sweepOutbox(repoRoot) {
      return projectOf(repoRoot).outbox?.pump() ?? 0
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

    async shutdown(repoRoot) {
      return shutdownProject(repoRoot)
    },

    async shutdownAll() {
      const results: SuperAgentShutdownResult[] = []
      for (const repoRoot of [...projects.keys()]) {
        results.push(await shutdownProject(repoRoot))
      }
      return results
    },

    pause(repoRoot) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      project.domain.pauseProject()
      return true
    },

    async resume(repoRoot) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      project.domain.resumeProject()
      // 暂停期间到达的人消息不丢：补投挂起输入后续跑队列
      await drainPendingInputs(repoRoot, project)
      project.scheduler.resume()
      // 暂停期间不开始新 Eval；恢复后把积压候选重新建批。
      project.evalDriver?.pump()
      return true
    },

    authorizationPolicy(repoRoot) {
      const project = projectOf(repoRoot)
      return {
        repoRoot,
        // 深拷贝：视图跨 IPC/测试边界，调用方不得借引用改到领域状态
        policy: cloneSuperAgentPolicy(project.domain.state.policy),
      }
    },

    async authorizationPolicySet(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      const result = project.domain.setPolicy({
        acceptMode: command.acceptMode,
        rules: command.rules,
        admissions: command.admissions,
      })
      if (result.changed) {
        // 新版本会丢弃/重排运行中 Eval：同步卡片与 Attention 投影，
        // 让 UI 立刻看到领域 seq 与工单事实一致，而不是等下一次事件。
        project.projector.sync()
        project.attentionProjector.sync()
        // 旧版本 Eval 已丢弃、Trigger 已回队：按新 Policy 立即重开评估。
        project.evalDriver?.pump()
      }
      return {
        repoRoot,
        policy: cloneSuperAgentPolicy(result.policy),
        changed: result.changed,
        discardedEvalIds: [...result.discardedEvalIds],
      }
    },

    executionPolicy(repoRoot) {
      const project = projectOf(repoRoot)
      const policy = project.domain.state.executionPolicy
      return {
        repoRoot,
        policy: { mode: policy.mode, maxWorkers: policy.maxWorkers, worktree: policy.worktree },
      }
    },

    async setExecutionPolicy(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      // 结构校验先行：上限/派生与 domain 单一出处（resolveExecutionPolicy）
      const next = resolveExecutionPolicy({ mode: command.mode, maxWorkers: command.maxWorkers })
      const current = project.domain.state.executionPolicy
      const changed =
        current.mode !== next.mode ||
        current.maxWorkers !== next.maxWorkers ||
        current.worktree !== next.worktree
      if (changed) {
        // 运行中不热切换：有 Worker 占槽时拒绝策略变更
        if (project.scheduler.hasActiveWorkers()) {
          throw superAgentError('policyChangeBlocked', {
            repoRoot,
            mode: next.mode,
            maxWorkers: next.maxWorkers,
          })
        }
        if (next.mode === 'parallel') {
          // 并行开启需 UI 二次确认显式携带
          if (command.confirmed !== true) {
            throw superAgentError('policyConfirmRequired', { repoRoot })
          }
          // 并行要求 per-ticket worktree：不是 git 仓库时拒绝开启
          const workspace = await probe.probe(repoRoot)
          if (!workspace.head) {
            throw superAgentError('worktreeUnavailable', { repoRoot })
          }
        }
        // 落持久领域事实（幂等；相同策略不推进 seq），再即时生效（pump + 队列广播）
        project.domain.setExecutionPolicy({ mode: command.mode, maxWorkers: command.maxWorkers })
        project.scheduler.applyPolicy()
      }
      return {
        repoRoot,
        policy: {
          mode: next.mode,
          maxWorkers: next.maxWorkers,
          worktree: next.worktree,
        },
      }
    },

    async checkpoint(repoRoot) {
      const project = projectOf(repoRoot)
      const cp = project.checkpoints.latest(repoRoot)
      const workspace = await probe.probe(repoRoot)
      // 回退候选 = 当前脏文件中「检查点时还干净」的部分（检查点前已脏的是用户自己的
      // 改动）；工作区不可用（非 git 仓库）时无可靠脏清单
      const changedFiles = workspace.head
        ? workspace.statusText
            .split('\n')
            .map((line) => parsePorcelainEntry(line))
            .filter(
              (entry): entry is string =>
                entry !== null &&
                !checkpointDirtyOf(cp).has(entry.replace(/\\/g, '/')),
            )
        : []
      return {
        repoRoot,
        checkpoint: cp ? { savedAt: cp.savedAt, head: cp.head, entries: cp.entries } : null,
        changedFiles,
      }
    },

    async checkpointRollback(repoRoot, command) {
      const project = projectOf(repoRoot)
      assertCommandsAllowed(project, repoRoot)
      if (
        !Array.isArray(command.files) ||
        command.files.some((file) => typeof file !== 'string')
      ) {
        throw superAgentError('checkpointInvalidFile', { repoRoot })
      }
      const result = await project.checkpoints.rollbackFiles(repoRoot, command.files)
      // 回退是工作区变化：投影与队列刷新（快照内含 dirty 标志）
      project.projector.sync()
      project.scheduler.applyPolicy()
      return result
    },
  }
}
