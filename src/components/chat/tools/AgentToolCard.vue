<template>
  <div class="agent-tool-row">
    <!-- Clickable header → opens subagent panel -->
    <div class="agent-header" @click="openInPanel">
      <Bot :size="14" class="agent-icon" :class="statusClass" />
      <span class="agent-label">{{ t('toolCards.agent') }}</span>
      <span class="agent-type">{{ agentTypeDisplay }}</span>
      <span class="agent-separator">·</span>
      <span class="agent-task">{{ taskSummary }}</span>
      <!-- 状态徽章 -->
      <span v-if="statusBadge" class="agent-status-badge" :class="statusBadgeClass">
        {{ statusBadge }}
      </span>
      <ExternalLink :size="13" class="panel-hint-icon" />
    </div>

    <!-- 折叠态预览：输出摘要 / 最近工具调用活动 -->
    <div v-if="outputPreview || recentToolCalls.length" class="agent-preview">
      <div v-if="outputPreview" class="preview-output">{{ outputPreview }}</div>
      <div v-if="recentToolCalls.length && !outputPreview" class="preview-activity">
        <div v-for="tc in recentToolCalls" :key="tc.id" class="activity-item">
          {{ formatToolCallSummary(tc) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall, Message } from '@/types'
import { Bot, ExternalLink } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import {
  parseAgentToolOutput,
  extractAgentDisplayText,
  getAgentOutputSummary,
  isAgentLaunchResult,
  formatToolCallSummary,
} from '@/services/teamTranscriptService'
import { useSubagentTranscript } from '@/composables/useSubagentTranscript'

const props = defineProps<{ toolCall: ToolCall }>()
const { t } = useI18n()
const appStore = useAppStore()
const { messages: streamMessages } = useSubagentTranscript(() => props.toolCall.id)

const MAX_OUTPUT = 4000
const MAX_RECENT_TOOL_CALLS = 3

const statusClass = computed(() => `status-${props.toolCall.status}`)

const agentTypeDisplay = computed(() => {
  const type = props.toolCall.input?.agentType || props.toolCall.input?.type || 'general-purpose'
  return type === 'general-purpose' ? 'Agent' : String(type)
})

function getFirstStringField(input: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = input[field]
    if (typeof value === 'string') return value
  }
  return ''
}

const taskSummary = computed(() =>
  getFirstStringField(props.toolCall.input || {}, ['description', 'prompt', 'task', 'content'])
)

// 折叠态预览逻辑
const allToolCalls = computed<ToolCall[]>(() => {
  const result: ToolCall[] = []
  for (const msg of streamMessages.value) {
    if (msg.toolCalls) {
      result.push(...msg.toolCalls)
    }
  }
  return result
})

const recentToolCalls = computed<ToolCall[]>(() =>
  allToolCalls.value.slice(-MAX_RECENT_TOOL_CALLS)
)

const assistantTexts = computed<Message[]>(() =>
  streamMessages.value.filter(msg => msg.role === 'assistant' && msg.content?.trim())
)

const renderedOutput = computed(() => {
  if (streamMessages.value.length) return ''
  const o = props.toolCall.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  const cleaned = extractAgentDisplayText(displayText)
  if (!cleaned || isAgentLaunchResult(cleaned)) return ''
  return cleaned.length > MAX_OUTPUT ? cleaned.slice(0, MAX_OUTPUT) + '\n\n...' : cleaned
})

const outputPreview = computed(() => {
  if (renderedOutput.value) {
    return getAgentOutputSummary(renderedOutput.value)
  }
  const lastAssistant = assistantTexts.value[assistantTexts.value.length - 1]
  if (lastAssistant?.content?.trim()) {
    return getAgentOutputSummary(lastAssistant.content)
  }
  return ''
})

const statusBadge = computed(() => {
  if (props.toolCall.status === 'running' || props.toolCall.status === 'pending') {
    return t('toolCards.agentStatusRunning')
  }
  if (props.toolCall.status === 'error') {
    return t('toolCards.agentStatusFailed')
  }
  if (props.toolCall.status === 'completed') {
    return t('toolCards.agentStatusDone')
  }
  return ''
})

const statusBadgeClass = computed(() => {
  if (props.toolCall.status === 'running' || props.toolCall.status === 'pending') return 'badge-running'
  if (props.toolCall.status === 'error') return 'badge-failed'
  if (props.toolCall.status === 'completed') return 'badge-done'
  return ''
})

function openInPanel() {
  appStore.openSubagentPanel(props.toolCall.id)
}
</script>

<style lang="scss" scoped>
.agent-tool-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  font-size: var(--text-md);
}

.agent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.agent-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);

  &.status-running {
    color: var(--accent-tertiary);
    animation: agent-spin 1s linear infinite;
  }

  &.status-completed {
    color: var(--success);
  }

  &.status-error {
    color: var(--error);
  }
}

@keyframes agent-spin {
  to { transform: rotate(360deg); }
}

.agent-label {
  font-size: var(--text-md);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.agent-type {
  font-size: var(--text-md);
  color: var(--accent-tertiary);
  font-weight: 500;
  flex-shrink: 0;
}

.agent-separator {
  font-size: var(--text-md);
  color: var(--text-disabled);
  flex-shrink: 0;
}

.agent-task {
  font-size: var(--text-md);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.agent-status-badge {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: var(--leading-normal);

  &.badge-running {
    background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
    color: var(--warning, #f59e0b);
  }

  &.badge-done {
    background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
    color: var(--success, #22c55e);
  }

  &.badge-failed {
    background: color-mix(in srgb, var(--error, #ef4444) 12%, transparent);
    color: var(--error, #ef4444);
  }
}

/* 面板跳转图标，在 hover 时显示 */
.panel-hint-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity var(--transition-fast);
  margin-left: auto;
}

.agent-header:hover .panel-hint-icon {
  opacity: 0.6;
}

/* 折叠态预览 */
.agent-preview {
  padding: 2px 8px 4px 28px;
  max-width: 100%;
}

.preview-output {
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  color: var(--text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-activity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.activity-item {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
