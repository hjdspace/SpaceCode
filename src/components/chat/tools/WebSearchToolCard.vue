<template>
  <div class="search-tool-card" :class="[statusClass]">
    <div class="search-header" @click="toggleExpand">
      <div class="search-icon-wrapper"><Search :size="14" /></div>
      <span class="search-label">WebSearch</span>
      <span class="search-query">{{ queryDisplay }}</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded" class="search-body">
      <div v-if="toolCall.output" class="search-results">
        <div class="block-label">Results</div>
        <pre class="results-content"><code>{{ toolCall.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Search, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const queryDisplay = computed(() => {
  const q = props.toolCall.input?.query || ''
  return q.length > 60 ? q.slice(0, 60) + '...' : q
})
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.search-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.search-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.search-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(249, 115, 22, 0.12); color: #fb923c; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.search-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #fb923c; flex-shrink: 0; }
.search-query { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.search-body { border-top: 1px solid var(--surface-border); }
.search-results { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.results-content { margin: 0; padding: 10px 12px; border-radius: 4px; font-size: 12px; line-height: 1.7; overflow: auto; max-height: 500px; white-space: pre-wrap; background: #0d1117; color: #f0f6fc; word-break: break-word; }
</style>
