// @vitest-environment node
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── electron 捕获 IPC 注册表与通知实例（先例：profiles.test.ts）──
const electronMocks = vi.hoisted(() => {
  const notifications: Array<{ opts: unknown; shown: boolean; show: () => void }> = []
  return { notifications }
})

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Notification: vi.fn(function (this: unknown, opts: unknown) {
    const inst = {
      opts,
      shown: false,
      show() {
        inst.shown = true
      },
    }
    electronMocks.notifications.push(inst)
    return inst
  }),
  app: { on: vi.fn() },
}))

// ── 兄弟模块 mock：调度器实例捕获构造 options ──
const cronMocks = vi.hoisted(() => {
  const schedulerInstances: Array<{
    opts: {
      getProjectRoot: () => string | null
      runPrompt: unknown
      onTaskFired: (run: unknown) => void
      onRunCompleted: (run: unknown) => void
    }
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    executeTask: ReturnType<typeof vi.fn>
  }> = []
  const runPromptSentinel = vi.fn()
  return { schedulerInstances, runPromptSentinel }
})

vi.mock('../cron/cronScheduler', () => ({
  CronScheduler: vi.fn(function (opts: Record<string, unknown>) {
    const inst = {
      opts: opts as {
        getProjectRoot: () => string | null
        runPrompt: unknown
        onTaskFired: (run: unknown) => void
        onRunCompleted: (run: unknown) => void
      },
      start: vi.fn(),
      stop: vi.fn(),
      executeTask: vi.fn(),
    }
    cronMocks.schedulerInstances.push(inst)
    return inst
  }),
}))

vi.mock('../cron/cronSessionRunner', () => ({
  createCronSessionRunner: vi.fn(() => cronMocks.runPromptSentinel),
}))

vi.mock('../cron/cronFileStore', () => ({
  readCronTasks: vi.fn(),
  addCronTask: vi.fn(),
  updateCronTask: vi.fn(),
  deleteCronTask: vi.fn(),
}))

vi.mock('../cron/taskRunLogger', () => ({
  getRecentRuns: vi.fn(),
  getTaskRuns: vi.fn(),
}))

vi.mock('../cron/cronParser', () => ({
  isValidCron: vi.fn(),
  cronToHuman: vi.fn(),
}))

vi.mock('../infra/logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}))

import { ipcMain, app, BrowserWindow, Notification } from 'electron'
import { registerCronIPCHandlers } from '../cron/cronService'
import { CronScheduler } from '../cron/cronScheduler'
import { createCronSessionRunner } from '../cron/cronSessionRunner'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask } from '../cron/cronFileStore'
import { getRecentRuns, getTaskRuns } from '../cron/taskRunLogger'
import { isValidCron, cronToHuman } from '../cron/cronParser'
import { error as logError } from '../infra/logger'

type Handler = (...args: unknown[]) => any
const ipcOn = new Map<string, Handler>()
const ipcHandle = new Map<string, Handler>()
const sendMock = vi.fn()
// ipcMain 回调首参是 event 对象，业务参数从第二个起
const evt = {}

let root: string

function lastScheduler() {
  return cronMocks.schedulerInstances[cronMocks.schedulerInstances.length - 1]
}

/** 触发 ipcMain.on 注册的回调 */
function callOn(channel: string, ...args: unknown[]): unknown {
  return ipcOn.get(channel)!(evt, ...args)
}

/** 触发 ipcMain.handle 注册的回调 */
function call(channel: string, ...args: unknown[]): any {
  return ipcHandle.get(channel)!(evt, ...args)
}

function fire(run: Record<string, unknown>): void {
  lastScheduler().opts.onTaskFired(run)
}

function completed(run: Record<string, unknown>): void {
  lastScheduler().opts.onRunCompleted(run)
}

function pngDataUrl(content: string): string {
  return `data:image/png;base64,${Buffer.from(content, 'utf-8').toString('base64')}`
}

beforeAll(() => {
  vi.mocked(ipcMain.on).mockImplementation(((channel: string, handler: Handler) => {
    ipcOn.set(channel, handler)
  }) as never)
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, handler: Handler) => {
    ipcHandle.set(channel, handler)
  }) as never)
})

beforeEach(() => {
  vi.clearAllMocks()
  electronMocks.notifications.length = 0
  root = mkdtempSync(join(tmpdir(), 'cron-service-'))
  // 重新注册：拿到干净的调度器实例与 handler 注册表
  registerCronIPCHandlers()
  // 模块级 activeProjectRoot 复位
  callOn('cron:setProjectRoot', '')
  // 默认实现：未编排时走空任务表 / 空运行记录
  vi.mocked(readCronTasks).mockResolvedValue([])
  vi.mocked(getRecentRuns).mockResolvedValue([])
  vi.mocked(getTaskRuns).mockResolvedValue([])
  vi.mocked(addCronTask).mockResolvedValue({} as Awaited<ReturnType<typeof addCronTask>>)
  vi.mocked(updateCronTask).mockResolvedValue(undefined)
  vi.mocked(deleteCronTask).mockResolvedValue(undefined)
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('registerCronIPCHandlers — 调度器装配', () => {
  it('以项目根/执行器/回调构造 CronScheduler 并启动', () => {
    const sched = lastScheduler()
    expect(CronScheduler).toHaveBeenCalled()
    expect(sched.start).toHaveBeenCalledTimes(1)
    expect(sched.opts.getProjectRoot).toBeTypeOf('function')
    // runPrompt 来自 createCronSessionRunner()
    expect(createCronSessionRunner).toHaveBeenCalledTimes(1)
    expect(sched.opts.runPrompt).toBe(cronMocks.runPromptSentinel)
    expect(sched.opts.onTaskFired).toBeTypeOf('function')
    expect(sched.opts.onRunCompleted).toBeTypeOf('function')
  })

  it('cron:setProjectRoot — 字符串生效，空串/非字符串回 null', () => {
    const sched = lastScheduler()
    expect(sched.opts.getProjectRoot()).toBeNull()

    callOn('cron:setProjectRoot', '/proj/a')
    expect(sched.opts.getProjectRoot()).toBe('/proj/a')

    callOn('cron:setProjectRoot', '')
    expect(sched.opts.getProjectRoot()).toBeNull()

    callOn('cron:setProjectRoot', 42)
    expect(sched.opts.getProjectRoot()).toBeNull()
  })
})

describe('cron:list / cron:create / cron:update / cron:delete', () => {
  it('cron:list 成功转发，失败时返回 [] 并记日志', async () => {
    const tasks = [{ id: 't1' }]
    vi.mocked(readCronTasks).mockResolvedValueOnce(tasks as never)
    await expect(call('cron:list', root)).resolves.toBe(tasks)
    expect(readCronTasks).toHaveBeenCalledWith(root)

    vi.mocked(readCronTasks).mockRejectedValueOnce(new Error('disk gone'))
    await expect(call('cron:list', root)).resolves.toEqual([])
    expect(logError).toHaveBeenCalledWith('Cron', 'cron:list failed', expect.any(Error))
  })

  it('cron:create 成功转发', async () => {
    const task = { cron: '0 9 * * *', prompt: 'p' }
    const created = { id: 'new' }
    vi.mocked(addCronTask).mockResolvedValueOnce(created as never)

    await expect(call('cron:create', root, task)).resolves.toBe(created)
    expect(addCronTask).toHaveBeenCalledWith(task, root)
  })

  it('cron:create 失败时 error 取 message，或字符串化非 Error', async () => {
    vi.mocked(addCronTask).mockRejectedValueOnce(new Error('bad task'))
    await expect(call('cron:create', root, {})).resolves.toEqual({ error: 'bad task' })

    vi.mocked(addCronTask).mockRejectedValueOnce('boom-string')
    await expect(call('cron:create', root, {})).resolves.toEqual({ error: 'boom-string' })
  })

  it('cron:update 成功 {success:true}，失败 {success:false, error}', async () => {
    await expect(call('cron:update', root, 't1', {})).resolves.toEqual({ success: true })
    expect(updateCronTask).toHaveBeenCalledWith('t1', {}, root)

    vi.mocked(updateCronTask).mockRejectedValueOnce(new Error('no such task'))
    await expect(call('cron:update', root, 't1', {})).resolves.toEqual({
      success: false,
      error: 'no such task',
    })
  })

  it('cron:delete 成功 {success:true}，失败 {success:false, error}', async () => {
    await expect(call('cron:delete', root, 't1')).resolves.toEqual({ success: true })
    expect(deleteCronTask).toHaveBeenCalledWith('t1', root)

    vi.mocked(deleteCronTask).mockRejectedValueOnce(new Error('locked'))
    await expect(call('cron:delete', root, 't1')).resolves.toEqual({
      success: false,
      error: 'locked',
    })
  })
})

describe('cron:run', () => {
  const task = { id: 't1', cron: '0 9 * * *', prompt: 'p' }

  it('任务不存在时返回 Task not found', async () => {
    vi.mocked(readCronTasks).mockResolvedValueOnce([])
    await expect(call('cron:run', root, 't1')).resolves.toEqual({ error: 'Task not found' })
  })

  it('找到任务时以前台模式执行', async () => {
    const run = { status: 'completed' }
    vi.mocked(readCronTasks).mockResolvedValueOnce([task] as never)
    lastScheduler().executeTask.mockResolvedValueOnce(run)

    await expect(call('cron:run', root, 't1')).resolves.toBe(run)
    expect(lastScheduler().executeTask).toHaveBeenCalledWith(task, root, { activate: true })
  })

  it('executeTask 抛错时返回 {error}', async () => {
    vi.mocked(readCronTasks).mockResolvedValueOnce([task] as never)
    lastScheduler().executeTask.mockRejectedValueOnce(new Error('engine dead'))

    await expect(call('cron:run', root, 't1')).resolves.toEqual({ error: 'engine dead' })
  })
})

describe('cron:runs / cron:taskRuns — 运行记录查询', () => {
  it('cron:runs 转发 limit，失败时返回 []', async () => {
    const runs = [{ id: 'r1' }]
    vi.mocked(getRecentRuns).mockResolvedValueOnce(runs as never)
    await expect(call('cron:runs', root, 5)).resolves.toBe(runs)
    expect(getRecentRuns).toHaveBeenCalledWith(root, 5)

    vi.mocked(getRecentRuns).mockRejectedValueOnce(new Error('x'))
    await expect(call('cron:runs', root, undefined)).resolves.toEqual([])
    expect(logError).toHaveBeenCalledWith('Cron', 'cron:runs failed', expect.anything())
  })

  it('cron:taskRuns 以 (taskId, projectRoot) 顺序转发，失败时返回 []', async () => {
    const runs = [{ id: 'r2', taskId: 't1' }]
    vi.mocked(getTaskRuns).mockResolvedValueOnce(runs as never)
    await expect(call('cron:taskRuns', root, 't1')).resolves.toBe(runs)
    expect(getTaskRuns).toHaveBeenCalledWith('t1', root)

    vi.mocked(getTaskRuns).mockRejectedValueOnce(new Error('x'))
    await expect(call('cron:taskRuns', root, 't1')).resolves.toEqual([])
    expect(logError).toHaveBeenCalledWith('Cron', 'cron:taskRuns failed', expect.anything())
  })
})

describe('cron:validate / cron:describe', () => {
  it('cron:validate 两种分支', async () => {
    vi.mocked(isValidCron).mockReturnValueOnce(true)
    await expect(call('cron:validate', '0 9 * * *')).resolves.toEqual({ valid: true })
    expect(isValidCron).toHaveBeenCalledWith('0 9 * * *')

    vi.mocked(isValidCron).mockReturnValueOnce(false)
    await expect(call('cron:validate', 'bad')).resolves.toEqual({
      valid: false,
      error: 'Invalid cron expression',
    })
  })

  it('cron:describe 委托 cronToHuman', async () => {
    vi.mocked(cronToHuman).mockReturnValueOnce('每天 09:00')
    await expect(call('cron:describe', '0 9 * * *')).resolves.toBe('每天 09:00')
    expect(cronToHuman).toHaveBeenCalledWith('0 9 * * *')
  })
})

describe('cron:saveAttachment — 真实落盘', () => {
  it('合法 png dataUrl 写入 .claude/cron-attachments/{id}.png', async () => {
    const result = (await call('cron:saveAttachment', root, {
      id: 'a1b2c3d4',
      name: 'pic.png',
      dataUrl: pngDataUrl('PNG-BYTES'),
    })) as { path?: string; error?: string }

    expect(result.error).toBeUndefined()
    const expected = join(root, '.claude', 'cron-attachments', 'a1b2c3d4.png')
    expect(result.path).toBe(expected)
    expect(readFileSync(expected, 'utf-8')).toBe('PNG-BYTES')
  })

  it('mime → 扩展名映射（jpg/svg），未知 mime 兜底 .png', async () => {
    const cases: Array<[string, string]> = [
      ['image/jpeg', '.jpg'],
      ['image/svg+xml', '.svg'],
      ['image/x-fancy', '.png'],
    ]
    let n = 0
    for (const [mime, ext] of cases) {
      const id = `a1b2c3d${n++}`
      const result = (await call('cron:saveAttachment', root, {
        id,
        name: 'f',
        dataUrl: `data:${mime};base64,${Buffer.from('x').toString('base64')}`,
      })) as { path?: string }
      expect(result.path).toBe(join(root, '.claude', 'cron-attachments', `${id}${ext}`))
    }
  })

  it('mime 大小写不敏感', async () => {
    const result = (await call('cron:saveAttachment', root, {
      id: 'a1b2c3d5',
      name: 'f',
      dataUrl: `data:image/JPEG;base64,${Buffer.from('x').toString('base64')}`,
    })) as { path?: string }
    expect(result.path).toContain('a1b2c3d5.jpg')
  })

  it('目录已存在时不重复创建', async () => {
    const dir = join(root, '.claude', 'cron-attachments')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'keep.txt'), 'keep')

    const result = (await call('cron:saveAttachment', root, {
      id: 'a1b2c3d6',
      name: 'f',
      dataUrl: pngDataUrl('more'),
    })) as { path?: string }

    expect(result.path).toBeTruthy()
    expect(readFileSync(join(dir, 'keep.txt'), 'utf-8')).toBe('keep')
    expect(readFileSync(join(dir, 'a1b2c3d6.png'), 'utf-8')).toBe('more')
  })

  it('非法 id（过短/非法字符）拒绝且不落盘', async () => {
    for (const id of ['short', 'a1b2c3d4!', '../evil']) {
      const result = (await call('cron:saveAttachment', root, {
        id,
        name: 'f',
        dataUrl: pngDataUrl('x'),
      })) as { error?: string }
      expect(result.error).toBe('Invalid attachment id')
    }
    expect(existsSync(join(root, '.claude', 'cron-attachments'))).toBe(false)
  })

  it('非 image dataUrl 拒绝', async () => {
    for (const dataUrl of ['data:text/plain;base64,aaaa', 'not-a-data-url', '']) {
      const result = (await call('cron:saveAttachment', root, {
        id: 'a1b2c3d7',
        name: 'f',
        dataUrl,
      })) as { error?: string }
      expect(result.error).toBe('Invalid image data')
    }
  })
})

describe('调度器回调 → 渲染进程与通知', () => {
  const run = {
    id: 'r1',
    taskId: 't1',
    taskName: '夜间备份',
    status: 'completed',
    output: 'done',
  }

  it('onTaskFired 通过 webContents 转发 cron:onTaskFired', () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } },
    ] as never)

    fire(run)

    expect(sendMock).toHaveBeenCalledWith('cron:onTaskFired', run)
  })

  it('onRunCompleted 转发 cron:onRunCompleted 并弹系统通知', () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { webContents: { send: sendMock } },
    ] as never)

    completed(run)

    expect(sendMock).toHaveBeenCalledWith('cron:onRunCompleted', run)
    expect(Notification).toHaveBeenCalledTimes(1)
    const opts = electronMocks.notifications[0].opts as { title: string; body: string }
    expect(opts.title).toBe('定时任务成功: 夜间备份')
    expect(opts.body).toBe('done')
    expect(electronMocks.notifications[0].shown).toBe(true)
  })

  it('通知标题按状态：completed/timeout/failed → 成功/超时/失败', () => {
    completed({ ...run, status: 'timeout' })
    completed({ ...run, status: 'failed' })
    expect(electronMocks.notifications[0].opts).toMatchObject({
      title: expect.stringContaining('超时'),
    })
    expect(electronMocks.notifications[1].opts).toMatchObject({
      title: expect.stringContaining('失败'),
    })
  })

  it('body 优先级 error > output > 默认文案，且截断到 200 字符', () => {
    completed({ ...run, status: 'failed', error: 'E'.repeat(300), output: 'O'.repeat(300) })
    expect((electronMocks.notifications[0].opts as { body: string }).body).toBe('E'.repeat(200))

    completed({ ...run, status: 'failed', output: 'O'.repeat(300) })
    expect((electronMocks.notifications[1].opts as { body: string }).body).toBe('O'.repeat(200))

    // error 与 output 都缺失才落到默认文案
    completed({ ...run, status: 'failed', error: undefined, output: undefined })
    expect((electronMocks.notifications[2].opts as { body: string }).body).toBe('任务失败')
  })

  it('Notification 构造抛错被吞掉，不影响回调链', () => {
    vi.mocked(Notification).mockImplementationOnce(() => {
      throw new Error('no notification service')
    })
    expect(() => completed(run)).not.toThrow()
  })

  it('没有窗口时不炸', () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
    expect(() => fire(run)).not.toThrow()
    expect(() => completed(run)).not.toThrow()
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('before-quit 清理', () => {
  function beforeQuitCallbacks(): Array<(...args: unknown[]) => void> {
    // app.on 的类型是重载集，mock.calls 只按最后一个重载收窄；拍平成 [string, fn] 再筛
    const calls = vi.mocked(app.on).mock.calls as unknown as Array<[
      string,
      (...args: unknown[]) => void,
    ]>
    return calls.filter(call => call[0] === 'before-quit').map(call => call[1])
  }

  it('触发时 scheduler.stop() 且只停一次', () => {
    const sched = lastScheduler()
    const callbacks = beforeQuitCallbacks()
    const cb = callbacks[callbacks.length - 1]

    cb()
    expect(sched.stop).toHaveBeenCalledTimes(1)

    // 第二次触发：scheduler 已置 null，不重复 stop
    cb()
    expect(sched.stop).toHaveBeenCalledTimes(1)
  })
})
