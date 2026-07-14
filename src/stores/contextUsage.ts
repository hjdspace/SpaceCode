import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ContextUsageData, ContextUsageSnapshot } from '@/types/contextUsage'
import {
  buildFallbackSnapshot,
  buildSnapshotFromEngineData,
  enrichContextDataFromClient,
} from '@/utils/contextUsage'
import { api } from '@/services/electronAPI'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { useSettingsStore } from '@/stores/settings'

function parseEngineContextData(raw: Record<string, unknown>): ContextUsageData | null {
  if (!raw || typeof raw.totalTokens !== 'number') return null
  const data: ContextUsageData = {
    categories: Array.isArray(raw.categories)
      ? (raw.categories as ContextUsageData['categories'])
      : [],
    totalTokens: raw.totalTokens as number,
    maxTokens: (raw.maxTokens as number) ?? 0,
    rawMaxTokens: (raw.rawMaxTokens as number) ?? 200_000,
    percentage: (raw.percentage as number) ?? 0,
    model: String(raw.model ?? ''),
    autoCompactThreshold: raw.autoCompactThreshold as number | undefined,
    isAutoCompactEnabled: Boolean(raw.isAutoCompactEnabled ?? true),
    apiUsage: (raw.apiUsage as ContextUsageData['apiUsage']) ?? null,
    messageBreakdown: raw.messageBreakdown as ContextUsageData['messageBreakdown'],
    memoryFiles: raw.memoryFiles as ContextUsageData['memoryFiles'],
    mcpTools: raw.mcpTools as ContextUsageData['mcpTools'],
    agents: raw.agents as ContextUsageData['agents'],
    skills: raw.skills as ContextUsageData['skills'],
  }
  return data
}

const CONTEXT_USAGE_FETCH_TIMEOUT_MS = 3_500

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs)
    promise
      .then(value => resolve(value))
      .catch(() => resolve(undefined))
      .finally(() => clearTimeout(timer))
  })
}

async function fetchEngineContextUsage(sessionId: string): Promise<Record<string, unknown> | undefined> {
  return withTimeout(api.getContextUsage(sessionId), CONTEXT_USAGE_FETCH_TIMEOUT_MS)
}

export const useContextUsageStore = defineStore('contextUsage', () => {
  const snapshot = ref<ContextUsageSnapshot | null>(null)
  const loading = ref(false)
  const lastFetchedSessionId = ref<string | null>(null)
  const activeRequestSessionId = ref<string | null>(null)
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
        return refresh(undefined, true)
      })
      .catch(() => {
        // Compaction failed — still clear the flag
      })
      .finally(() => {
        isCompacting.value = false
      })
  }

  async function refresh(sessionId?: string, force = false) {
    const sessionStore = useChatSessionStore()
    const settingsStore = useSettingsStore()
    const sid = sessionId ?? sessionStore.currentSessionId
    if (!sid) {
      snapshot.value = null
      return
    }

    if (!force && lastFetchedSessionId.value === sid && snapshot.value && !loading.value) {
      return
    }
    if (loading.value && activeRequestSessionId.value === sid) {
      return
    }

    const model = settingsStore.config.model || 'claude-sonnet-4-6'
    const userCtxOverride = settingsStore.modelContextWindows[model]
    const session = sessionStore.sessions.find(s => s.id === sid)
    const messages = session?.messages ?? []

    if (lastFetchedSessionId.value !== sid) {
      snapshot.value = null
    }

    // Show client-side estimate immediately so the modal/chip never spin for minutes.
    snapshot.value = buildFallbackSnapshot(messages, model, userCtxOverride)

    loading.value = true
    lastFetchedSessionId.value = sid
    activeRequestSessionId.value = sid

    try {
      if (settingsStore.engineType === 'claude-code') {
        const raw = await fetchEngineContextUsage(sid)
        const data = raw ? parseEngineContextData(raw as Record<string, unknown>) : null
        if (data) {
          const enriched = enrichContextDataFromClient(data, messages)
          snapshot.value = buildSnapshotFromEngineData(enriched, model, userCtxOverride)
        }
      }
    } catch {
      // Keep optimistic fallback snapshot.
    } finally {
      if (activeRequestSessionId.value === sid) {
        loading.value = false
        activeRequestSessionId.value = null
      }
    }
  }

  function clear() {
    snapshot.value = null
    lastFetchedSessionId.value = null
    activeRequestSessionId.value = null
    loading.value = false
  }

  /**
   * Lightweight, synchronous snapshot update derived solely from the chat
   * store's messages. Intended for live updates while the assistant is
   * streaming so the chip/modal can move with the response without
   * incurring an engine IPC roundtrip on every assistant event.
   */
  function applyFallback(sessionId?: string) {
    const sessionStore = useChatSessionStore()
    const settingsStore = useSettingsStore()
    const sid = sessionId ?? sessionStore.currentSessionId
    if (!sid) return
    // Only update if it matches the currently displayed session to avoid
    // overwriting another session's authoritative snapshot.
    if (lastFetchedSessionId.value && lastFetchedSessionId.value !== sid) return
    const session = sessionStore.sessions.find(s => s.id === sid)
    const messages = session?.messages ?? []
    const model = settingsStore.config.model || 'claude-sonnet-4-6'
    const userCtxOverride = settingsStore.modelContextWindows[model]
    snapshot.value = buildFallbackSnapshot(messages, model, userCtxOverride)
    lastFetchedSessionId.value = sid
  }

  return {
    snapshot,
    loading,
    hasData,
    isCompacting,
    refresh,
    applyFallback,
    clear,
    startCompact,
  }
})
