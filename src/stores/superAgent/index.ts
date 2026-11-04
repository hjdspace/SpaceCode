/**
 * Super Agent renderer store（T01 #71 骨架）。
 *
 * bind 走主进程的幂等 routerBind，并把 Router 会话以 sessionType='superAgent'
 * 登记进 chatSession —— 普通侧边栏按类型过滤，因此不会出现这条会话。
 * snapshot 是主进程投影的只读副本；attentionCount 供入口徽章使用。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'
import type { SuperAgentBindResult, SuperAgentSnapshot } from '@/shared/channels/superAgent'
import { useChatSessionStore } from '../chatSession'

export const useSuperAgentStore = defineStore('superAgent', () => {
  const snapshot = ref<SuperAgentSnapshot | null>(null)
  const boundSessionId = ref<string | null>(null)

  const attentionCount = computed(() => snapshot.value?.attention.unanswered ?? 0)

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

  return {
    snapshot,
    boundSessionId,
    attentionCount,
    bind,
    loadState,
  }
})
