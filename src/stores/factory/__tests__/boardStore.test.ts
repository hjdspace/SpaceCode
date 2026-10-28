/**
 * Factory store 的看板部分：加载待办与运行、创建运行、选中与页签。
 * IPC 全部 mock；store 只做投影与错误码保存。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FactoryBacklogItem, FactoryEvent, FactoryRunSnapshot } from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    backlogList: vi.fn(),
    backlogCreate: vi.fn(),
    backlogUpdate: vi.fn(),
    backlogDelete: vi.fn(),
    backlogMove: vi.fn(),
    runLatest: vi.fn(),
    runCreate: vi.fn(),
    taskStart: vi.fn(),
    taskStop: vi.fn(),
    runStop: vi.fn(),
    taskEvents: vi.fn(),
    worktreeReveal: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))

import { useFactoryStore } from '../index'

const backlog: FactoryBacklogItem[] = [
  { id: 'bl-1', title: '第一件事', goal: '目标一', createdAt: '2026-10-28T10:00:00Z', order: 0 },
  { id: 'bl-2', title: '第二件事', goal: '', createdAt: '2026-10-28T10:01:00Z', order: 1 },
]

function snapshot(): FactoryRunSnapshot {
  return {
    run: {
      id: 'run-1',
      status: 'pending',
      paused: false,
      createdAt: '2026-10-28T10:02:00Z',
      maxConcurrency: 4,
      spendUsd: 0,
      elapsedMs: 0,
    },
    tasks: backlog.map((item) => ({
      id: item.id,
      runId: 'run-1',
      source: 'local' as const,
      title: item.title,
      goal: item.goal,
      lane: 'queued' as const,
      stageIdx: 0,
      branch: `agent/task-${item.id}`,
      worktree: null,
      model: 'claude-sonnet-4-5',
      iteration: 0,
      maxIterations: 5,
      diff: { additions: 0, deletions: 0 },
      timestamps: { claimedAt: '2026-10-28T10:02:00Z' },
    })),
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('backlog', () => {
  it('loads the list and keeps error codes on failure', async () => {
    factoryApi.backlogList.mockResolvedValue(backlog)
    const store = useFactoryStore()
    await store.loadBacklog('/repo')
    expect(store.backlog).toEqual(backlog)
    expect(store.backlogError).toBeNull()

    factoryApi.backlogCreate.mockResolvedValue({ ok: false, error: 'title-required', items: backlog })
    const ok = await store.createBacklogTask('/repo', { title: ' ' })
    expect(ok).toBe(false)
    expect(store.backlogError).toBe('title-required')
    expect(store.backlog).toEqual(backlog)
  })

  it('replaces the list after a successful mutation', async () => {
    const updated = [...backlog, { id: 'bl-3', title: '新任务', goal: '', createdAt: '2026-10-28T10:03:00Z', order: 2 }]
    factoryApi.backlogCreate.mockResolvedValue({ ok: true, items: updated })
    const store = useFactoryStore()
    const ok = await store.createBacklogTask('/repo', { title: '新任务' })
    expect(ok).toBe(true)
    expect(store.backlog.map((item) => item.id)).toEqual(['bl-1', 'bl-2', 'bl-3'])
  })
})

describe('run and selection', () => {
  it('loads the latest run and selects the first task', async () => {
    factoryApi.runLatest.mockResolvedValue(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')
    expect(store.run?.id).toBe('run-1')
    expect(store.tasks).toHaveLength(2)
    expect(store.selectedId).toBe('bl-1')
    expect(store.selectedTask?.title).toBe('第一件事')
    expect(store.laneCounts.queued).toBe(2)
  })

  it('keeps the selection when switching inspector tabs', async () => {
    factoryApi.runLatest.mockResolvedValue(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.selectTask('bl-2')
    store.setInspectorTab('events')
    expect(store.selectedId).toBe('bl-2')
    expect(store.selectedTask?.id).toBe('bl-2')
    store.setInspectorTab('diff')
    expect(store.selectedId).toBe('bl-2')
  })

  it('creates a run from selected backlog tasks', async () => {
    factoryApi.runCreate.mockResolvedValue({ ok: true, snapshot: snapshot() })
    const store = useFactoryStore()
    const result = await store.createRun('/repo', ['bl-1', 'bl-2'])
    expect(result).toBe(true)
    expect(store.run?.id).toBe('run-1')
    expect(store.selectedId).toBe('bl-1')
    expect(store.createRunError).toBeNull()
    expect(store.creatingRun).toBe(false)
  })

  it('surfaces duplicate claims without clobbering the current board', async () => {
    factoryApi.runLatest.mockResolvedValue(snapshot())
    factoryApi.runCreate.mockResolvedValue({ ok: false, error: 'duplicate-tasks', duplicates: ['bl-1'] })
    const store = useFactoryStore()
    await store.loadRun('/repo')

    const ok = await store.createRun('/repo', ['bl-1'])
    expect(ok).toBe(false)
    expect(store.run?.id).toBe('run-1')
    expect(store.createRunError).toEqual({ code: 'duplicate-tasks', params: { ids: 'bl-1' } })
  })

  it('reports empty/missing selections as error codes', async () => {
    factoryApi.runCreate.mockResolvedValue({ ok: false, error: 'missing-tasks', missing: ['bl-9'] })
    const store = useFactoryStore()
    expect(await store.createRun('/repo', ['bl-9'])).toBe(false)
    expect(store.createRunError).toEqual({ code: 'missing-tasks', params: { ids: 'bl-9' } })
  })
})

function event(seq: number, overrides: Partial<FactoryEvent> = {}): FactoryEvent {
  return {
    seq,
    at: '2026-10-28T10:05:00Z',
    runId: 'run-1',
    taskId: 'bl-1',
    stage: 'implement',
    code: 'agent.turn',
    level: 'info',
    ...overrides,
  }
}

describe('implementation events', () => {
  it('appends pushed events by seq and drops duplicates', async () => {
    factoryApi.runLatest.mockResolvedValue(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.applyPush({ event: event(1), snapshot: snapshot() })
    store.applyPush({ event: event(1), snapshot: snapshot() })
    store.applyPush({ event: event(2, { code: 'task.started', level: 'ok' }), snapshot: snapshot() })

    expect(store.selectedEvents.map((item) => item.seq)).toEqual([1, 2])
    expect(store.selectedEvents[1].code).toBe('task.started')
  })

  it('ignores pushes from another run and keeps run-level events', async () => {
    factoryApi.runLatest.mockResolvedValue(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.applyPush({ event: event(9, { runId: 'run-9' }), snapshot: { ...snapshot(), run: { ...snapshot().run, id: 'run-9' } } })
    store.applyPush({ event: event(3, { taskId: null, code: 'run.stopped' }), snapshot: snapshot() })

    expect(store.selectedEvents).toHaveLength(0)
    expect(store.runEvents.map((item) => item.code)).toEqual(['run.stopped'])
    expect(store.run?.id).toBe('run-1')
  })

  it('loads persisted events into the selected task', async () => {
    factoryApi.taskEvents.mockResolvedValue([event(1), event(2)])
    const store = useFactoryStore()
    await store.loadRun('/repo')
    await store.loadEvents('/repo', 'run-1', 'bl-1')
    expect(store.selectedEvents).toHaveLength(2)
    expect(store.eventsLoading).toBe(false)
  })

  it('keeps dirty-worktree as a confirmable action error', async () => {
    factoryApi.runLatest.mockResolvedValue(snapshot())
    factoryApi.taskStart.mockResolvedValue({ ok: false, error: 'dirty-worktree', detail: '2' })
    const store = useFactoryStore()
    await store.loadRun('/repo')

    const result = await store.startTask('/repo', 'run-1', 'bl-1')
    expect(result).toMatchObject({ ok: false, error: 'dirty-worktree' })
    expect(store.actionError).toEqual({ code: 'dirty-worktree', detail: '2' })
    expect(store.pendingDirtyId).toBe('bl-1')
    expect(store.startingId).toBeNull()

    factoryApi.taskStart.mockResolvedValue({ ok: true, snapshot: snapshot() })
    await store.confirmDirtyStart('/repo', 'run-1', 'bl-1')
    expect(factoryApi.taskStart).toHaveBeenLastCalledWith('/repo', 'run-1', 'bl-1', { confirmDirty: true })
    expect(store.pendingDirtyId).toBeNull()
  })
})
