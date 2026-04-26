<template>
  <div class="tool-call-list">
    <!-- 全局任务看板：当存在累积任务时显示 -->
    <TaskListCard
      v-if="allTasks.length && shouldShowTaskBoard"
      :tasks="allTasks"
    />
    <template v-for="tool in displayToolCalls" :key="tool.id">
      <TaskListCard
        v-if="tool.taskItems.length && !shouldShowTaskBoard"
        :tasks="tool.taskItems"
      />
      <ToolCallCard
        v-else-if="!TASK_LIST_ONLY_TOOL_NAMES.has(tool.name)"
        :tool-call="tool"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import ToolCallCard from './ToolCallCard.vue'
import TaskListCard, { type TaskListItem } from './TaskListCard.vue'
import { useTaskManager } from '@/composables/useTaskManager'
import { computed } from 'vue'

const taskManager = useTaskManager()

const props = defineProps<{
  toolCalls: ToolCall[]
}>()

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed'])

const TASK_LIST_TOOL_NAMES = new Set(['TodoWrite', 'TaskList', 'TaskCreate', 'TaskUpdate'])
const TASK_LIST_ONLY_TOOL_NAMES = new Set(['TaskList', 'TaskCreate', 'TaskUpdate'])

const allTasks = computed(() => {
  return taskManager.getAllTasks().map(task => ({
    id: task.id,
    content: task.content,
    status: task.status,
    owner: task.owner,
    blockedBy: task.blockedBy
  } as TaskListItem))
})

const shouldShowTaskBoard = computed(() => {
  // 当存在多个任务时使用全局看板，而不是单独显示每个工具调用
  return allTasks.value.length > 1
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
    if (tools[i].taskItems.length > 0) {
      return i
    }
  }
  return -1
}

function getTaskListItems(toolCall: ToolCall): TaskListItem[] {
  if (toolCall.name === 'TodoWrite') {
    return parseTodoWriteItems(toolCall.input)
  }

  if (toolCall.name === 'TaskList') {
    return parseTaskListOutput(toolCall.output)
  }

  if (toolCall.name === 'TaskCreate') {
    return parseTaskCreateOutput(toolCall.output)
  }

  if (toolCall.name === 'TaskUpdate') {
    return parseTaskUpdateOutput(toolCall.output)
  }

  return []
}

function parseTodoWriteItems(input: Record<string, any>): TaskListItem[] {
  if (!Array.isArray(input.todos)) return []

  return input.todos
    .filter((todo): todo is Record<string, any> => {
      return typeof todo?.content === 'string' && TASK_STATUSES.has(todo.status)
    })
    .map((todo) => ({
      content: todo.content,
      status: todo.status
    }))
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

  const match = output.match(/^Task #(\\d+) created successfully: (.+)$/)
  if (!match) return []

  return [{
    id: match[1],
    content: match[2],
    status: 'pending'
  }]
}

function parseTaskUpdateOutput(output?: string): TaskListItem[] {
  if (!output) return []

  const updatedMatch = output.match(/^Updated task #(\\d+)/)
  if (!updatedMatch) return []

  const taskId = updatedMatch[1]

  const statusChangeMatch = output.match(/statusChange: (\\w+) -> (\\w+)/)
  const status = statusChangeMatch ? statusChangeMatch[2] : undefined

  return [{
    id: taskId,
    content: `Task #${taskId} updated`,
    status: (status as TaskListItem['status']) || 'pending'
  }]
}
</script>

<style lang="scss" scoped>
.tool-call-list {
  margin: 4px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 4px;
  border-left: 2px solid var(--surface-border);
}
</style>
