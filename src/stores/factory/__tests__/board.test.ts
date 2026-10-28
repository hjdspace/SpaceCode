/**
 * 看板纯逻辑：六泳道顺序、分组计数、阶段进度与卡片状态。
 * 组件只负责渲染这些结果，避免把判定散落在模板里。
 */
import { describe, it, expect } from 'vitest'
import type { FactoryTask } from '@/shared/factory'
import {
  FACTORY_LANES,
  FACTORY_SEGMENTS,
  FACTORY_STEPS,
  findTask,
  formatClock,
  formatTimestamp,
  laneCounts,
  taskElapsedMs,
  taskStagePercent,
  taskStatus,
  tasksByLane,
} from '../board'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '任务',
    goal: '',
    lane: 'queued',
    stageIdx: 0,
    branch: 'agent/task-bl-1',
    worktree: null,
    model: 'claude-sonnet-4-5',
    iteration: 0,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: {},
    ...overrides,
  }
}

describe('FACTORY_LANES', () => {
  it('keeps the prototype order and i18n keys', () => {
    expect(FACTORY_LANES.map((lane) => lane.key)).toEqual([
      'queued',
      'implementing',
      'reviewing',
      'mergeable',
      'blocked',
      'done',
    ])
    expect(FACTORY_LANES.map((lane) => lane.labelKey)).toEqual([
      'factory.lanes.queued',
      'factory.lanes.implementing',
      'factory.lanes.reviewing',
      'factory.lanes.mergeable',
      'factory.lanes.blocked',
      'factory.lanes.done',
    ])
    expect(FACTORY_SEGMENTS.map((segment) => segment.key)).toEqual(FACTORY_LANES.map((lane) => lane.key))
    expect(FACTORY_STEPS).toEqual(['claim', 'worktree', 'implement', 'verify', 'review', 'merge'])
  })
})

describe('grouping', () => {
  it('returns only the matching lane and never placeholder entries', () => {
    const tasks = [task({ id: 'a', lane: 'queued' }), task({ id: 'b', lane: 'blocked' })]
    expect(tasksByLane(tasks, 'queued').map((item) => item.id)).toEqual(['a'])
    expect(tasksByLane(tasks, 'implementing')).toEqual([])
  })

  it('counts every lane including empty ones', () => {
    expect(laneCounts([])).toEqual({
      queued: 0,
      implementing: 0,
      reviewing: 0,
      mergeable: 0,
      blocked: 0,
      done: 0,
    })
    expect(
      laneCounts([task({ lane: 'queued' }), task({ id: 'b', lane: 'done' }), task({ id: 'c', lane: 'done' })]),
    ).toMatchObject({ queued: 1, done: 2 })
  })

  it('finds the selected task and tolerates a stale id', () => {
    const tasks = [task({ id: 'a' })]
    expect(findTask(tasks, 'a')?.id).toBe('a')
    expect(findTask(tasks, 'gone')).toBeNull()
    expect(findTask(tasks, null)).toBeNull()
  })
})

describe('stage rail', () => {
  it('marks the claim stage active for a queued task', () => {
    expect(taskStagePercent(task())).toBe(17)
    expect(taskStatus(task())).toEqual({ key: 'factory.cardStatus.queued' })
  })

  it('reports iteration progress while implementing', () => {
    expect(taskStatus(task({ lane: 'implementing', stageIdx: 2, iteration: 2, maxIterations: 5 }))).toEqual({
      key: 'factory.cardStatus.implementing',
      params: { iteration: 2, max: 5 },
    })
    expect(taskStagePercent(task({ lane: 'implementing', stageIdx: 2 }))).toBe(50)
  })

  it('highlights blocked tasks at the stuck stage', () => {
    expect(taskStatus(task({ lane: 'blocked', stageIdx: 5 }))).toEqual({ key: 'factory.cardStatus.blocked' })
    expect(taskStagePercent(task({ lane: 'blocked', stageIdx: 5 }))).toBe(100)
  })

  it('shows merged or cancelled for done tasks', () => {
    expect(taskStatus(task({ lane: 'done', stageIdx: 6 }))).toEqual({ key: 'factory.cardStatus.done' })
    expect(taskStatus(task({ lane: 'done', stageIdx: 6, cancelled: true }))).toEqual({
      key: 'factory.cardStatus.cancelled',
    })
  })
})

describe('elapsed time', () => {
  it('is zero before the task starts', () => {
    expect(taskElapsedMs(task(), Date.parse('2026-10-28T10:00:00Z'))).toBe(0)
  })

  it('measures from startedAt and stops at endedAt', () => {
    const started = '2026-10-28T10:00:00.000Z'
    const ended = '2026-10-28T10:01:30.000Z'
    expect(taskElapsedMs(task({ timestamps: { startedAt: started } }), Date.parse(ended))).toBe(90_000)
    expect(
      taskElapsedMs(task({ timestamps: { startedAt: started, endedAt: ended } }), Date.parse('2026-10-28T11:00:00Z')),
    ).toBe(90_000)
  })

  it('formats durations as mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(372_000)).toBe('06:12')
    expect(formatClock(3_723_000)).toBe('62:03')
  })

  it('formats timestamps as MM-DD HH:MM and tolerates missing values', () => {
    expect(formatTimestamp(undefined)).toBe('')
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp('not-a-date')).toBe('')
    expect(formatTimestamp('2026-10-28T10:05:00')).toBe('10-28 10:05')
  })
})
