// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CronScheduler, checkScheduleWindow } from '../cron/cronScheduler'
import type { CronRunContext } from '../cron/cronScheduler'
import { addCronTask, deleteCronTask, readCronTasks, type CronTask } from '../cron/cronFileStore'

function taskWith(extra: Partial<CronTask>): CronTask {
  return { id: 'a', cron: '0 9 5 10 *', prompt: 'p', createdAt: 0, ...extra }
}

describe('checkScheduleWindow', () => {
  it('不带窗口字段的老任务不受门控', () => {
    expect(checkScheduleWindow(taskWith({}), new Date(2026, 9, 5, 9, 0, 0))).toBe('active')
  })

  it('startsAt 未到给 pending，到点那一分钟给 active', () => {
    const startsAt = new Date(2026, 9, 5, 9, 0, 0).getTime()
    const task = taskWith({ startsAt })
    expect(checkScheduleWindow(task, new Date(2026, 9, 5, 8, 59, 0))).toBe('pending')
    expect(checkScheduleWindow(task, new Date(2026, 9, 5, 9, 0, 0))).toBe('active')
  })

  it('endsAt 已过给 expired', () => {
    const endsAt = new Date(2026, 9, 5, 23, 59, 59).getTime()
    expect(checkScheduleWindow(taskWith({ endsAt }), new Date(2026, 9, 6, 0, 0, 0))).toBe('expired')
  })

  it('单次的 startsAt 就是终点：过了判 expired，不会明年同一分钟再跑一次', () => {
    const startsAt = new Date(2026, 9, 7, 21, 55, 0).getTime()
    const task = taskWith({ recurring: false, startsAt })
    expect(checkScheduleWindow(task, new Date(2026, 9, 7, 21, 55, 30))).toBe('active')
    expect(checkScheduleWindow(task, new Date(2026, 9, 7, 21, 56, 0))).toBe('expired')
  })
})

describe('CronScheduler 执行会话', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cron-session-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('sessionId 落到执行记录，并区分立即执行与定时触发的前台行为', async () => {
    const contexts: CronRunContext[] = []
    const scheduler = new CronScheduler({
      getProjectRoot: () => root,
      runPrompt: (_prompt, _cwd, context) => {
        contexts.push(context)
        return Promise.resolve({ exitCode: 0, stdout: 'ok', stderr: '' })
      },
    })
    const task = await addCronTask(
      { cron: '0 9 * * *', prompt: 'p', recurring: true, name: 'nightly' },
      root,
    )

    const manual = await scheduler.executeTask(task, root, { activate: true })
    expect(manual.status).toBe('completed')
    expect(manual.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(contexts[0].sessionId).toBe(manual.sessionId)
    expect(contexts[0].taskName).toBe('nightly')
    expect(contexts[0].activate).toBe(true)

    const auto = await scheduler.executeTask(task, root)
    expect(contexts[1].activate).toBe(false)
    expect(auto.sessionId).not.toBe(manual.sessionId)
  })

  it('单次任务跑完即禁用', async () => {
    const scheduler = new CronScheduler({
      getProjectRoot: () => root,
      runPrompt: () => Promise.resolve({ exitCode: 0, stdout: 'ok', stderr: '' }),
    })
    const task = await addCronTask({ cron: '55 21 7 10 *', prompt: 'p', recurring: false }, root)

    const run = await scheduler.executeTask(task, root)
    expect(run.status).toBe('completed')
    expect((await readCronTasks(root))[0].enabled).toBe(false)
  })

  it('收尾时任务已不在文件里，也不把成功的执行改成失败', async () => {
    const scheduler = new CronScheduler({
      getProjectRoot: () => root,
      runPrompt: () => Promise.resolve({ exitCode: 0, stdout: '你好', stderr: '' }),
    })
    const task = await addCronTask({ cron: '55 21 7 10 *', prompt: 'p', recurring: false }, root)
    // 引擎侧的调度器可能在这一轮跑完前就把单次任务删掉
    await deleteCronTask(task.id, root)

    const run = await scheduler.executeTask(task, root)
    expect(run.status).toBe('completed')
    expect(run.output).toBe('你好')
    expect(run.error).toBeUndefined()
  })

  it('超时不只落记录，还中断执行信号', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const scheduler = new CronScheduler({
        getProjectRoot: () => root,
        runPrompt: (_prompt, _cwd, context) => {
          signal = context.signal
          return new Promise(() => {})
        },
      })
      const task = await addCronTask({ cron: '0 9 * * *', prompt: 'p', recurring: true }, root)

      const pending = scheduler.executeTask(task, root)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      const run = await pending
      expect(run.status).toBe('timeout')
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('CronScheduler 有效期门控', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cron-window-'))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(root, { recursive: true, force: true })
  })

  /** start() 立即 tick 一次；推进 1ms 让 tick 里的 await 链落定 */
  async function tickAt(at: Date) {
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    vi.setSystemTime(at)
    const scheduler = new CronScheduler({ getProjectRoot: () => root, runPrompt: spawn })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1)
    scheduler.stop()
    return spawn
  }

  it('不带窗口的老任务照常在匹配分钟执行', async () => {
    await addCronTask({ cron: '0 9 * * *', prompt: 'p', recurring: true }, root)
    const spawn = await tickAt(new Date(2026, 9, 5, 9, 0, 0))
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('单次任务不在 startsAt 之前的同名分钟误触发', async () => {
    const startsAt = new Date(2027, 9, 5, 9, 0, 0).getTime()
    await addCronTask(
      { cron: '0 9 5 10 *', prompt: 'p', recurring: false, scheduleMode: 'once', startsAt },
      root,
    )

    // 这条 cron 在 2026-10-05 09:00 同样命中；加门控前它会提前一年跑掉
    const early = await tickAt(new Date(2026, 9, 5, 9, 0, 0))
    expect(early).not.toHaveBeenCalled()

    const due = await tickAt(new Date(2027, 9, 5, 9, 0, 30))
    expect(due).toHaveBeenCalledTimes(1)
  })

  it('到期任务写回 enabled:false 并停止执行', async () => {
    const created = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'p',
      recurring: true,
      scheduleMode: 'repeat',
      endsAt: new Date(2026, 9, 4, 23, 59, 59).getTime(),
    }, root)

    const spawn = await tickAt(new Date(2026, 9, 5, 9, 0, 0))
    expect(spawn).not.toHaveBeenCalled()

    const stored = await readCronTasks(root)
    expect(stored.find(t => t.id === created.id)?.enabled).toBe(false)
  })

  it('单次的时刻已过即禁用，不等明年同一分钟', async () => {
    const created = await addCronTask({
      cron: '0 9 5 10 *',
      prompt: 'p',
      recurring: false,
      scheduleMode: 'once',
      startsAt: new Date(2026, 9, 5, 9, 0, 0).getTime(),
    }, root)

    const spawn = await tickAt(new Date(2026, 9, 6, 9, 0, 0))
    expect(spawn).not.toHaveBeenCalled()

    const stored = await readCronTasks(root)
    expect(stored.find(t => t.id === created.id)?.enabled).toBe(false)
  })
})
