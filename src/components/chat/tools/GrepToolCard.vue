<template>
  <div class="grep-tool-card" :class="[statusClass]">
    <div class="grep-header" @click="toggleExpand">
      <div class="grep-icon-wrapper"><TextSearch :size="14" /></div>
      <span class="grep-label">Grep</span>
      <code class="grep-query">{{ query }}</code>
      <span v-if="matchCount !== null" class="grep-count">{{ matchCount }} matches</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded" class="grep-body">
      <pre class="search-results"><code>{{ formattedOutput }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { TextSearch, ChevronDown, ExternalLink } from 'lucide-vue-next'
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
const formattedOutput = computed(() => props.toolCall.output || 'No results')
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
.grep-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.grep-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.grep-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(139, 92, 246, 0.12); color: #a78bfa; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.grep-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #a78bfa; flex-shrink: 0; }
.grep-query { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(139,92,246,0.1); padding: 1px 6px; border-radius: 3px; color: #c4b5fd; }
.grep-count { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
.panel-btn { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; transition: all 0.15s; &:hover { background: rgba(255,255,255,0.1); color: var(--text-primary); } }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.grep-body { border-top: 1px solid var(--surface-border); }
.search-results { margin: 0; padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; overflow: auto; max-height: 400px; white-space: pre; background: #0d1117; color: #f0f6fc; border-radius: 4px; }
</style>
