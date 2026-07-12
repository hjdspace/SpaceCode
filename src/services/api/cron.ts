import { electronAPI } from './_context'
import type { CronTask, CronRunEntry } from '../electronAPI'

export const cron = {
  list: (projectRoot: string): Promise<CronTask[]> =>
    electronAPI?.cron?.list(projectRoot) || Promise.resolve([]),
  create: (projectRoot: string, task: Omit<CronTask, 'id'>): Promise<CronTask | null> =>
    electronAPI?.cron?.create(projectRoot, task) || Promise.resolve(null),
  update: (projectRoot: string, id: string, updates: Partial<CronTask>): Promise<void> =>
    electronAPI?.cron?.update(projectRoot, id, updates) || Promise.resolve(),
  delete: (projectRoot: string, id: string): Promise<void> =>
    electronAPI?.cron?.delete(projectRoot, id) || Promise.resolve(),
  run: (projectRoot: string, id: string): Promise<{ success: boolean; error?: string } | null> =>
    electronAPI?.cron?.run(projectRoot, id) || Promise.resolve(null),
  runs: (projectRoot: string, limit?: number): Promise<CronRunEntry[]> =>
    electronAPI?.cron?.runs(projectRoot, limit) || Promise.resolve([]),
  taskRuns: (projectRoot: string, taskId: string): Promise<CronRunEntry[]> =>
    electronAPI?.cron?.taskRuns(projectRoot, taskId) || Promise.resolve([]),
  validate: (cron: string): Promise<{ valid: boolean; error?: string }> =>
    electronAPI?.cron?.validate(cron) || Promise.resolve({ valid: false, error: 'Cron API not available' }),
  describe: (cron: string): Promise<string> =>
    electronAPI?.cron?.describe(cron) || Promise.resolve(cron),
  onTaskFired: (callback: (data: { taskId: string; taskName: string; [key: string]: unknown }) => void): (() => void) | null =>
    electronAPI?.cron?.onTaskFired(callback) || null,
  onRunCompleted: (callback: (data: { runId: string; taskId: string; status: string; [key: string]: unknown }) => void): (() => void) | null =>
    electronAPI?.cron?.onRunCompleted(callback) || null,
}
