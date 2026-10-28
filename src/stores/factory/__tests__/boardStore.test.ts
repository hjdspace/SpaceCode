/**
 * Factory store 的看板部分：加载待办与运行、创建运行、选中与页签。
 * IPC 全部 mock；store 只做投影与错误码保存。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FactoryBacklogItem, FactoryRunSnapshot } from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    backlogList: vi.fn(),
    backlogCreate: vi.fn(),
    backlogUpdate: vi.fn(),
    backlogDelete: vi.fn(),
    backlogMove: vi.fn(),
    runLatest: vi.fn(),
    runCreate: vi.fn(),
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
