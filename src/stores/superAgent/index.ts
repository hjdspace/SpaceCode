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
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'
import type {
  SuperAgentBindResult,
  SuperAgentDispatchCommand,
  SuperAgentDispatchResult,
  SuperAgentHealthReport,
  SuperAgentQueueSnapshot,
  SuperAgentSnapshot,
  SuperAgentWorkerMirror,
} from '@/shared/channels/superAgent'
import { useChatSessionStore } from '../chatSession'

export const useSuperAgentStore = defineStore('superAgent', () => {
  const snapshot = ref<SuperAgentSnapshot | null>(null)
  const boundSessionId = ref<string | null>(null)
  const healthReport = ref<SuperAgentHealthReport | null>(null)
  const healthPanelOpen = ref(false)
  const queue = ref<SuperAgentQueueSnapshot | null>(null)
  /** Worker 只读镜像快照，按 ticketId 索引；标签页并存时各取各的。 */
  const workerMirrors = ref<Record<string, SuperAgentWorkerMirror>>({})

  const attentionCount = computed(() => snapshot.value?.attention.unanswered ?? 0)
  const healthProblemCount = computed(() => healthReport.value?.problemCount ?? 0)
  /** 面板问题列表：error 级且未由工单卡片呈现的项。 */
  const healthProblems = computed(() =>
    (healthReport.value?.items ?? []).filter(
      (item) => item.status === 'error' && !item.reflectedOnTicket,
    ),
  )

  function ensureRouterSession(sessionId: string, repoRoot: string): void {
    const chat = useChatSessionStore()
    const existing = chat.sessions.find(item => item.id === sessionId)
    if (existing) return
    chat.createSession(i18n.global.t('superAgent.title'), repoRoot, sessionId, {
      sessionType: 'superAgent',
      activate: false,
    })
  }

  /** Worker 稳定会话登记：不激活、不进侧边栏；已存在则跳过。 */
  function ensureWorkerSession(mirror: SuperAgentWorkerMirror): void {
    const chat = useChatSessionStore()
    const existing = chat.sessions.find(item => item.id === mirror.sessionId)
    if (existing) return
    chat.createSession(mirror.title, mirror.repoRoot, mirror.sessionId, {
      sessionType: 'superAgentWorker',
      activate: false,
    })
  }

  async function bind(repoRoot: string): Promise<SuperAgentBindResult> {
    const result = await api.superAgent.routerBind(repoRoot)
    boundSessionId.value = result.sessionId
    snapshot.value = result.snapshot
    ensureRouterSession(result.sessionId, repoRoot)
    return result
  }

  async function loadState(repoRoot: string): Promise<SuperAgentSnapshot> {
    const next = await api.superAgent.state(repoRoot)
    snapshot.value = next
    return next
  }

  async function loadHealth(repoRoot: string): Promise<SuperAgentHealthReport> {
    const next = await api.superAgent.health(repoRoot)
    healthReport.value = next
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
    queue.value = next
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
    return mirror
  }

  /** 只停镜像并清掉本地快照；Worker 会话与转录保留，后台推进不受影响。 */
  async function unbindWorker(repoRoot: string, ticketId: string): Promise<void> {
    await api.superAgent.workerUnbind(repoRoot, ticketId)
    delete workerMirrors.value[ticketId]
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

  function toggleHealthPanel(): void {
    healthPanelOpen.value = !healthPanelOpen.value
  }

  return {
    snapshot,
    boundSessionId,
    attentionCount,
    healthReport,
    healthProblemCount,
    healthProblems,
    healthPanelOpen,
    queue,
    workerMirrors,
    bind,
    loadState,
    loadHealth,
    dispatch,
    loadQueue,
    bindWorker,
    unbindWorker,
    watchHealth,
    watchQueue,
    toggleHealthPanel,
  }
})
