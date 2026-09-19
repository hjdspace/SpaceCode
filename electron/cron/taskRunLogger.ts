// electron/taskRunLogger.ts
import { readFileSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

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

type RunFile = { runs: TaskRun[] }

const CRON_DIR_REL = '.claude'
const RUN_FILE_REL = join(CRON_DIR_REL, 'scheduled_tasks_log.json')
const MAX_RUNS_PER_TASK = 100
const STALE_THRESHOLD_MS = 11 * 60 * 1000 // 10min timeout + 1min buffer

function getRunFilePath(projectRoot: string): string {
  return join(projectRoot, RUN_FILE_REL)
}

function readRunFileSync(projectRoot: string): TaskRun[] {
  const filePath = getRunFilePath(projectRoot)
  try {
    const raw = readFileSync(filePath, { encoding: 'utf-8' })
    const data: RunFile = JSON.parse(raw)
    return data.runs || []
  } catch {
    return []
  }
}

function writeRunFileSync(runs: TaskRun[], projectRoot: string): void {
  const filePath = getRunFilePath(projectRoot)
  const dir = join(projectRoot, CRON_DIR_REL)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const data: RunFile = { runs }
  const json = JSON.stringify(data, null, 2)
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, json, { encoding: 'utf-8' })
  renameSync(tmpPath, filePath)
}

function trimRunsByTask(runs: TaskRun[], taskId: string): TaskRun[] {
  const taskRuns = runs.filter(r => r.taskId === taskId)
  if (taskRuns.length <= MAX_RUNS_PER_TASK) return runs
  const toRemove = new Set(
    taskRuns
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .slice(0, taskRuns.length - MAX_RUNS_PER_TASK)
      .map(r => r.id)
  )
  return runs.filter(r => !toRemove.has(r.id))
}

export async function appendRun(run: TaskRun, projectRoot: string): Promise<void> {
  const runs = readRunFileSync(projectRoot)
  runs.push(run)
  const trimmed = trimRunsByTask(runs, run.taskId)
  writeRunFileSync(trimmed, projectRoot)
}

export async function updateRun(id: string, updates: Partial<TaskRun>, projectRoot: string): Promise<void> {
  const runs = readRunFileSync(projectRoot)
  const run = runs.find(r => r.id === id)
  if (!run) return
  Object.assign(run, updates)
  writeRunFileSync(runs, projectRoot)
}

export async function getRecentRuns(projectRoot: string, limit: number = 50): Promise<TaskRun[]> {
  const runs = readRunFileSync(projectRoot)
  return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, limit)
}

export async function getTaskRuns(taskId: string, projectRoot: string): Promise<TaskRun[]> {
  const runs = readRunFileSync(projectRoot)
  return runs
    .filter(r => r.taskId === taskId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

export async function cleanupStaleRuns(projectRoot: string): Promise<void> {
  const runs = readRunFileSync(projectRoot)
  const now = Date.now()
  let changed = false
  for (const run of runs) {
    if (run.status === 'running') {
      const startedAt = new Date(run.startedAt).getTime()
      if (now - startedAt > STALE_THRESHOLD_MS) {
        run.status = 'failed'
        run.error = 'Stale run: exceeded timeout threshold'
        run.completedAt = new Date().toISOString()
        changed = true
      }
    }
  }
  if (changed) writeRunFileSync(runs, projectRoot)
}
