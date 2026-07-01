<template>
  <div class="agent-tool-row">
    <div class="agent-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Bot :size="14" class="agent-icon" :class="statusClass" />
      <span class="agent-label">{{ t('toolCards.agent') }}</span>
      <span class="agent-type">{{ agentTypeDisplay }}</span>
      <span class="agent-separator">·</span>
      <span class="agent-task">{{ taskSummary }}</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-if="isExpanded" class="agent-details">
      <div class="agent-section">
        <div class="section-label">{{ t('toolCards.agentDescription') }}</div>
        <pre class="prompt-block"><code>{{ promptText }}</code></pre>
      </div>
      <div class="agent-section">
        <div class="section-label">{{ t('toolCards.agentResult') }}</div>
        <div class="output-content">
          <MarkdownRenderer v-if="renderedOutput" :content="renderedOutput" />
          <div v-else-if="streamMessages.length" class="stream-messages">
            <div v-for="msg in streamMessages" :key="msg.id" class="stream-message">
              <MarkdownRenderer :content="msg.content" />
            </div>
          </div>
          <div v-else class="output-empty">
            {{ isRunning ? t('common.loading') : t('toolCards.agentNoOutput') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Bot, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { parseAgentToolOutput } from '@/services/teamTranscriptService'
import { useSubagentTranscript } from '@/composables/useSubagentTranscript'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()
const { messages: streamMessages } = useSubagentTranscript(() => props.toolCall.id)

const MAX_OUTPUT = 4000

const statusClass = computed(() => `status-${props.toolCall.status}`)
const isRunning = computed(() => props.toolCall.status === 'running' || props.toolCall.status === 'pending')

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

const promptText = computed(() => {
  const input = props.toolCall.input || {}
  const value = getFirstStringField(input, ['prompt', 'description', 'task', 'content'])
  return value || JSON.stringify(input, null, 2)
})

const renderedOutput = computed(() => {
  if (streamMessages.value.length) return ''
  const o = props.toolCall.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  return displayText.length > MAX_OUTPUT ? displayText.slice(0, MAX_OUTPUT) + '\n\n...' : displayText
})

function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.agent-tool-row {
  display: inline-flex;
  flex-direction: column;
  max-width: 100%;
  font-size: 13px;
}

.agent-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);

  &:hover,
  &.is-expanded {
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
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.agent-type {
  font-size: 13px;
  color: var(--accent-tertiary);
  font-weight: 500;
  flex-shrink: 0;
}

.agent-separator {
  font-size: 13px;
  color: var(--text-disabled);
  flex-shrink: 0;
}

.agent-task {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.expand-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.5;
  transition: transform var(--transition-fast), opacity var(--transition-fast);

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.agent-header:hover .expand-icon {
  opacity: 0.8;
}

.agent-details {
  margin-top: 4px;
  padding: 0 8px;
  animation: agent-fade-in 150ms ease-out;
}

@keyframes agent-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.agent-section {
  margin-top: 12px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;

  &:first-child {
    margin-top: 0;
  }
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.prompt-block {
  margin: 0;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;
}

.output-content {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 360px;
  overflow-y: auto;
}

.output-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.stream-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stream-message {
  &:not(:last-child) {
    border-bottom: 1px solid var(--surface-border);
    padding-bottom: 12px;
  }
}
</style>
