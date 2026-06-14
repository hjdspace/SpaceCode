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
      <div v-if="parsedOutput" class="agent-result">
        <div class="block-label">Result</div>
        <div class="result-content">
          <MarkdownRenderer :content="parsedOutput" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Bot, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { parseAgentToolOutput } from '@/services/teamTranscriptService'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const agentType = computed(() => props.toolCall.input?.agentType || props.toolCall.input?.type || 'general-purpose')
const description = computed(() => props.toolCall.input?.description || '')
const MAX_OUTPUT = 4000
const parsedOutput = computed(() => {
  const o = props.toolCall.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  return displayText.length > MAX_OUTPUT ? displayText.slice(0, MAX_OUTPUT) + '\n\n...' : displayText
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
.result-content { padding: 0 12px 12px; max-height: 400px; overflow-y: auto; font-size: 13px; line-height: 1.6; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
