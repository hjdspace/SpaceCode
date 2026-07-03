import type { ToolCall } from '@/types'

type TaskStatus = 'pending' | 'in_progress' | 'completed'

interface TaskSyncManager {
  createTask: (id: string, content: string, description?: string) => void
  updateTask: (id: string, updates: { status?: TaskStatus, owner?: string }) => void
  clearTasks: () => void
  syncTasksFromList: (tasks: Array<{
    id: string
    content: string
    status: string
    owner?: string
    blockedBy?: string[]
  }>) => void
}

function asTaskStatus(value: unknown): TaskStatus | undefined {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
    ? value
    : undefined
}

export function syncTaskStateFromToolCall(
  taskManager: TaskSyncManager,
  toolCall: Pick<ToolCall, 'name' | 'input'>,
  resultOutput = ''
): void {
  const toolName = toolCall.name
  if (toolName === 'TaskCreate') {
    const match = resultOutput.match(/^Task #(\d+) created successfully: (.+)$/m)
    if (match) {
      taskManager.createTask(match[1], match[2], toolCall.input?.description)
    }
  } else if (toolName === 'TaskUpdate') {
    const idFromOutput = resultOutput.match(/^Updated task #(\d+)/)?.[1]
    const idFromInput = typeof toolCall.input?.taskId === 'string'
      ? toolCall.input.taskId
      : typeof toolCall.input?.task_id === 'string'
        ? toolCall.input.task_id
        : undefined
    const taskId = idFromOutput || idFromInput
    if (taskId) {
      const updates: { status?: TaskStatus, owner?: string } = {}
      const inputStatus = asTaskStatus(toolCall.input?.status)
      if (inputStatus) {
        updates.status = inputStatus
      } else {
        const statusMatch = resultOutput.match(/status\w*:\s*(\w+)\s*->\s*(\w+)/i)
        const outputStatus = asTaskStatus(statusMatch?.[2])
        if (outputStatus) updates.status = outputStatus
      }
      if (typeof toolCall.input?.owner === 'string') {
        updates.owner = toolCall.input.owner
      } else {
        const ownerMatch = resultOutput.match(/owner\w*:\s*([^,\n]+)/i)
        if (ownerMatch) updates.owner = ownerMatch[1].trim()
      }
      taskManager.updateTask(taskId, updates)
    }
  } else if (toolName === 'TaskList') {
    if (resultOutput === 'No tasks found') {
      taskManager.clearTasks()
      return
    }
    const tasks: Array<{
      id: string
      content: string
      status: TaskStatus
      owner?: string
      blockedBy?: string[]
    }> = []
    const lines = resultOutput.split('\n')
    for (const line of lines) {
      const match = line.match(/^#([^\s]+) \[(pending|in_progress|completed)\] (.*?)(?: \(([^)]+)\))?(?: \[blocked by (.+)\])?$/)
      if (!match) continue
      tasks.push({
        id: match[1],
        status: match[2] as TaskStatus,
        content: match[3],
        owner: match[4],
        blockedBy: match[5]?.split(', ').map(id => id.replace(/^#/, '')).filter(Boolean) || []
      })
    }
    taskManager.syncTasksFromList(tasks)
  } else if (toolName === 'TodoWrite') {
    const todos = toolCall.input?.todos
    if (Array.isArray(todos)) {
      taskManager.syncTasksFromList(
        todos
          .filter((t: any) => t && typeof t.content === 'string')
          .map((t: any) => ({
            id: String(t.id ?? t.content),
            content: t.content,
            status: asTaskStatus(t.status) || 'pending',
          }))
      )
    }
  }
}
