import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ContextUsageSnapshot } from '@/types/contextUsage'
import { buildFallbackSnapshot } from '@/utils/contextUsage'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { useSettingsStore } from '@/stores/settings'

export const useContextUsageStore = defineStore('contextUsage', () => {
  const snapshot = ref<ContextUsageSnapshot | null>(null)
  const lastFetchedSessionId = ref<string | null>(null)
  const isCompacting = ref(false)

  const hasData = computed(() => snapshot.value != null)

  /**
   * Start a manual context compaction by sending /compact to the engine.
   * Runs in the background — the modal can be closed while compaction
   * is in progress. When done, refreshes the context snapshot.
   */
  function startCompact() {
    if (isCompacting.value) return
    const turnStore = useTurnStore()
    isCompacting.value = true

    turnStore
      .sendMessage('/compact')
      .then(() => {
        // Compaction completed — refresh context data
        return refresh()
      })
      .catch(() => {
        // Compaction failed — still clear the flag
      })
      .finally(() => {
        isCompacting.value = false
      })
  }

  /**
   * 快照全部由客户端算: 每轮 API 的真实 usage 落在消息 metadata 上, 窗口来自设置页,
   * 分类明细由 buildFallbackSnapshot 用「真实总量 − 对话估算」摊出并标 isEstimated.
   * 这里不发 get_context_usage 控制请求 —— CLI 的 stdin 循环是串行的, 那个请求会占住
   * 循环几分钟, 把用户消息堵在后面.
   */
  function refresh(sessionId?: string) {
    const sid = sessionId ?? useChatSessionStore().currentSessionId
    if (!sid) {
      snapshot.value = null
      lastFetchedSessionId.value = null
      return
    }

    snapshot.value = buildSnapshotForSession(sid)
    lastFetchedSessionId.value = sid
  }

  function buildSnapshotForSession(sid: string): ContextUsageSnapshot {
    const sessionStore = useChatSessionStore()
    const settingsStore = useSettingsStore()
    const session = sessionStore.sessions.find(s => s.id === sid)
    const model = session?.model || settingsStore.config.model || 'claude-sonnet-4-6'
    const userCtxOverride = settingsStore.getContextWindowOverride(model)
    return buildFallbackSnapshot(session?.messages ?? [], model, userCtxOverride)
  }

  function clear() {
    snapshot.value = null
    lastFetchedSessionId.value = null
  }

  /**
   * Streaming-time update. Same computation as {@link refresh}, but refuses to
   * adopt a session other than the one currently displayed.
   */
  function applyFallback(sessionId?: string) {
    const sid = sessionId ?? useChatSessionStore().currentSessionId
    if (!sid) return
    if (lastFetchedSessionId.value && lastFetchedSessionId.value !== sid) return
    snapshot.value = buildSnapshotForSession(sid)
    lastFetchedSessionId.value = sid
  }

  return {
    snapshot,
    hasData,
    isCompacting,
    refresh,
    applyFallback,
    clear,
    startCompact,
  }
})
