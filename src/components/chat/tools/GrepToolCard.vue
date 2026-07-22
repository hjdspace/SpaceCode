<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <TextSearch v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.grep') }}</span>
      <template v-if="query">
        <span class="tool-separator">·</span>
        <code class="tool-target">{{ query }}</code>
      </template>
      <span v-if="matchCount !== null" class="tool-meta">{{ matchCount }} {{ t('toolCards.grepMatches') }}</span>
      <div class="tool-actions">
        <button
          class="action-btn"
          @click.stop="openInPanel"
          :title="t('infoPanel.openInPanel')"
        >
          <ExternalLink :size="14" />
        </button>
        <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
      </div>
    </div>
    <div v-if="isExpanded" class="tool-body">
      <div class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.grepResults') }}</div>
        <div class="tool-section-body">
          <pre class="search-results"><code>{{ formattedOutput }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { TextSearch, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const query = computed(() => props.toolCall.input?.query || props.toolCall.input?.pattern || '')
const matchCount = computed(() => {
  const out = props.toolCall.output || ''
  if (!out || out.includes('No matches found')) return 0
  const lines = out.split('\n').filter(l => l.includes(':'))
  return lines.length
})
const formattedOutput = computed(() => props.toolCall.output || t('toolCards.grepNoResults'))
function toggleExpand() { isExpanded.value = !isExpanded.value }

function openInPanel() {
  const q = props.toolCall.input?.query || props.toolCall.input?.pattern || ''
  appStore.showToolDiff({
    type: 'grep',
    filePath: `Grep: ${q}`,
    originalContent: '',
    modifiedContent: '',
    toolCallId: props.toolCall.id,
    language: 'text',
    displayContent: props.toolCall.output || '',
    searchQuery: q,
  })
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.search-results {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 400px;
  white-space: pre;
  background: var(--code-bg, #0d1117);
  color: var(--code-fg, #f0f6fc);
  border-radius: 6px;
}
</style>
