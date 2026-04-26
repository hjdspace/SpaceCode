<template>
  <div class="tool-call-card" :class="[statusClass, { 'is-expanded': isExpanded }]">
    <div class="tool-call-header" @click="toggleExpand">
      <div class="tool-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <Check v-else-if="toolCall.status === 'completed'" :size="14" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Terminal v-else :size="14" />
      </div>
      <span class="tool-name">{{ displayName }}</span>
      <span v-if="duration" class="tool-duration">{{ duration }}s</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    
    <div v-show="isExpanded" class="tool-call-details">
      <div class="tool-section">
        <div class="section-label">Input</div>
        <pre class="code-block"><code>{{ formattedInput }}</code></pre>
      </div>
      
      <div v-if="toolCall.output" class="tool-section">
        <div class="section-label">Output</div>
        <pre class="code-block"><code>{{ formattedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Loader2, Check, X, Terminal, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  toolCall: ToolCall
}>()

const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)

// 简化工具名称显示
const displayName = computed(() => {
  const name = props.toolCall.name
  // 移除常见的工具前缀
  return name
    .replace(/^(Read|Edit|Write|Glob|Grep|Bash|Search|CodebaseSearch)_?/i, '')
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim() || name
})

const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})

const formattedInput = computed(() => {
  // 简化显示，对于简单输入
  const input = props.toolCall.input
  if (input.path && Object.keys(input).length <= 2) {
    return input.path
  }
  if (input.command && Object.keys(input).length <= 2) {
    return input.command
  }
  if (input.query && Object.keys(input).length <= 2) {
    return input.query
  }
  return JSON.stringify(input, null, 2)
})

const formattedOutput = computed(() => {
  if (!props.toolCall.output) return ''
  // 截断过长的输出
  const maxLen = 500
  let output = props.toolCall.output
  try {
    const parsed = JSON.parse(output)
    output = JSON.stringify(parsed, null, 2)
  } catch {
    // 保持原样
  }
  if (output.length > maxLen) {
    return output.slice(0, maxLen) + '\n... (truncated)'
  }
  return output
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
.tool-call-card {
  border-radius: 4px;
  background: transparent;
  overflow: hidden;
  transition: all var(--transition-fast);
  font-size: 13px;

  &.is-expanded {
    background: var(--bg-secondary);
    border: 1px solid var(--surface-border);
  }

  &:not(.is-expanded) {
    .tool-call-header:hover {
      background: var(--surface-glass-hover);
    }
  }
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: all var(--transition-fast);
}

.tool-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.6;

  .status-running & {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  .status-completed & {
    color: var(--success);
    opacity: 0.7;
  }

  .status-error & {
    color: var(--error);
    opacity: 0.8;
  }
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 450;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-duration {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  opacity: 0.7;
}

.expand-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.5;
  transition: transform var(--transition-fast), opacity var(--transition-fast);

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.tool-call-header:hover .expand-icon {
  opacity: 0.8;
}

.tool-call-details {
  padding: 8px 8px 12px 28px;
  border-top: 1px solid var(--surface-border);
}

.tool-section {
  margin-top: 10px;

  &:first-child {
    margin-top: 0;
  }
}

.section-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.code-block {
  background: var(--surface-glass);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  line-height: 1.5;
}
</style>
