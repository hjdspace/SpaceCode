// @vitest-environment node
/**
 * 运行时：任务迁移只能走 transitionTask 一处，非法迁移被拒绝且不落盘；
 * 投影补丁（diff/commits/usage）与运行状态写回同一份快照。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { createBacklogItem } from '../backlog'
import { createFactoryRun, readRunSnapshot } from '../runs'
import {
  canTransition,
  patchTask,
  stageIndexFor,
  transitionTask,
  updateRun,
} from '../runtime'

let dir: string
let runId: string

function taskId(): string {
  return readRunSnapshot(dir, runId)!.tasks[0].id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-runtime-'))
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  writeFactoryConfigAtomic(dir, built.config)
  const backlog = createBacklogItem(dir, { title: '任务' }, { genId: () => 'bl-1' })
  if (!backlog.ok) throw new Error('fixture backlog invalid')
  const created = createFactoryRun(dir, { taskIds: ['bl-1'] }, { genId: () => 'run-1' })
  if (!created.ok) throw new Error('fixture run invalid')
  runId = created.snapshot.run.id
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('transition rules', () => {
  it('maps lanes to the six-step progress indexes', () => {
    expect(stageIndexFor('queued')).toBe(0)
    expect(stageIndexFor('implementing')).toBe(1)
    expect(stageIndexFor('reviewing')).toBe(4)
    expect(stageIndexFor('mergeable')).toBe(5)
    expect(stageIndexFor('done')).toBe(6)
  })

  it('allows the documented pipeline edges only', () => {
    expect(canTransition('queued', 'implementing')).toBe(true)
    expect(canTransition('implementing', 'reviewing')).toBe(true)
    expect(canTransition('reviewing', 'mergeable')).toBe(true)
    expect(canTransition('mergeable', 'done')).toBe(true)
    expect(canTransition('blocked', 'implementing')).toBe(true)
    // 接管交回后验证通过：blocked 也可以直接回到审查阶段重试。
    expect(canTransition('blocked', 'reviewing')).toBe(true)

    expect(canTransition('queued', 'done')).toBe(false)
    expect(canTransition('done', 'implementing')).toBe(false)
    expect(canTransition('mergeable', 'reviewing')).toBe(false)
  })
})

describe('transitionTask', () => {
  const now = () => new Date('2026-10-28T10:00:00.000Z')

  it('moves a queued task to the worktree stage and stamps startedAt', () => {
    const id = taskId()
    const result = transitionTask(
      dir,
      runId,
      id,
      { lane: 'implementing', stageIdx: 1 },
      'worktree.ready',
      { worktree: '.spacecode/worktrees/bl-1', branch: 'agent/task-bl-1' },
      { now },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.tasks[0]).toMatchObject({
      lane: 'implementing',
      stageIdx: 1,
      worktree: '.spacecode/worktrees/bl-1',
      branch: 'agent/task-bl-1',
      timestamps: { startedAt: '2026-10-28T10:00:00.000Z' },
    })
    expect(readRunSnapshot(dir, runId)!.tasks[0].lane).toBe('implementing')
  })

  it('blocks with an attention reason and keeps the stuck stage', () => {
    const id = taskId()
    transitionTask(dir, runId, id, { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {}, { now })
    const blocked = transitionTask(dir, runId, id, { lane: 'blocked' }, 'stopped', {}, { now })
    expect(blocked).toMatchObject({
      ok: true,
      snapshot: {
        tasks: [
          {
            lane: 'blocked',
            stageIdx: 2,
            attention: { reason: 'stopped', action: 'retry' },
          },
        ],
      },
    })
  })

  it('rejects illegal transitions without writing', () => {
    const id = taskId()
    const result = transitionTask(dir, runId, id, { lane: 'done', stageIdx: 6 }, 'skip', {}, { now })
    expect(result).toEqual({ ok: false, error: 'invalid-transition' })
    expect(readRunSnapshot(dir, runId)!.tasks[0].lane).toBe('queued')
  })

  it('reports missing tasks and runs', () => {
    expect(
      transitionTask(dir, runId, 'bl-404', { lane: 'implementing', stageIdx: 1 }, 'x', {}, { now }),
    ).toEqual({ ok: false, error: 'task-not-found' })
    expect(
      transitionTask(dir, 'run-404', 'bl-1', { lane: 'implementing', stageIdx: 1 }, 'x', {}, { now }),
    ).toEqual({ ok: false, error: 'task-not-found' })
  })

  it('stamps endedAt and the cancelled flag on completion', () => {
    const id = taskId()
    transitionTask(dir, runId, id, { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {}, { now })
    const done = transitionTask(
      dir,
      runId,
      id,
      { lane: 'done', stageIdx: 6 },
      'cancelled',
      { cancelled: true },
      { now },
    )
    expect(done).toMatchObject({
      ok: true,
      snapshot: { tasks: [{ lane: 'done', stageIdx: 6, cancelled: true, timestamps: { endedAt: '2026-10-28T10:00:00.000Z' } }] },
    })
  })
})

describe('projection patches', () => {
  const now = () => new Date('2026-10-28T10:00:00.000Z')

  it('persists diff, commits, usage and iteration without changing the lane', () => {
    const id = taskId()
    const result = patchTask(
      dir,
      runId,
      id,
      {
        iteration: 2,
        diff: { additions: 12, deletions: 3, files: [{ path: 'a.ts', additions: 12, deletions: 3 }] },
        commits: [{ sha: 'abc', message: 'feat: a' }],
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      { now },
    )
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        tasks: [
          {
            lane: 'queued',
            iteration: 2,
            diff: { additions: 12, deletions: 3 },
            commits: [{ sha: 'abc', message: 'feat: a' }],
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        ],
      },
    })
  })

  it('returns task-not-found for unknown ids', () => {
    expect(patchTask(dir, runId, 'bl-404', { iteration: 1 }, { now })).toEqual({
      ok: false,
      error: 'task-not-found',
    })
  })

  it('sets and clears the takeover marker', () => {
    const id = taskId()
    transitionTask(dir, runId, id, { lane: 'implementing', stageIdx: 2 }, 'worktree.ready', {}, { now })
    const marked = patchTask(
      dir,
      runId,
      id,
      { takeover: { at: '2026-10-28T10:00:00.000Z', sessionId: 'fac-run-1-bl-1-takeover' } },
      { now },
    )
    expect(marked).toMatchObject({
      ok: true,
      snapshot: { tasks: [{ takeover: { sessionId: 'fac-run-1-bl-1-takeover' } }] },
    })

    const cleared = transitionTask(dir, runId, id, { lane: 'blocked' }, 'stopped', { takeover: null }, { now })
    expect(cleared).toMatchObject({ ok: true, snapshot: { tasks: [{ lane: 'blocked' }] } })
    expect(readRunSnapshot(dir, runId)!.tasks[0]).not.toHaveProperty('takeover')
  })
})

describe('updateRun', () => {
  it('writes status, timestamps and elapsed time', () => {
    const started = updateRun(
      dir,
      runId,
      { status: 'running', startedAt: '2026-10-28T10:00:00.000Z' },
      { now: () => new Date('2026-10-28T10:01:30.000Z') },
    )
    expect(started).toMatchObject({ status: 'running', elapsedMs: 90_000 })

    const stopped = updateRun(
      dir,
      runId,
      { status: 'stopped', endedAt: '2026-10-28T10:02:00.000Z' },
      { now: () => new Date('2026-10-28T10:02:00.000Z') },
    )
    expect(stopped).toMatchObject({ status: 'stopped', elapsedMs: 120_000 })
  })

  it('returns null for unknown runs', () => {
    expect(updateRun(dir, 'run-404', { status: 'running' })).toBeNull()
  })
})
