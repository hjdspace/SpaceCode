<template>
  <div class="agent-tool-card" :class="[statusClass]">
    <div class="agent-header" @click="toggleExpand">
      <div class="agent-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Bot v-else :size="14" />
      </div>
      <span class="agent-label">Agent</span>
      <span class="agent-type">{{ agentType }}</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-if="isExpanded" class="agent-body">
      <div v-if="description" class="agent-desc-block">
        <div class="block-label">Description</div>
        <p class="desc-text">{{ description }}</p>
      </div>
      <div v-if="toolCall.output" class="agent-result">
        <div class="block-label">Result</div>
        <pre class="code-block"><code>{{ truncatedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Bot, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const agentType = computed(() => props.toolCall.input?.agentType || props.toolCall.input?.type || 'general-purpose')
const description = computed(() => props.toolCall.input?.description || '')
const MAX_OUTPUT = 2000
const truncatedOutput = computed(() => {
  const o = props.toolCall.output || ''
  return o.length > MAX_OUTPUT ? o.slice(0, MAX_OUTPUT) + '\n...' : o
})
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.agent-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.agent-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.agent-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(139, 92, 246, 0.12); color: #a78bfa; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.status-running .agent-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .agent-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.agent-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #a78bfa; flex-shrink: 0; }
.agent-type { font-weight: 600; font-size: 12px; color: #c4b5fd; flex-shrink: 0; }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.agent-body { border-top: 1px solid var(--surface-border); }
.agent-desc-block, .agent-result { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.desc-text { margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.code-block { margin: 0; padding: 10px 12px; border-radius: 4px; font-size: 12px; line-height: 1.5; overflow: auto; max-height: 400px; white-space: pre-wrap; background: #0d1117; color: #f0f6fc; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
