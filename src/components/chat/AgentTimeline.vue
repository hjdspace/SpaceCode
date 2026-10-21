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
      <template v-for="(item, index) in displayItems" :key="item.groupId || item.event?.id || `item-${index}`">
        <!-- ── 工具调用折叠组 (Tool Chips) ── -->
        <div v-if="item.type === 'tool-group'" class="tool-group">
          <!-- 折叠时：紧凑 chips 摘要行 -->
          <div v-if="isToolGroupCollapsed(item.groupId!)" class="tool-group__summary">
            <button
              type="button"
              class="tool-group__toggle"
              :aria-expanded="false"
              @click="toggleToolGroup(item.groupId!)"
            >
              <svg
                class="tool-group__chevron"
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
              <Loader2
                v-if="getGroupRunStatus(item.events!) === 'running'"
                :size="12"
                class="spin-icon tool-group__status tool-group__status--running"
              />
              <AlertCircle
                v-else-if="getGroupRunStatus(item.events!) === 'error'"
                :size="12"
                class="tool-group__status tool-group__status--error"
              />
              <span class="tool-group__count">
                {{ t('chat.toolChips.toolCalls', { count: item.events!.length }) }}
              </span>
            </button>
            <!-- 紧凑 chips（带工具图标） -->
            <div class="tool-group__chips">
              <span
                v-for="(chip, ci) in getGroupChips(item.events!).slice(0, CHIP_CAP)"
                :key="ci"
                class="tool-group__chip"
                :class="{ 'tool-group__chip--mono': chip.mono }"
              >
                <component :is="chip.icon" :size="11" class="tool-group__chip-icon" />
                <span class="tool-group__chip-text">{{ chip.text }}</span>
              </span>
              <span
                v-if="getGroupChips(item.events!).length > CHIP_CAP"
                class="tool-group__chip tool-group__chip--more"
              >
                {{ t('chat.toolChips.more', { count: getGroupChips(item.events!).length - CHIP_CAP }) }}
              </span>
            </div>
            <!-- diff 统计 chips -->
            <div v-if="getGroupDiffStats(item.events!).length > 0" class="tool-group__diffs">
              <span
                v-for="(diff, di) in getGroupDiffStats(item.events!).slice(0, DIFF_CAP)"
                :key="diff.file"
                class="tool-group__diff-chip"
                :style="{ '--chip-delay': `${di * 80}ms` }"
              >
                <span class="tool-group__diff-file">{{ diff.file }}</span>
                <span class="tool-group__diff-add">+{{ diff.add }}</span>
                <span v-if="diff.del > 0" class="tool-group__diff-del">−{{ diff.del }}</span>
              </span>
            </div>
          </div>

          <!-- 展开时：显示折叠按钮 + 逐行工具事件 -->
          <button
            v-else
            type="button"
            class="tool-group__toggle tool-group__toggle--expanded"
            :aria-expanded="true"
            @click="toggleToolGroup(item.groupId!)"
          >
            <svg
              class="tool-group__chevron tool-group__chevron--expanded"
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            <Loader2
              v-if="getGroupRunStatus(item.events!) === 'running'"
              :size="12"
              class="spin-icon tool-group__status tool-group__status--running"
            />
            <AlertCircle
              v-else-if="getGroupRunStatus(item.events!) === 'error'"
              :size="12"
              class="tool-group__status tool-group__status--error"
            />
            <span class="tool-group__count">
              {{ t('chat.toolChips.toolCalls', { count: item.events!.length }) }}
            </span>
          </button>

          <!-- 展开面板（grid 动画）：专用卡片 + generic 工具行 + diff chips -->
          <div class="tool-group__expand-panel" :class="{ 'tool-group__expand-panel--open': !isToolGroupCollapsed(item.groupId!) }">
            <div class="tool-group__expand-clip">
              <div class="tool-group__events">
                <template v-for="event in item.events!" :key="event.id">
                  <!-- 带专用组件的工具：卡片 UI 原样渲染 -->
                  <div
                    v-if="event.specialComponent"
                    :key="`card-${getSpecialComponentKey(event)}`"
                    class="tool-group__card"
                  >
                    <component
                      :is="event.specialComponent"
                      :tool-call="toolOf(event)!"
                      :now="toolNeedsNow(event) ? now : undefined"
                      @submit="handleToolSubmit(toolOf(event)!.id, $event)"
                      @skip="handleToolSkip(toolOf(event)!.id)"
                    />
                  </div>

                  <!-- generic 工具行 -->
                  <div v-else class="tool-row" :class="[`status-${event.status}`]">
                    <button
                      type="button"
                      class="tool-row__button"
                      :aria-expanded="expandedEvents[event.id]"
                      @click="toggleEvent(event.id)"
                    >
                      <span class="tool-row__icon-wrap">
                        <span class="tool-row__icon" :class="{ 'tool-row__icon--hidden': expandedEvents[event.id] }">
                          <Loader2 v-if="event.status === 'running'" :size="13" class="spin-icon" />
                          <X v-else-if="event.status === 'error'" :size="13" />
                          <component v-else :is="event.icon" :size="13" />
                        </span>
                        <svg
                          class="tool-row__chevron"
                          :class="{ 'tool-row__chevron--open': expandedEvents[event.id] }"
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                      <span class="tool-row__label">{{ event.label }}</span>
                      <span v-if="toolTarget(event)" class="tool-row__chip" :class="{ 'tool-row__chip--mono': isMonoTool(toolOf(event)?.name) }">
                        {{ toolTarget(event) }}
                      </span>
                      <span v-if="toolDuration(event)" class="tool-row__duration">{{ toolDuration(event) }}s</span>
                    </button>

                    <!-- detail panel with grid animation -->
                    <div
                      class="detail-panel"
                      :class="{ 'detail-panel--open': expandedEvents[event.id] }"
                    >
                      <div class="detail-panel__clip">
                        <template v-if="expandedEvents[event.id]">
                          <div class="detail-lines">
                            <div v-if="toolOf(event)?.input && Object.keys(toolOf(event)!.input).length" class="detail-line detail-line--code">
                              <pre class="detail-code"><code>{{ formatInput(toolOf(event)!) }}</code></pre>
                            </div>
                            <div v-if="toolOf(event)?.output" class="detail-line detail-line--code">
                              <pre class="detail-code output"><code>{{ formatOutput(toolOf(event)?.output || '') }}</code></pre>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>
              </div>

              <!-- diff chips（展开时底部显示，超出上限可展开剩余） -->
              <div v-if="getGroupDiffStats(item.events!).length > 0" class="tool-group__diff-list">
                <span
                  v-for="(diff, di) in visibleGroupDiffs(item.groupId!, item.events!)"
                  :key="diff.file"
                  class="tool-group__diff-chip"
                  :style="{ '--chip-delay': `${Math.min(di, 5) * 80}ms` }"
                >
                  <span class="tool-group__diff-file">{{ diff.file }}</span>
                  <span class="tool-group__diff-add">+{{ diff.add }}</span>
                  <span v-if="diff.del > 0" class="tool-group__diff-del">−{{ diff.del }}</span>
                </span>
                <button
                  v-if="hasMoreGroupDiffs(item.groupId!, item.events!)"
                  type="button"
                  class="tool-group__more-btn"
                  @click="revealGroupDiffs(item.groupId!)"
                >
                  {{ t('chat.toolChips.more', { count: getGroupDiffStats(item.events!).length - visibleGroupDiffs(item.groupId!, item.events!).length }) }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── 单独事件（reasoning / text / special tool_call / metadata / error）── -->
        <div
          v-else
          class="timeline-event"
          :class="[`event-${item.event!.type}`, `status-${item.event!.status}`, { 'is-last': index === displayItems.length - 1 }]"
        >
          <!-- Timeline connector -->
          <div v-if="item.event!.type === 'metadata'" class="event-node">
            <div class="event-dot" :class="`status-${item.event!.status}`">
              <Loader2 v-if="item.event!.status === 'running'" :size="11" class="spin-icon" />
              <X v-else-if="item.event!.status === 'error'" :size="11" />
              <component v-else :is="item.event!.icon" :size="11" />
            </div>
            <div v-if="index < displayItems.length - 1" class="event-line"></div>
          </div>
          <div v-else class="event-spacer"></div>

          <!-- Event content -->
          <div class="event-body">
            <!-- Reasoning event: 使用 ReasoningCard 复刻 soc-verify 的思考块 UI -->
            <template v-if="item.event!.type === 'reasoning'">
              <ReasoningCard
                :reasoning="reasoningForEvent(item.event!)"
                :is-thinking="item.event!.status === 'running'"
              />
            </template>

            <!-- Text event -->
            <template v-else-if="item.event!.type === 'text'">
              <div class="event-text-content">
                <MarkdownRenderer :content="item.event!.content" />
              </div>
            </template>

            <!-- Tool call event with special component -->
            <template v-else-if="item.event!.type === 'tool_call' && shouldRenderSpecialComponent(item.event!)">
              <component
                :is="item.event!.specialComponent"
                :key="getSpecialComponentKey(item.event!)"
                :tool-call="toolOf(item.event!)!"
                :now="toolNeedsNow(item.event!) ? now : undefined"
                @submit="handleToolSubmit(toolOf(item.event!)!.id, $event)"
                @skip="handleToolSkip(toolOf(item.event!)!.id)"
              />
              <PermissionRequestCard
                v-if="!SELF_PERMISSION_TOOL_NAMES.has(toolOf(item.event!)!.name) && getPendingPermission(toolOf(item.event!)!.id)"
                :message-id="item.event!.messageId!"
                :tool-use-id="toolOf(item.event!)!.id"
                :tool-name="getPendingPermission(toolOf(item.event!)!.id)!.toolName"
                :input="getPendingPermission(toolOf(item.event!)!.id)!.input"
              />
            </template>

            <!-- Generic tool call event (single, not in a group) -->
            <template v-else-if="item.event!.type === 'tool_call'">
              <div class="tool-row" :class="[`status-${item.event!.status}`]">
                <button
                  type="button"
                  class="tool-row__button"
                  :aria-expanded="expandedEvents[item.event!.id]"
                  @click="toggleEvent(item.event!.id)"
                >
                  <span class="tool-row__icon-wrap">
                    <span class="tool-row__icon" :class="{ 'tool-row__icon--hidden': expandedEvents[item.event!.id] }">
                      <Loader2 v-if="item.event!.status === 'running'" :size="13" class="spin-icon" />
                      <X v-else-if="item.event!.status === 'error'" :size="13" />
                      <component v-else :is="item.event!.icon" :size="13" />
                    </span>
                    <svg
                      class="tool-row__chevron"
                      :class="{ 'tool-row__chevron--open': expandedEvents[item.event!.id] }"
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                  <span class="tool-row__label">{{ item.event!.label }}</span>
                  <span v-if="toolTarget(item.event!)" class="tool-row__chip" :class="{ 'tool-row__chip--mono': isMonoTool(toolOf(item.event!)?.name) }">
                    {{ toolTarget(item.event!) }}
                  </span>
                  <span v-if="toolDuration(item.event!)" class="tool-row__duration">{{ toolDuration(item.event!) }}s</span>
                </button>

                <div class="detail-panel" :class="{ 'detail-panel--open': expandedEvents[item.event!.id] }">
                  <div class="detail-panel__clip">
                    <template v-if="expandedEvents[item.event!.id]">
                      <div class="detail-lines">
                        <div v-if="toolOf(item.event!)?.input && Object.keys(toolOf(item.event!)!.input).length" class="detail-line detail-line--code">
                          <pre class="detail-code"><code>{{ formatInput(toolOf(item.event!)!) }}</code></pre>
                        </div>
                        <div v-if="toolOf(item.event!)?.output" class="detail-line detail-line--code">
                          <pre class="detail-code output"><code>{{ formatOutput(toolOf(item.event!)?.output || '') }}</code></pre>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>

                <PermissionRequestCard
                  v-if="toolOf(item.event!) && getPendingPermission(toolOf(item.event!)!.id)"
                  :message-id="item.event!.messageId!"
                  :tool-use-id="toolOf(item.event!)!.id"
                  :tool-name="getPendingPermission(toolOf(item.event!)!.id)!.toolName"
                  :input="getPendingPermission(toolOf(item.event!)!.id)!.input"
                />
              </div>
            </template>

            <!-- Metadata event -->
            <template v-else-if="item.event!.type === 'metadata'">
              <div class="event-meta">
                <span v-if="item.event!.metadata?.model" class="meta-tag">{{ item.event!.metadata.model }}</span>
                <span v-if="item.event!.metadata?.inputTokens" class="meta-tag">↑{{ item.event!.metadata.inputTokens }}</span>
                <span v-if="item.event!.metadata?.outputTokens" class="meta-tag">↓{{ item.event!.metadata.outputTokens }}</span>
                <span v-if="item.event!.metadata?.duration" class="meta-tag">{{ (item.event!.metadata.duration / 1000).toFixed(1) }}s</span>
              </div>
            </template>

            <!-- Error event -->
            <template v-else-if="item.event!.type === 'error' && item.event!.classifiedError">
              <ErrorCard
                :error="item.event!.classifiedError"
                @retry="handleRetry"
                @dismiss="handleDismissError"
              />
            </template>

            <!-- pi 扩展对话框：会话级的一次提问，没有 toolCall 可挂，只能自己成一条 (#54) -->
            <template v-else-if="item.event!.type === 'extension_dialog' && item.event!.dialog">
              <ExtensionDialogCard :dialog="item.event!.dialog" />
            </template>
          </div>
        </div>
      </template>

      <!-- Engine 内部重试中提示：429/529 等错误时 engine 自动重试 -->
      <div v-if="engineRetryState && engineRetrySeconds > 0" class="timeline-engine-retry">
        <div class="engine-retry-card">
          <AlertTriangle :size="14" class="engine-retry-icon" />
          <div class="engine-retry-body">
            <span class="engine-retry-title">{{ engineRetryState.errorTitle }}</span>
            <span class="engine-retry-detail">
              {{ t('errors.retryCountdown', { attempt: engineRetryState.attempt, max: engineRetryState.maxRetries, seconds: engineRetrySeconds }) }}
            </span>
          </div>
          <Loader2 :size="12" class="spin-icon engine-retry-spinner" />
        </div>
      </div>

      <div v-else-if="engineRetryState" class="timeline-waiting">
        <ThinkingState
          :start-time="engineRetryState.startedAt + engineRetryState.delayMs"
          variant="responding"
        />
      </div>

      <!-- 等待 LLM 下一轮响应：工具调用结束后的间隙指示（修复2） -->
      <div v-else-if="isWaitingForLlm && !engineRetryState" class="timeline-waiting">
        <ThinkingState
          :start-time="turnStartTimestamp"
          variant="responding"
        />
      </div>

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
import type { Message, ToolCall, MessageMetadata, ClassifiedError, ReasoningBlock } from '@/types'
import type { Component } from 'vue'
import { computed, markRaw, onMounted, onUnmounted, reactive, watch, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { hasToolComponent, resolveToolComponent } from '@/components/chat/tools/index'
import PermissionRequestCard from './tools/PermissionRequestCard.vue'
import ExtensionDialogCard from './tools/ExtensionDialogCard.vue'
import { type ExtensionDialog } from '@/services/extensionDialogService'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ErrorCard from '../common/ErrorCard.vue'
import TurnSummaryBar from './TurnSummaryBar.vue'
import ThinkingState from './ThinkingState.vue'
import ReasoningCard from './ReasoningCard.vue'
import { stripDesignTags } from '@/utils/chat/buildBlocks'
import { extractEditParts } from '@/lib/editInput'
import { errorHandler } from '@/services/errorHandler'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import {
  Loader2, X, ChevronDown, Bot, AlertCircle, AlertTriangle, Clock,
  Terminal, FileText, FileEdit, Search, Globe, Wand2, Folder, Code,
  MessageCircle, Info, ListChecks
} from 'lucide-vue-next'

const EmptyIcon = () => null

const TASK_LIST_ONLY_TOOL_NAMES = new Set(['TaskList', 'TaskCreate', 'TaskUpdate'])
// 这些工具的特殊组件本身就是权限交互 UI（emit submit/skip，并把合并后的
// updatedInput 交给 store.allowPermission）。若再叠加 PermissionRequestCard，
// 既会重复显示操作按钮，又会把原始 input（如 AskUserQuestion 的 questions
// 数组）以 JSON 形式泄露到卡片下方，且 Allow 按钮会以不带 answers 的原始
// input 提交，破坏问答流程。
const SELF_PERMISSION_TOOL_NAMES = new Set(['AskUserQuestion'])
// plan 模式的两张交互卡是用户决策的承重面：问卷要答题、计划要读完才能行动，
// 折进「N 个工具调用」等于把 Plan 藏起来（截图中计划卡整个消失）——永远独立成行。
const PROMOTED_TOOL_NAMES = new Set(['plan_mode_question', 'plan_mode_complete'])

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
  type: 'reasoning' | 'text' | 'tool_call' | 'metadata' | 'error' | 'extension_dialog'
  status: 'running' | 'completed' | 'error' | 'pending'
  icon: Component
  label: string
  content: string
  /** 工具事件只存身份，toolCall 本体在渲染时从 messages 解析 —— 缓存里存对象引用会握住被替换掉的旧 input */
  toolCallId?: string
  /** reasoning 事件的耗时（秒）。工具耗时由 toolCall 实时计算，不进缓存 */
  duration?: string
  messageId?: string
  metadata?: MessageMetadata
  specialComponent?: Component
  classifiedError?: ClassifiedError
  /** type 为 extension_dialog 时的那条 pi 扩展对话框；它不属于任何 message，只属于会话 */
  dialog?: ExtensionDialog
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
  /**
   * 本组消息名下要渲染的扩展对话框，由 MessageList 按会话与消息分组分配。
   *
   * 组件不能自己读全局 service：会话里每条 assistant 消息都挂一个 AgentTimeline，
   * 各实例都读全量、都把自己没放下的卡片追加到末尾，别的分组的卡片就会在本组
   * 重复出现 (#54)。
   */
  dialogs?: ExtensionDialog[]
}>()

const expandedEvents = reactive<Record<string, boolean>>({})

const sessionStore = useChatSessionStore()
const turnStore = useTurnStore()
const { t } = useI18n()

function getPendingPermission(toolUseId: string) {
  return turnStore.getPendingPermissionForToolUse(toolUseId)
}

/**
 * toolCall 本体从当前 messages 解析，而不是塞进缓存的 TimelineEvent。
 *
 * turn store 补 input/output 一律是「换对象」，缓存若持有旧引用，键不变的期间卡片
 * 就永远看不到新值（Bash 的 command 曾因此直到工具结束才出现）。缓存只保留身份，
 * 渲染时读这份响应式索引，任何一次替换都会把新对象送进卡片。
 */
const toolCallsById = computed(() => {
  const map = new Map<string, ToolCall>()
  for (const msg of props.messages) {
    for (const tool of msg.toolCalls || []) map.set(`${msg.id}:${tool.id}`, tool)
  }
  return map
})

function toolOf(event: TimelineEvent): ToolCall | undefined {
  if (!event.toolCallId) return undefined
  return toolCallsById.value.get(`${event.messageId ?? ''}:${event.toolCallId}`)
}

function toolTarget(event: TimelineEvent): string {
  const tool = toolOf(event)
  return tool ? getToolTarget(tool) : ''
}

function toolDuration(event: TimelineEvent): string | null {
  const tool = toolOf(event)
  return tool ? getToolDuration(tool) : null
}

/** 只有会在标题里显示耗时的卡片需要 now；传给未声明该 prop 的组件会落到根 DOM 上 */
function toolNeedsNow(event: TimelineEvent): boolean {
  const name = toolOf(event)?.name
  return name === 'Bash' || name === 'TaskOutput'
}

function handleRetry() {
  turnStore.retryLastMessage()
}

function handleDismissError() {
  const sid = sessionStore.currentSessionId
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

/**
 * 就地归一化 events[from..] —— 一个 assistant 轮次产出的事件片段。
 *
 * 1. 丢弃已收口的空 reasoning 事件。上游兼容层会在 text 块之间夹入没有
 *    任何 thinking_delta 的占位 thinking 块，渲染出来是一行空白折叠卡片，
 *    把答复切成一段段插在中间。运行中的空块保留 —— 那是"思考中"动画的首帧。
 * 2. 把相邻的 text 事件合并成一个 Markdown 文档。Anthropic 一轮内只会有一个
 *    连续 text 块，多个相邻 text 事件是兼容层按帧切块的产物；逐块渲染会把
 *    `**粗体**`、列表、表格的语法边界截断成互不相干的碎片。
 * 3. 合并之后才剥离设计专用标签，保证跨帧的 <od-card> 仍能整体匹配。
 */
function normalizeMessageEvents(events: TimelineEvent[], from: number, designMode: boolean): void {
  const normalized: TimelineEvent[] = []
  let textRun: TimelineEvent[] = []

  const flushTextRun = () => {
    if (!textRun.length) return
    const raw = textRun.map(event => event.content).join('')
    const content = designMode ? stripDesignTags(raw) : raw
    if (content.trim()) {
      normalized.push({
        ...textRun[0],
        content,
        status: textRun.some(event => event.status === 'running') ? 'running' : 'completed',
      })
    }
    textRun = []
  }

  for (const event of events.slice(from)) {
    if (event.type === 'text') {
      textRun.push(event)
      continue
    }
    // 先判丢弃再 flush：空占位块被打断的正是同一段答复，若先 flush 就会把
    // 一个 text run 拆成多块，合并等于没做。
    if (event.type === 'reasoning' && event.status !== 'running' && !event.content.trim()) continue
    flushTextRun()
    normalized.push(event)
  }
  flushTextRun()

  events.splice(from, events.length - from, ...normalized)
}

function toDialogEvent(dialog: ExtensionDialog): TimelineEvent {
  return {
    id: `extension-dialog-${dialog.dialogId}`,
    type: 'extension_dialog',
    status: dialog.state === 'pending' ? 'running' : 'completed',
    icon: markRaw(MessageCircle),
    label: dialog.title,
    content: '',
    dialog,
  }
}

/**
 * 把这一轮问出来的扩展对话框插回它发生的位置 (issue #54)。
 *
 * 游标是 store 在收到帧的那一刻记下的（当时该消息最后一个 timeline 事件，通常就是触发
 * 提问的那个工具行）。`anchorAtStart` 表示提问发生时消息还没有事件，卡片要排在本消息
 * 全部事件之前；只有事件游标已经不存在时才退到消息末尾 —— 关键是别退到全局末尾：
 * 卡片吊在最后，用户答完之后 LLM 的续写就全被它压在下面，看着像这张卡永远挂在底部。
 *
 * 必须在 normalizeMessageEvents 之前插：归一化会把相邻 text 块并成一个文档，插在那之后
 * 游标就对不上了；插在那之前，卡片本身成为两个 text run 的边界，答复不会被错并成一坨。
 */
function insertDialogEvents(
  events: TimelineEvent[],
  from: number,
  messageId: string,
  dialogs: ExtensionDialog[],
  placed: Set<string>,
): void {
  const startAnchored = dialogs.filter(dialog =>
    !placed.has(dialog.dialogId) &&
    dialog.anchorAtStart &&
    dialog.anchorMessageId === messageId,
  )
  for (const dialog of startAnchored) {
    placed.add(dialog.dialogId)
  }

  const byAnchorEvent = new Map<string, ExtensionDialog[]>()
  for (const dialog of dialogs) {
    if (dialog.anchorAtStart || !dialog.anchorEventId || placed.has(dialog.dialogId)) continue
    const bucket = byAnchorEvent.get(dialog.anchorEventId)
    if (bucket) bucket.push(dialog)
    else byAnchorEvent.set(dialog.anchorEventId, [dialog])
  }

  const merged: TimelineEvent[] = startAnchored.map(toDialogEvent)
  for (const event of events.slice(from)) {
    merged.push(event)
    for (const dialog of byAnchorEvent.get(event.id) ?? []) {
      if (placed.has(dialog.dialogId)) continue
      placed.add(dialog.dialogId)
      merged.push(toDialogEvent(dialog))
    }
  }

  for (const dialog of dialogs) {
    if (placed.has(dialog.dialogId) || dialog.anchorMessageId !== messageId) continue
    placed.add(dialog.dialogId)
    merged.push(toDialogEvent(dialog))
  }

  events.splice(from, events.length - from, ...merged)
}

function buildTimelineEvents(msgs: Message[]): TimelineEvent[] {
  // 只把结构字段放进键：input/output 的更新由 toolOf() 在渲染时解析，不需要重建事件数组
  const toolStateKey = msgs
    .flatMap(msg => (msg.toolCalls || []).map(tool => [
      tool.id,
      tool.name,
      tool.status,
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
  // pi 的扩展对话框属于会话而不是某条消息（它不带 toolCallId，也没有对应工具条目），
  // 所以只能作为视图层合成的事件插进时间线 —— 与 ErrorCard 同一条路子 (#54)。
  // 会话/分组归属已由 MessageList 分配；这里再按消息 id 兜一层：锚在别组消息上的
  // 卡片即使被误传进来，也不能挂到本组末尾。
  const messageIds = new Set(msgs.map(msg => msg.id))
  const dialogs = (props.dialogs ?? []).filter(dialog =>
    !dialog.anchorMessageId || messageIds.has(dialog.anchorMessageId))
  // 卡片状态一变（答了、超时了、下一轮菜单来了）就要重算，因此必须进缓存键，
  // 否则命中旧数组、卡片停在原地不动。
  const dialogStateKey = dialogs
    .map(dialog => [dialog.dialogId, dialog.state, dialog.outcomeText ?? '', dialog.closedReason ?? ''].join(':'))
    .join('|')
  // 插到「问出来那一刻」的位置，而不是统统吊在末尾：存的是已插入的 dialogId (#54)
  const placedDialogIds = new Set<string>()

  const finalMetadataMessageId = props.loading ? '' : getFinalMetadataMessageId(msgs)
  const modeKey = props.mode || 'default'
  const key = msgs.length > 0
    ? `${modeKey}-${msgs.length}-${msgs[0]?.id}-${msgs[msgs.length - 1]?.id}-${toolStateKey}-${metadataStateKey}-${contentStateKey}-${finalMetadataMessageId}-${dialogStateKey}`
    : `empty-${modeKey}-${dialogStateKey}`

  if (_cachedTimelineEvents && _cachedTimelineKey === key) {
    return _cachedTimelineEvents
  }

  const events: TimelineEvent[] = []
  const timelineToolCallIds = new Set<string>()

  for (const msg of msgs) {
    const msgEventsStart = events.length
    const hasTimeline = msg.timelineEvents?.length

    if (hasTimeline) {
      for (const event of msg.timelineEvents!) {
        // 纯空白文本块（LLM 在工具调用间常输出 "\n"）若不过滤，
        // 会渲染成 min-height:28px 的空白占位行，导致卡片间距异常大。
        if (event.type === 'text' && !event.content?.trim()) continue
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
            toolCallId: tool.id,
            messageId: msg.id,
            specialComponent: specialComponents[tool.name] ? markRaw(specialComponents[tool.name]) : undefined,
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
          label: getToolLabel(tool.name),
          content: '',
          toolCallId: tool.id,
          messageId: msg.id,
          specialComponent: specialComponents[tool.name] ? markRaw(specialComponents[tool.name]) : undefined,
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
        events.push({
          id: `${msg.id}-text`,
          type: 'text',
          status: 'completed',
          icon: markRaw(MessageCircle),
          label: t('timeline.response'),
          content: msg.content,
        })
      }
    }

    insertDialogEvents(events, msgEventsStart, msg.id, dialogs, placedDialogIds)
    normalizeMessageEvents(events, msgEventsStart, props.mode === 'design')

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

  // 没锚到任何一条消息的（会话刚起就来的确认框、或那一轮的消息已被换掉）才落到末尾。
  // pi 的菜单是连着问的（选一项→再问一轮），答过的收成一行既让出视线，
  // 也保住「问过什么、答了什么」这条痕迹。
  for (const dialog of dialogs) {
    if (placedDialogIds.has(dialog.dialogId)) continue
    events.push(toDialogEvent(dialog))
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
  return timelineEvents.value.filter((event) => {
    if (event.type !== 'tool_call') return true
    const tool = toolOf(event)
    if (!tool) return true
    return !TASK_LIST_ONLY_TOOL_NAMES.has(tool.name)
  })
})

// ── 将连续的工具调用 run 合并为可折叠的 Tool Chips 组 ──
// 专用卡片工具（Bash/Read/Edit 等）同样参与折叠：卡片 UI 原样渲染在组内。
// 排除两类必须始终可见的工具：交互式问答（自身即权限 UI）与挂起中的权限请求。
interface DisplayItem {
  type: 'single' | 'tool-group'
  event?: TimelineEvent
  events?: TimelineEvent[]
  groupId?: string
}

// 折叠摘要行中目标 chips / diff chips 的展示上限
const CHIP_CAP = 8
const DIFF_CAP = 4

function isGroupableToolEvent(event: TimelineEvent): boolean {
  if (event.type !== 'tool_call') return false
  const tool = toolOf(event)
  if (!tool) return false
  if (SELF_PERMISSION_TOOL_NAMES.has(tool.name)) return false
  if (PROMOTED_TOOL_NAMES.has(tool.name)) return false
  return !getPendingPermission(tool.id)
}

const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = []
  let run: TimelineEvent[] = []

  const flushRun = () => {
    if (run.length === 0) return
    // ≥2 个连续工具、或带专用卡片的单个工具 → 折叠组；
    // 单个 generic 工具保持独立行（行本身就是紧凑形态）
    if (run.length >= 2 || run.some(e => !!e.specialComponent)) {
      items.push({ type: 'tool-group', events: run, groupId: `tool-group-${run[0].id}` })
    } else {
      for (const event of run) items.push({ type: 'single', event })
    }
    run = []
  }

  for (const event of visibleTimelineEvents.value) {
    if (isGroupableToolEvent(event)) {
      run.push(event)
    } else {
      flushRun()
      items.push({ type: 'single', event })
    }
  }
  flushRun()

  return items
})

// ── 工具组折叠状态 ──
// 手动操作优先。自动规则（sticky）：组内所有工具结束后折叠，且保持折叠 ——
// 后续同组追加的新工具由折叠摘要行的 spinner / chips 持续展示进度，
// 避免组在「工具结束 → 等待 LLM 下一轮 → 新工具开始」间反复展开/折叠闪烁。
// 新建的组（从未自动折叠过）在有工具运行时保持展开，用户可实时观看进度。
const manualToolGroupCollapse = reactive<Record<string, boolean>>({})
const autoCollapsedGroups = reactive<Record<string, boolean>>({})
// diff chips 超出 DIFF_CAP 后点击 "+N more" 展开剩余
const revealedDiffGroups = reactive<Record<string, boolean>>({})

watch(displayItems, (items) => {
  for (const item of items) {
    if (item.type !== 'tool-group') continue
    const hasActive = item.events!.some(e => e.status === 'running' || e.status === 'pending')
    if (!hasActive) autoCollapsedGroups[item.groupId!] = true
  }
}, { immediate: true })

function isToolGroupCollapsed(groupId: string): boolean {
  if (manualToolGroupCollapse[groupId] !== undefined) return manualToolGroupCollapse[groupId]
  if (autoCollapsedGroups[groupId]) return true
  const events = displayItems.value.find(item => item.groupId === groupId)?.events
  return !events?.some(e => e.status === 'running' || e.status === 'pending')
}

function toggleToolGroup(groupId: string) {
  manualToolGroupCollapse[groupId] = !isToolGroupCollapsed(groupId)
}

function getGroupRunStatus(events: TimelineEvent[]): 'running' | 'error' | 'completed' {
  if (events.some(e => e.status === 'running' || e.status === 'pending')) return 'running'
  if (events.some(e => e.status === 'error')) return 'error'
  return 'completed'
}

function visibleGroupDiffs(groupId: string, events: TimelineEvent[]): DiffStat[] {
  const stats = getGroupDiffStats(events)
  return revealedDiffGroups[groupId] ? stats : stats.slice(0, DIFF_CAP)
}

function hasMoreGroupDiffs(groupId: string, events: TimelineEvent[]): boolean {
  return !revealedDiffGroups[groupId] && getGroupDiffStats(events).length > DIFF_CAP
}

function revealGroupDiffs(groupId: string) {
  revealedDiffGroups[groupId] = true
}

// ── 工具组摘要信息 ──
function isMonoTool(toolName?: string): boolean {
  return ['Bash', 'Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit', 'Read', 'FileRead'].includes(toolName || '')
}

function getGroupChips(events: TimelineEvent[]): { text: string; mono: boolean; icon: Component }[] {
  return events.map(e => {
    const target = toolTarget(e)
    return { text: target, mono: isMonoTool(toolOf(e)?.name), icon: e.icon }
  }).filter(c => c.text)
}

interface DiffStat {
  file: string
  add: number
  del: number
}

function getGroupDiffStats(events: TimelineEvent[]): DiffStat[] {
  const stats: DiffStat[] = []
  for (const e of events) {
    const tool = toolOf(e)
    if (!tool) continue
    const input = tool.input || {}
    if (!['Edit', 'FileEdit', 'MultiEdit', 'Write', 'FileWrite'].includes(tool.name)) continue
    // pi 流式写入时 path 参数排在 content 之后，闭合引号要到生成末尾才出现；
    // 未到达前用「写入中」占位，路径闭合后节流刷新会自动换成真实文件名
    const file = (input.file_path || input.path || '').toString().replace(/\\/g, '/').split('/').pop() || t('chat.toolChips.writingFile')
    let add = 0
    let del = 0
    if (input.old_string && input.new_string) {
      del = String(input.old_string).split('\n').filter(l => l.trim()).length
      add = String(input.new_string).split('\n').filter(l => l.trim()).length
    } else if (input.content) {
      add = String(input.content).split('\n').filter(l => l.trim()).length
    } else if (input.edits && Array.isArray(input.edits)) {
      // 批量编辑：Claude MultiEdit 元素用 old_string/new_string，pi 用 oldText/newText —— 同一份归一化
      for (const part of extractEditParts(input)) {
        if (part.old && part.new) {
          del += String(part.old).split('\n').filter(l => l.trim()).length
          add += String(part.new).split('\n').filter(l => l.trim()).length
        }
      }
    }
    const existing = stats.find(s => s.file === file)
    if (existing) {
      existing.add += add
      existing.del += del
    } else {
      stats.push({ file, add, del })
    }
  }
  // 展示上限由调用方（DIFF_CAP + "+N more" 按钮）控制，这里返回全量
  return stats
}

const overallStatus = computed(() => {
  const lastMsg = props.messages[props.messages.length - 1]
  // loading 是权威的运行中信号。子代理转录经 JSONL 解析后每条 assistant 消息都带
  // metadata（model/tokens），不能再用 !lastMsg.metadata 判断是否流式结束，
  // 否则子代理运行期间会被误判为已完成（面板 hero 显示运行中、时间线却显示完成）。
  const isStreaming = props.loading && !!lastMsg
  if (isStreaming) return 'running'
  if (timelineEvents.value.some(e => e.status === 'running' || e.status === 'pending')) return 'running'
  if (timelineEvents.value.some(e => e.status === 'error')) return 'error'
  return 'completed'
})

// ── 等待 LLM 下一轮响应检测 ──
// loading 期间，若本 turn 已有可见内容，但没有任何进行中的活动
// （工具执行 / 推理 / 非空流式文本），也没有等待用户裁决的权限请求，
// 则说明工具结果已返回、正在等待 LLM 生成下一段响应（或引擎内部重试）。
// 该间隙此前完全没有行内指示，用户只能看到静止的已完成工具组。
const isWaitingForLlm = computed(() => {
  if (!props.loading) return false
  const msgs = props.messages
  if (!msgs.length) return false
  // 无可见内容时属于"等待首个 token"，由 MessageList 的 ThinkingState 负责
  const hasContent = msgs.some(m =>
    (m.content?.trim() ?? '') !== '' ||
    (m.reasoning?.content?.trim() ?? '') !== '' ||
    (m.toolCalls?.length ?? 0) > 0,
  )
  if (!hasContent) return false
  for (const m of msgs) {
    // 运行中/挂起的工具（含等待权限裁决的）已有自身的视觉指示（spinner / 权限卡片），
    // 不属于空闲等待
    if (m.toolCalls?.some(tc => tc.status === 'running' || tc.status === 'pending')) return false
    for (const ev of m.timelineEvents || []) {
      if (ev.status !== 'running' && ev.status !== 'pending') continue
      // 纯空白的 text 占位事件不可见（LLM 在工具调用间常输出 "\n"），不算活动
      if (ev.type === 'text' && !ev.content?.trim()) continue
      return false
    }
  }
  return true
})

// ── Engine 内部重试状态检测 ──
// 当 engine 在 API 调用期间遇到 429/529 等错误并自动重试时，
// 通过 SystemAPIErrorMessage 将 retryState 写入助手消息的 metadata。
// 这里读取该状态，展示"正在重连 (attempt/maxRetries)"提示。
const engineRetryState = computed(() => {
  // retryState 是 turn 级瞬态，只在 turn 进行中（loading）才有意义。
  // 前端 auto-retry 会保留带内容的失败助手消息，其 metadata.retryState 可能
  // 残留；若不加 loading 守卫，已完成的会话会因历史消息上的残留状态
  // 永久显示"正在回复"等待指示。
  if (!props.loading) return null
  const msgs = props.messages
  // 只认当前 turn 的助手消息（组内最后一条 assistant）。更早消息上的
  // retryState 属于已结算的旧 turn，一律忽略，避免旧重试状态在
  // 续跑的新 turn 里伪装成"正在重连/正在回复"。
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'assistant') return m.metadata?.retryState ?? null
  }
  return null
})

const engineRetrySeconds = computed(() => {
  if (!engineRetryState.value) return 0
  return Math.max(0, Math.ceil((engineRetryState.value.startedAt + engineRetryState.value.delayMs - now.value) / 1000))
})

// 等待指示行的计时起点：本组内最近一次活动的结束时刻 ——
// 取工具结果返回时间（toolCalls.endTime）与最后一个时间线事件创建时间的最大值，
// 即当前这轮"等待 LLM 响应"间隙的开始，每轮等待各自从 0 计时、不累加此前轮次。
// 使用持久化在消息上的时间戳而非组件挂载时刻，跨页面/会话切换重建后计时不归零。
const turnStartTimestamp = computed(() => {
  let latest = props.messages[0]?.timestamp || 0
  for (const m of props.messages) {
    for (const tc of m.toolCalls || []) {
      if (tc.endTime && tc.endTime > latest) latest = tc.endTime
    }
    for (const ev of m.timelineEvents || []) {
      if (ev.timestamp > latest) latest = ev.timestamp
    }
  }
  return latest
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

/**
 * 把 TimelineEvent (reasoning) 转换为 ReasoningCard 需要的 ReasoningBlock。
 * - 运行中: endTime=undefined → ReasoningCard 显示 "思考中..." + 动画 dots，自动展开
 * - 已完成: 用 duration 字段构造 startTime/endTime，自动折叠
 */
function reasoningForEvent(event: TimelineEvent): ReasoningBlock {
  const content = event.content || ''
  if (event.status === 'running') {
    return { content, startTime: now.value, endTime: undefined }
  }
  // 已完成: duration 字段是秒数字符串 (如 "2.3")
  const durSec = event.duration ? parseFloat(event.duration) : 0
  return { content, startTime: 0, endTime: durSec * 1000 }
}

function getSpecialComponentKey(event: TimelineEvent): string {
  // key 只跟工具 id 走：数据更新由响应式 props 驱动，若随 output/input 变化重挂载，
  // 流式输出会把卡片的本地状态（展开、AskUserQuestion 的选择）周期性清掉。
  return toolOf(event)?.id || event.id
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
  // now 每秒推进（overallStatus 为 running 时），运行中的耗时才不会停在建卡那一刻
  const end = tool.endTime || now.value
  return ((end - tool.startTime) / 1000).toFixed(1)
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
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.timeline-status-badge {
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
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
  font-size: var(--text-2xs);
  font-family: var(--font-mono);
  font-weight: var(--font-weight-medium);
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

/* 等待 LLM 下一轮响应指示行：与工具行/文本列对齐（22px 轴 + 10px 内边距） */
.timeline-waiting {
  margin-left: 32px;
  padding: 2px 0 6px;
}

/* Engine 内部重试中提示卡片 */
.timeline-engine-retry {
  margin: 4px 0 4px 32px;
}

.engine-retry-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.06);
}

.engine-retry-icon {
  flex-shrink: 0;
  color: #f59e0b;
}

.engine-retry-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.engine-retry-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.engine-retry-detail {
  font-size: 12px;
  color: var(--text-secondary);
}

.engine-retry-spinner {
  flex-shrink: 0;
  color: var(--text-muted);
  animation: spin 1s linear infinite;
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
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
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
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-duration {
  font-size: var(--text-2xs);
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
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  line-height: var(--leading-relaxed);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  max-height: 200px;
  overflow-y: auto;
  @include scrollbar-overlay;

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
  font-size: var(--text-2xs);
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

/* ── 工具调用折叠组样式 ── */
.tool-group {
  margin-bottom: 2px;
}

.tool-group__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  /* 折叠组不经过 .timeline-event 的 22px 轴留白 + 10px 正文内边距（文本列共 32px），
     而 toggle 内部箭头(12px)+间距(6px)使计数文案右移 18px，补 32-18=14px
     让 "N 个工具调用" 与消息文本左对齐，箭头留在时间轴槽内 */
  padding: 2px 0 2px 14px;
}

.tool-group__toggle {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 6px;
  margin-inline: -6px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-sm-plus);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.tool-group__toggle--expanded {
  /* 覆盖基础 -6px 外边距：与折叠摘要行同列（箭头对齐轴槽，文案对齐文本列） */
  margin-left: 8px;
  margin-bottom: 2px;
}

.tool-group__chevron {
  flex-shrink: 0;
  transition: transform 200ms ease;
}

.tool-group__chevron--expanded {
  transform: rotate(0deg);
}

.tool-group__toggle:not(.tool-group__toggle--expanded) .tool-group__chevron {
  transform: rotate(-90deg);
}

.tool-group__count {
  white-space: nowrap;
}

/* 折叠摘要行 chips */
.tool-group__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.tool-group__chip {
  display: inline-flex;
  height: 22px;
  max-width: 160px;
  align-items: center;
  gap: 4px;
  padding-inline: 6px;
  overflow: hidden;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  box-shadow: 0 0 0 1px var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs-plus);
  text-overflow: ellipsis;
  white-space: nowrap;
  animation: chip-in 250ms cubic-bezier(0.23, 1, 0.32, 1) both;
}

.tool-group__chip-icon {
  flex-shrink: 0;
  opacity: 0.6;
}

.tool-group__chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-group__chip--mono {
  font-family: var(--font-mono);
}

/* 摘要行 "+N 更多" 计数 chip */
.tool-group__chip--more {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* 折叠头状态图标（运行中 spinner / 出错） */
.tool-group__status {
  flex-shrink: 0;
}

.tool-group__status--running {
  color: var(--accent-primary);
}

.tool-group__status--error {
  color: var(--error);
}

.tool-group__diffs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 4px;
  margin-left: auto;
}

.tool-group__diff-chip {
  display: inline-flex;
  height: 22px;
  align-items: center;
  gap: 4px;
  padding-inline: 6px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  box-shadow: 0 0 0 1px var(--border-subtle);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  animation: chip-in 250ms cubic-bezier(0.23, 1, 0.32, 1) var(--chip-delay, 0ms) both;
}

.tool-group__diff-file {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-group__diff-add {
  color: var(--success);
  font-variant-numeric: tabular-nums;
}

.tool-group__diff-del {
  color: var(--error);
  font-variant-numeric: tabular-nums;
}

/* diff 列表 "+N more" 展开剩余按钮（ToolChips more-button 风格） */
.tool-group__more-btn {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding-inline: 6px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color 100ms ease, text-decoration-color 100ms ease;

  &:hover {
    color: var(--text-secondary);
    text-decoration-color: currentColor;
  }
}

/* 展开面板（grid 动画） */
.tool-group__expand-panel {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 300ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 300ms cubic-bezier(0.23, 1, 0.32, 1);
}

.tool-group__expand-panel--open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.tool-group__expand-clip {
  min-height: 0;
  overflow: hidden;
}

.tool-group__events {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  /* 对齐单个事件的 event-body 文本列（22px 轴留白 + 10px 内边距），
     使组内工具行/专用卡片与独立的单工具行渲染位置一致 */
  padding-left: 32px;
}

/* 组内专用工具卡片容器：卡片 UI 本身不变，仅负责组内间距 */
.tool-group__card {
  margin-block: 3px;
}

/* diff 列表（展开时底部） */
.tool-group__diff-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0 32px;
  padding-top: 8px;
  border-top: 1px solid var(--surface-border);
}

/* ── 工具行（compact chip 风格） ── */
.tool-row {
  animation: tool-row-in 300ms cubic-bezier(0.23, 1, 0.32, 1) both;
}

.tool-row__button {
  display: flex;
  width: 100%;
  min-width: 0;
  height: 28px;
  align-items: center;
  gap: 8px;
  padding-inline: 4px;
  margin-inline: -4px;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 100ms ease;

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.tool-row__icon-wrap {
  position: relative;
  display: flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

/* 运行状态图标颜色 */
.tool-row.status-running .tool-row__icon-wrap {
  color: var(--accent-primary);
}

.tool-row.status-error .tool-row__icon-wrap {
  color: var(--error);
}

.tool-row.status-completed .tool-row__icon-wrap {
  color: var(--text-muted);
}

.tool-row__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 100ms ease;
}

.tool-row__button:hover .tool-row__icon,
.tool-row__icon--hidden {
  opacity: 0;
}

.tool-row__chevron {
  position: absolute;
  opacity: 0;
  transform: rotate(-90deg);
  transition: opacity 150ms ease, transform 150ms ease;
}

.tool-row__button:hover .tool-row__chevron,
.tool-row__chevron--open {
  opacity: 1;
}

.tool-row__chevron--open {
  transform: rotate(0deg);
}

.tool-row__label {
  flex-shrink: 0;
  font-size: var(--text-sm-plus);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.tool-row__chip {
  display: inline-flex;
  min-width: 0;
  height: 22px;
  flex: 1;
  align-items: center;
  padding-inline: 6px;
  overflow: hidden;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  box-shadow: 0 0 0 1px var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs-plus);
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color 100ms ease;

  &:hover {
    background: var(--bg-hover);
  }
}

.tool-row__chip--mono {
  font-family: var(--font-mono);
}

.tool-row__duration {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  opacity: 0.7;
}

/* detail panel（grid 展开动画） */
.detail-panel {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 300ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 300ms cubic-bezier(0.23, 1, 0.32, 1);
}

.detail-panel--open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.detail-panel__clip {
  min-height: 0;
  overflow: hidden;
}

.detail-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 4px 20px;
  padding: 2px 0 2px 12px;
  border-left: 1px solid var(--surface-border);
}

.detail-line {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs-plus);
  line-height: var(--leading-prose);
}

.detail-line--code {
  min-width: 0;
}

@keyframes chip-in {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes tool-row-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-group__expand-panel,
  .detail-panel,
  .tool-row,
  .tool-group__diff-chip,
  .tool-group__chip {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}

/* TurnSummaryBar 在 timeline 中的定位：与事件列表左对齐 */
.timeline-turn-summary {
  margin-left: 36px;
}
</style>
