import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import {
  readCronTasks, addCronTask, updateCronTask, deleteCronTask, updateLastFired,
  disableCronTask, CRON_FILE_REL,
} from '../cron/cronFileStore'

const CRON_FILE_NAME = basename(CRON_FILE_REL)

describe('cronFileStore', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cron-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns empty array when no file exists', async () => {
    const tasks = await readCronTasks(tempDir)
    expect(tasks).toEqual([])
  })

  it('creates and reads a task', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
      recurring: true,
      name: 'Daily Review',
    }, tempDir)

    expect(task.id).toBeTruthy()
    expect(task.cron).toBe('0 9 * * *')
    expect(task.prompt).toBe('review code')
    expect(task.recurring).toBe(true)
    expect(task.name).toBe('Daily Review')
    expect(task.enabled).toBe(true)

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(task.id)
  })

  it('updates a task', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
    }, tempDir)

    await updateCronTask(task.id, { prompt: 'new prompt', enabled: false }, tempDir)

    const tasks = await readCronTasks(tempDir)
    expect(tasks[0].prompt).toBe('new prompt')
    expect(tasks[0].enabled).toBe(false)
  })

  it('deletes a task', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
    }, tempDir)

    await deleteCronTask(task.id, tempDir)

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(0)
  })

  it('updates lastFiredAt', async () => {
    const task = await addCronTask({
      cron: '0 9 * * *',
      prompt: 'review code',
      recurring: true,
    }, tempDir)

    const firedAt = Date.now()
    await updateLastFired(task.id, firedAt, tempDir)

    const tasks = await readCronTasks(tempDir)
    expect(tasks[0].lastFiredAt).toBe(firedAt)
  })

  it('silently skips tasks with invalid cron on read', async () => {
    const { writeFileSync, mkdirSync } = await import('fs')
    const dir = join(tempDir, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, CRON_FILE_NAME), JSON.stringify({
      tasks: [
        { id: 'a1', cron: '0 9 * * *', prompt: 'valid', createdAt: Date.now() },
        { id: 'b2', cron: 'invalid', prompt: 'bad', createdAt: Date.now() },
      ]
    }))

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('a1')
  })

  it('disableCronTask 对已消失的任务静默跳过', async () => {
    await expect(disableCronTask('gone', tempDir)).resolves.toBeUndefined()

    const task = await addCronTask({ cron: '0 9 * * *', prompt: 'p' }, tempDir)
    await disableCronTask(task.id, tempDir)
    expect((await readCronTasks(tempDir))[0].enabled).toBe(false)
  })

  describe('从引擎共用的 scheduled_tasks.json 迁移', () => {
    const legacyDir = () => join(tempDir, '.claude')

    function writeLegacy(tasks: unknown[]) {
      mkdirSync(legacyDir(), { recursive: true })
      writeFileSync(
        join(legacyDir(), 'scheduled_tasks.json'),
        JSON.stringify({ tasks }, null, 2),
      )
    }

    function readLegacy(): { id: string }[] {
      return JSON.parse(
        readFileSync(join(legacyDir(), 'scheduled_tasks.json'), 'utf-8'),
      ).tasks
    }

    it('把 SpaceCode 的任务搬进独立文件，引擎建的原样留给引擎', async () => {
      writeLegacy([
        { id: 'mine', cron: '0 9 * * *', prompt: 'p', createdAt: 1, enabled: true, name: 'x' },
        { id: 'theirs', cron: '30 8 * * *', prompt: 'engine', createdAt: 1 },
      ])

      const tasks = await readCronTasks(tempDir)

      expect(tasks.map(t => t.id)).toEqual(['mine'])
      expect(readLegacy().map(t => t.id)).toEqual(['theirs'])
      // 再读一次不再迁移
      expect((await readCronTasks(tempDir)).map(t => t.id)).toEqual(['mine'])
    })

    it('没有历史文件时不产生任何写入', async () => {
      expect(await readCronTasks(tempDir)).toEqual([])
      expect(existsSync(join(legacyDir(), CRON_FILE_NAME))).toBe(false)
    })
  })
})
