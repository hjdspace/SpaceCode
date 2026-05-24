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

    loading.value = true
    lastFetchedSessionId.value = sid

    try {
      if (settingsStore.engineType === 'claude-code') {
        const raw = await api.getContextUsage(sid)
        const data = raw ? parseEngineContextData(raw as Record<string, unknown>) : null
        if (data) {
          const enriched = enrichContextDataFromClient(data, messages)
          snapshot.value = buildSnapshotFromEngineData(enriched, model)
          return
        }
      }
      snapshot.value = buildFallbackSnapshot(messages, model)
    } catch {
      snapshot.value = buildFallbackSnapshot(messages, model)
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
