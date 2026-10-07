import { readFileSync, mkdirSync, renameSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isValidCron } from './cronParser'

/** 提示词里 @image:"<id>" 标记对应的落盘图片 */
export interface CronAttachment {
  id: string
  name: string
  path: string
}

/** 排期方式：与 5 字段 cron 一同存储，供弹窗回填；调度只看 cron + 窗口 */
export type CronScheduleMode = 'once' | 'repeat' | 'interval'

export interface CronTask {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  /** 缺省表示窗口字段上线前创建的任务，调度按老逻辑不加门控 */
  scheduleMode?: CronScheduleMode
  /** epoch ms：早于此时刻不触发；单次任务即目标时刻 */
  startsAt?: number
  /** epoch ms：晚于此时刻调度器自动禁用任务 */
  endsAt?: number
  name?: string
  enabled?: boolean
  frequency?: string
  scheduledTime?: string
  /** 任务自己的工作空间；为空表示跟随当前项目根 */
  workspace?: string
  /** 仅作记录：执行时不会替用户 checkout */
  branch?: string
  model?: string
  effort?: string
  agent?: string
  permissionMode?: string
  attachments?: CronAttachment[]
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
    scheduleMode: input.scheduleMode,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    name: input.name,
    enabled: input.enabled ?? true,
    frequency: input.frequency,
    scheduledTime: input.scheduledTime,
    workspace: input.workspace,
    branch: input.branch,
    model: input.model,
    effort: input.effort,
    agent: input.agent,
    permissionMode: input.permissionMode,
    attachments: input.attachments,
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
