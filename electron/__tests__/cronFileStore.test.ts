import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readCronTasks, addCronTask, updateCronTask, deleteCronTask, updateLastFired } from '../cronFileStore'

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
    writeFileSync(join(dir, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [
        { id: 'a1', cron: '0 9 * * *', prompt: 'valid', createdAt: Date.now() },
        { id: 'b2', cron: 'invalid', prompt: 'bad', createdAt: Date.now() },
      ]
    }))

    const tasks = await readCronTasks(tempDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('a1')
  })
})
