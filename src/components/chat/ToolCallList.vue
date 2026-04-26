<template>
  <div class="tool-call-list">
    <template v-for="tool in toolCalls" :key="tool.id">
      <TaskListCard
        v-if="getTaskListItems(tool).length"
        :tasks="getTaskListItems(tool)"
      />
      <ToolCallCard
        v-else
        :tool-call="tool"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import ToolCallCard from './ToolCallCard.vue'
import TaskListCard, { type TaskListItem } from './TaskListCard.vue'

defineProps<{
  toolCalls: ToolCall[]
}>()

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed'])

function getTaskListItems(toolCall: ToolCall): TaskListItem[] {
  if (toolCall.name === 'TodoWrite') {
    return parseTodoWriteItems(toolCall.input)
  }

  if (toolCall.name === 'TaskList') {
    return parseTaskListOutput(toolCall.output)
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
      const match = line.match(/^#([^\\s]+) \\[(pending|in_progress|completed)\\] (.*?)(?: \\(([^)]+)\\))?(?: \\[blocked by .+\\])?$/)
      if (!match) return items
      items.push({
        id: match[1],
        status: match[2] as TaskListItem['status'],
        content: match[3],
        owner: match[4]
      })
      return items
    }, [])
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
