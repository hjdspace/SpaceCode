/**
 * 看板纯逻辑：六泳道顺序、分组计数、阶段进度与卡片状态。
 * 组件只负责渲染这些结果，避免把判定散落在模板里。
 */
import { describe, it, expect } from 'vitest'
import type { FactoryReviewCommentStatus, FactoryRun, FactoryTask } from '@/shared/factory'
import {
  FACTORY_LANES,
  FACTORY_SEGMENTS,
  FACTORY_STEPS,
  attentionStatus,
  attentionTasks,
  canRetryTask,
  canReturnTask,
  canTakeOver,
  cardDiffstat,
  doneTaskMeta,
  findTask,
  formatClock,
  formatTimeOfDay,
  formatTimestamp,
  isAttentionTask,
  isCardPulsing,
  isTakenOver,
  laneCounts,
  openReviewComments,
  runUsage,
  showsTaskProgress,
  taskElapsedMs,
  taskProgressPercent,
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

describe('attention projection', () => {
  const review = (verdict: 'approved' | 'needs_changes') => ({
    verdict,
    summary: '',
    comments: [],
    at: '2026-10-29T10:00:00Z',
  })

  it('covers blocked tasks and reviews that need changes', () => {
    const blocked = task({ id: 'blocked', lane: 'blocked', stageIdx: 5 })
    const needsChanges = task({ id: 'review', lane: 'reviewing', review: review('needs_changes') })
    const approved = task({ id: 'approved', lane: 'reviewing', review: review('approved') })
    const implementing = task({ id: 'impl', lane: 'implementing' })

    expect(isAttentionTask(blocked)).toBe(true)
    expect(isAttentionTask(needsChanges)).toBe(true)
    expect(isAttentionTask(approved)).toBe(false)
    expect(isAttentionTask(implementing)).toBe(false)
    expect(attentionTasks([blocked, needsChanges, approved, implementing]).map((item) => item.id)).toEqual([
      'blocked',
      'review',
    ])
  })

  it('labels blocked tasks as merge/conflict and needs-changes reviews as review', () => {
    expect(attentionStatus(task({ lane: 'blocked' }))).toEqual({
      kind: 'merge',
      labelKey: 'factory.run.attentionMerge',
    })
    expect(attentionStatus(task({ lane: 'reviewing', review: review('needs_changes') }))).toEqual({
      kind: 'review',
      labelKey: 'factory.run.attentionReview',
    })
  })
})

describe('stage rail', () => {
  it('marks the claim stage active for a queued task', () => {
    expect(taskStatus(task())).toEqual({ key: 'factory.cardStatus.queued' })
  })

  it('reports iteration progress while implementing', () => {
    expect(taskStatus(task({ lane: 'implementing', stageIdx: 2, iteration: 2, maxIterations: 5 }))).toEqual({
      key: 'factory.cardStatus.implementing',
      params: { iteration: 2, max: 5 },
    })
  })

  it('highlights blocked tasks at the stuck stage', () => {
    expect(taskStatus(task({ lane: 'blocked', stageIdx: 5 }))).toEqual({ key: 'factory.cardStatus.blocked' })
  })

  it('shows merged or cancelled for done tasks', () => {
    expect(taskStatus(task({ lane: 'done', stageIdx: 6 }))).toEqual({ key: 'factory.cardStatus.done' })
    expect(taskStatus(task({ lane: 'done', stageIdx: 6, cancelled: true }))).toEqual({
      key: 'factory.cardStatus.cancelled',
    })
  })
})

describe('card progress', () => {
  it('only draws the bar while implementing or reviewing', () => {
    expect(showsTaskProgress(task({ lane: 'queued' }))).toBe(false)
    expect(showsTaskProgress(task({ lane: 'implementing' }))).toBe(true)
    expect(showsTaskProgress(task({ lane: 'reviewing' }))).toBe(true)
    expect(showsTaskProgress(task({ lane: 'mergeable' }))).toBe(false)
    expect(showsTaskProgress(task({ lane: 'blocked' }))).toBe(false)
    expect(showsTaskProgress(task({ lane: 'done' }))).toBe(false)
  })

  it('drops the bar once the task is cancelled', () => {
    expect(showsTaskProgress(task({ lane: 'implementing', cancelled: true }))).toBe(false)
    expect(showsTaskProgress(task({ lane: 'reviewing', cancelled: true }))).toBe(false)
  })

  it('walks by iteration while implementing and reads full once in review', () => {
    expect(taskProgressPercent(task({ lane: 'implementing', iteration: 0, maxIterations: 5 }))).toBe(0)
    expect(taskProgressPercent(task({ lane: 'implementing', iteration: 2, maxIterations: 5 }))).toBe(40)
    expect(taskProgressPercent(task({ lane: 'implementing', iteration: 6, maxIterations: 5 }))).toBe(100)
    expect(taskProgressPercent(task({ lane: 'reviewing' }))).toBe(100)
  })

  it('tolerates a snapshot without an iteration limit', () => {
    expect(taskProgressPercent(task({ lane: 'implementing', maxIterations: 0 }))).toBe(0)
  })
})

describe('review comments', () => {
  const review = (statuses: FactoryReviewCommentStatus[]) => ({
    verdict: 'needs_changes' as const,
    summary: '',
    comments: statuses.map((status, index) => ({
      id: `c-${index}`,
      body: '意见',
      severity: 'blocker' as const,
      status,
    })),
    at: '2026-10-29T10:00:00Z',
  })

  it('counts only the comments still waiting for a decision', () => {
    expect(openReviewComments(task({ lane: 'reviewing', review: review(['open', 'open', 'accepted', 'ignored', 'resolved']) }))).toBe(2)
    expect(openReviewComments(task())).toBe(0)
  })

  it('puts the pending count on the reviewing chip', () => {
    expect(taskStatus(task({ lane: 'reviewing', review: review(['open', 'accepted']) }))).toEqual({
      key: 'factory.cardStatus.reviewingComments',
      params: { count: 1 },
    })
  })

  it('keeps a plain reviewing text while nothing is pending', () => {
    // 结论已落地但一条未决意见都没有时，不能写成「0 条意见」。
    expect(taskStatus(task({ lane: 'reviewing' }))).toEqual({ key: 'factory.cardStatus.reviewing' })
    expect(taskStatus(task({ lane: 'reviewing', review: review([]) }))).toEqual({
      key: 'factory.cardStatus.reviewing',
    })
  })
})

describe('card pulse', () => {
  function run(overrides: Partial<FactoryRun> = {}): FactoryRun {
    return {
      id: 'run-1',
      status: 'running',
      paused: false,
      createdAt: '2026-10-29T10:00:00Z',
      maxConcurrency: 4,
      spendUsd: 0,
      elapsedMs: 0,
      ...overrides,
    }
  }

  it('pulses only an implementing task in a run that is still advancing', () => {
    expect(isCardPulsing(task({ lane: 'implementing' }), run())).toBe(true)
    expect(isCardPulsing(task({ lane: 'queued' }), run())).toBe(false)
    expect(isCardPulsing(task({ lane: 'reviewing' }), run())).toBe(false)
    expect(isCardPulsing(task({ lane: 'done' }), run())).toBe(false)
  })

  it('stops as soon as the run is paused, pending, stopped or missing', () => {
    const item = task({ lane: 'implementing' })
    expect(isCardPulsing(item, run({ paused: true }))).toBe(false)
    expect(isCardPulsing(item, run({ status: 'paused' }))).toBe(false)
    expect(isCardPulsing(item, run({ status: 'pending' }))).toBe(false)
    expect(isCardPulsing(item, run({ status: 'stopped' }))).toBe(false)
    expect(isCardPulsing(item, null)).toBe(false)
  })

  it('stops on an implementing task the background no longer drives', () => {
    expect(isCardPulsing(task({ lane: 'implementing', cancelled: true }), run())).toBe(false)
    expect(
      isCardPulsing(
        task({
          lane: 'implementing',
          worktree: '.spacecode/worktrees/bl-1',
          takeover: { at: '2026-10-29T10:00:00Z', sessionId: 'sess-1' },
        }),
        run(),
      ),
    ).toBe(false)
  })
})

describe('card diffstat', () => {
  it('reports the change counts once anything moved', () => {
    expect(cardDiffstat(task({ diff: { additions: 86, deletions: 12 } }))).toEqual({ additions: 86, deletions: 12 })
    expect(cardDiffstat(task({ diff: { additions: 0, deletions: 3 } }))).toEqual({ additions: 0, deletions: 3 })
  })

  it('returns null for a task without changes', () => {
    expect(cardDiffstat(task())).toBeNull()
  })
})

describe('merged card meta', () => {
  it('reads merge time and the commits carried into the target branch', () => {
    expect(
      doneTaskMeta(task({ lane: 'done', stageIdx: 6, mergedCommits: 3, timestamps: { mergedAt: '2026-10-29T03:58:00' } })),
    ).toEqual({ key: 'factory.cardMeta.merged', params: { time: '03:58', commits: 3 } })
  })

  it('counts the task commits when the merge did not record a number', () => {
    const meta = doneTaskMeta(
      task({
        lane: 'done',
        mergedCommits: undefined,
        commits: [{ sha: 'a3f91c2', message: 'fix: 恢复顺序' }],
        timestamps: { mergedAt: '2026-10-29T03:58:00' },
      }),
    )
    expect(meta?.params).toMatchObject({ commits: 1 })
  })

  it('keeps the commit count without a time for runs saved before mergedAt existed', () => {
    expect(doneTaskMeta(task({ lane: 'done', mergedCommits: 2 }))).toEqual({
      key: 'factory.cardMeta.finished',
      params: { commits: 2 },
    })
  })

  it('never claims a merge for a cancelled or still-running task', () => {
    expect(doneTaskMeta(task({ lane: 'done', cancelled: true, mergedCommits: 3 }))).toBeNull()
    expect(doneTaskMeta(task({ lane: 'mergeable', mergedCommits: 3 }))).toBeNull()
  })
})

describe('takeover projection', () => {
  const takeover = { at: '2026-10-29T10:00:00Z', sessionId: 'fac-run-1-bl-1-takeover' }

  it('marks a taken-over task and reports the takeover status', () => {
    const taken = task({ lane: 'implementing', worktree: '.spacecode/worktrees/bl-1', takeover })
    expect(isTakenOver(taken)).toBe(true)
    expect(taskStatus(taken)).toEqual({ key: 'factory.cardStatus.takeover' })
    expect(canReturnTask(taken)).toBe(true)
    expect(canTakeOver(taken)).toBe(false)
  })

  it('only offers takeover for running tasks with a worktree', () => {
    expect(canTakeOver(task({ lane: 'implementing', worktree: '.spacecode/worktrees/bl-1' }))).toBe(true)
    expect(canTakeOver(task({ lane: 'reviewing', worktree: '.spacecode/worktrees/bl-1' }))).toBe(true)
    expect(canTakeOver(task({ lane: 'implementing' }))).toBe(false)
    expect(canTakeOver(task({ lane: 'queued', worktree: '.spacecode/worktrees/bl-1' }))).toBe(false)
    expect(canTakeOver(task({ lane: 'mergeable', worktree: '.spacecode/worktrees/bl-1' }))).toBe(false)
    expect(isTakenOver(task({ lane: 'blocked', takeover }))).toBe(false)
  })

  it('offers retry only for blocked tasks that still have a worktree', () => {
    expect(canRetryTask(task({ lane: 'blocked', worktree: '.spacecode/worktrees/bl-1' }))).toBe(true)
    expect(canRetryTask(task({ lane: 'blocked' }))).toBe(false)
    expect(canRetryTask(task({ lane: 'implementing', worktree: '.spacecode/worktrees/bl-1' }))).toBe(false)
  })
})

describe('run usage', () => {
  it('sums tokens across tasks and reports no cost without a price', () => {
    const usage = runUsage([
      task({ usage: { inputTokens: 10, outputTokens: 5 } }),
      task({ id: 'b', usage: { inputTokens: 30, outputTokens: 15 } }),
      task({ id: 'c' }),
    ])
    expect(usage).toEqual({
      inputTokens: 40,
      outputTokens: 20,
      totalTokens: 60,
      costUsd: 0,
      hasCost: false,
    })
  })

  it('sums cost when any task carries a price', () => {
    const usage = runUsage([
      task({ usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.12 } }),
      task({ id: 'b', usage: { inputTokens: 30, outputTokens: 15 } }),
    ])
    expect(usage.hasCost).toBe(true)
    expect(usage.costUsd).toBeCloseTo(0.12)
    expect(usage.totalTokens).toBe(60)
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

  it('formats only the time of day for the card foot', () => {
    expect(formatTimeOfDay('2026-10-28T10:05:00')).toBe('10:05')
    expect(formatTimeOfDay(undefined)).toBe('')
    expect(formatTimeOfDay(null)).toBe('')
    expect(formatTimeOfDay('not-a-date')).toBe('')
  })
})
