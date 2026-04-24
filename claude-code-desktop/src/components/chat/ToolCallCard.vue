<template>
  <div class="tool-call-card" :class="statusClass">
    <div class="tool-call-header" @click="toggleExpand">
      <div class="tool-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="16" class="spin-icon" />
        <Check v-else-if="toolCall.status === 'completed'" :size="16" />
        <X v-else-if="toolCall.status === 'error'" :size="16" />
        <Clock v-else :size="16" />
      </div>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span class="tool-status">{{ statusText }}</span>
      <span v-if="duration" class="tool-duration">{{ duration }}s</span>
      <ChevronDown :size="16" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    
    <div v-show="isExpanded" class="tool-call-details">
      <div class="tool-section">
        <div class="section-label">📥 输入参数</div>
        <pre class="code-block"><code>{{ formattedInput }}</code></pre>
      </div>
      
      <div v-if="toolCall.output" class="tool-section">
        <div class="section-label">📤 输出结果</div>
        <pre class="code-block"><code>{{ formattedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Loader2, Check, X, Clock, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  toolCall: ToolCall
}>()

const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)

const statusText = computed(() => {
  const map = {
    pending: '等待中',
    running: '执行中',
    completed: '已完成',
    error: '出错'
  }
  return map[props.toolCall.status]
})

const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})

const formattedInput = computed(() => {
  return JSON.stringify(props.toolCall.input, null, 2)
})

const formattedOutput = computed(() => {
  if (!props.toolCall.output) return ''
  try {
    const parsed = JSON.parse(props.toolCall.output)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return props.toolCall.output
  }
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
.tool-call-card {
  border-radius: 8px;
  border: 1px solid var(--surface-border);
  background: var(--surface-card);
  overflow: hidden;
  transition: all 0.3s ease;

  &.status-running {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.05);
  }

  &.status-completed {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.05);
  }

  &.status-error {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.05);
  }

  &.status-pending {
    border-color: #9ca3af;
    opacity: 0.8;
  }
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.02);
  }
}

.tool-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  .status-running & {
    color: #3b82f6;
  }

  .status-completed & {
    color: #22c55e;
  }

  .status-error & {
    color: #ef4444;
  }

  .status-pending & {
    color: #9ca3af;
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
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.tool-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
}

.tool-duration {
  font-size: 12px;
  color: var(--text-secondary);
}

.expand-icon {
  color: #9ca3af;
  transition: transform 0.3s ease;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.tool-call-details {
  padding: 0 12px 12px;
  border-top: 1px solid var(--surface-border);
}

.tool-section {
  margin-top: 12px;

  &:first-child {
    margin-top: 8px;
  }
}

.section-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.code-block {
  background: var(--surface-code);
  border-radius: 6px;
  padding: 10px;
  margin: 0;
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}
</style>
