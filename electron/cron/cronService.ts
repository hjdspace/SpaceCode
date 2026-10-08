import { ipcMain, BrowserWindow, Notification, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { CronScheduler } from './cronScheduler'
import { createCronSessionRunner } from './cronSessionRunner'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask } from './cronFileStore'
import { getRecentRuns, getTaskRuns } from './taskRunLogger'
import { isValidCron, cronToHuman } from './cronParser'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'
import { info, error } from '../infra/logger'

let scheduler: CronScheduler | null = null
/**
 * 调度器要自己去读任务表，而项目根只有渲染进程知道（主进程侧的 __projectCwd
 * 是从未被赋值的死全局，靠它取根等于调度器每分钟直接 return）。
 */
let activeProjectRoot: string | null = null

const CRON_ATTACHMENT_DIR = join('.claude', 'cron-attachments')
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

/** 把弹窗里的图片写进任务工作空间，返回绝对路径供提示词以 @"path" 引用 */
function saveCronAttachment(
  projectRoot: string,
  input: { id: string; name: string; dataUrl: string },
): string {
  if (!input?.id || !/^[0-9a-f-]{8,36}$/i.test(input.id)) {
    throw new Error('Invalid attachment id')
  }
  const match = /^data:(image\/[a-z.+-]+);base64,(.+)$/is.exec(input.dataUrl || '')
  if (!match) throw new Error('Invalid image data')
  const ext = IMAGE_EXT_BY_MIME[match[1].toLowerCase()] || 'png'
  const dir = join(projectRoot, CRON_ATTACHMENT_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${input.id}.${ext}`)
  writeFileSync(filePath, Buffer.from(match[2], 'base64'))
  return filePath
}

export function registerCronIPCHandlers(): void {
  const win = () => BrowserWindow.getAllWindows()[0]

  scheduler = new CronScheduler({
    getProjectRoot: () => activeProjectRoot,
    // 执行走聊天侧同一套引擎进程（含随包 bun 解析），任务过程才可能在会话里可见
    runPrompt: createCronSessionRunner(),
    onTaskFired: (run: TaskRun) => {
      win()?.webContents.send('cron:onTaskFired', run)
    },
    onRunCompleted: (run: TaskRun) => {
      win()?.webContents.send('cron:onRunCompleted', run)

      try {
        const statusLabel = run.status === 'completed' ? '成功' : run.status === 'timeout' ? '超时' : '失败'
        const notification = new Notification({
          title: `定时任务${statusLabel}: ${run.taskName}`,
          body: run.error
            ? run.error.slice(0, 200)
            : run.output
              ? run.output.slice(0, 200)
              : `任务${statusLabel}`,
        })
        notification.show()
      } catch {}
    },
  })

  scheduler.start()
  info('Cron', 'CronScheduler started')

  ipcMain.on('cron:setProjectRoot', (_event, root: unknown) => {
    activeProjectRoot = typeof root === 'string' && root ? root : null
  })

  ipcMain.handle('cron:list', async (_event, projectRoot: string) => {
    try {
      return await readCronTasks(projectRoot)
    } catch (err) {
      error('Cron', 'cron:list failed', err)
      return []
    }
  })

  ipcMain.handle('cron:create', async (_event, projectRoot: string, task: Omit<CronTask, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean }) => {
    try {
      return await addCronTask(task, projectRoot)
    } catch (err: any) {
      error('Cron', 'cron:create failed', err)
      return { error: err.message || String(err) }
    }
  })

  ipcMain.handle('cron:update', async (_event, projectRoot: string, id: string, updates: Partial<CronTask>) => {
    try {
      await updateCronTask(id, updates, projectRoot)
      return { success: true }
    } catch (err: any) {
      error('Cron', 'cron:update failed', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('cron:delete', async (_event, projectRoot: string, id: string) => {
    try {
      await deleteCronTask(id, projectRoot)
      return { success: true }
    } catch (err: any) {
      error('Cron', 'cron:delete failed', err)
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('cron:run', async (_event, projectRoot: string, id: string) => {
    try {
      const tasks = await readCronTasks(projectRoot)
      const task = tasks.find(t => t.id === id)
      if (!task) return { error: 'Task not found' }
      if (!scheduler) return { error: 'Scheduler not initialized' }
      // 用户点了「立即执行」就是要看过程：把新会话切到前台
      const run = await scheduler.executeTask(task, projectRoot, { activate: true })
      return run
    } catch (err: any) {
      error('Cron', 'cron:run failed', err)
      return { error: err.message || String(err) }
    }
  })

  ipcMain.handle('cron:runs', async (_event, projectRoot: string, limit?: number) => {
    try {
      return await getRecentRuns(projectRoot, limit)
    } catch (err) {
      error('Cron', 'cron:runs failed', err)
      return []
    }
  })

  ipcMain.handle('cron:taskRuns', async (_event, projectRoot: string, taskId: string) => {
    try {
      return await getTaskRuns(taskId, projectRoot)
    } catch (err) {
      error('Cron', 'cron:taskRuns failed', err)
      return []
    }
  })

  ipcMain.handle('cron:validate', async (_event, cron: string) => {
    const valid = isValidCron(cron)
    if (valid) {
      return { valid: true }
    }
    return { valid: false, error: 'Invalid cron expression' }
  })

  ipcMain.handle('cron:describe', async (_event, cron: string) => {
    return cronToHuman(cron)
  })

  ipcMain.handle('cron:saveAttachment', async (_event, projectRoot: string, input: { id: string; name: string; dataUrl: string }) => {
    try {
      return { path: saveCronAttachment(projectRoot, input) }
    } catch (err: any) {
      error('Cron', 'cron:saveAttachment failed', err)
      return { error: err.message || String(err) }
    }
  })

  app.on('before-quit', () => {
    if (scheduler) {
      scheduler.stop()
      scheduler = null
      info('Cron', 'CronScheduler stopped on before-quit')
    }
  })
}
