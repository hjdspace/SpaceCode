<template>
  <div class="read-tool-card" :class="[statusClass]">
    <div class="read-header" @click="toggleExpand">
      <div class="read-icon-wrapper"><FileText :size="14" /></div>
      <span class="read-label">Read</span>
      <span class="read-file-path">{{ filePath }}</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-show="isExpanded" class="read-body">
      <div class="read-meta-row">
        <span class="meta-item" v-if="offset"><ArrowUp :size="11" /> Line {{ offset }}</span>
        <span class="meta-item" v-if="limit"><ArrowDown :size="11" /> {{ limit }} lines</span>
        <span class="meta-item"><FileOutput :size="11" /> {{ outputLines }} lines</span>
      </div>
      <pre class="code-content"><code>{{ toolCall.output || '(empty file)' }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileText, ChevronDown, ArrowUp, ArrowDown, FileOutput } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || 'unknown')
const offset = computed(() => props.toolCall.input?.offset)
const limit = computed(() => props.toolCall.input?.limit)
const outputLines = computed(() => (props.toolCall.output || '').split('\n').length)
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.read-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.read-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.read-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(59, 130, 246, 0.12); color: #60a5fa; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.read-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #60a5fa; flex-shrink: 0; }
.read-file-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.read-body { border-top: 1px solid var(--surface-border); }
.read-meta-row { display: flex; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--surface-border); }
.meta-item { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-tertiary); }
.code-content { margin: 0; padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.6; overflow-x: auto; white-space: pre; tab-size: 2; max-height: 500px; overflow-y: auto; background: #0d1117; color: #f0f6fc; border-radius: 4px; }
</style>
