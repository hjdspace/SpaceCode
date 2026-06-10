// electron/__tests__/taskRunLogger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendRun, updateRun, getRecentRuns, getTaskRuns, cleanupStaleRuns } from '../taskRunLogger'
import type { TaskRun } from '../taskRunLogger'

describe('taskRunLogger', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cron-log-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('appends and reads runs', async () => {
    const run: TaskRun = {
      id: 'r1',
      taskId: 't1',
      taskName: 'Test',
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: 'test prompt',
    }
    await appendRun(run, tempDir)

    const runs = await getRecentRuns(tempDir)
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe('r1')
  })

  it('updates a run', async () => {
    const run: TaskRun = {
      id: 'r2',
      taskId: 't1',
      taskName: 'Test',
      startedAt: new Date().toISOString(),
      status: 'running',
      prompt: 'test',
    }
    await appendRun(run, tempDir)
    await updateRun('r2', { status: 'completed', durationMs: 5000 }, tempDir)

    const runs = await getRecentRuns(tempDir)
    expect(runs[0].status).toBe('completed')
    expect(runs[0].durationMs).toBe(5000)
  })

  it('filters runs by taskId', async () => {
    await appendRun({ id: 'r3', taskId: 't1', taskName: 'A', startedAt: new Date().toISOString(), status: 'completed', prompt: 'a' }, tempDir)
    await appendRun({ id: 'r4', taskId: 't2', taskName: 'B', startedAt: new Date().toISOString(), status: 'completed', prompt: 'b' }, tempDir)

    const runs = await getTaskRuns('t1', tempDir)
    expect(runs).toHaveLength(1)
    expect(runs[0].taskId).toBe('t1')
  })

  it('cleans up stale running records', async () => {
    const oldTime = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    await appendRun({ id: 'r5', taskId: 't1', taskName: 'Stale', startedAt: oldTime, status: 'running', prompt: 'stale' }, tempDir)

    await cleanupStaleRuns(tempDir)

    const runs = await getRecentRuns(tempDir)
    expect(runs[0].status).toBe('failed')
  })
})
