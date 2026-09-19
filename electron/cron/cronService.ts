import { ipcMain, BrowserWindow, Notification, app } from 'electron'
import { spawn } from 'child_process'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { CronScheduler } from './cronScheduler'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask } from './cronFileStore'
import { getRecentRuns, getTaskRuns } from './taskRunLogger'
import { isValidCron, cronToHuman } from './cronParser'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'
import { info, warn, error } from './logger'

let scheduler: CronScheduler | null = null

function getCliCommand(): string | null {
  const cliProjectRoot = app.isPackaged
    ? resolve(process.resourcesPath, 'engine')
    : resolve(__dirname, '../engine')

  const desktopCliPath = resolve(cliProjectRoot, 'dist-desktop/cli.js')
  if (existsSync(desktopCliPath)) {
    return `bun "${desktopCliPath}"`
  }

  const distCliPath = resolve(cliProjectRoot, 'dist/cli.js')
  if (existsSync(distCliPath)) {
    return `bun "${distCliPath}"`
  }

  const srcCliPath = resolve(cliProjectRoot, 'src/entrypoints/cli.tsx')
  if (existsSync(srcCliPath)) {
    const devScript = resolve(cliProjectRoot, 'scripts/dev.ts')
    return `bun "${devScript}"`
  }

  return null
}

function spawnCliProcess(prompt: string, cwd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string; sessionId?: string }> {
  return new Promise((resolve) => {
    const cliCommand = getCliCommand()
    if (!cliCommand) {
      resolve({ exitCode: 1, stdout: '', stderr: 'No CLI found' })
      return
    }

    const isWin = process.platform === 'win32'
    const shell = isWin ? 'cmd.exe' : '/bin/sh'
    const shellArgs = isWin ? ['/c', cliCommand, '--print', prompt] : ['-c', `${cliCommand} --print ${JSON.stringify(prompt)}`]

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr })
    })

    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message })
    })
  })
}

export function registerCronIPCHandlers(getProjectRoot: () => string | null): void {
  const win = () => BrowserWindow.getAllWindows()[0]

  scheduler = new CronScheduler({
    getProjectRoot,
    spawnCliProcess,
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
      const run = await scheduler.executeTask(task, projectRoot)
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

  app.on('before-quit', () => {
    if (scheduler) {
      scheduler.stop()
      scheduler = null
      info('Cron', 'CronScheduler stopped on before-quit')
    }
  })
}
