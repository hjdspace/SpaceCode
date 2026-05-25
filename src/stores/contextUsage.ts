import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ContextUsageData, ContextUsageSnapshot } from '@/types/contextUsage'
import {
  buildFallbackSnapshot,
  buildSnapshotFromEngineData,
  enrichContextDataFromClient,
} from '@/utils/contextUsage'
import { api } from '@/services/electronAPI'
import { useChatStore } from '@/stores/chat'
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

const CONTEXT_USAGE_FETCH_RETRIES = 1
const CONTEXT_USAGE_RETRY_DELAY_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchEngineContextUsage(sessionId: string): Promise<Record<string, unknown> | undefined> {
  for (let attempt = 0; attempt <= CONTEXT_USAGE_FETCH_RETRIES; attempt++) {
    try {
      const raw = await api.getContextUsage(sessionId)
      if (raw) return raw
    } catch {
      if (attempt >= CONTEXT_USAGE_FETCH_RETRIES) break
      await sleep(CONTEXT_USAGE_RETRY_DELAY_MS)
    }
  }
  return undefined
}

export const useContextUsageStore = defineStore('contextUsage', () => {
  const snapshot = ref<ContextUsageSnapshot | null>(null)
  const loading = ref(false)
  const lastFetchedSessionId = ref<string | null>(null)

  const hasData = computed(() => snapshot.value != null)

  async function refresh(sessionId?: string, force = false) {
    const chatStore = useChatStore()
    const settingsStore = useSettingsStore()
    const sid = sessionId ?? chatStore.currentSessionId
    if (!sid) {
      snapshot.value = null
      return
    }

    if (!force && lastFetchedSessionId.value === sid && snapshot.value && !loading.value) {
      return
    }

    const model = settingsStore.config.model || 'claude-sonnet-4-6'
    const session = chatStore.sessions.find(s => s.id === sid)
    const messages = session?.messages ?? []

    if (lastFetchedSessionId.value !== sid) {
      snapshot.value = null
    }

    // Show client-side estimate immediately so the modal/chip never spin for minutes.
    snapshot.value = buildFallbackSnapshot(messages, model)

    loading.value = true
    lastFetchedSessionId.value = sid

    try {
      if (settingsStore.engineType === 'claude-code') {
        const raw = await fetchEngineContextUsage(sid)
        const data = raw ? parseEngineContextData(raw as Record<string, unknown>) : null
        if (data) {
          const enriched = enrichContextDataFromClient(data, messages)
          snapshot.value = buildSnapshotFromEngineData(enriched, model)
        }
      }
    } catch {
      // Keep optimistic fallback snapshot.
    } finally {
      loading.value = false
    }
  }

  function clear() {
    snapshot.value = null
    lastFetchedSessionId.value = null
  }

  return {
    snapshot,
    loading,
    hasData,
    refresh,
    clear,
  }
})
