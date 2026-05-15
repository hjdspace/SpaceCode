<template>
  <div class="agent-timeline">
    <!-- Timeline header -->
    <div class="timeline-header" @click="toggleCollapse">
      <div class="timeline-header-icon">
        <Loader2 v-if="summaryStatus === 'running'" :size="14" class="spin-icon" />
        <CheckCircle2 v-else-if="summaryStatus === 'completed'" :size="14" />
        <XCircle v-else-if="summaryStatus === 'error'" :size="14" />
        <CircleDot v-else :size="14" />
      </div>
      <span class="timeline-header-text">{{ summaryText }}</span>
      <span class="timeline-header-count">{{ visibleToolCount }} steps</span>
      <ChevronDown :size="14" class="timeline-collapse-icon" :class="{ 'is-collapsed': isCollapsed }" />
    </div>

    <!-- Timeline body -->
    <div v-show="!isCollapsed" class="timeline-body">
      <!-- 全局任务看板 -->
      <TaskListCard
        v-if="allTasks.length && shouldShowTaskBoard"
        :tasks="allTasks"
        class="timeline-task-board"
      />

      <!-- Timeline items -->
      <div
        v-for="(tool, index) in displayToolCalls"
        :key="tool.id"
        class="timeline-item"
        :class="[`status-${tool.status}`, { 'is-last': index === displayToolCalls.length - 1 }]"
      >
        <!-- Task items (non-card) -->
        <template v-if="tool.taskItems.length && !shouldShowTaskBoard">
          <TaskListCard :tasks="tool.taskItems" class="timeline-task-inline" />
        </template>

        <!-- Special tool cards rendered inline -->
        <template v-else-if="specialComponents[tool.id]">
          <div class="timeline-node">
            <div class="timeline-dot" :class="`status-${tool.status}`">
              <Loader2 v-if="tool.status === 'running'" :size="12" class="spin-icon" />
              <Check v-else-if="tool.status === 'completed'" :size="12" />
              <X v-else-if="tool.status === 'error'" :size="12" />
              <component :is="getToolIcon(tool.name)" v-else :size="12" />
            </div>
            <div v-if="index < displayToolCalls.length - 1" class="timeline-line"></div>
          </div>
          <div class="timeline-content">
            <component
              :is="specialComponents[tool.id]"
              :tool-call="tool"
              @submit="handleToolSubmit(tool.id, $event)"
              @skip="handleToolSkip(tool.id)"
            />
          </div>
        </template>

        <!-- Generic tool as timeline row -->
        <template v-else-if="!TASK_LIST_ONLY_TOOL_NAMES.has(tool.name)">
          <div class="timeline-node">
            <div class="timeline-dot" :class="`status-${tool.status}`">
              <Loader2 v-if="tool.status === 'running'" :size="12" class="spin-icon" />
              <Check v-else-if="tool.status === 'completed'" :size="12" />
              <X v-else-if="tool.status === 'error'" :size="12" />
              <component :is="getToolIcon(tool.name)" v-else :size="12" />
            </div>
            <div v-if="index < displayToolCalls.length - 1" class="timeline-line"></div>
          </div>
          <div class="timeline-content">
            <div class="timeline-row" @click="toggleItem(tool.id)">
              <span class="timeline-tool-name">{{ getToolLabel(tool.name) }}</span>
              <span v-if="getToolTarget(tool)" class="timeline-target">{{ getToolTarget(tool) }}</span>
              <span v-if="getToolDuration(tool)" class="timeline-duration">{{ getToolDuration(tool) }}s</span>
              <ChevronDown
                v-if="tool.output || hasDetailContent(tool)"
                :size="12"
                class="timeline-expand-icon"
                :class="{ 'is-expanded': expandedItems[tool.id] }"
              />
            </div>
            <div v-if="expandedItems[tool.id]" class="timeline-details">
              <div v-if="tool.input && Object.keys(tool.input).length" class="detail-section">
                <pre class="detail-code"><code>{{ formatInput(tool) }}</code></pre>
              </div>
              <div v-if="tool.output" class="detail-section">
                <pre class="detail-code output"><code>{{ formatOutput(tool.output) }}</code></pre>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import type { Component } from 'vue'
import TaskListCard, { type TaskListItem } from './TaskListCard.vue'
import { useTaskManager } from '@/composables/useTaskManager'
import { computed, markRaw, onMounted, reactive, ref, watch } from 'vue'
import { hasToolComponent, resolveToolComponent } from '@/components/chat/tools/index'
import {
  Loader2, Check, X, ChevronDown, CheckCircle2, XCircle, CircleDot,
  Terminal, FileText, FileEdit, Search, Globe, Wand2, Bot, Folder, Code, MessageCircleQuestion
} from 'lucide-vue-next'

const taskManager = useTaskManager()

const props = defineProps<{
  toolCalls: ToolCall[]
}>()

const emit = defineEmits<{
  toolSubmit: [toolId: string, answers: Record<string, string>]
  toolSkip: [toolId: string]
}>()

const isCollapsed = ref(false)
const expandedItems = reactive<Record<string, boolean>>({})

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const TASK_LIST_TOOL_NAMES = new Set(['TodoWrite', 'TaskList', 'TaskCreate', 'TaskUpdate'])
const TASK_LIST_ONLY_TOOL_NAMES = new Set(['TaskList', 'TaskCreate', 'TaskUpdate'])

const TOOL_ICON_MAP: Record<string, Component> = {
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
  CodebaseSearch: Search,
  AskUserQuestion: MessageCircleQuestion,
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
  AskUserQuestion: 'Ask user',
}

function getToolIcon(name: string): Component {
  return TOOL_ICON_MAP[name] || Code
}

function getToolLabel(name: string): string {
  return TOOL_LABEL_MAP[name] || name
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

function hasDetailContent(tool: ToolCall): boolean {
  return !!(tool.input && Object.keys(tool.input).length > 0)
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function toggleItem(toolId: string) {
  expandedItems[toolId] = !expandedItems[toolId]
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

const allTasks = computed(() => {
  return taskManager.getAllTasks().map(task => ({
    id: task.id,
    content: task.content,
    status: task.status,
    owner: task.owner,
    blockedBy: task.blockedBy
  } as TaskListItem))
})

const shouldShowTaskBoard = computed(() => allTasks.value.length > 1)

const summaryStatus = computed(() => {
  if (props.toolCalls.some(tool => tool.status === 'running' || tool.status === 'pending')) return 'running'
  if (props.toolCalls.some(tool => tool.status === 'error')) return 'error'
  return 'completed'
})

const visibleToolCount = computed(() => {
  return displayToolCalls.value.filter(tool => !TASK_LIST_ONLY_TOOL_NAMES.has(tool.name)).length
})

const summaryText = computed(() => {
  const visibleTools = displayToolCalls.value.filter(tool => !TASK_LIST_ONLY_TOOL_NAMES.has(tool.name))
  const runningTool = visibleTools.find(tool => tool.status === 'running' || tool.status === 'pending')
  if (runningTool) return getToolLabel(runningTool.name) + (getToolTarget(runningTool) ? `: ${getToolTarget(runningTool)}` : '...')
  const failedCount = visibleTools.filter(tool => tool.status === 'error').length
  if (failedCount > 0) return `${failedCount} step${failedCount > 1 ? 's' : ''} failed`
  return 'Done'
})

const displayToolCalls = computed(() => {
  const parsed = props.toolCalls.map((tool) => ({
    ...tool,
    taskItems: getTaskListItems(tool)
  }))

  const latestTaskListIndex = findLatestTaskListIndex(parsed)

  return parsed.filter((tool, index) => {
    const isTaskListTool = TASK_LIST_TOOL_NAMES.has(tool.name)
    if (!isTaskListTool) return true
    if (!tool.taskItems.length) return true
    return index === latestTaskListIndex
  })
})

function findLatestTaskListIndex(tools: Array<ToolCall & { taskItems: TaskListItem[] }>): number {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].taskItems.length > 0) return i
  }
  return -1
}

function getTaskListItems(toolCall: ToolCall): TaskListItem[] {
  if (toolCall.name === 'TodoWrite') return parseTodoWriteItems(toolCall.input)
  if (toolCall.name === 'TaskList') return parseTaskListOutput(toolCall.output)
  if (toolCall.name === 'TaskCreate') return parseTaskCreateOutput(toolCall.output)
  if (toolCall.name === 'TaskUpdate') return parseTaskUpdateOutput(toolCall.output)
  return []
}

function parseTodoWriteItems(input: Record<string, any>): TaskListItem[] {
  if (!Array.isArray(input.todos)) return []
  return input.todos
    .filter((todo): todo is Record<string, any> => {
      return typeof todo?.content === 'string' && TASK_STATUSES.has(todo.status)
    })
    .map((todo) => ({ content: todo.content, status: todo.status }))
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

function parseTaskCreateOutput(output?: string): TaskListItem[] {
  if (!output) return []
  const match = output.match(/^Task #(\d+) created successfully: (.+)$/)
  if (!match) return []
  return [{ id: match[1], content: match[2], status: 'pending' }]
}

function parseTaskUpdateOutput(output?: string): TaskListItem[] {
  if (!output) return []
  const updatedMatch = output.match(/^Updated task #(\d+)/)
  if (!updatedMatch) return []
  const taskId = updatedMatch[1]
  const statusChangeMatch = output.match(/statusChange: (\w+) -> (\w+)/)
  const status = statusChangeMatch ? statusChangeMatch[2] : undefined
  return [{ id: taskId, content: `Task #${taskId} updated`, status: (status as TaskListItem['status']) || 'pending' }]
}

const specialComponents = reactive<Record<string, Component>>({})

async function loadSpecialComponents() {
  for (const tool of props.toolCalls) {
    if (hasToolComponent(tool.name) && !specialComponents[tool.id]) {
      const comp = await resolveToolComponent(tool.name)
      if (comp) specialComponents[tool.id] = markRaw(comp)
    }
  }
}

onMounted(loadSpecialComponents)
watch(() => props.toolCalls, () => { loadSpecialComponents() }, { deep: true })

function handleToolSubmit(toolId: string, answers: Record<string, string>) {
  emit('toolSubmit', toolId, answers)
}

function handleToolSkip(toolId: string) {
  emit('toolSkip', toolId)
}
</script>

<style lang="scss" scoped>
.agent-timeline {
  margin: 8px 0;
  border-radius: 8px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.timeline-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--accent-primary);
}

.timeline-header-text {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-header-count {
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.timeline-collapse-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform var(--transition-fast);

  &.is-collapsed {
    transform: rotate(-90deg);
  }
}

.timeline-body {
  border-top: 1px solid var(--surface-border);
  padding: 8px 14px 12px;
}

.timeline-task-board {
  margin-bottom: 8px;
}

.timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 0;
  min-height: 28px;
}

.timeline-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 24px;
  flex-shrink: 0;
  padding-top: 6px;
}

.timeline-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  border: 1.5px solid var(--surface-border);
  transition: all var(--transition-fast);

  &.status-running {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  &.status-completed {
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
    border-color: #22c55e;
  }

  &.status-error {
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    border-color: #ef4444;
  }
}

.timeline-line {
  width: 1.5px;
  flex: 1;
  min-height: 8px;
  background: var(--surface-border);
  margin: 3px 0;
}

.timeline-content {
  flex: 1;
  min-width: 0;
  padding: 4px 0 8px 8px;
}

.timeline-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.timeline-tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.timeline-target {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-duration {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  opacity: 0.7;
  flex-shrink: 0;
}

.timeline-expand-icon {
  color: var(--text-muted);
  opacity: 0.5;
  flex-shrink: 0;
  transition: transform var(--transition-fast);

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.timeline-details {
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

.timeline-task-inline {
  margin-left: 32px;
  margin-bottom: 4px;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
