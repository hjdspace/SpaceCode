import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'

export interface CronTask {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  name?: string
  description?: string
  enabled?: boolean
  frequency?: string
  scheduledTime?: string
}

export interface TaskRun {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string
  error?: string
  durationMs?: number
  sessionId?: string
}

export const useCronStore = defineStore('cron', () => {
  const tasks = ref<CronTask[]>([])
  const recentRuns = ref<TaskRun[]>([])
  const taskRunsMap = ref<Record<string, TaskRun[]>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const expandedTaskId = ref<string | null>(null)

  const totalCount = computed(() => tasks.value.length)
  const enabledCount = computed(() => tasks.value.filter(t => t.enabled !== false).length)
  const disabledCount = computed(() => tasks.value.filter(t => t.enabled === false).length)
  const oneShotCount = computed(() => tasks.value.filter(t => !t.recurring).length)

  async function fetchTasks(projectRoot: string) {
    loading.value = true
    error.value = null
    try {
      tasks.value = await api.cron.list(projectRoot)
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function createTask(projectRoot: string, input: Omit<CronTask, 'id' | 'createdAt'>) {
    const task = await api.cron.create(projectRoot, input)
    if (task) tasks.value.push(task)
    return task
  }

  async function updateTask(projectRoot: string, id: string, updates: Partial<CronTask>) {
    await api.cron.update(projectRoot, id, updates)
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx !== -1) tasks.value[idx] = { ...tasks.value[idx], ...updates }
  }

  async function deleteTask(projectRoot: string, id: string) {
    await api.cron.delete(projectRoot, id)
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  async function toggleTask(projectRoot: string, id: string, enabled: boolean) {
    await updateTask(projectRoot, id, { enabled })
  }

  async function runTaskNow(projectRoot: string, id: string) {
    return api.cron.run(projectRoot, id)
  }

  async function fetchRecentRuns(projectRoot: string, limit?: number) {
    recentRuns.value = await api.cron.runs(projectRoot, limit)
  }

  async function fetchTaskRuns(projectRoot: string, taskId: string) {
    const runs = await api.cron.taskRuns(projectRoot, taskId)
    taskRunsMap.value[taskId] = runs
  }

  async function validateCron(cron: string) {
    return api.cron.validate(cron)
  }

  async function describeCron(cron: string) {
    return api.cron.describe(cron)
  }

  function toggleExpanded(taskId: string) {
    expandedTaskId.value = expandedTaskId.value === taskId ? null : taskId
  }

  return {
    tasks, recentRuns, taskRunsMap, loading, error, expandedTaskId,
    totalCount, enabledCount, disabledCount, oneShotCount,
    fetchTasks, createTask, updateTask, deleteTask, toggleTask,
    runTaskNow, fetchRecentRuns, fetchTaskRuns, validateCron, describeCron, toggleExpanded,
  }
})
