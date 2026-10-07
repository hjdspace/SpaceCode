import { ipcMain, BrowserWindow, Notification, app } from 'electron'
import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { CronScheduler } from './cronScheduler'
import type { CronExecOptions } from './cronScheduler'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask } from './cronFileStore'
import { getRecentRuns, getTaskRuns } from './taskRunLogger'
import { isValidCron, cronToHuman } from './cronParser'
import type { CronTask } from './cronFileStore'
import type { TaskRun } from './taskRunLogger'
import { info, warn, error } from '../infra/logger'

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

/** 允许直接拼进命令行的取值：不含空格与 shell 元字符 */
const SAFE_ARG_RE = /^[\w.@:/-]+$/
const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions']

function buildCliFlags(options?: CronExecOptions): string[] {
  if (!options) return []
  const flags: string[] = []
  if (options.model && SAFE_ARG_RE.test(options.model)) flags.push('--model', options.model)
  if (options.effort && SAFE_ARG_RE.test(options.effort)) flags.push('--effort', options.effort)
  if (options.agent && SAFE_ARG_RE.test(options.agent)) flags.push('--agent', options.agent)
  const mode = options.permissionMode
  if (mode && PERMISSION_MODES.includes(mode)) {
    flags.push('--permission-mode', mode)
    // 无人值守：需要放行的任务必须显式选 bypass，其余模式卡在权限请求上直到超时。
    if (mode === 'bypassPermissions') flags.push('--dangerously-skip-permissions')
  }
  return flags
}

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

function spawnCliProcess(
  prompt: string,
  cwd: string,
  options?: CronExecOptions,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; sessionId?: string }> {
  return new Promise((resolve) => {
    const cliCommand = getCliCommand()
    if (!cliCommand) {
      resolve({ exitCode: 1, stdout: '', stderr: 'No CLI found' })
      return
    }

    const flags = buildCliFlags(options)
    const isWin = process.platform === 'win32'
    const shell = isWin ? 'cmd.exe' : '/bin/sh'
    // 提示词走 stdin 而不是 argv：多行提示词经 cmd.exe 拼命令行会被截断，
    // 路径里的引号与 & 也会破坏参数。engine 在非 TTY 下从 stdin 读 --print 的输入。
    const shellArgs = isWin
      ? ['/c', cliCommand, '--print', ...flags]
      : ['-c', [cliCommand, '--print', ...flags].join(' ')]

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
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

    child.stdin?.on('error', () => {
      // 引擎提前退出时写 stdin 会 EPIPE，结果仍由 close 事件给出
    })
    child.stdin?.write(prompt)
    child.stdin?.end()
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
