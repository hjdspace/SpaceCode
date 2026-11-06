/**
 * Super Agent renderer store（T01 #71 骨架，T13 #83 健康面板，T05 #75 显式派工，
 * T07 #77 Worker 只读镜像）。
 *
 * bind 走主进程的幂等 routerBind，并把 Router 会话以 sessionType='superAgent'
 * 登记进 chatSession —— 普通侧边栏按类型过滤，因此不会出现这条会话。
 * snapshot 是主进程投影的只读副本；attentionCount 供入口徽章使用。
 *
 * T13：healthReport 只读镜像来自 health 通道 + health.changed 事件（只接受
 * 当前绑定项目的报告）；面板问题列表只含 error 且未反映在工单卡片的项，
 * 单次抖动（degraded）不上面板、不打扰人。面板只读，无处置动作。
 *
 * T05：dispatch 是「新建工单」独立动作（普通发送仍只对话 Router）；
 * queue 只读镜像来自 queue 通道 + queue-changed 事件，队列现状对所有窗口可见。
 *
 * T07：bindWorker 幂等挂 Worker 只读镜像 —— 用镜像的稳定 sessionId 把 Worker
 * 会话以 sessionType='superAgentWorker' 登记进 chatSession（不激活、不进侧边栏），
 * AgentTimeline 直接从该会话读转录；unbindWorker 只停镜像并清掉本地快照，
 * 会话与转录保留，重开标签时再次 bindWorker 即可从快照恢复。
 *
 * T06 #76：ticketBoard 是工单卡片镜像 —— tickets 通道全量拉取 + ticket-updated
 * 增量推送。事件携带领域 seq 水位（fromSeq/toSeq）：fromSeq 与本地水位不一致
 * 即判定领域断档，全量重拉；ticket-progress 是节流后的轻量进度，使用独立
 * 投影水位，断档不重拉、不重放，只应用最新。
 *
 * T09 #79：takeover 是接管态镜像 —— workerTakeover/workerRelease 切换，
 * takeover-changed 事件同步所有面板（多面板不互抢）。sendWorkerMessage 把
 * 接管输入交给主进程先落库再投递（requestId 对账），不直连引擎。
 *
 * T08 #78：attentionBoard 是 Attention 气泡镜像 —— attentions 通道全量拉取 +
 * attention-asked/answered/withdrawn 事件增量应用（payload 本身携带全量视图，
 * 直接应用即幂等，无需水位对账）。attentionCount 按工单去重联动徽章；
 * answerAttention 把就地回答交给主进程落成领域 Input 再投递给对应 Worker。
 *
 * T10 #80：review 工单的三个显式出口（acceptTicket / messageTicket / stopTicket）
 * 与只对 delivery/blocked/failed 开放的 retryTicket 都委托主进程落库（错误码经
 * IPC 序列化）；reviewReminders 从卡片看板派生（state=review 且带提醒水位），
 * 同一工单复用原气泡；reviewRemindedCount 按工单去重联动入口徽章与状态条。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'
import type {
  SuperAgentAttentionAnswerCommand,
  SuperAgentAttentionAnswerResult,
  SuperAgentAttentionBoard,
  SuperAgentAttentionView,
  SuperAgentBindResult,
  SuperAgentCheckpointInfo,
  SuperAgentCheckpointRollbackResult,
  SuperAgentDispatchCommand,
  SuperAgentDispatchResult,
  SuperAgentExecutionPolicyView,
  SuperAgentEvalReevaluateResult,
  SuperAgentHealthCategory,
  SuperAgentHealthReport,
  SuperAgentPolicySetCommand,
  SuperAgentQueueSnapshot,
  SuperAgentRouterMessageCommand,
  SuperAgentRouterMessageResult,
  SuperAgentSnapshot,
  SuperAgentTakeoverState,
  SuperAgentTicketActionResult,
  SuperAgentTicketBoard,
  SuperAgentTicketCard,
  SuperAgentTicketMessageCommand,
  SuperAgentTicketMessageResult,
  SuperAgentTicketProgress,
  SuperAgentTicketRetryResult,
  SuperAgentWorkerMessageCommand,
  SuperAgentWorkerMessageResult,
  SuperAgentWorkerMirror,
} from '@/shared/channels/superAgent'
import { useChatSessionStore } from '../chatSession'
import { useTurnStore } from '../turn'

/** 待验收超时提醒项：由卡片看板派生，同一工单复用同一条气泡。 */
export interface SuperAgentReviewReminderItem {
  ticketId: string
  title: string
  remindedAt: string
}

export const useSuperAgentStore = defineStore('superAgent', () => {
  const snapshot = ref<SuperAgentSnapshot | null>(null)
  const boundSessionId = ref<string | null>(null)
  /**
   * Router 这一轮是否在跑 —— 真源是主进程 RouterRunner（router-status 事件），
   * 不是本地 turn：会话归主进程，渲染端只是观察者。typing/计时与停止按钮都读它。
   */
  const routerRunning = ref(false)
  const healthReport = ref<SuperAgentHealthReport | null>(null)
  const healthPanelOpen = ref(false)
  const queue = ref<SuperAgentQueueSnapshot | null>(null)
  /** T12 #82：执行策略镜像（policy 通道；策略变更即时生效并持久化）。 */
  const executionPolicy = ref<SuperAgentExecutionPolicyView | null>(null)
  /** T12 #82：检查点信息镜像（最新检查点 + 检查点后新增脏文件，回退候选）。 */
  const checkpointInfo = ref<SuperAgentCheckpointInfo | null>(null)
  /** 工单卡片看板镜像（T06 #76）：全量卡片 + 领域 seq 水位。 */
  const ticketBoard = ref<SuperAgentTicketBoard | null>(null)
  /** 各工单最新轻量进度（T06 #76）：节流后增量，断档不重拉。 */
  const ticketProgress = ref<Record<string, SuperAgentTicketProgress>>({})
  /** Worker 只读镜像快照，按 ticketId 索引；标签页并存时各取各的。 */
  const workerMirrors = ref<Record<string, SuperAgentWorkerMirror>>({})
  /** T09 #79：当前接管态镜像；null = 未接管。每项目同时至多一个。 */
  const takeover = ref<SuperAgentTakeoverState | null>(null)
  /** T08 #78：Attention 气泡看板镜像（含已回答的审计折叠项）。 */
  const attentionBoard = ref<SuperAgentAttentionBoard | null>(null)

  /** T09 #79：当前被接管的 ticketId；面板据此切换只读/可写。 */
  const takeoverTicketId = computed(() => takeover.value?.ticketId ?? null)

  /** 待处理 Attention：按工单去重，与主进程徽章计数同源。 */
  const attentionCount = computed(
    () => attentionBoard.value?.pendingTickets ?? snapshot.value?.attention.unanswered ?? 0,
  )
  /** 全部非撤回气泡：open 展示回答入口，answered 折叠保留审计。 */
  const attentionBubbles = computed(() =>
    (attentionBoard.value?.attentions ?? []).filter(
      (view: SuperAgentAttentionView) => view.status !== 'withdrawn',
    ),
  )
  const openAttentions = computed(() =>
    attentionBubbles.value.filter((view: SuperAgentAttentionView) => view.status === 'open'),
  )
  /**
   * T10 #80：待验收超时提醒列表 —— 从卡片看板派生（state=review 且已提醒），
   * 同一工单天然只出现一条（复用原气泡，不按提醒次数新增消息）。
   */
  const reviewReminders = computed<SuperAgentReviewReminderItem[]>(() =>
    (ticketBoard.value?.tickets ?? [])
      .filter((card) => card.state === 'review' && card.reviewRemindedAt !== null)
      .map((card) => ({
        ticketId: card.ticketId,
        title: card.title,
        remindedAt: card.reviewRemindedAt as string,
      })),
  )
  /**
   * T10 #80：待验收提醒计数（按工单去重，不按提醒次数计）—— 入口徽章与
   * 状态条联动；看板未加载时回退快照计数（快照与主进程同源）。
   */
  const reviewRemindedCount = computed(() => {
    if (ticketBoard.value !== null) return reviewReminders.value.length
    return snapshot.value?.review.reminded ?? 0
  })
  const healthProblemCount = computed(() => healthReport.value?.problemCount ?? 0)
  /** 面板问题列表：error 级且未由工单卡片呈现的项。 */
  const healthProblems = computed(() =>
    (healthReport.value?.items ?? []).filter(
      (item) => item.status === 'error' && !item.reflectedOnTicket,
    ),
  )

  function ensureRouterSession(sessionId: string, repoRoot: string): void {
    // ensureSession 两条路都管：没有行就按归属建，有行（修复前它以普通聊天建过）
    // 就补认归属。早退会让那条行永远留在侧边栏里。
    useChatSessionStore().ensureSession(sessionId, {
      title: i18n.global.t('superAgent.title'),
      projectPath: repoRoot,
      activate: false,
      sessionType: 'superAgent',
    })
  }

  /** Worker 稳定会话登记：不激活、不进侧边栏；已有行则补认归属。 */
  function ensureWorkerSession(mirror: SuperAgentWorkerMirror): void {
    useChatSessionStore().ensureSession(mirror.sessionId, {
      title: mirror.title,
      projectPath: mirror.repoRoot,
      activate: false,
      sessionType: 'superAgentWorker',
    })
  }

  /**
   * 当前绑定的项目根 —— 中置页那份镜像的唯一作用域。
   *
   * 页面动作只读它，绝不读实时项目指针：切换项目后若动作仍发实时指针，屏幕上
   * 是 A 的工单、命令却打到 B，等于拿一个不存在的 ticketId 去敲另一个项目。
   */
  const boundRepoRoot = computed<string | null>(() => snapshot.value?.repoRoot ?? null)

  /**
   * 中置页的单项目镜像清空。
   *
   * workerMirrors 与 takeover 不在内 —— 那两个属于右侧 Worker 标签，标签自己
   * 带着打开时的项目根，跨项目切换要继续可用。
   */
  function resetProjectScope(): void {
    snapshot.value = null
    boundSessionId.value = null
    routerRunning.value = false
    healthReport.value = null
    queue.value = null
    executionPolicy.value = null
    checkpointInfo.value = null
    ticketBoard.value = null
    ticketProgress.value = {}
    attentionBoard.value = null
  }

  /**
   * 镜像写入闸门：只接受属于当前绑定项目的数据。
   *
   * 事件订阅一直按这条规则丢弃不一致事件；切换项目后在途的旧请求必须走同一道闸，
   * 否则 A→B 连切时 A 的慢响应会整版盖掉 B 的镜像。
   */
  function isBoundProject(repoRoot: string): boolean {
    return snapshot.value?.repoRoot === repoRoot
  }

  /**
   * 切换 Super Agent 的项目作用域（跟随全局项目指针）：清空中置页镜像并绑定新项目。
   *
   * 先清空再绑：清空后 boundRepoRoot 为 null，动作与卡片自然停摆，不会留下
   * 「半新半旧」的一帧。五面镜像的重拉仍由调用方在订阅建立之后再发 ——
   * 订阅不能等慢快照全部返回，否则期间到达的事件会丢（见 SuperAgentView 的挂载次序）。
   *
   * 主进程按 repoRoot 分项目：旧项目的 Router/Worker 继续推进，切回来靠稳定会话 id
   * 接上历史，这里不杀任何进程。
   */
  async function switchProject(repoRoot: string): Promise<void> {
    // 空根 = 关闭文件夹：必须退出作用域，否则页面留着旧项目的卡片，
    // 而动作仍按旧根发出去 —— 人已经"没有项目"了，命令却还在打它。
    if (!repoRoot) {
      resetProjectScope()
      return
    }
    if (isBoundProject(repoRoot) && boundSessionId.value) return
    resetProjectScope()
    await bind(repoRoot)
  }

  /**
   * 每次 bind 领一个递增序号；响应回来时若已有更新的 bind 开始，这份结果就不该再落镜像。
   * 与 isBoundProject 分工：这里护住作用域本身，那里护住各面镜像。
   */
  let bindSeq = 0

  async function bind(repoRoot: string): Promise<SuperAgentBindResult> {
    const token = ++bindSeq
    const result = await api.superAgent.routerBind(repoRoot)
    // 会话登记与"当前看哪个项目"无关：属于 Super Agent 就该带归属，
    // 即便它已经不是当前项目，也不该以普通聊天身份留在侧边栏。
    ensureRouterSession(result.sessionId, repoRoot)
    if (token !== bindSeq) return result
    boundSessionId.value = result.sessionId
    snapshot.value = result.snapshot
    routerRunning.value = result.running
    // Router 会话由主进程持有且 id 稳定：重启后 transcript 里已有之前的对话，
    // 不重读就只剩一个空聊天区（人会以为 IM 历史没了）。
    await useChatSessionStore().refreshSessionHistory(result.sessionId)
    return result
  }

  /**
   * 与 Router 对话（T21）：交给主进程 RouterRunner，不走渲染端 turnStore ——
   * 走 turnStore 就等于让 Router 变成一条带全套写工具的普通聊天。
   * Promise 只表示已受理，回复由 router-status 与流事件驱动。
   */
  async function sendRouterMessage(
    repoRoot: string,
    command: SuperAgentRouterMessageCommand,
  ): Promise<SuperAgentRouterMessageResult> {
    const result = await api.superAgent.routerMessage(repoRoot, command)
    routerRunning.value = result.running
    return result
  }

  /**
   * 中止 Router 当前轮次；不影响任何 Worker 的推进。
   *
   * 先给 turn store 打"用户主动中止"标记再停：引擎对中断轮次回的 result 带
   * is_error=true（"API error"），没标记就会被 handleError 当成引擎故障弹错误
   * 气泡 —— 与主聊天 turnStore.abort 的打标是同一条规则。标记在下一轮
   * router-status 转为 running 时清除（见 watchRouterStatus），不会吞掉之后
   * 的真实引擎错误。
   */
  async function abortRouter(repoRoot: string): Promise<void> {
    const sid = boundSessionId.value
    if (sid) useTurnStore().markUserAborted(sid)
    await api.superAgent.routerAbort(repoRoot)
    routerRunning.value = false
  }

  /** 订阅 router-status；只接受当前绑定项目的状态，返回退订函数。 */
  function watchRouterStatus(): () => void {
    return api.superAgent.onRouterStatus((repoRoot, router) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      routerRunning.value = router.running
      // 新一轮开始 = 上次中止的带错 result 已经处理完，撤掉中止标记
      if (router.running && boundSessionId.value) {
        useTurnStore().clearUserAborted(boundSessionId.value)
      }
    })
  }

  async function loadState(repoRoot: string): Promise<SuperAgentSnapshot> {
    const next = await api.superAgent.state(repoRoot)
    if (isBoundProject(next.repoRoot)) snapshot.value = next
    return next
  }

  async function loadHealth(repoRoot: string): Promise<SuperAgentHealthReport> {
    const next = await api.superAgent.health(repoRoot)
    if (isBoundProject(next.repoRoot)) healthReport.value = next
    return next
  }

  /** 「新建工单」显式派工；成功后刷新队列快照。 */
  async function dispatch(
    repoRoot: string,
    command: SuperAgentDispatchCommand,
  ): Promise<SuperAgentDispatchResult> {
    const result = await api.superAgent.dispatch(repoRoot, command)
    await loadQueue(repoRoot)
    return result
  }

  async function loadQueue(repoRoot: string): Promise<SuperAgentQueueSnapshot> {
    const next = await api.superAgent.queue(repoRoot)
    if (isBoundProject(next.repoRoot)) queue.value = next
    return next
  }

  /** T12 #82：拉取执行策略镜像（串/并行、上限、worktree 形态）。 */
  async function loadPolicy(repoRoot: string): Promise<SuperAgentExecutionPolicyView> {
    const next = await api.superAgent.policy(repoRoot)
    if (isBoundProject(next.repoRoot)) executionPolicy.value = next
    return next
  }

  /**
   * T12 #82：执行策略变更 —— 开启并行必须 UI 二次确认后携带 confirmed；
   * 变更即时生效，成功后刷新策略与队列快照（上限变化）。
   */
  async function setPolicy(
    repoRoot: string,
    command: SuperAgentPolicySetCommand,
  ): Promise<SuperAgentExecutionPolicyView> {
    const next = await api.superAgent.policySet(repoRoot, command)
    if (isBoundProject(next.repoRoot)) executionPolicy.value = next
    await loadQueue(repoRoot)
    return next
  }

  /** T12 #82：拉取检查点信息（最新检查点 + 回退候选文件清单）。 */
  async function loadCheckpoint(repoRoot: string): Promise<SuperAgentCheckpointInfo> {
    const next = await api.superAgent.checkpoint(repoRoot)
    if (isBoundProject(next.repoRoot)) checkpointInfo.value = next
    return next
  }

  /** T12 #82：按文件显式回退到检查点状态；成功后刷新候选清单与工单看板。 */
  async function rollbackCheckpointFiles(
    repoRoot: string,
    files: string[],
  ): Promise<SuperAgentCheckpointRollbackResult> {
    const result = await api.superAgent.checkpointRollback(repoRoot, { files })
    await Promise.all([loadCheckpoint(repoRoot), loadTickets(repoRoot)])
    return result
  }

  /** 全量拉取工单卡片看板（T06 #76）：初始加载与领域断档重拉共用。 */
  async function loadTickets(repoRoot: string): Promise<SuperAgentTicketBoard> {
    const next = await api.superAgent.tickets(repoRoot)
    if (isBoundProject(next.repoRoot)) {
      ticketBoard.value = next
      syncStaleWorkerMirrors(repoRoot, next.tickets)
    }
    return next
  }

  /**
   * 幂等挂 Worker 只读镜像（T07 #77）：取稳定 sessionId 与代次分段快照，
   * 登记 Worker 会话（不激活）。重开标签时再次调用即可从快照恢复。
   */
  async function bindWorker(repoRoot: string, ticketId: string): Promise<SuperAgentWorkerMirror> {
    const mirror = await api.superAgent.workerBind(repoRoot, ticketId)
    workerMirrors.value[ticketId] = mirror
    ensureWorkerSession(mirror)
    // Worker 会话 id 跨重启稳定：重开标签先接上 transcript，再由事件续流。
    await useChatSessionStore().refreshSessionHistory(mirror.sessionId)
    return mirror
  }

  /** 只停镜像并清掉本地快照；Worker 会话与转录保留，后台推进不受影响。 */
  async function unbindWorker(repoRoot: string, ticketId: string): Promise<void> {
    await api.superAgent.workerUnbind(repoRoot, ticketId)
    delete workerMirrors.value[ticketId]
    // 主进程会在 unbind 时一并释放接管；本地立即清镜像，面板不残留接管态
    if (takeover.value?.ticketId === ticketId) takeover.value = null
  }

  /**
   * 接管 Worker（T09 #79）：只切面板态，不改调度；同一项目同时至多一个，
   * 冲突时主进程抛 takeoverConflict。接管后镜像同步刷新 takenOver。
   */
  async function takeoverWorker(
    repoRoot: string,
    ticketId: string,
  ): Promise<SuperAgentTakeoverState> {
    const state = await api.superAgent.workerTakeover(repoRoot, ticketId)
    takeover.value = state
    const mirror = workerMirrors.value[ticketId]
    if (mirror) workerMirrors.value[ticketId] = { ...mirror, takenOver: true }
    return state
  }

  /** 交还（T09 #79）：幂等；交还后该工单镜像回到只读。 */
  async function releaseWorker(repoRoot: string, ticketId: string): Promise<true> {
    const result = await api.superAgent.workerRelease(repoRoot, ticketId)
    if (takeover.value?.ticketId === ticketId) takeover.value = null
    const mirror = workerMirrors.value[ticketId]
    if (mirror) workerMirrors.value[ticketId] = { ...mirror, takenOver: false }
    return result
  }

  /**
   * 接管输入（T09 #79）：主进程先落 Domain Input 再按调度投递（requestId 对账），
   * 渲染端不直连引擎。unconfirmed/uncertain 结果由调用方提示，不在此重投。
   */
  async function sendWorkerMessage(
    repoRoot: string,
    command: SuperAgentWorkerMessageCommand,
  ): Promise<SuperAgentWorkerMessageResult> {
    return api.superAgent.workerMessage(repoRoot, command)
  }

  /** 全量拉取 Attention 气泡看板（T08 #78）：初始加载共用。 */
  async function loadAttentions(repoRoot: string): Promise<SuperAgentAttentionBoard> {
    const next = await api.superAgent.attentions(repoRoot)
    if (isBoundProject(next.repoRoot)) attentionBoard.value = next
    return next
  }

  /**
   * 就地回答 Attention（T08 #78）：主进程先落领域 Input 再投递给对应 Worker
   * （requestId 对账）；成功后重拉看板，保证与事件广播的到达顺序无关。
   */
  async function answerAttention(
    repoRoot: string,
    command: SuperAgentAttentionAnswerCommand,
  ): Promise<SuperAgentAttentionAnswerResult> {
    const result = await api.superAgent.attentionAnswer(repoRoot, command)
    await loadAttentions(repoRoot)
    return result
  }

  /**
   * T10 #80：接受验收 —— person/review 的显式出口。成功后刷新快照与看板，
   * 徽章/提醒列表随水位与阶段变化即时收敛（与事件广播到达顺序无关）。
   */
  async function acceptTicket(
    repoRoot: string,
    ticketId: string,
  ): Promise<SuperAgentTicketActionResult> {
    const result = await api.superAgent.ticketAccept(repoRoot, { ticketId })
    await Promise.all([loadState(repoRoot), loadTickets(repoRoot)])
    return result
  }

  /** T10 #80：停止出口 —— Mandate 撤回 + 工单 stopped；同样刷新快照与看板。 */
  async function stopTicket(
    repoRoot: string,
    ticketId: string,
  ): Promise<SuperAgentTicketActionResult> {
    const result = await api.superAgent.ticketStop(repoRoot, { ticketId })
    await Promise.all([loadState(repoRoot), loadTickets(repoRoot)])
    return result
  }

  /**
   * T10 #80：继续追问 —— review 的人消息复用原 Assignment 回到 working；
   * 与接管输入同一套 requestId 对账（主进程先落库再投递）。
   */
  async function messageTicket(
    repoRoot: string,
    command: SuperAgentTicketMessageCommand,
  ): Promise<SuperAgentTicketMessageResult> {
    const result = await api.superAgent.ticketMessage(repoRoot, command)
    await loadTickets(repoRoot)
    return result
  }

  /** T10 #80：人工重试 —— 只对 delivery/blocked/failed 开放，重试 generation+1。 */
  async function retryTicket(
    repoRoot: string,
    ticketId: string,
  ): Promise<SuperAgentTicketRetryResult> {
    const result = await api.superAgent.ticketRetry(repoRoot, { ticketId })
    await Promise.all([loadState(repoRoot), loadTickets(repoRoot), loadQueue(repoRoot)])
    return result
  }

  /**
   * T20 #90：重新评估 unavailable Eval —— Trigger 回队、计数清零；
   * 成功后重拉健康报告（eval 主体项随之解除），状态回显。
   */
  async function reevaluateEval(
    repoRoot: string,
    evalId: string,
  ): Promise<SuperAgentEvalReevaluateResult> {
    const result = await api.superAgent.evalReevaluate(repoRoot, { evalId })
    await loadHealth(repoRoot)
    return result
  }

  /**
   * T20 #90：忽略健康问题 —— eval 主体同时释放对应 Eval；响应即最新报告
   * （含处置审计），直接写回镜像。
   */
  async function dismissProblem(
    repoRoot: string,
    category: SuperAgentHealthCategory,
    subjectId: string | null,
  ): Promise<SuperAgentHealthReport> {
    const report = await api.superAgent.problemDismiss(repoRoot, {
      category,
      ...(subjectId !== null ? { subjectId } : {}),
    })
    healthReport.value = report
    return report
  }

  /** T20 #90：重试健康项 —— 清零连续失败计数；响应即最新报告。 */
  async function retryHealthProblem(
    repoRoot: string,
    category: SuperAgentHealthCategory,
    subjectId: string | null,
  ): Promise<SuperAgentHealthReport> {
    const report = await api.superAgent.healthRetry(repoRoot, {
      category,
      ...(subjectId !== null ? { subjectId } : {}),
    })
    healthReport.value = report
    return report
  }

  /** 订阅 health.changed；只接受当前绑定项目的报告，返回退订函数。 */
  function watchHealth(): () => void {
    return api.superAgent.onHealthChanged((repoRoot, report) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      healthReport.value = report
    })
  }

  /** 订阅 queue-changed；只接受当前绑定项目的队列快照，返回退订函数。 */
  function watchQueue(): () => void {
    return api.superAgent.onQueueChanged((repoRoot, next) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      queue.value = next
    })
  }

  /**
   * 代次一变就重拉已绑定的 Worker 镜像。
   *
   * 镜像没有推送通道：`running` 与代次分段只在 bindWorker 时取一次快照。人工重试、
   * Router 的 retry、重启恢复都会把 generation+1，不重拉的话右侧面板继续停在上一代
   * 结束后的"空闲" —— 人以为重跑根本没发生。
   */
  function syncStaleWorkerMirrors(
    repoRoot: string,
    tickets: readonly SuperAgentTicketCard[],
  ): void {
    for (const [ticketId, mirror] of Object.entries(workerMirrors.value)) {
      const card = tickets.find((item) => item.ticketId === ticketId)
      if (!card) continue
      const mirrored = mirror.segments.reduce((max, segment) => Math.max(max, segment.generation), 0)
      if (card.generation !== mirrored) void bindWorker(repoRoot, ticketId)
    }
  }

  /**
   * 订阅 ticket-updated / ticket-progress（T06 #76），返回退订函数。
   *
   * 领域断档重拉：ticket-updated 携带 fromSeq/toSeq，fromSeq 与本地水位不一致
   * 说明有事件丢失（如窗口休眠），全量重拉 tickets；一致则直接应用全量卡片
   * （幂等）。进度断档不重拉：ticket-progress 只保留各工单最新一份，中间
   * 丢弃的进度不重放。
   */
  function watchTickets(): () => void {
    const offUpdated = api.superAgent.onTicketUpdated((repoRoot, event) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      const board = ticketBoard.value
      if (!board || event.fromSeq !== board.seq) {
        void loadTickets(repoRoot)
        return
      }
      ticketBoard.value = { repoRoot, seq: event.toSeq, tickets: event.tickets }
      syncStaleWorkerMirrors(repoRoot, event.tickets)
    })
    const offProgress = api.superAgent.onTicketProgress((repoRoot, progress) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      ticketProgress.value = { ...ticketProgress.value, [progress.ticketId]: progress }
    })
    return () => {
      offUpdated()
      offProgress()
    }
  }

  /** 订阅 takeover-changed（T09 #79）；只接受当前绑定项目的事件，返回退订函数。 */
  function watchTakeover(): () => void {
    return api.superAgent.onTakeoverChanged((repoRoot, event) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      takeover.value = event.takeover
      // 各工单镜像的 takenOver 跟随事件同步（含其他面板触发的接管/交还）
      const next = event.takeover
      for (const [ticketId, mirror] of Object.entries(workerMirrors.value)) {
        const takenOver = next?.ticketId === ticketId
        if (mirror.takenOver !== takenOver) {
          workerMirrors.value[ticketId] = { ...mirror, takenOver }
        }
      }
    })
  }

  /**
   * 订阅 attention-asked / answered / withdrawn（T08 #78），返回退订函数。
   *
   * 三个事件的 payload 都携带全量视图与按工单去重的待处理数，直接应用即幂等，
   * 不需要水位对账；只接受当前绑定项目的事件。
   */
  function watchAttentions(): () => void {
    const apply = (repoRoot: string, attentions: SuperAgentAttentionView[], pendingTickets: number) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      attentionBoard.value = { repoRoot, attentions, pendingTickets }
    }
    const offAsked = api.superAgent.onAttentionAsked((repoRoot, event) => {
      apply(repoRoot, event.attentions, event.pendingTickets)
    })
    const offAnswered = api.superAgent.onAttentionAnswered((repoRoot, event) => {
      apply(repoRoot, event.attentions, event.pendingTickets)
    })
    const offWithdrawn = api.superAgent.onAttentionWithdrawn((repoRoot, event) => {
      apply(repoRoot, event.attentions, event.pendingTickets)
    })
    return () => {
      offAsked()
      offAnswered()
      offWithdrawn()
    }
  }

  function toggleHealthPanel(): void {
    healthPanelOpen.value = !healthPanelOpen.value
  }

  return {
    snapshot,
    boundSessionId,
    boundRepoRoot,
    routerRunning,
    attentionCount,
    healthReport,
    healthProblemCount,
    healthProblems,
    healthPanelOpen,
    queue,
    executionPolicy,
    checkpointInfo,
    ticketBoard,
    ticketProgress,
    workerMirrors,
    takeover,
    takeoverTicketId,
    attentionBoard,
    attentionBubbles,
    openAttentions,
    reviewReminders,
    reviewRemindedCount,
    bind,
    switchProject,
    sendRouterMessage,
    abortRouter,
    watchRouterStatus,
    loadState,
    loadHealth,
    dispatch,
    loadQueue,
    loadPolicy,
    setPolicy,
    loadCheckpoint,
    rollbackCheckpointFiles,
    loadTickets,
    loadAttentions,
    answerAttention,
    acceptTicket,
    stopTicket,
    messageTicket,
    retryTicket,
    reevaluateEval,
    dismissProblem,
    retryHealthProblem,
    bindWorker,
    unbindWorker,
    takeoverWorker,
    releaseWorker,
    sendWorkerMessage,
    watchHealth,
    watchQueue,
    watchTickets,
    watchTakeover,
    watchAttentions,
    toggleHealthPanel,
  }
})
