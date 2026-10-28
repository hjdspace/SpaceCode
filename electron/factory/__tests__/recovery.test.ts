// @vitest-environment node
/**
 * 启动恢复：崩溃后把实现中/审查中降级为阻塞、清空接管标记；损坏的 JSON/JSONL
 * 隔离到旁路目录，单个运行损坏不影响其他运行；清理只删已完成且无工作树的旧运行。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { recoverRuns } from '../recovery'

let dir: string
let runsRoot: string

function seedRun(
  runId: string,
  tasks: Array<Record<string, unknown>> = [],
  run: Record<string, unknown> = {},
): void {
  const runDir = join(runsRoot, runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      id: runId,
      status: 'running',
      paused: false,
      createdAt: '2026-10-29T10:00:00Z',
      maxConcurrency: 2,
      spendUsd: 0,
      elapsedMs: 0,
      ...run,
    }),
    'utf-8',
  )
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify(tasks), 'utf-8')
}

function task(id: string, lane: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    runId: 'run-1',
    source: 'local',
    title: id,
    goal: '',
    lane,
    stageIdx: lane === 'reviewing' ? 4 : 2,
    branch: `agent/${id}`,
    worktree: null,
    model: '',
    iteration: 1,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: {},
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-recovery-'))
  runsRoot = join(dir, '.spacecode', 'factory', 'runs')
  mkdirSync(runsRoot, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('recoverRuns', () => {
  it('downgrades implementing/reviewing tasks to blocked and clears takeover', () => {
    seedRun('run-1', [
      task('a', 'implementing', { takeover: { at: '2026-10-29T10:01:00Z', sessionId: 's-1' } }),
      task('b', 'reviewing'),
      task('c', 'queued'),
    ])

    const result = recoverRuns(dir, { writable: true })

    const tasks = JSON.parse(readFileSync(join(runsRoot, 'run-1', 'tasks.json'), 'utf-8'))
    expect(tasks[0]).toMatchObject({
      lane: 'blocked',
      stageIdx: 2,
      attention: { reason: 'app.restarted', action: 'retry' },
    })
    expect(tasks[0].takeover).toBeUndefined()
    expect(tasks[1]).toMatchObject({ lane: 'blocked', stageIdx: 4 })
    expect(tasks[2]).toMatchObject({ lane: 'queued' })

    const run = JSON.parse(readFileSync(join(runsRoot, 'run-1', 'run.json'), 'utf-8'))
    expect(run).toMatchObject({ status: 'paused', paused: true })
    expect(result.recovered).toEqual(['run-1'])
  })

  it('quarantines a corrupt run without touching other runs', () => {
    seedRun('run-1', [task('a', 'implementing')])
    seedRun('run-2', [task('b', 'queued')])
    writeFileSync(join(runsRoot, 'run-2', 'run.json'), '{ not json', 'utf-8')

    const result = recoverRuns(dir, { writable: true })

    expect(result.corrupt).toContain('run-2')
    expect(existsSync(join(runsRoot, 'run-2'))).toBe(false)
    expect(existsSync(join(dir, '.spacecode', 'factory', 'corrupt'))).toBe(true)
    expect(existsSync(join(runsRoot, 'run-1', 'tasks.json'))).toBe(true)
  })

  it('quarantines corrupt event lines while keeping valid history', () => {
    const runDir = join(runsRoot, 'run-1')
    seedRun('run-1', [task('a', 'queued')])
    const event = {
      seq: 1,
      at: '2026-10-29T10:00:00Z',
      runId: 'run-1',
      taskId: null,
      code: 'run.paused',
      level: 'info',
    }
    writeFileSync(
      join(runDir, 'events.jsonl'),
      `${JSON.stringify(event)}\n{ broken line\n${JSON.stringify({ ...event, seq: 2 })}\n`,
      'utf-8',
    )

    const result = recoverRuns(dir, { writable: true })

    expect(result.corrupt).toContain('run-1/events.jsonl')
    const lines = readFileSync(join(runDir, 'events.jsonl'), 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]).seq).toBe(2)
  })

  it('prunes old finished runs without worktrees but keeps the configured count', () => {
    for (const [index, createdAt] of [
      ['old', '2026-10-01T00:00:00Z'],
      ['middle', '2026-10-02T00:00:00Z'],
      ['new', '2026-10-03T00:00:00Z'],
    ] as const) {
      seedRun(
        index,
        [task(`t-${index}`, 'done', { worktree: null })],
        { status: 'stopped', paused: false, createdAt },
      )
    }

    const result = recoverRuns(dir, { writable: true, keepDoneRuns: 1 })

    expect(result.removed.sort()).toEqual(['middle', 'old'])
    expect(existsSync(join(runsRoot, 'new'))).toBe(true)
    expect(existsSync(join(runsRoot, 'old'))).toBe(false)
  })

  it('does not mutate files when the caller is read-only', () => {
    seedRun('run-1', [task('a', 'implementing')])
    const before = readFileSync(join(runsRoot, 'run-1', 'tasks.json'), 'utf-8')
    const log = join(runsRoot, 'run-1', 'events.jsonl')
    writeFileSync(log, '{"seq":1}\n{ broken\n', 'utf-8')
    const logBefore = readFileSync(log, 'utf-8')

    const result = recoverRuns(dir, { writable: false })

    expect(result.recovered).toEqual([])
    expect(result.corrupt).toContain('run-1/events.jsonl')
    expect(readFileSync(join(runsRoot, 'run-1', 'tasks.json'), 'utf-8')).toBe(before)
    expect(readFileSync(log, 'utf-8')).toBe(logBefore)
    expect(existsSync(join(dir, '.spacecode', 'factory', 'corrupt'))).toBe(false)
  })
})
