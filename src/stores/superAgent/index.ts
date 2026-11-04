/**
 * Super Agent renderer store（T01 #71 骨架，T13 #83 健康面板）。
 *
 * bind 走主进程的幂等 routerBind，并把 Router 会话以 sessionType='superAgent'
 * 登记进 chatSession —— 普通侧边栏按类型过滤，因此不会出现这条会话。
 * snapshot 是主进程投影的只读副本；attentionCount 供入口徽章使用。
 *
 * T13：healthReport 只读镜像来自 health 通道 + health.changed 事件（只接受
 * 当前绑定项目的报告）；面板问题列表只含 error 且未反映在工单卡片的项，
 * 单次抖动（degraded）不上面板、不打扰人。面板只读，无处置动作。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'
import type { SuperAgentBindResult, SuperAgentHealthReport, SuperAgentSnapshot } from '@/shared/channels/superAgent'
import { useChatSessionStore } from '../chatSession'

export const useSuperAgentStore = defineStore('superAgent', () => {
  const snapshot = ref<SuperAgentSnapshot | null>(null)
  const boundSessionId = ref<string | null>(null)
  const healthReport = ref<SuperAgentHealthReport | null>(null)
  const healthPanelOpen = ref(false)

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

  /** 订阅 health.changed；只接受当前绑定项目的报告，返回退订函数。 */
  function watchHealth(): () => void {
    return api.superAgent.onHealthChanged((repoRoot, report) => {
      if (snapshot.value?.repoRoot !== repoRoot) return
      healthReport.value = report
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
    bind,
    loadState,
    loadHealth,
    watchHealth,
    toggleHealthPanel,
  }
})
