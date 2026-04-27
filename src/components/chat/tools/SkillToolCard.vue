<template>
  <div class="skill-tool-card" :class="[statusClass]">
    <div class="skill-header" @click="toggleExpand">
      <div class="skill-icon-wrapper"><Zap :size="14" /></div>
      <span class="skill-label">Skill</span>
      <span class="skill-name">/{{ skillName }}</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded" class="skill-body">
      <div v-if="promptArg" class="skill-prompt">
        <div class="block-label">Prompt Argument</div>
        <pre><code>{{ promptArg }}</code></pre>
      </div>
      <div v-if="toolCall.output" class="skill-result">
        <div class="block-label">Result</div>
        <pre class="code-block"><code>{{ toolCall.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Zap, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const skillName = computed(() => props.toolCall.input?.skill || props.toolCall.input?.command || 'unknown')
const promptArg = computed(() => props.toolCall.input?.prompt || '')
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.skill-tool-card { border-radius: 6px; background: var(--surface-glass); border: 1px solid var(--surface-border); overflow: hidden; font-size: 13px; }
.skill-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; &:hover { background: rgba(255,255,255,0.03); } }
.skill-icon-wrapper { width: 22px; height: 22px; border-radius: 4px; background: rgba(234, 179, 8, 0.12); color: #fbbf24; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.skill-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #fbbf24; flex-shrink: 0; }
.skill-name { font-weight: 600; font-size: 13px; color: #fcd34d; }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }
.skill-body { border-top: 1px solid var(--surface-border); }
.skill-prompt, .skill-result { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
pre { margin: 0; padding: 8px 10px; border-radius: 4px; font-size: 12px; background: #0d1117; white-space: pre-wrap; color: #f0f6fc; }
.code-block { max-height: 400px; overflow-y: auto; }
</style>
