// @vitest-environment node
/**
 * 运行创建与快照：任务以排队态领取、写入 runs/<id>，且一个待办
 * 只能出现在一个未结束的运行里。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readLatestRun, readRunSnapshot, runDir } from '../runs'
import type { FactoryBacklogItem } from '@/shared/factory'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-runs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function runDeps() {
  let tick = 0
  let counter = 0
  const base = Date.parse('2026-10-28T10:00:00.000Z')
  return {
    now: () => new Date(base + tick++ * 1000),
    genId: () => `run-${++counter}`,
  }
}

function seedConfig(): void {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)
}

function seedBacklog(titles: string[]): FactoryBacklogItem[] {
  let counter = 0
  const deps = { now: () => new Date('2026-10-28T09:00:00.000Z'), genId: () => `bl-${++counter}` }
  let items: FactoryBacklogItem[] = []
  for (const title of titles) {
    const result = createBacklogItem(dir, { title }, deps)
    if (!result.ok) throw new Error('fixture backlog invalid')
    items = result.items
  }
  return items
}

function runIds(): string[] {
  const path = join(dir, '.spacecode/factory/runs')
  return existsSync(path) ? readdirSync(path) : []
}

function stopRun(runId: string): void {
  const path = join(runDir(dir, runId), 'run.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  writeFileSync(path, JSON.stringify({ ...raw, status: 'stopped' }), 'utf-8')
}

describe('createFactoryRun', () => {
  beforeEach(seedConfig)

  it('claims backlog tasks into the queue, stopped at the claim stage', () => {
    const backlog = seedBacklog(['登录态刷新丢失', '缓存重复请求', '面板数字跳动'])
    const result = createFactoryRun(
      dir,
      { taskIds: backlog.map((item) => item.id) },
      runDeps(),
    )
    if (!result.ok) throw new Error(`unexpected failure: ${result.error}`)

    const { run, tasks } = result.snapshot
    expect(run).toMatchObject({
      id: 'run-1',
      status: 'pending',
      paused: false,
      maxConcurrency: 4,
      spendUsd: 0,
      elapsedMs: 0,
    })
    expect(run.createdAt).toBeTruthy()

    expect(tasks).toHaveLength(3)
    expect(tasks.map((task) => task.title)).toEqual(['登录态刷新丢失', '缓存重复请求', '面板数字跳动'])
    for (const task of tasks) {
      expect(task).toMatchObject({
        runId: 'run-1',
        source: 'local',
        lane: 'queued',
        stageIdx: 0,
        worktree: null,
        model: 'claude-sonnet-4-5',
        iteration: 0,
        maxIterations: 5,
        diff: { additions: 0, deletions: 0 },
      })
      expect(task.branch).toBe(`agent/task-${task.id}`)
      expect(task.issueNumber).toBeUndefined()
      expect(task.timestamps.claimedAt).toBe(run.createdAt)
    }

    // 落盘后重新读取仍然一致（刷新窗口 / 重启）
    expect(readRunSnapshot(dir, 'run-1')).toEqual(result.snapshot)
    expect(readLatestRun(dir)).toEqual(result.snapshot)
  })

  it('deduplicates repeated ids in one request', () => {
    const [first] = seedBacklog(['唯一任务'])
    const result = createFactoryRun(dir, { taskIds: [first.id, first.id] }, runDeps())
    if (!result.ok) throw new Error('unexpected failure')
    expect(result.snapshot.tasks).toHaveLength(1)
  })

  it('rejects empty selections and unknown ids', () => {
    const empty = createFactoryRun(dir, { taskIds: [] }, runDeps())
    expect(empty).toMatchObject({ ok: false, error: 'empty-tasks' })
    expect(runIds()).toHaveLength(0)

    const missing = createFactoryRun(dir, { taskIds: ['bl-404'] }, runDeps())
    expect(missing).toMatchObject({ ok: false, error: 'missing-tasks', missing: ['bl-404'] })
  })

  it('rejects a task already claimed by an unfinished run', () => {
    const [first, second] = seedBacklog(['已领取', '未领取'])
    const deps = runDeps()
    const created = createFactoryRun(dir, { taskIds: [first.id] }, deps)
    if (!created.ok) throw new Error('fixture run invalid')

    const duplicate = createFactoryRun(dir, { taskIds: [first.id] }, deps)
    expect(duplicate).toMatchObject({ ok: false, error: 'duplicate-tasks', duplicates: [first.id] })
    expect(runIds()).toHaveLength(1)

    // 未领取的那条仍然可以创建新运行
    const free = createFactoryRun(dir, { taskIds: [second.id] }, deps)
    expect(free.ok).toBe(true)
    if (!free.ok) throw new Error('unexpected failure')
    expect(free.snapshot.run.id).toBe('run-2')
  })

  it('allows reclaiming a task once the previous run is stopped', () => {
    const [first] = seedBacklog(['可重新领取'])
    const deps = runDeps()
    const created = createFactoryRun(dir, { taskIds: [first.id] }, deps)
    if (!created.ok) throw new Error('fixture run invalid')

    stopRun(created.snapshot.run.id)

    const retried = createFactoryRun(dir, { taskIds: [first.id] }, deps)
    expect(retried.ok).toBe(true)
    if (!retried.ok) throw new Error('unexpected failure')
    expect(retried.snapshot.run.id).toBe('run-2')
    expect(retried.snapshot.tasks[0].runId).toBe('run-2')
  })

  it('clamps the concurrency limit', () => {
    const [first, second, third] = seedBacklog(['A', 'B', 'C'])
    const high = createFactoryRun(dir, { taskIds: [first.id], concurrency: 99 }, runDeps())
    if (!high.ok) throw new Error('unexpected failure')
    expect(high.snapshot.run.maxConcurrency).toBe(20)

    const low = createFactoryRun(dir, { taskIds: [second.id], concurrency: 0 }, runDeps())
    if (!low.ok) throw new Error('unexpected failure')
    expect(low.snapshot.run.maxConcurrency).toBe(1)

    const defaulted = createFactoryRun(dir, { taskIds: [third.id] }, runDeps())
    if (!defaulted.ok) throw new Error('unexpected failure')
    expect(defaulted.snapshot.run.maxConcurrency).toBe(4)
  })

  it('returns the newest run from readLatestRun', () => {
    const [first, second] = seedBacklog(['旧运行', '新运行'])
    const deps = runDeps()
    const older = createFactoryRun(dir, { taskIds: [first.id] }, deps)
    const newer = createFactoryRun(dir, { taskIds: [second.id] }, deps)
    if (!older.ok || !newer.ok) throw new Error('fixture runs invalid')

    expect(readLatestRun(dir)?.run.id).toBe(newer.snapshot.run.id)
    expect(readRunSnapshot(dir, older.snapshot.run.id)?.run.id).toBe('run-1')
    expect(readRunSnapshot(dir, 'run-404')).toBeNull()
  })

  it('falls back to defaults without a config file', () => {
    rmSync(join(dir, '.spacecode/factory/config.json'))
    const [first] = seedBacklog(['无配置'])
    const result = createFactoryRun(dir, { taskIds: [first.id] }, runDeps())
    if (!result.ok) throw new Error('unexpected failure')
    expect(result.snapshot.run.maxConcurrency).toBe(4)
    expect(result.snapshot.tasks[0]).toMatchObject({ model: '', maxIterations: 5 })
  })
})

describe('persisted run layout', () => {
  beforeEach(seedConfig)

  it('writes run.json and tasks.json under runs/<runId>', () => {
    const [first] = seedBacklog(['一个任务'])
    const created = createFactoryRun(dir, { taskIds: [first.id] }, runDeps())
    if (!created.ok) throw new Error('unexpected failure')

    const base = runDir(dir, created.snapshot.run.id)
    expect(existsSync(join(base, 'run.json'))).toBe(true)
    expect(existsSync(join(base, 'tasks.json'))).toBe(true)
    const tasks = JSON.parse(readFileSync(join(base, 'tasks.json'), 'utf-8')) as unknown[]
    expect(tasks).toHaveLength(1)
  })
})
