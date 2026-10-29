/**
 * 多运行页签：运行列表 → 每个页签各自的快照、选中项与事件缓存。
 * IPC 全部 mock；store 只做投影，关闭页签不触碰磁盘。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  FactoryEvent,
  FactoryRun,
  FactoryRunSnapshot,
  FactoryRunStatus,
  FactoryTask,
} from '@/shared/factory'
import { FACTORY_RUN_TAB_LIMIT } from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    runList: vi.fn(),
    runGet: vi.fn(),
    runCreate: vi.fn(),
    runResume: vi.fn(),
    runPause: vi.fn(),
    taskEvents: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))

import { useFactoryStore } from '../index'

function task(runId: string, id: string, title = id): FactoryTask {
  return {
    id,
    runId,
    source: 'local',
    title,
    goal: '',
    lane: 'queued',
    stageIdx: 0,
    branch: `agent/task-${id}`,
    worktree: null,
    model: 'claude-sonnet-4-5',
    iteration: 0,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: { claimedAt: '2026-10-28T10:00:00Z' },
  }
}

function summary(id: string, createdAt: string, status: FactoryRunStatus = 'running'): FactoryRun {
  return {
    id,
    status,
    paused: false,
    createdAt,
    maxConcurrency: 4,
    spendUsd: 0,
    elapsedMs: 0,
  }
}

function snapshot(
  run: FactoryRun,
  taskIds: string[],
  overrides: Partial<FactoryRun> = {},
): FactoryRunSnapshot {
  return { run: { ...run, ...overrides }, tasks: taskIds.map((id) => task(run.id, id)) }
}

function event(runId: string, taskId: string | null, seq: number): FactoryEvent {
  return {
    seq,
    at: '2026-10-28T10:05:00Z',
    runId,
    taskId,
    stage: 'implement',
    code: 'agent.turn',
    level: 'info',
  }
}

const run2 = summary('run-2', '2026-10-28T11:00:00Z')
const run1 = summary('run-1', '2026-10-28T10:00:00Z', 'stopped')

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  factoryApi.taskEvents.mockResolvedValue([])
  factoryApi.runList.mockResolvedValue([run2, run1])
  factoryApi.runGet.mockImplementation((_root: string, runId: string) =>
    Promise.resolve(
      runId === 'run-2'
        ? snapshot(run2, ['t2-a', 't2-b'])
        : snapshot(run1, ['t1-a', 't1-b']),
    ),
  )
})

describe('run tabs', () => {
  it('opens the newest run and loads its events', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')

    expect(store.runTabs.map((run) => run.id)).toEqual(['run-2', 'run-1'])
    expect(store.run?.id).toBe('run-2')
    expect(store.tasks.map((item) => item.id)).toEqual(['t2-a', 't2-b'])
    expect(store.selectedId).toBe('t2-a')
    expect(factoryApi.runGet).toHaveBeenCalledWith('/repo', 'run-2')
    expect(factoryApi.taskEvents).toHaveBeenCalledWith('/repo', 'run-2', 't2-a')
  })

  it('switches snapshot, selection and events with the tab', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')
    store.applyPush({ event: event('run-2', 't2-a', 1), snapshot: snapshot(run2, ['t2-a', 't2-b']) })
    expect(store.selectedEvents).toHaveLength(1)

    await store.selectRun('/repo', 'run-1')

    expect(store.run?.id).toBe('run-1')
    expect(store.tasks.map((item) => item.id)).toEqual(['t1-a', 't1-b'])
    expect(store.selectedId).toBe('t1-a')
    expect(store.selectedEvents).toEqual([])

    store.applyPush({ event: event('run-2', 't2-a', 2), snapshot: snapshot(run2, ['t2-a', 't2-b']) })
    expect(store.selectedEvents).toEqual([])
  })

  it('resets the selection even when the task id exists in both runs', async () => {
    const store = useFactoryStore()
    factoryApi.runGet.mockImplementation((_root: string, runId: string) =>
      Promise.resolve(
        runId === 'run-2'
          ? snapshot(run2, ['shared', 'only-2'])
          : snapshot(run1, ['shared', 'only-1']),
      ),
    )
    await store.loadRun('/repo')
    store.selectTask('only-2')

    await store.selectRun('/repo', 'run-1')
    expect(store.selectedId).toBe('shared')
  })

  it('closes an inactive tab without reloading the board', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')
    const calls = factoryApi.runGet.mock.calls.length

    await store.closeRun('/repo', 'run-1')

    expect(store.runTabs.map((run) => run.id)).toEqual(['run-2'])
    expect(store.run?.id).toBe('run-2')
    expect(store.tasks.map((item) => item.id)).toEqual(['t2-a', 't2-b'])
    expect(factoryApi.runGet).toHaveBeenCalledTimes(calls)
  })

  it('selects the neighbor when the active tab closes', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')

    await store.closeRun('/repo', 'run-2')

    expect(store.runTabs.map((run) => run.id)).toEqual(['run-1'])
    expect(store.run?.id).toBe('run-1')
    expect(store.tasks.map((item) => item.id)).toEqual(['t1-a', 't1-b'])
    expect(store.selectedId).toBe('t1-a')
  })

  it('returns to the empty board after the last tab closes', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')

    await store.closeRun('/repo', 'run-2')
    await store.closeRun('/repo', 'run-1')

    expect(store.runTabs).toEqual([])
    expect(store.run).toBeNull()
    expect(store.tasks).toEqual([])
    expect(store.selectedId).toBeNull()
    expect(store.selectedEvents).toEqual([])
  })

  it('adds a freshly created run as a tab without reloading the list', async () => {
    const store = useFactoryStore()
    factoryApi.runList.mockResolvedValue([run1])
    factoryApi.runGet.mockResolvedValue(snapshot(run1, ['t1-a']))
    await store.loadRun('/repo')

    const created = snapshot(summary('run-3', '2026-10-28T12:00:00Z', 'pending'), ['t3-a'])
    factoryApi.runCreate.mockResolvedValue({ ok: true, snapshot: created })
    factoryApi.runResume.mockResolvedValue({
      ok: true,
      snapshot: snapshot({ ...created.run, status: 'running' }, ['t3-a']),
    })

    expect(await store.createRun('/repo', ['t3-a'])).toBe(true)
    expect(store.runTabs.map((run) => run.id)).toEqual(['run-3', 'run-1'])
    expect(store.run?.id).toBe('run-3')
    expect(store.runTabs[0].status).toBe('running')
    expect(factoryApi.runList).toHaveBeenCalledTimes(1)
  })

  it('never adds a tab for pushes from runs outside the strip', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')

    const other = summary('run-9', '2026-10-28T12:00:00Z')
    store.applyPush({ event: event('run-9', 't9-a', 1), snapshot: snapshot(other, ['t9-a']) })

    expect(store.runTabs.map((run) => run.id)).toEqual(['run-2', 'run-1'])
    expect(store.run?.id).toBe('run-2')
  })

  it('resets task-keyed action flags when the tab changes', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')
    store.startingId = 't2-a'

    await store.selectRun('/repo', 'run-1')

    expect(store.startingId).toBeNull()
  })

  it('keeps the tab strip within the recent-run limit', async () => {
    const store = useFactoryStore()
    factoryApi.runList.mockResolvedValue([])
    await store.loadRun('/repo')
    factoryApi.runResume.mockResolvedValue({ ok: false, error: 'run-stopped' })

    for (let index = 0; index <= FACTORY_RUN_TAB_LIMIT; index += 1) {
      const id = `run-cap-${index}`
      factoryApi.runCreate.mockResolvedValue({
        ok: true,
        snapshot: snapshot(
          summary(id, `2026-10-28T12:${String(index).padStart(2, '0')}:00Z`, 'pending'),
          [`t-${index}`],
        ),
      })
      await store.createRun('/repo', [`t-${index}`])
    }

    expect(store.runTabs).toHaveLength(FACTORY_RUN_TAB_LIMIT)
    expect(store.runTabs[0].id).toBe(`run-cap-${FACTORY_RUN_TAB_LIMIT}`)
  })

  it('does not let a late action response switch the board back', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')

    let resolvePause: (value: unknown) => void = () => {}
    factoryApi.runPause.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePause = resolve
        }),
    )
    const pending = store.pauseRun('/repo', 'run-2')
    await store.selectRun('/repo', 'run-1')

    resolvePause({
      ok: true,
      snapshot: snapshot({ ...run2, status: 'paused' }, ['t2-a', 't2-b']),
    })
    await pending

    expect(store.run?.id).toBe('run-1')
    expect(store.runTabs.find((run) => run.id === 'run-2')?.status).toBe('paused')
  })

  it('keeps the active tab across a list refresh and syncs its status', async () => {
    const store = useFactoryStore()
    await store.loadRun('/repo')
    await store.selectRun('/repo', 'run-1')

    factoryApi.runList.mockResolvedValue([
      summary('run-3', '2026-10-28T12:00:00Z'),
      run2,
      { ...run1, status: 'stopped' },
    ])
    await store.loadRun('/repo')

    expect(store.runTabs.map((run) => run.id)).toEqual(['run-3', 'run-2', 'run-1'])
    expect(store.run?.id).toBe('run-1')
  })

  it('ignores a stale snapshot that resolves after a newer tab switch', async () => {
    const store = useFactoryStore()
    factoryApi.runList.mockResolvedValue([
      summary('run-3', '2026-10-28T12:00:00Z'),
      run2,
      run1,
    ])
    factoryApi.runGet.mockResolvedValue(
      snapshot(summary('run-3', '2026-10-28T12:00:00Z'), ['t3-a']),
    )
    await store.loadRun('/repo')

    let resolveSlow: (value: FactoryRunSnapshot) => void = () => {}
    const slow = new Promise<FactoryRunSnapshot>((resolve) => {
      resolveSlow = resolve
    })
    factoryApi.runGet.mockImplementationOnce(() => slow)
    factoryApi.runGet.mockImplementationOnce(() => Promise.resolve(snapshot(run2, ['t2-a'])))

    const pending = store.selectRun('/repo', 'run-1')
    await store.selectRun('/repo', 'run-2')
    resolveSlow(snapshot(run1, ['t1-a']))
    await pending

    expect(store.run?.id).toBe('run-2')
    expect(store.tasks.map((item) => item.id)).toEqual(['t2-a'])
  })
})
