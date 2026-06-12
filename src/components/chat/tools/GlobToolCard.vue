<template>
  <div class="glob-tool-card" :class="[statusClass]">
    <div class="glob-header" @click="toggleExpand">
      <div class="glob-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Search v-else :size="14" />
      </div>
      <span class="glob-label">Glob</span>
      <code class="glob-pattern">{{ pattern }}</code>
      <span v-if="matchCount !== null" class="glob-count">{{ matchCount }} results</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="glob-body">
      <pre class="file-list"><code>{{ formattedOutput }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Search, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const pattern = computed(() => props.toolCall.input?.pattern || props.toolCall.input?.path || '*')
const matchCount = computed(() => {
  const out = props.toolCall.output || ''
  if (!out || out === 'No matching files') return 0
  return out.split('\n').filter(l => l.trim()).length
})
const formattedOutput = computed(() => props.toolCall.output || 'No results')
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.glob-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.glob-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.glob-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(139, 92, 246, 0.12); color: #a78bfa; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-running .glob-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .glob-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.glob-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #a78bfa; flex-shrink: 0; }
.glob-pattern { font-family: var(--font-mono); font-size: 12px; background: rgba(139,92,246,0.1); padding: 1px 6px; border-radius: 3px; color: #c4b5fd; }
.glob-count { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.glob-body { border-top: 1px solid var(--surface-border); }
.file-list { margin: 0; padding: 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; overflow: auto; max-height: 350px; white-space: pre; background: #0d1117; color: #f0f6fc; border-radius: 4px; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
