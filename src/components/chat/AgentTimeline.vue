<template>
  <div class="agent-timeline">
    <!-- Timeline header with avatar -->
    <div class="timeline-header">
      <div class="timeline-avatar">
        <Bot :size="16" />
      </div>
      <span class="timeline-agent-name">Agent</span>
      <span class="timeline-status-badge" :class="overallStatus">
        <Loader2 v-if="overallStatus === 'running'" :size="10" class="spin-icon" />
        {{ statusLabel }}
      </span>
    </div>

    <!-- Timeline event list -->
    <div class="timeline-events">
      <div
        v-for="(event, index) in timelineEvents"
        :key="event.id"
        class="timeline-event"
        :class="[`event-${event.type}`, `status-${event.status}`, { 'is-last': index === timelineEvents.length - 1 }]"
      >
        <!-- Timeline connector -->
        <div v-if="event.type === 'reasoning' || event.type === 'metadata'" class="event-node">
          <div class="event-dot" :class="`status-${event.status}`">
            <Loader2 v-if="event.status === 'running'" :size="11" class="spin-icon" />
            <Check v-else-if="event.status === 'completed'" :size="11" />
            <X v-else-if="event.status === 'error'" :size="11" />
            <component v-else :is="event.icon" :size="11" />
          </div>
          <div v-if="index < timelineEvents.length - 1" class="event-line"></div>
        </div>
        <div v-else class="event-spacer"></div>

        <!-- Event content -->
        <div class="event-body">
          <!-- Reasoning event -->
          <template v-if="event.type === 'reasoning'">
            <div class="event-row" @click="toggleEvent(event.id)">
              <span class="event-label">Thinking</span>
              <span v-if="event.duration" class="event-duration">{{ event.duration }}s</span>
              <ChevronDown v-if="event.content" :size="12" class="event-chevron" :class="{ expanded: expandedEvents[event.id] }" />
            </div>
            <div v-if="expandedEvents[event.id] && event.content" class="event-detail">
              <MarkdownRenderer :content="event.content" />
            </div>
          </template>

          <!-- Text event -->
          <template v-else-if="event.type === 'text'">
            <div class="event-text-content">
              <MarkdownRenderer :content="event.content" />
            </div>
          </template>

          <!-- Tool call event with special component -->
          <template v-else-if="event.type === 'tool_call' && event.specialComponent">
            <component :is="event.specialComponent" :tool-call="event.toolCall!" />
          </template>

          <!-- Generic tool call event -->
          <template v-else-if="event.type === 'tool_call'">
            <div class="event-row" @click="toggleEvent(event.id)">
              <span class="inline-tool-status" :class="`status-${event.status}`">
                <Loader2 v-if="event.status === 'running'" :size="12" class="spin-icon" />
                <X v-else-if="event.status === 'error'" :size="12" />
                <component v-else :is="event.icon" :size="12" />
              </span>
              <span class="event-label">{{ event.label }}</span>
              <span v-if="event.target" class="event-target">{{ event.target }}</span>
              <span v-if="event.duration" class="event-duration">{{ event.duration }}s</span>
              <ChevronDown
                v-if="event.toolCall?.output || hasDetailContent(event)"
                :size="12"
                class="event-chevron"
                :class="{ expanded: expandedEvents[event.id] }"
              />
            </div>
            <div v-if="expandedEvents[event.id]" class="event-detail">
              <div v-if="event.toolCall?.input && Object.keys(event.toolCall.input).length" class="detail-section">
                <pre class="detail-code"><code>{{ formatInput(event.toolCall) }}</code></pre>
              </div>
              <div v-if="event.toolCall?.output" class="detail-section">
                <pre class="detail-code output"><code>{{ formatOutput(event.toolCall.output) }}</code></pre>
              </div>
            </div>
          </template>

          <!-- Metadata event -->
          <template v-else-if="event.type === 'metadata'">
            <div class="event-meta">
              <span v-if="event.metadata?.model" class="meta-tag">{{ event.metadata.model }}</span>
              <span v-if="event.metadata?.inputTokens" class="meta-tag">↑{{ event.metadata.inputTokens }}</span>
              <span v-if="event.metadata?.outputTokens" class="meta-tag">↓{{ event.metadata.outputTokens }}</span>
              <span v-if="event.metadata?.duration" class="meta-tag">{{ (event.metadata.duration / 1000).toFixed(1) }}s</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message, ToolCall, MessageMetadata } from '@/types'
import type { Component } from 'vue'
import { computed, markRaw, onMounted, reactive, watch } from 'vue'
import { hasToolComponent, resolveToolComponent } from '@/components/chat/tools/index'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import {
  Loader2, Check, X, ChevronDown, Bot,
  Terminal, FileText, FileEdit, Search, Globe, Wand2, Folder, Code,
  Brain, MessageCircle, Info
} from 'lucide-vue-next'

interface TimelineEvent {
  id: string
  type: 'reasoning' | 'text' | 'tool_call' | 'metadata'
  status: 'running' | 'completed' | 'error' | 'pending'
  icon: Component
  label: string
  content: string
  target?: string
  duration?: string
  toolCall?: ToolCall
  metadata?: MessageMetadata
  specialComponent?: Component
}

const props = defineProps<{
  messages: Message[]
}>()

const expandedEvents = reactive<Record<string, boolean>>({})

const TOOL_ICON_MAP: Record<string, Component> = {
  Bash: Terminal,
  Read: FileText,
  FileRead: FileText,
  Write: FileEdit,
  FileWrite: FileEdit,
  Edit: FileEdit,
  FileEdit: FileEdit,
  MultiEdit: FileEdit,
  Glob: Folder,
  Grep: Search,
  Agent: Bot,
  Skill: Wand2,
  WebFetch: Globe,
  WebSearch: Globe,
  CodebaseSearch: Search,
}

const TOOL_LABEL_MAP: Record<string, string> = {
  Bash: 'Run command',
  Read: 'Read file',
  FileRead: 'Read file',
  Write: 'Write file',
  FileWrite: 'Write file',
  Edit: 'Edit file',
  FileEdit: 'Edit file',
  MultiEdit: 'Multi edit',
  Glob: 'Search files',
  Grep: 'Grep search',
  Agent: 'Sub-agent',
  Skill: 'Skill',
  WebFetch: 'Fetch URL',
  WebSearch: 'Web search',
  CodebaseSearch: 'Codebase search',
  TodoWrite: 'Update tasks',
}

const specialComponents = reactive<Record<string, Component>>({})

async function loadSpecialComponents() {
  for (const msg of props.messages) {
    for (const tool of msg.toolCalls || []) {
      if (hasToolComponent(tool.name) && !specialComponents[tool.id]) {
        const comp = await resolveToolComponent(tool.name)
        if (comp) specialComponents[tool.id] = markRaw(comp)
      }
    }
  }
}

onMounted(loadSpecialComponents)
watch(() => props.messages, () => { loadSpecialComponents() }, { deep: true })

const timelineEvents = computed<TimelineEvent[]>(() => {
  const events: TimelineEvent[] = []
  const timelineToolCallIds = new Set<string>()

  for (const msg of props.messages) {
    const hasTimeline = msg.timelineEvents?.length

    if (hasTimeline) {
      for (const event of msg.timelineEvents!) {
        if (event.type === 'text' && !event.content) continue
        if (event.type === 'tool_call') {
          const tool = msg.toolCalls?.find(toolCall => toolCall.id === event.toolCallId)
          if (!tool) continue
          timelineToolCallIds.add(tool.id)
          const icon = TOOL_ICON_MAP[tool.name] || Code
          events.push({
            id: event.id,
            type: 'tool_call',
            status: tool.status,
            icon: markRaw(icon),
            label: TOOL_LABEL_MAP[tool.name] || tool.name,
            content: '',
            target: getToolTarget(tool),
            duration: getToolDuration(tool) || undefined,
            toolCall: tool,
            specialComponent: specialComponents[tool.id] ? markRaw(specialComponents[tool.id]) : undefined,
          })
          continue
        }
        if (event.type === 'reasoning') {
          events.push({
            id: event.id,
            type: 'reasoning',
            status: event.status,
            icon: markRaw(Brain),
            label: 'Thinking',
            content: event.content || '',
          })
          continue
        }
        if (event.type === 'text') {
          events.push({
            id: event.id,
            type: 'text',
            status: event.status,
            icon: markRaw(MessageCircle),
            label: 'Response',
            content: event.content || '',
          })
          continue
        }
      }
    }

    if (msg.toolCalls?.length) {
      for (const tool of msg.toolCalls) {
        if (timelineToolCallIds.has(tool.id)) continue
        const icon = TOOL_ICON_MAP[tool.name] || Code
        events.push({
          id: tool.id,
          type: 'tool_call',
          status: tool.status,
          icon: markRaw(icon),
          label: TOOL_LABEL_MAP[tool.name] || tool.name,
          content: '',
          target: getToolTarget(tool),
          duration: getToolDuration(tool) || undefined,
          toolCall: tool,
          specialComponent: specialComponents[tool.id] ? markRaw(specialComponents[tool.id]) : undefined,
        })
      }
    }

    if (!hasTimeline) {
      if (msg.reasoning) {
        const isThinking = !msg.reasoning.endTime
        const duration = msg.reasoning.endTime
          ? ((msg.reasoning.endTime - msg.reasoning.startTime) / 1000).toFixed(1)
          : null
        events.push({
          id: `${msg.id}-reasoning`,
          type: 'reasoning',
          status: isThinking ? 'running' : 'completed',
          icon: markRaw(Brain),
          label: 'Thinking',
          content: msg.reasoning.content || '',
          duration: duration || undefined,
        })
      }

      if (msg.content) {
        events.push({
          id: `${msg.id}-text`,
          type: 'text',
          status: 'completed',
          icon: markRaw(MessageCircle),
          label: 'Response',
          content: msg.content,
        })
      }
    }

    if (msg.metadata && (msg.metadata.model || msg.metadata.inputTokens || msg.metadata.duration)) {
      events.push({
        id: `${msg.id}-meta`,
        type: 'metadata',
        status: 'completed',
        icon: markRaw(Info),
        label: 'Info',
        content: '',
        metadata: msg.metadata,
      })
    }
  }

  return events
})

const overallStatus = computed(() => {
  const lastMsg = props.messages[props.messages.length - 1]
  // Still streaming: no metadata means response hasn't finished yet
  const isStreaming = lastMsg && !lastMsg.metadata
  if (isStreaming) return 'running'
  if (timelineEvents.value.some(e => e.status === 'running' || e.status === 'pending')) return 'running'
  if (timelineEvents.value.some(e => e.status === 'error')) return 'error'
  return 'completed'
})

const statusLabel = computed(() => {
  if (overallStatus.value === 'running') {
    const running = timelineEvents.value.find(e => e.status === 'running')
    if (running) return running.label
    const lastMsg = props.messages[props.messages.length - 1]
    if (lastMsg?.toolCalls?.some(t => t.status === 'running')) return 'Working...'
    return 'Responding...'
  }
  if (overallStatus.value === 'error') return 'Error'
  return 'Done'
})

function toggleEvent(eventId: string) {
  expandedEvents[eventId] = !expandedEvents[eventId]
}

function getToolTarget(tool: ToolCall): string {
  const input = tool.input || {}
  const value = input.file_path || input.path || input.command || input.pattern || input.query
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\\/g, '/')
  if (normalized.length > 60) {
    const parts = normalized.split('/')
    const filename = parts[parts.length - 1]
    return filename.length > 60 ? `...${normalized.slice(-57)}` : filename
  }
  return normalized
}

function getToolDuration(tool: ToolCall): string | null {
  if (!tool.startTime) return null
  const end = tool.endTime || Date.now()
  return ((end - tool.startTime) / 1000).toFixed(1)
}

function hasDetailContent(event: TimelineEvent): boolean {
  return !!(event.toolCall?.input && Object.keys(event.toolCall.input).length > 0)
}

function formatInput(tool: ToolCall): string {
  const input = tool.input || {}
  if (input.command && Object.keys(input).length <= 2) return input.command
  if ((input.file_path || input.path) && Object.keys(input).length <= 2) return input.file_path || input.path
  if (input.query && Object.keys(input).length <= 2) return input.query
  return JSON.stringify(input, null, 2)
}

function formatOutput(output: string): string {
  const maxLen = 800
  if (output.length > maxLen) return output.slice(0, maxLen) + '\n... (truncated)'
  return output
}
</script>

<style lang="scss" scoped>
.agent-timeline {
  padding: 12px 0;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.timeline-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-glass);
  color: var(--accent-primary);
  border: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.timeline-agent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.timeline-status-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 4px;

  &.running {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    color: var(--accent-primary);
  }

  &.completed {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }

  &.error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
}

.timeline-events {
  margin-left: 14px;
  padding-left: 0;
}

.timeline-event {
  display: flex;
  align-items: flex-start;
  min-height: 28px;
}

.event-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 22px;
  flex-shrink: 0;
  padding-top: 5px;
}

.event-spacer {
  width: 22px;
  flex-shrink: 0;
}

.event-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  border: 1.5px solid var(--surface-border);
  transition: all 0.15s ease;

  &.status-running {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  &.status-completed {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.4);
  }

  &.status-error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.4);
  }
}

.event-line {
  width: 1.5px;
  flex: 1;
  min-height: 6px;
  background: var(--surface-border);
  margin: 2px 0;
}

.event-body {
  flex: 1;
  min-width: 0;
  padding: 2px 0 6px 10px;
}

.event-text {
  .event-body {
    padding-top: 5px;
    padding-bottom: 8px;
  }
}

.event-tool_call {
  .event-body {
    padding-top: 4px;
    padding-bottom: 8px;
  }
}

.event-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.event-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.inline-tool-status {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  color: var(--text-muted);

  &.status-running {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    color: var(--accent-primary);
  }

  &.status-error {
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
  }

  &.status-completed {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }
}

.event-target {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-duration {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  opacity: 0.7;
  flex-shrink: 0;
}

.event-chevron {
  color: var(--text-muted);
  opacity: 0.5;
  flex-shrink: 0;
  transition: transform 0.15s ease;

  &.expanded {
    transform: rotate(180deg);
  }
}

.event-detail {
  margin-top: 4px;
  padding: 0 8px;
}

.detail-section {
  margin-top: 6px;

  &:first-child {
    margin-top: 0;
  }
}

.detail-code {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: var(--font-mono);
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  max-height: 200px;
  overflow-y: auto;

  &.output {
    color: var(--text-muted);
    max-height: 300px;
  }
}

.event-text-content {
  padding: 4px 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  user-select: text;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  flex-wrap: wrap;
}

.meta-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
