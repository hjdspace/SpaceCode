<template>
  <div class="agent-timeline">
    <!-- Timeline header with avatar -->
    <div class="timeline-header">
      <div class="timeline-avatar">
        <Bot :size="16" />
      </div>
      <span class="timeline-agent-name">{{ t('timeline.agent') }}</span>
      <span class="timeline-status-badge" :class="overallStatus">
        <Loader2 v-if="overallStatus === 'running'" :size="10" class="spin-icon" />
        {{ statusLabel }}
      </span>
      <!-- 用时计时器 -->
      <div class="timeline-timer" :class="overallStatus">
        <Clock :size="12" class="timer-icon" />
        <span class="timer-value">{{ timerText }}</span>
      </div>
    </div>

    <!-- Timeline event list -->
    <div class="timeline-events">
      <div
        v-for="(event, index) in visibleTimelineEvents"
        :key="event.id"
        class="timeline-event"
        :class="[`event-${event.type}`, `status-${event.status}`, { 'is-last': index === visibleTimelineEvents.length - 1 }]"
      >
        <!-- Timeline connector -->
        <div v-if="event.type === 'metadata'" class="event-node">
          <div class="event-dot" :class="`status-${event.status}`">
            <Loader2 v-if="event.status === 'running'" :size="11" class="spin-icon" />
            <X v-else-if="event.status === 'error'" :size="11" />
            <component v-else :is="event.icon" :size="11" />
          </div>
          <div v-if="index < visibleTimelineEvents.length - 1" class="event-line"></div>
        </div>
        <div v-else class="event-spacer"></div>

        <!-- Event content -->
        <div class="event-body">
          <!-- Reasoning event -->
          <template v-if="event.type === 'reasoning'">
            <div class="event-row" @click="toggleEvent(event.id)">
              <span class="event-label">{{ t('timeline.thinking') }}</span>
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
          <template v-else-if="event.type === 'tool_call' && shouldRenderSpecialComponent(event)">
            <component
              :is="event.specialComponent"
              :key="getSpecialComponentKey(event)"
              :tool-call="event.toolCall!"
              @submit="handleToolSubmit(event.toolCall!.id, $event)"
              @skip="handleToolSkip(event.toolCall!.id)"
            />
            <PermissionRequestCard
              v-if="!SELF_PERMISSION_TOOL_NAMES.has(event.toolCall!.name) && getPendingPermission(event.toolCall!.id)"
              :message-id="event.messageId!"
              :tool-use-id="event.toolCall!.id"
              :tool-name="getPendingPermission(event.toolCall!.id)!.toolName"
              :input="getPendingPermission(event.toolCall!.id)!.input"
            />
          </template>

          <!-- Task list inline card (when not showing global board) -->
          <template v-else-if="event.type === 'tool_call' && event.taskItems?.length && !shouldShowTaskBoard">
            <TaskListCard :tasks="event.taskItems" class="event-task-inline" />
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
            <PermissionRequestCard
              v-if="event.toolCall && getPendingPermission(event.toolCall.id)"
              :message-id="event.messageId!"
              :tool-use-id="event.toolCall.id"
              :tool-name="getPendingPermission(event.toolCall.id)!.toolName"
              :input="getPendingPermission(event.toolCall.id)!.input"
            />
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

          <!-- Error event -->
          <template v-else-if="event.type === 'error' && event.classifiedError">
            <ErrorCard
              :error="event.classifiedError"
              @retry="handleRetry"
              @dismiss="handleDismissError"
            />
          </template>
        </div>
      </div>

      <!-- 自动重试提示：简洁单行"API Error：xxx... 正在重连（n/m）"；放在时间线事件下方 -->
      <RetryIndicator
        v-if="currentRetryState && !currentRetryState.aborted"
        :attempt="currentRetryState.attempt"
        :max-retries="currentRetryState.maxRetries"
        :delay-ms="currentRetryState.delayMs"
        :error-category="currentRetryState.errorCategory"
        :error-title="currentRetryState.errorTitle"
        :error-code="currentRetryState.errorCode"
        @cancel="handleCancelRetry"
      />

      <!-- 全局任务看板 -->
      <TaskListCard
        v-if="allTasks.length && shouldShowTaskBoard"
        :tasks="allTasks"
        class="timeline-task-board"
      />
    </div>

    <!-- 用时汇总条：复用 TurnSummaryBar 组件 -->
    <TurnSummaryBar
      :metadata="finalMetadata"
      :reasoning-duration-ms="reasoningDurationMs"
      :loading="overallStatus === 'running'"
      :total-duration-ms="totalElapsedMs"
      class="timeline-turn-summary"
    />
  </div>
</template>

<script setup lang="ts">
import type { Message, ToolCall, MessageMetadata, ClassifiedError } from '@/types'
import type { Component } from 'vue'
import { computed, markRaw, onMounted, onUnmounted, reactive, watch, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { hasToolComponent, resolveToolComponent } from '@/components/chat/tools/index'
import TaskListCard, { type TaskListItem } from './TaskListCard.vue'
import { useTaskManager } from '@/composables/useTaskManager'
import PermissionRequestCard from './tools/PermissionRequestCard.vue'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ErrorCard from '../common/ErrorCard.vue'
import RetryIndicator from './RetryIndicator.vue'
import TurnSummaryBar from './TurnSummaryBar.vue'
import { stripDesignTags } from '@/utils/chat/buildBlocks'
import { errorHandler } from '@/services/errorHandler'
import { useChatStore } from '@/stores/chat'
import { useChatStreamStore } from '@/stores/chatStream'
import {
  Loader2, X, ChevronDown, Bot, AlertCircle, Clock,
  Terminal, FileText, FileEdit, Search, Globe, Wand2, Folder, Code,
  MessageCircle, Info, ListChecks
} from 'lucide-vue-next'

const EmptyIcon = () => null

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const TASK_LIST_TOOL_NAMES = new Set(['TodoWrite', 'TaskList', 'TaskCreate', 'TaskUpdate'])
const TASK_LIST_ONLY_TOOL_NAMES = new Set(['TaskList', 'TaskCreate', 'TaskUpdate'])
// 这些工具的特殊组件本身就是权限交互 UI（emit submit/skip，并把合并后的
// updatedInput 交给 store.allowPermission）。若再叠加 PermissionRequestCard，
// 既会重复显示操作按钮，又会把原始 input（如 AskUserQuestion 的 questions
// 数组）以 JSON 形式泄露到卡片下方，且 Allow 按钮会以不带 answers 的原始
// input 提交，破坏问答流程。
const SELF_PERMISSION_TOOL_NAMES = new Set(['AskUserQuestion'])

const emit = defineEmits<{
  toolSubmit: [toolId: string, updatedInput: Record<string, unknown>]
  toolSkip: [toolId: string]
}>()

function handleToolSubmit(toolId: string, updatedInput: Record<string, unknown>) {
  emit('toolSubmit', toolId, updatedInput)
}

function handleToolSkip(toolId: string) {
  emit('toolSkip', toolId)
}

interface TimelineEvent {
  id: string
  type: 'reasoning' | 'text' | 'tool_call' | 'metadata' | 'error'
  status: 'running' | 'completed' | 'error' | 'pending'
  icon: Component
  label: string
  content: string
  target?: string
  duration?: string
  toolCall?: ToolCall
  messageId?: string
  metadata?: MessageMetadata
  specialComponent?: Component
  classifiedError?: ClassifiedError
  taskItems?: TaskListItem[]
}

const props = defineProps<{
  messages: Message[]
  loading?: boolean
  /**
   * 渲染模式：
   * - `design`：文本内容中的设计专用 XML 标签（od-card / next-steps / question-form）
   *   会被剥离，不在此组件渲染；由外层 DesignBlocks 组件负责展示。
   * - 不传：原样渲染所有文本内容。
   */
  mode?: 'design'
}>()

const expandedEvents = reactive<Record<string, boolean>>({})

const chatStore = useChatStore()
const streamStore = useChatStreamStore()
const taskManager = useTaskManager()
const { t } = useI18n()

function getPendingPermission(toolUseId: string) {
  return chatStore.getPendingPermissionForToolUse(toolUseId)
}

function handleRetry() {
  chatStore.retryLastMessage()
}

function handleCancelRetry() {
  chatStore.cancelRetry()
}

/** 当前会话的重试状态（从响应式 store 中读取） */
const currentRetryState = computed(() => {
  const sid = chatStore.currentSessionId
  if (!sid) return null
  return streamStore.retryStates.get(sid) ?? null
})

function handleDismissError() {
  const sid = chatStore.currentSessionId
  if (sid) errorHandler.clearInlineError(sid)
}

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

function getToolLabel(tool: string): string {
  const map: Record<string, string> = {
    Bash: t('timeline.tools.bash'),
    Read: t('timeline.tools.read'),
    FileRead: t('timeline.tools.read'),
    Write: t('timeline.tools.write'),
    FileWrite: t('timeline.tools.write'),
    Edit: t('timeline.tools.edit'),
    FileEdit: t('timeline.tools.edit'),
    MultiEdit: t('timeline.tools.multiEdit'),
    Glob: t('timeline.tools.glob'),
    Grep: t('timeline.tools.grep'),
    Agent: t('timeline.tools.agent'),
    Skill: t('timeline.tools.skill'),
    WebFetch: t('timeline.tools.webFetch'),
    WebSearch: t('timeline.tools.webSearch'),
    CodebaseSearch: t('timeline.tools.codebaseSearch'),
    TodoWrite: t('timeline.tools.updateTasks'),
    TaskCreate: t('timeline.tools.createTask'),
    TaskUpdate: t('timeline.tools.updateTask'),
    TaskList: t('timeline.tools.listTasks'),
  }
  return map[tool] || tool
}

// Keyed by tool NAME (not id): the same Vue component is reused across
// every tool_use of the same name, so resolving once is sufficient and
// guarantees real-time card rendering for subsequent calls during streaming.
const specialComponents = reactive<Record<string, Component>>({})
const loadingSpecialComponents = new Set<string>()
const specialToolNames = computed(() => {
  const names = new Set<string>()
  for (const msg of props.messages) {
    for (const tool of msg.toolCalls || []) {
      if (hasToolComponent(tool.name)) names.add(tool.name)
    }
  }
  return Array.from(names).sort().join(',')
})

async function loadSpecialComponentByName(toolName: string) {
  if (!hasToolComponent(toolName) || specialComponents[toolName] || loadingSpecialComponents.has(toolName)) return
  loadingSpecialComponents.add(toolName)
  const comp = await resolveToolComponent(toolName)
  if (comp) specialComponents[toolName] = markRaw(comp)
  loadingSpecialComponents.delete(toolName)
}

function loadVisibleSpecialComponents() {
  for (const msg of props.messages) {
    for (const tool of msg.toolCalls || []) {
      loadSpecialComponentByName(tool.name)
    }
  }
}

onMounted(loadVisibleSpecialComponents)

// Trigger only when the set of tool names changes (cheap string compare).
// Per-name resolution covers every tool.id automatically.
watch(specialToolNames, loadVisibleSpecialComponents)

// ========== 优化2: timelineEvents计算缓存 ==========
let _cachedTimelineEvents: TimelineEvent[] | null = null
let _cachedTimelineKey = ''

function buildTimelineEvents(msgs: Message[]): TimelineEvent[] {
  const toolStateKey = msgs
    .flatMap(msg => (msg.toolCalls || []).map(tool => [
      tool.id,
      tool.name,
      tool.status,
      getTaskStateContentKey(tool),
      getToolContentKey(tool),
      specialComponents[tool.name] ? 1 : 0,
    ].join(':')))
    .join(',')
  const metadataStateKey = msgs
    .map(msg => [
      msg.id,
      msg.metadata?.model || '',
      msg.metadata?.inputTokens || '',
      msg.metadata?.outputTokens || '',
      msg.metadata?.duration || '',
    ].join(':'))
    .join(',')
  // 必须把流式文本/推理内容也纳入缓存键, 否则纯 text_delta 流式更新时
  // (msg 数量/ID/工具状态都不变) 缓存命中 -> 返回旧的 TimelineEvent[] ->
  // MarkdownRenderer 拿到同一份 content 字符串, watch 不触发, 界面卡住,
  // 直到用户切走再切回 (组件 remount, 缓存重置) 才看到完整答复.
  const contentStateKey = msgs.map(msg => {
    const tlKey = (msg.timelineEvents || [])
      .map(e => {
        if (e.type === 'text' || e.type === 'reasoning') {
          return `${e.id}:${e.status}:${(e.content || '').length}`
        }
        return `${e.id}:${e.type}`
      })
      .join('|')
    return [
      msg.id,
      (msg.content || '').length,
      (msg.reasoning?.content || '').length,
      msg.reasoning?.endTime ? 1 : 0,
      msg.metadata ? 1 : 0,
      tlKey,
    ].join(':')
  }).join(';')
  const finalMetadataMessageId = props.loading ? '' : getFinalMetadataMessageId(msgs)
  const modeKey = props.mode || 'default'
  const key = msgs.length > 0
    ? `${modeKey}-${msgs.length}-${msgs[0]?.id}-${msgs[msgs.length - 1]?.id}-${toolStateKey}-${metadataStateKey}-${contentStateKey}-${finalMetadataMessageId}`
    : `empty-${modeKey}`

  if (_cachedTimelineEvents && _cachedTimelineKey === key) {
    return _cachedTimelineEvents
  }

  const events: TimelineEvent[] = []
  const timelineToolCallIds = new Set<string>()

  for (const msg of msgs) {
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
            label: getToolLabel(tool.name),
            content: '',
            target: getToolTarget(tool),
            duration: getToolDuration(tool) || undefined,
            toolCall: tool,
            messageId: msg.id,
            specialComponent: specialComponents[tool.name] ? markRaw(specialComponents[tool.name]) : undefined,
            taskItems: getTaskListItems(tool),
          })
          continue
        }
        if (event.type === 'reasoning') {
          events.push({
            id: event.id,
            type: 'reasoning',
            status: event.status,
            icon: markRaw(EmptyIcon),
            label: t('timeline.thinking'),
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
            label: t('timeline.response'),
            content: props.mode === 'design' ? stripDesignTags(event.content || '') : (event.content || ''),
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
          label: getToolLabel(tool.name),
          content: '',
          target: getToolTarget(tool),
          duration: getToolDuration(tool) || undefined,
          toolCall: tool,
          messageId: msg.id,
          specialComponent: specialComponents[tool.name] ? markRaw(specialComponents[tool.name]) : undefined,
          taskItems: getTaskListItems(tool),
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
          icon: markRaw(EmptyIcon),
          label: t('timeline.thinking'),
          content: msg.reasoning.content || '',
          duration: duration || undefined,
        })
      }

      if (msg.content) {
        const textContent = props.mode === 'design' ? stripDesignTags(msg.content) : msg.content
        if (textContent) {
          events.push({
            id: `${msg.id}-text`,
            type: 'text',
            status: 'completed',
            icon: markRaw(MessageCircle),
            label: t('timeline.response'),
            content: textContent,
          })
        }
      }
    }

    if (msg.id === finalMetadataMessageId && hasFinalMetadata(msg.metadata)) {
      events.push({
        id: `${msg.id}-meta`,
        type: 'metadata',
        status: 'completed',
        icon: markRaw(Info),
        label: t('timeline.info'),
        content: '',
        metadata: msg.metadata,
      })
    }

    if (msg.metadata?.error) {
      events.push({
        id: `${msg.id}-error`,
        type: 'error',
        status: 'error',
        icon: markRaw(AlertCircle),
        label: t('timeline.error'),
        content: '',
        classifiedError: msg.metadata.error,
      })
    }
  }

  _cachedTimelineEvents = events
  _cachedTimelineKey = key
  return events
}

const timelineEvents = computed<TimelineEvent[]>(() => {
  // 显式访问 specialComponents，建立响应式依赖
  // 这样当特殊组件异步加载完成后，computed 会自动重新计算
  const _componentDeps = Object.keys(specialComponents).join(',')
  return buildTimelineEvents(props.messages)
})

const visibleTimelineEvents = computed<TimelineEvent[]>(() => {
  const events = timelineEvents.value
  // 找到最后一个有 taskItems 的任务工具事件
  let latestTaskEventIdx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'tool_call' && e.toolCall &&
        TASK_LIST_TOOL_NAMES.has(e.toolCall.name) && e.taskItems?.length) {
      latestTaskEventIdx = i
      break
    }
  }

  return events.filter((event, index) => {
    if (event.type !== 'tool_call' || !event.toolCall) return true
    const name = event.toolCall.name
    if (!TASK_LIST_TOOL_NAMES.has(name)) return true
    // 没有 taskItems 的任务专用工具（TaskCreate/TaskUpdate/TaskList）隐藏
    if (!event.taskItems?.length && TASK_LIST_ONLY_TOOL_NAMES.has(name)) return false
    // 有 taskItems 时只保留最后一个，其余隐藏（避免重复显示）
    if (event.taskItems?.length) return index === latestTaskEventIdx
    // TodoWrite 没有 taskItems 时保留（显示为通用行）
    return true
  })
})

const overallStatus = computed(() => {
  const lastMsg = props.messages[props.messages.length - 1]
  // Still streaming: no metadata means response hasn't finished yet
  const isStreaming = props.loading && lastMsg && !lastMsg.metadata
  if (isStreaming) return 'running'
  if (timelineEvents.value.some(e => e.status === 'running' || e.status === 'pending')) return 'running'
  if (timelineEvents.value.some(e => e.status === 'error')) return 'error'
  return 'completed'
})

// ========== 优化3: 使用更轻量的监听替代deep watch ==========
// 只监听reasoning事件的状态变化，不监听整个timelineEvents数组
const lastEventCount = ref(0)

watch(() => timelineEvents.value.length, (newLength, oldLength) => {
  const events = timelineEvents.value

  // 只处理新添加的事件
  if (newLength > oldLength) {
    for (let i = oldLength; i < newLength; i++) {
      const event = events[i]
      if (event.type === 'reasoning') {
        expandedEvents[event.id] = event.status === 'running'
      }
    }
  }

  // 检查已有事件的状态变化
  const reasoningEvents = events.filter(e => e.type === 'reasoning')
  for (const event of reasoningEvents) {
    const currentExpanded = expandedEvents[event.id]
    // 如果事件正在运行，默认展开；如果已完成且之前是自动展开的，可以折叠
    if (event.status === 'running' && currentExpanded === undefined) {
      expandedEvents[event.id] = true
    }
  }

  lastEventCount.value = newLength
})

const statusLabel = computed(() => {
  if (overallStatus.value === 'running') {
    const running = timelineEvents.value.find(e => e.status === 'running')
    if (running) return running.label
    const lastMsg = props.messages[props.messages.length - 1]
    if (lastMsg?.toolCalls?.some(tc => tc.status === 'running')) return t('timeline.working')
    return t('timeline.responding')
  }
  if (overallStatus.value === 'error') return t('timeline.error')
  return t('timeline.done')
})

// ========== 用时计时器 ==========
const now = ref(Date.now())
let timerInterval: ReturnType<typeof setInterval> | null = null

watch(overallStatus, (status) => {
  if (status === 'running') {
    if (!timerInterval) {
      timerInterval = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  } else {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }
}, { immediate: true })

onUnmounted(() => {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
})

const turnStartTime = computed(() => props.messages[0]?.timestamp || Date.now())

const totalElapsedMs = computed(() => {
  if (overallStatus.value === 'running') {
    return Math.max(0, now.value - turnStartTime.value)
  }
  const finalMsg = props.messages.find(m => m.id === getFinalMetadataMessageId(props.messages))
  return finalMsg?.metadata?.duration || 0
})

const timerText = computed(() => {
  const ms = totalElapsedMs.value
  if (ms <= 0) return '0.0s'
  if (overallStatus.value === 'running') {
    const totalSec = Math.floor(ms / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${(ms / 1000).toFixed(1)}s`
})

const finalMetadata = computed(() => {
  const finalMsg = props.messages.find(m => m.id === getFinalMetadataMessageId(props.messages))
  return finalMsg?.metadata
})

const reasoningDurationMs = computed<number | null>(() => {
  for (const msg of props.messages) {
    if (msg.reasoning?.endTime && msg.reasoning?.startTime) {
      return msg.reasoning.endTime - msg.reasoning.startTime
    }
  }
  for (const event of timelineEvents.value) {
    if (event.type === 'reasoning' && event.duration) {
      return parseFloat(event.duration) * 1000
    }
  }
  return null
})

function toggleEvent(eventId: string) {
  expandedEvents[eventId] = !expandedEvents[eventId]
}

function shouldRenderSpecialComponent(event: TimelineEvent): boolean {
  return !!event.specialComponent
}

function getToolContentKey(tool: ToolCall): string {
  const input = tool.input || {}
  return [
    input.file_path || input.path || '',
    input.old_string ? String(input.old_string).length : 0,
    input.new_string ? String(input.new_string).length : 0,
    tool.output ? tool.output.length : 0,
  ].join(':')
}

function getTaskStateContentKey(tool: ToolCall): string {
  if (!TASK_LIST_TOOL_NAMES.has(tool.name)) return ''
  const input = tool.input || {}
  const taskId = input.taskId || input.id || ''
  const existingTask = typeof taskId === 'string' ? taskManager.getTaskById(taskId) : undefined
  return [
    existingTask?.content || '',
    existingTask?.description || '',
    existingTask?.status || '',
    input.subject || input.description || input.content || input.title || input.status || '',
  ].join(':')
}

function getSpecialComponentKey(event: TimelineEvent): string {
  if (event.toolCall) {
    // AskUserQuestion 卡片在 pending→completed 切换后需保持挂载，以保留本地
    // selections/customInputs 供汇总展示。若 key 随 output 变化，tool_result
    // 到达会触发 remount 并丢失本地状态，导致汇总卡片无法显示用户已选答案。
    if (event.toolCall.name === 'AskUserQuestion') return event.toolCall.id
    return `${event.toolCall.id}:${getToolContentKey(event.toolCall)}`
  }
  return event.id
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
  if (output.length > maxLen) return output.slice(0, maxLen) + t('timeline.truncated')
  return output
}

// ========== Task list parsing ==========

function hasFinalMetadata(metadata?: MessageMetadata): boolean {
  return !!(metadata?.model || metadata?.inputTokens || metadata?.outputTokens || metadata?.duration)
}

function getFinalMetadataMessageId(msgs: Message[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (hasFinalMetadata(msg.metadata)) return msg.id
  }
  return ''
}

const allTasks = computed(() => {
  return taskManager.getAllTasks().map(task => ({
    id: task.id,
    content: task.description || task.content,
    status: task.status,
    owner: task.owner,
    blockedBy: task.blockedBy
  } as TaskListItem))
})

/**
 * 当前助手分组是否包含任务相关工具调用（TodoWrite / TaskList / TaskCreate / TaskUpdate）。
 * 全局 taskManager 是跨轮次共享的单例，如果不加此守卫，
 * 后续轮次的 AgentTimeline 也会渲染相同的任务看板，
 * 导致任务看板"漂浮"到最新轮次底部而非绑定到创建它的那一轮。
 */
const hasTaskToolCalls = computed(() => {
  return props.messages.some(msg =>
    msg.toolCalls?.some(tool => TASK_LIST_TOOL_NAMES.has(tool.name))
  )
})

const shouldShowTaskBoard = computed(() =>
  allTasks.value.length > 1 && hasTaskToolCalls.value
)

function toTaskListItem(task: {
  id?: string
  content?: string
  description?: string
  status?: string
  owner?: string
  blockedBy?: string[]
}): TaskListItem | null {
  const status = task.status
  const content = task.description || task.content
  if (!content || !status || !TASK_STATUSES.has(status)) return null
  return {
    id: task.id,
    content,
    status: status as TaskListItem['status'],
    owner: task.owner,
    blockedBy: task.blockedBy
  }
}

function getTaskDisplayContent(input: Record<string, any>, fallback?: string): string {
  const value = input.description || input.subject || input.content || input.title || fallback
  return typeof value === 'string' ? value : ''
}

function getTaskListItems(toolCall: ToolCall): TaskListItem[] {
  if (toolCall.name === 'TodoWrite') return parseTodoWriteItems(toolCall.input)
  if (toolCall.name === 'TaskList') return parseTaskListOutput(toolCall.output)
  if (toolCall.name === 'TaskCreate') return parseTaskCreateOutput(toolCall.output, toolCall.input)
  if (toolCall.name === 'TaskUpdate') return parseTaskUpdateOutput(toolCall.output, toolCall.input)
  return []
}

function parseTodoWriteItems(input: Record<string, any>): TaskListItem[] {
  if (!Array.isArray(input.todos)) return []
  return input.todos
    .map((todo) => toTaskListItem(todo))
    .filter((todo): todo is TaskListItem => !!todo)
}

function parseTaskListOutput(output?: string): TaskListItem[] {
  if (!output || output === 'No tasks found') return []
  return output.split('\n').reduce<TaskListItem[]>((items, line) => {
    const match = line.match(/^#([^\s]+) \[(pending|in_progress|completed)\] (.*?)(?: \(([^)]+)\))?(?: \[blocked by (.+)\])?$/)
    if (!match) return items
    items.push({
      id: match[1],
      status: match[2] as TaskListItem['status'],
      content: match[3],
      owner: match[4],
      blockedBy: match[5]?.split(', ').filter(Boolean) || []
    })
    return items
  }, [])
}

function parseTaskCreateOutput(output?: string, input: Record<string, any> = {}): TaskListItem[] {
  if (!output) return []
  const match = output.match(/^Task #(\d+) created successfully: (.+)$/)
  if (!match) return []
  const content = getTaskDisplayContent(input, match[2])
  return [{
    id: match[1],
    content,
    status: 'pending'
  }]
}

function parseTaskUpdateOutput(output?: string, input: Record<string, any> = {}): TaskListItem[] {
  const updatedMatch = output?.match(/^Updated task #(\d+)/)
  const inputTaskId = typeof input.taskId === 'string' ? input.taskId : undefined
  const taskId = updatedMatch?.[1] || inputTaskId
  if (!taskId) return []

  const existingTask = taskManager.getTaskById(taskId)
  const statusChangeMatch = output?.match(/statusChange: (\w+) -> (\w+)/)
  const inputStatus = typeof input.status === 'string' ? input.status : undefined
  const status = existingTask?.status || inputStatus || (statusChangeMatch ? statusChangeMatch[2] : undefined)
  const fallbackContent = existingTask?.description || existingTask?.content
  const content = getTaskDisplayContent(input, fallbackContent)

  if (!content || !status || !TASK_STATUSES.has(status)) return []
  return [{
    id: taskId,
    content,
    status: status as TaskListItem['status'],
    owner: existingTask?.owner,
    blockedBy: existingTask?.blockedBy
  }]
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

.timeline-timer {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  transition: all var(--transition-fast);

  &.running {
    color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }

  &.completed {
    color: var(--text-muted);
    background: var(--bg-tertiary);
  }

  &.error {
    color: var(--error);
    background: var(--error-glow);
  }

  .timer-icon {
    flex-shrink: 0;
  }

  &.running .timer-icon {
    animation: timer-pulse 1.5s ease-in-out infinite;
  }
}

@keyframes timer-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.timeline-events {
  margin-left: 14px;
  padding-left: 0;
}

.timeline-task-board {
  margin-top: 8px;
  margin-left: 32px;
}

.event-task-inline {
  margin: 4px 0;
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
    padding-bottom: 2px;
  }
}

.event-reasoning {
  .event-body {
    padding-top: 4px;
    padding-bottom: 0;
  }
}

.event-tool_call {
  .event-body {
    padding-top: 0;
    padding-bottom: 4px;
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
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.meta-tag {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 4px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* TurnSummaryBar 在 timeline 中的定位：与事件列表左对齐 */
.timeline-turn-summary {
  margin-left: 36px;
}
</style>
