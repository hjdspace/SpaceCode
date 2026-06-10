import { randomUUID } from 'crypto'
import { readCronTasks, updateLastFired, updateCronTask } from './cronFileStore'
import { appendRun, updateRun, cleanupStaleRuns } from './taskRunLogger'
import { cronMatches } from './cronParser'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'

export interface CronSchedulerOptions {
  getProjectRoot: () => string | null
  spawnCliProcess: (prompt: string, cwd: string) => Promise<{ exitCode: number | null; stdout: string; stderr: string; sessionId?: string }>
  onTaskFired?: (run: TaskRun) => void
  onRunCompleted?: (run: TaskRun) => void
}

const TICK_INTERVAL_MS = 60_000
const EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

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

  async executeTask(task: CronTask, projectRoot: string): Promise<TaskRun> {
    const runId = randomUUID().replace(/-/g, '').slice(0, 8)
    const run: TaskRun = {
      id: runId,
      taskId: task.id,
      taskName: task.name || task.cron,
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: task.prompt,
    }

    this.runningTasks.add(task.id)
    await updateLastFired(task.id, Date.now(), projectRoot)
    await appendRun(run, projectRoot)
    this.options.onTaskFired?.(run)

    try {
      const timeoutPromise = new Promise<{ exitCode: null; stdout: ''; stderr: 'Execution timeout' }>((resolve) =>
        setTimeout(() => resolve({ exitCode: null, stdout: '', stderr: 'Execution timeout' }), EXECUTION_TIMEOUT_MS)
      )

      const result = await Promise.race([
        this.options.spawnCliProcess(task.prompt, projectRoot),
        timeoutPromise,
      ])

      const completedRun: Partial<TaskRun> = {
        completedAt: new Date().toISOString(),
        status: result.exitCode === 0 ? 'completed' : (result.stderr.includes('timeout') ? 'timeout' : 'failed'),
        output: result.stdout.slice(0, 5000),
        error: result.stderr ? result.stderr.slice(0, 2000) : undefined,
        durationMs: Date.now() - new Date(run.startedAt).getTime(),
        sessionId: 'sessionId' in result ? result.sessionId : undefined,
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
      this.runningTasks.delete(task.id)
      this.options.onRunCompleted?.(run)
    }

    return run
  }
}
