<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <SearchCode v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.searchExtraTools') }}</span>
      <span class="tool-separator">·</span>
      <span class="tool-target">{{ query }}</span>
      <span v-if="matchCount !== null" class="tool-meta">{{ matchCount }} {{ t('toolCards.searchExtraToolsMatches') }}</span>
      <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-if="isExpanded" class="tool-body">
      <div class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.searchExtraToolsResults') }}</div>
        <div class="tool-section-body">
          <div v-if="outputData" class="result-grid">
            <div class="result-row">
              <span class="result-label">{{ t('toolCards.searchExtraToolsQuery') }}</span>
              <span class="result-value">{{ outputData.query }}</span>
            </div>
            <div v-if="outputData.matches?.length" class="result-row">
              <span class="result-label">{{ t('toolCards.searchExtraToolsMatches') }}</span>
              <ul class="tool-name-list">
                <li v-for="name in outputData.matches" :key="name" class="tool-name-item">
                  <code>{{ name }}</code>
                </li>
              </ul>
            </div>
            <div v-if="outputData.already_loaded?.length" class="result-row">
              <span class="result-label">{{ t('toolCards.searchExtraToolsAlreadyLoaded') }}</span>
              <ul class="tool-name-list">
                <li v-for="name in outputData.already_loaded" :key="name" class="tool-name-item loaded">
                  <code>{{ name }}</code>
                </li>
              </ul>
            </div>
            <div v-if="outputData.pending_mcp_servers?.length" class="result-row">
              <span class="result-label">{{ t('toolCards.searchExtraToolsPendingServers') }}</span>
              <ul class="tool-name-list">
                <li v-for="name in outputData.pending_mcp_servers" :key="name" class="tool-name-item pending">
                  <code>{{ name }}</code>
                </li>
              </ul>
            </div>
            <div class="result-row">
              <span class="result-label">{{ t('toolCards.searchExtraToolsTotal') }}</span>
              <span class="result-value">{{ outputData.total_deferred_tools }}</span>
            </div>
          </div>
          <pre v-else class="fallback-output"><code>{{ toolCall.output || t('toolCards.searchExtraToolsNoResults') }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { SearchCode, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface SearchExtraToolsOutput {
  query: string
  matches?: string[]
  total_deferred_tools: number
  pending_mcp_servers?: string[]
  already_loaded?: string[]
}

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const query = computed(() => props.toolCall.input?.query || '')

const outputData = computed<SearchExtraToolsOutput | null>(() => {
  const output = props.toolCall.output
  if (!output) return null
  try {
    const parsed = JSON.parse(output) as SearchExtraToolsOutput
    if (parsed && typeof parsed.query === 'string' && typeof parsed.total_deferred_tools === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
})

const matchCount = computed(() => {
  const matches = outputData.value?.matches
  return Array.isArray(matches) ? matches.length : null
})

function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.result-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.result-value {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.tool-name-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-name-item {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--surface-glass);
  font-size: 12px;
  color: var(--text-secondary);

  &.loaded {
    background: rgba(34, 197, 94, 0.1);
    color: var(--success);
  }

  &.pending {
    background: rgba(234, 179, 8, 0.1);
    color: var(--warning);
  }
}

.fallback-output {
  margin: 0;
}
</style>
