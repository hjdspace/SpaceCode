// @vitest-environment node
/**
 * 调度决策：并发闸门、依赖、排队公平性与暂停语义。
 *
 * 只跨真实 snapshot 形状做断言；执行由 runner 负责，这里不碰磁盘。
 */
import { describe, it, expect } from 'vitest'
import type { FactoryRun, FactoryRunSnapshot, FactoryTask } from '@/shared/factory'
import { clampConcurrency, dispatchDecision, FACTORY_MAX_CONCURRENCY } from '../scheduler'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 't-1',
    runId: 'run-1',
    source: 'local',
    title: '任务',
    goal: '',
    lane: 'queued',
    stageIdx: 0,
    branch: 'agent/task-t-1',
    worktree: null,
    model: 'claude-sonnet-4-5',
    iteration: 0,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: {},
    ...overrides,
  }
}

function run(overrides: Partial<FactoryRun> = {}): FactoryRun {
  return {
    id: 'run-1',
    status: 'running',
    paused: false,
    createdAt: '2026-10-29T10:00:00Z',
    startedAt: '2026-10-29T10:00:00Z',
    maxConcurrency: 2,
    spendUsd: 0,
    elapsedMs: 0,
    ...overrides,
  }
}

function snapshot(tasks: FactoryTask[], overrides: Partial<FactoryRun> = {}): FactoryRunSnapshot {
  return { run: run(overrides), tasks }
}

describe('clampConcurrency', () => {
  it('clamps to 1..20 and ignores non-finite input', () => {
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(3.9)).toBe(3)
    expect(clampConcurrency(25)).toBe(FACTORY_MAX_CONCURRENCY)
    expect(clampConcurrency(Number.NaN)).toBe(1)
  })
})

describe('dispatchDecision', () => {
  it('claims queued tasks in array order until the gate is full', () => {
    const decision = dispatchDecision(
      snapshot([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]),
      [],
    )
    expect(decision.taskId).toBe('a')
    expect(decision.active).toBe(0)
    expect(decision.max).toBe(2)
  })

  it('waits for a slot without counting the same task twice', () => {
    const tasks = [task({ id: 'a', lane: 'implementing' }), task({ id: 'b' }), task({ id: 'c' })]
    const decision = dispatchDecision(snapshot(tasks), ['a'])
    expect(decision.active).toBe(1)
    expect(decision.taskId).toBe('b')

    const full = dispatchDecision(snapshot(tasks), ['a', 'b'])
    expect(full.taskId).toBeNull()
    expect(full.waitingForSlot).toBe(2)
  })

  it('does not claim a task whose dependencies are unfinished', () => {
    const tasks = [
      task({ id: 'a', dependsOn: ['b'] }),
      task({ id: 'b', lane: 'implementing' }),
      task({ id: 'c' }),
    ]
    const decision = dispatchDecision(snapshot(tasks), ['b'])
    expect(decision.taskId).toBe('c')
    expect(decision.blockedByDependency).toBe(1)
  })

  it('treats missing and cancelled dependencies as unfinished', () => {
    const tasks = [
      task({ id: 'a', dependsOn: ['ghost'] }),
      task({ id: 'b', dependsOn: ['dep'] }),
      task({ id: 'dep', lane: 'done', cancelled: true }),
      task({ id: 'c' }),
    ]
    const decision = dispatchDecision(snapshot(tasks), [])
    expect(decision.taskId).toBe('c')
    expect(decision.blockedByDependency).toBe(2)
  })

  it('skips cancelled queued tasks', () => {
    const decision = dispatchDecision(
      snapshot([task({ id: 'a', cancelled: true }), task({ id: 'b' })]),
      [],
    )
    expect(decision.taskId).toBe('b')
  })

  it('claims nothing while the run is paused or stopped', () => {
    const paused = dispatchDecision(snapshot([task()], { paused: true }), [])
    expect(paused.taskId).toBeNull()

    const stopped = dispatchDecision(snapshot([task()], { status: 'stopped' }), [])
    expect(stopped.taskId).toBeNull()

    const pending = dispatchDecision(snapshot([task()], { status: 'pending' }), [])
    expect(pending.taskId).toBeNull()
  })

  it('counts a taken-over task as occupying a slot', () => {
    const tasks = [
      task({
        id: 'a',
        lane: 'implementing',
        takeover: { at: '2026-10-29T10:00:00Z', sessionId: 'fac-run-1-a-takeover' },
      }),
      task({ id: 'b' }),
    ]
    const decision = dispatchDecision(snapshot(tasks, { maxConcurrency: 1 }), [])
    expect(decision.takeoverActive).toBe(1)
    expect(decision.active).toBe(1)
    expect(decision.taskId).toBeNull()

    const wider = dispatchDecision(snapshot(tasks, { maxConcurrency: 2 }), [])
    expect(wider.taskId).toBe('b')
  })

  it('does not claim blocked tasks automatically', () => {
    const decision = dispatchDecision(
      snapshot([task({ id: 'a', lane: 'blocked' }), task({ id: 'b' })]),
      [],
    )
    expect(decision.taskId).toBe('b')
  })
})
