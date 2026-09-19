import { readFileSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isValidCron } from './cronParser'

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

type CronFile = { tasks: CronTask[] }

const CRON_DIR_REL = '.claude'
const CRON_FILE_REL = join(CRON_DIR_REL, 'scheduled_tasks.json')

function getCronFilePath(projectRoot: string): string {
  return join(projectRoot, CRON_FILE_REL)
}

function readCronFileSync(projectRoot: string): CronTask[] {
  const filePath = getCronFilePath(projectRoot)
  try {
    const raw = readFileSync(filePath, { encoding: 'utf-8' })
    const data: CronFile = JSON.parse(raw)
    if (!data.tasks || !Array.isArray(data.tasks)) return []
    return data.tasks.filter(t => isValidCron(t.cron))
  } catch {
    return []
  }
}

function writeCronFileSync(tasks: CronTask[], projectRoot: string): void {
  const filePath = getCronFilePath(projectRoot)
  const dir = join(projectRoot, CRON_DIR_REL)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const data: CronFile = { tasks }
  const json = JSON.stringify(data, null, 2)

  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, json, { encoding: 'utf-8' })
  renameSync(tmpPath, filePath)
}

export async function readCronTasks(projectRoot: string): Promise<CronTask[]> {
  return readCronFileSync(projectRoot)
}

export async function addCronTask(
  input: Omit<CronTask, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean },
  projectRoot: string
): Promise<CronTask> {
  const tasks = readCronFileSync(projectRoot)
  const task: CronTask = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    cron: input.cron,
    prompt: input.prompt,
    createdAt: Date.now(),
    lastFiredAt: input.lastFiredAt,
    recurring: input.recurring,
    permanent: input.permanent,
    name: input.name,
    description: input.description,
    enabled: input.enabled ?? true,
    frequency: input.frequency,
    scheduledTime: input.scheduledTime,
  }
  tasks.push(task)
  writeCronFileSync(tasks, projectRoot)
  return task
}

export async function updateCronTask(
  id: string,
  updates: Partial<CronTask>,
  projectRoot: string
): Promise<void> {
  const tasks = readCronFileSync(projectRoot)
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) throw new Error(`Task ${id} not found`)
  if (updates.cron && !isValidCron(updates.cron)) {
    throw new Error(`Invalid cron expression: ${updates.cron}`)
  }
  tasks[idx] = { ...tasks[idx], ...updates, id: tasks[idx].id, createdAt: tasks[idx].createdAt }
  writeCronFileSync(tasks, projectRoot)
}

export async function deleteCronTask(id: string, projectRoot: string): Promise<void> {
  const tasks = readCronFileSync(projectRoot)
  const filtered = tasks.filter(t => t.id !== id)
  if (filtered.length === tasks.length) throw new Error(`Task ${id} not found`)
  writeCronFileSync(filtered, projectRoot)
}

export async function updateLastFired(id: string, firedAt: number, projectRoot: string): Promise<void> {
  const tasks = readCronFileSync(projectRoot)
  const task = tasks.find(t => t.id === id)
  if (!task) return
  task.lastFiredAt = firedAt
  writeCronFileSync(tasks, projectRoot)
}
