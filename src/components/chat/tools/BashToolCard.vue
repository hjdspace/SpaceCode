<template>
  <div class="bash-tool-card" :class="[statusClass]">
    <div class="bash-header" @click="toggleExpand">
      <div class="bash-icon-wrapper"><Terminal :size="14" /></div>
      <span class="bash-label">Bash</span>
      <span v-if="commandPreview" class="bash-cmd-preview">{{ commandPreview }}</span>
      <span v-if="duration" class="bash-duration">{{ duration }}s</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-show="isExpanded" class="bash-body">
      <div class="bash-command-block">
        <div class="block-label">$ Command</div>
        <pre class="code-block command-text"><code>{{ toolCall.input.command }}</code></pre>
      </div>

      <div v-if="toolCall.output" class="bash-output-block">
        <div class="block-label">Output</div>
        <pre class="code-block output-text" :class="{ 'error-output': toolCall.status === 'error' }"><code>{{ truncatedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Terminal, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)
const commandPreview = computed(() => {
  const cmd = props.toolCall.input?.command
  if (!cmd) return null
  return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd
})
const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})
const MAX_OUTPUT_LEN = 3000
const truncatedOutput = computed(() => {
  const out = props.toolCall.output || ''
  if (out.length <= MAX_OUTPUT_LEN) return out
  return out.slice(0, MAX_OUTPUT_LEN) + '\n... (output truncated)'
})
function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.bash-tool-card {
  border-radius: 6px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden; font-size: 13px;
}
.bash-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.03); }
}
.bash-icon-wrapper {
  width: 22px; height: 22px; border-radius: 4px;
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.bash-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #4ade80; flex-shrink: 0; }
.bash-cmd-preview { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); }
.bash-duration { color: var(--text-tertiary); font-size: 11px; flex-shrink: 0; }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }

.bash-body { border-top: 1px solid var(--surface-border); }
.bash-command-block, .bash-output-block { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.code-block { margin: 0; padding: 10px 12px; border-radius: 4px; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
.command-text { background: #0d1117; color: #f0f6fc; }
.output-text { background: #0d1117; color: #c9d1d9; max-height: 400px; overflow-y: auto; }
.error-output { color: #f87171; background: rgba(248,113,113,0.08); }

.status-running .bash-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; animation: spin 1s linear infinite; }
.status-error .bash-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
