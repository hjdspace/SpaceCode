import { randomUUID } from 'crypto'
import { readCronTasks, updateLastFired, updateCronTask } from './cronFileStore'
import { appendRun, updateRun, cleanupStaleRuns } from './taskRunLogger'
import { cronMatches } from './cronParser'
import { buildExecutionPrompt } from '@/lib/cronPrompt'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'

export interface CronExecOptions {
  model?: string
  effort?: string
  agent?: string
  permissionMode?: string
}

/**
 * 执行身份与控制通道。
 * sessionId 由调度器生成而非执行器内部生成：超时那一侧也要能把执行记录
 * 关联到已经出现在会话列表里的那次运行。
 */
export interface CronRunContext {
  runId: string
  taskId: string
  taskName: string
  sessionId: string
  /** 手动「立即执行」把新会话切到前台；定时触发只入列，不打断当前会话 */
  activate: boolean
  signal: AbortSignal
}

export interface CronRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface CronSchedulerOptions {
  getProjectRoot: () => string | null
  runPrompt: (
    prompt: string,
    cwd: string,
    context: CronRunContext,
    options?: CronExecOptions,
  ) => Promise<CronRunResult>
  onTaskFired?: (run: TaskRun) => void
  onRunCompleted?: (run: TaskRun) => void
}

const TICK_INTERVAL_MS = 60_000
const EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

/**
 * cron 只有月/日没有年份语义，「单次」与「延后生效」必须由窗口补齐。
 * 不带窗口的老任务一律 active，行为与字段上线前一致。
 */
export function checkScheduleWindow(
  task: CronTask,
  now: Date,
): 'active' | 'pending' | 'expired' {
  const nowMs = now.getTime()
  if (task.endsAt && nowMs > task.endsAt) return 'expired'
  if (task.startsAt && nowMs < task.startsAt) return 'pending'
  return 'active'
}

export class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private runningTasks = new Set<string>()
  private firedMinuteKeys = new Set<string>()
  private options: CronSchedulerOptions

  constructor(options: CronSchedulerOptions) {
    this.options = options
  }

  start(): void {
    if (this.timer) return
    const projectRoot = this.options.getProjectRoot()
    if (projectRoot) {
      cleanupStaleRuns(projectRoot).catch(() => {})
    }
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.runningTasks.clear()
    this.firedMinuteKeys.clear()
  }

  private async tick(): Promise<void> {
    const projectRoot = this.options.getProjectRoot()
    if (!projectRoot) return

    const now = new Date()
    const minuteKey = (taskId: string) =>
      `${taskId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    let tasks: CronTask[]
    try {
      tasks = await readCronTasks(projectRoot)
    } catch {
      return
    }

    for (const task of tasks) {
      if (task.enabled === false) continue
      if (this.runningTasks.has(task.id)) continue
      const key = minuteKey(task.id)
      if (this.firedMinuteKeys.has(key)) continue
      if (task.lastFiredAt) {
        const lastFired = new Date(task.lastFiredAt)
        if (
          lastFired.getFullYear() === now.getFullYear() &&
          lastFired.getMonth() === now.getMonth() &&
          lastFired.getDate() === now.getDate() &&
          lastFired.getHours() === now.getHours() &&
          lastFired.getMinutes() === now.getMinutes()
        ) continue
      }
      const gate = checkScheduleWindow(task, now)
      if (gate === 'expired') {
        // 过期即落盘禁用：列表显示「已禁用」，而不是永远算不出下次执行时间
        await updateCronTask(task.id, { enabled: false }, projectRoot)
        continue
      }
      if (gate === 'pending') continue
      if (!cronMatches(task.cron, now)) continue

      this.firedMinuteKeys.add(key)
      this.executeTask(task, projectRoot).catch(() => {})
    }

    const currentMinute = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    for (const key of this.firedMinuteKeys) {
      if (!key.endsWith(currentMinute)) {
        this.firedMinuteKeys.delete(key)
      }
    }
  }

  async executeTask(
    task: CronTask,
    projectRoot: string,
    execOptions?: { activate?: boolean },
  ): Promise<TaskRun> {
    const runId = randomUUID().replace(/-/g, '').slice(0, 8)
    const run: TaskRun = {
      id: runId,
      taskId: task.id,
      taskName: task.name || task.cron,
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: task.prompt,
      sessionId: randomUUID(),
    }

    this.runningTasks.add(task.id)
    await updateLastFired(task.id, Date.now(), projectRoot)
    await appendRun(run, projectRoot)
    this.options.onTaskFired?.(run)

    const controller = new AbortController()
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    try {
      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutTimer = setTimeout(() => {
          // 到点不只让记录落定，还要中断执行器：引擎子进程否则会留在后台跑满整轮
          controller.abort()
          resolve(null)
        }, EXECUTION_TIMEOUT_MS)
      })

      const result = await Promise.race([
        this.options.runPrompt(
          buildExecutionPrompt(task.prompt, task.attachments),
          task.workspace || projectRoot,
          {
            runId,
            taskId: task.id,
            taskName: run.taskName,
            sessionId: run.sessionId as string,
            activate: execOptions?.activate === true,
            signal: controller.signal,
          },
          { model: task.model, effort: task.effort, agent: task.agent, permissionMode: task.permissionMode },
        ),
        timeoutPromise,
      ])

      const completedRun: Partial<TaskRun> = result === null
        ? {
            completedAt: new Date().toISOString(),
            status: 'timeout',
            error: 'Execution timeout',
            durationMs: Date.now() - new Date(run.startedAt).getTime(),
          }
        : {
            completedAt: new Date().toISOString(),
            status: result.exitCode === 0 ? 'completed' : 'failed',
            output: result.stdout.slice(0, 5000),
            error: result.stderr ? result.stderr.slice(0, 2000) : undefined,
            durationMs: Date.now() - new Date(run.startedAt).getTime(),
          }

      await updateRun(runId, completedRun, projectRoot)
      Object.assign(run, completedRun)

      if (!task.recurring) {
        await updateCronTask(task.id, { enabled: false }, projectRoot)
      }
    } catch (err: any) {
      const failedRun: Partial<TaskRun> = {
        completedAt: new Date().toISOString(),
        status: 'failed',
        error: err.message || String(err),
        durationMs: Date.now() - new Date(run.startedAt).getTime(),
      }
      await updateRun(runId, failedRun, projectRoot)
      Object.assign(run, failedRun)
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      this.runningTasks.delete(task.id)
      this.options.onRunCompleted?.(run)
    }

    return run
  }
}
