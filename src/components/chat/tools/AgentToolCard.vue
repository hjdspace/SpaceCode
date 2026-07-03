<template>
  <div class="agent-tool-row">
    <!-- 折叠态头部 -->
    <div class="agent-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Bot :size="14" class="agent-icon" :class="statusClass" />
      <span class="agent-label">{{ t('toolCards.agent') }}</span>
      <span class="agent-type">{{ agentTypeDisplay }}</span>
      <span class="agent-separator">·</span>
      <span class="agent-task">{{ taskSummary }}</span>
      <!-- 状态徽章 -->
      <span v-if="statusBadge" class="agent-status-badge" :class="statusBadgeClass">
        {{ statusBadge }}
      </span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <!-- 折叠态预览：输出摘要 / 最近工具调用活动 -->
    <div v-if="!isExpanded && (outputPreview || recentToolCalls.length)" class="agent-preview">
      <div v-if="outputPreview" class="preview-output">{{ outputPreview }}</div>
      <div v-if="recentToolCalls.length && !outputPreview" class="preview-activity">
        <div v-for="tc in recentToolCalls" :key="tc.id" class="activity-item">
          {{ formatToolCallSummary(tc) }}
        </div>
      </div>
    </div>

    <!-- 展开态详情 -->
    <div v-if="isExpanded" class="agent-details">
      <!-- 提示词区块 -->
      <div v-if="promptText" class="agent-section">
        <div class="section-label">{{ t('toolCards.agentDescription') }}</div>
        <pre class="prompt-block"><code>{{ promptText }}</code></pre>
      </div>

      <!-- 子代理活动时间线区块 -->
      <div v-if="allToolCalls.length" class="agent-section">
        <div class="section-label">{{ t('toolCards.agentActivity') }}</div>
        <div class="activity-timeline">
          <div
            v-for="tc in allToolCalls"
            :key="tc.id"
            class="activity-timeline-item"
            :class="`status-${tc.status}`"
          >
            <div class="activity-node">
              <div class="activity-dot" :class="`status-${tc.status}`">
                <Loader2 v-if="tc.status === 'running'" :size="10" class="spin-icon" />
                <Check v-else-if="tc.status === 'completed'" :size="10" />
                <X v-else-if="tc.status === 'error'" :size="10" />
                <component :is="getToolIcon(tc.name)" v-else :size="10" />
              </div>
            </div>
            <div class="activity-content">
              <span class="activity-tool-name">{{ tc.name }}</span>
              <span v-if="getToolTarget(tc)" class="activity-tool-target">{{ getToolTarget(tc) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 子代理输出区块 -->
      <div class="agent-section">
        <div class="section-label">{{ t('toolCards.agentResult') }}</div>
        <div class="output-content">
          <MarkdownRenderer v-if="renderedOutput" :content="renderedOutput" />
          <div v-else-if="assistantTexts.length" class="stream-messages">
            <div v-for="msg in assistantTexts" :key="msg.id" class="stream-message">
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
import type { ToolCall, Message } from '@/types'
import { Bot, ChevronDown, Loader2, Check, X, Terminal, FileText, FileEdit, Search, Globe, Wand2, Folder } from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import {
  parseAgentToolOutput,
  extractAgentDisplayText,
  getAgentOutputSummary,
  isAgentLaunchResult,
  formatToolCallSummary,
} from '@/services/teamTranscriptService'
import { useSubagentTranscript } from '@/composables/useSubagentTranscript'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()
const { messages: streamMessages } = useSubagentTranscript(() => props.toolCall.id)

const MAX_OUTPUT = 4000
const MAX_RECENT_TOOL_CALLS = 3

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
  const value = input.prompt || input.description || input.task || input.content || ''
  return typeof value === 'string' ? value : JSON.stringify(input, null, 2)
})

// ── 从转录消息中提取所有工具调用 ──
const allToolCalls = computed<ToolCall[]>(() => {
  const result: ToolCall[] = []
  for (const msg of streamMessages.value) {
    if (msg.toolCalls) {
      result.push(...msg.toolCalls)
    }
  }
  return result
})

// ── 最近 N 条工具调用（折叠态预览用）──
const recentToolCalls = computed<ToolCall[]>(() =>
  allToolCalls.value.slice(-MAX_RECENT_TOOL_CALLS)
)

// ── 助手文本消息（展开态输出用）──
const assistantTexts = computed<Message[]>(() =>
  streamMessages.value.filter(msg => msg.role === 'assistant' && msg.content?.trim())
)

// ── 最终输出文本（带元数据剥离）──
const renderedOutput = computed(() => {
  if (streamMessages.value.length) return ''
  const o = props.toolCall.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  // 剥离元数据后若为空（如仅有 agentId/usage），则不展示
  const cleaned = extractAgentDisplayText(displayText)
  if (!cleaned || isAgentLaunchResult(cleaned)) return ''
  return cleaned.length > MAX_OUTPUT ? cleaned.slice(0, MAX_OUTPUT) + '\n\n...' : cleaned
})

// ── 折叠态输出预览（优先用最终输出，其次用最后一条助手消息）──
const outputPreview = computed(() => {
  // 子代理已完成：从工具输出中提取摘要
  if (renderedOutput.value) {
    return getAgentOutputSummary(renderedOutput.value)
  }
  // 子代理运行中：从最后一条助手消息中提取预览
  const lastAssistant = assistantTexts.value[assistantTexts.value.length - 1]
  if (lastAssistant?.content?.trim()) {
    return getAgentOutputSummary(lastAssistant.content)
  }
  return ''
})

// ── 状态徽章 ──
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

// ── 工具图标映射 ──
const TOOL_ICONS: Record<string, Component> = {
  Bash: Terminal,
  Read: FileText,
  FileRead: FileText,
  Write: FileEdit,
  FileWrite: FileEdit,
  Edit: FileEdit,
  FileEdit: FileEdit,
  Glob: Folder,
  Grep: Search,
  Agent: Bot,
  Skill: Wand2,
  WebFetch: Globe,
  WebSearch: Globe,
}

function getToolIcon(name: string): Component {
  return TOOL_ICONS[name] || Terminal
}

function getToolTarget(tool: ToolCall): string {
  const input = tool.input || {}
  switch (tool.name) {
    case 'Bash':
      return typeof input.command === 'string' ? input.command : ''
    case 'Read':
    case 'FileRead':
    case 'Write':
    case 'FileWrite':
    case 'Edit':
    case 'FileEdit':
      return typeof input.file_path === 'string' ? String(input.file_path).split('/').pop() || '' : ''
    case 'Glob':
      return typeof input.pattern === 'string' ? input.pattern : ''
    case 'Grep':
      return typeof input.pattern === 'string' ? input.pattern : ''
    case 'Agent':
      return typeof input.description === 'string' ? input.description : ''
    case 'WebSearch':
      return typeof input.query === 'string' ? input.query : ''
    case 'WebFetch':
      return typeof input.url === 'string' ? input.url : ''
    default:
      return ''
  }
}

function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>

<style lang="scss" scoped>
.agent-tool-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  font-size: 13px;
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

.agent-status-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.4;

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

/* ── 折叠态预览 ── */
.agent-preview {
  padding: 2px 8px 4px 28px;
  max-width: 100%;
}

.preview-output {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
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
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 展开态详情 ── */
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

/* ── 活动时间线 ── */
.activity-timeline {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.activity-timeline-item {
  display: flex;
  align-items: center;
  gap: 8px;

  &:not(:last-child) {
    .activity-node::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      width: 1px;
      height: 6px;
      background: var(--surface-border);
    }
  }
}

.activity-node {
  position: relative;
  flex-shrink: 0;
}

.activity-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);

  &.status-running {
    border-color: var(--accent-tertiary);
    color: var(--accent-tertiary);
  }

  &.status-completed {
    border-color: var(--success);
    color: var(--success);
  }

  &.status-error {
    border-color: var(--error);
    color: var(--error);
  }
}

.activity-content {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.activity-tool-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.activity-tool-target {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.spin-icon {
  animation: agent-spin 1s linear infinite;
}

/* ── 输出内容 ── */
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
