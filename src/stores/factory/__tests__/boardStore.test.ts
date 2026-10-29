/**
 * Factory store 的看板部分：加载待办与运行、创建运行、选中与页签。
 * IPC 全部 mock；store 只做投影与错误码保存。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  FACTORY_BACKLOG_PATH,
  FACTORY_SANDBOX_WORKTREE_ROOT,
  type FactoryBacklogItem,
  type FactoryConfig,
  type FactoryEvent,
  type FactoryRunSnapshot,
} from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    backlogList: vi.fn(),
    backlogCreate: vi.fn(),
    backlogUpdate: vi.fn(),
    backlogDelete: vi.fn(),
    backlogMove: vi.fn(),
    runList: vi.fn(),
    runGet: vi.fn(),
    runCreate: vi.fn(),
    runResume: vi.fn(),
    runPause: vi.fn(),
    runStop: vi.fn(),
    configSave: vi.fn(),
    taskStart: vi.fn(),
    taskStop: vi.fn(),
    taskCancel: vi.fn(),
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

/** 页签条只有一个运行：runList 给出摘要，runGet 返回快照。 */
function mockRun(snap: FactoryRunSnapshot | null): void {
  factoryApi.runList.mockResolvedValue(snap ? [snap.run] : [])
  factoryApi.runGet.mockResolvedValue(snap)
  factoryApi.taskEvents.mockResolvedValue([])
}

function configFixture(): FactoryConfig {
  return {
    version: 1,
    revision: 1,
    repo: { root: '.', baseBranch: 'main' },
    template: 'parallel-planner-with-review',
    agent: { engineType: 'claude-code', model: 'sonnet', maxIterations: 5, maxConcurrency: 4 },
    sandbox: { type: 'worktree', root: FACTORY_SANDBOX_WORKTREE_ROOT },
    tracker: { type: 'local', backlogPath: FACTORY_BACKLOG_PATH, mergeMode: 'local' },
    stages: {
      plan: { enabled: true, permissionMode: 'plan', humanGate: false },
      implement: { enabled: true, permissionMode: 'acceptEdits', humanGate: false },
      verify: { enabled: true, permissionMode: 'default', humanGate: false },
      review: { enabled: true, permissionMode: 'acceptEdits', humanGate: true },
      merge: { enabled: true, permissionMode: 'default', humanGate: true },
    },
    commands: { verify: 'npm run test' },
    prompts: {
      plan: '.spacecode/factory/prompts/plan.md',
      implement: '.spacecode/factory/prompts/implement.md',
      review: '.spacecode/factory/prompts/review.md',
      fix: '.spacecode/factory/prompts/fix.md',
      'merge-conflict': '.spacecode/factory/prompts/merge-conflict.md',
    },
    limits: { taskTimeoutSec: 3600, idleTimeoutSec: 600, keepDoneRuns: 20 },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
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
  it('loads the open run and selects the first task', async () => {
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')
    expect(store.run?.id).toBe('run-1')
    expect(store.tasks).toHaveLength(2)
    expect(store.selectedId).toBe('bl-1')
    expect(store.selectedTask?.title).toBe('第一件事')
    expect(store.laneCounts.queued).toBe(2)
  })

  it('keeps the selection when switching inspector tabs', async () => {
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.selectTask('bl-2')
    store.setInspectorTab('events')
    expect(store.selectedId).toBe('bl-2')
    expect(store.selectedTask?.id).toBe('bl-2')
    store.setInspectorTab('diff')
    expect(store.selectedId).toBe('bl-2')
  })

  it('restores the persisted selection and ignores a stale id', async () => {
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.selectTask('bl-2')
    await store.loadRun('/repo')
    expect(store.selectedId).toBe('bl-2')

    localStorage.setItem('factory:selected:/repo', 'gone')
    store.reset()
    await store.loadRun('/repo')
    expect(store.selectedId).toBe('bl-1')
  })

  it('collapses the inspector and expands it again on the next pick', async () => {
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')
    expect(store.inspectorOpen).toBe(true)

    store.closeInspector()
    expect(store.inspectorOpen).toBe(false)
    // 收起只是不显示检查器，选中项仍在：看板要占满宽度，但重新点开就回到同一个任务。
    expect(store.selectedId).toBe('bl-1')

    // 迟到的快照不能替用户把检查器重新打开。
    await store.loadRun('/repo')
    expect(store.inspectorOpen).toBe(false)

    store.selectTask('bl-2')
    expect(store.inspectorOpen).toBe(true)
  })

  it('reopens the inspector for a different run', async () => {
    mockRun(snapshot())
    factoryApi.runGet.mockImplementation((_root: string, id: string) =>
      Promise.resolve(id === 'run-1' ? snapshot() : { ...snapshot(), run: { ...snapshot().run, id } }),
    )
    const store = useFactoryStore()
    await store.loadRun('/repo')
    store.closeInspector()

    await store.selectRun('/repo', 'run-2')
    expect(store.run?.id).toBe('run-2')
    expect(store.inspectorOpen).toBe(true)
  })

  it('creates a run and immediately hands it to the scheduler', async () => {
    factoryApi.runCreate.mockResolvedValue({ ok: true, snapshot: snapshot() })
    factoryApi.runResume.mockResolvedValue({
      ok: true,
      snapshot: { ...snapshot(), run: { ...snapshot().run, status: 'running' } },
    })
    const store = useFactoryStore()
    const result = await store.createRun('/repo', ['bl-1', 'bl-2'])
    expect(result).toBe(true)
    expect(factoryApi.runResume).toHaveBeenCalledWith('/repo', 'run-1')
    expect(store.run?.status).toBe('running')
    expect(store.selectedId).toBe('bl-1')
    expect(store.createRunError).toBeNull()
    expect(store.creatingRun).toBe(false)
  })

  it('keeps the created run when the scheduler refuses to start', async () => {
    factoryApi.runCreate.mockResolvedValue({ ok: true, snapshot: snapshot() })
    factoryApi.runResume.mockResolvedValue({ ok: false, error: 'run-stopped' })
    const store = useFactoryStore()
    await store.createRun('/repo', ['bl-1'])
    expect(store.run?.id).toBe('run-1')
    expect(store.actionError).toEqual({ code: 'run-stopped' })
  })

  it('surfaces duplicate claims without clobbering the current board', async () => {
    mockRun(snapshot())
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
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.applyPush({ event: event(1), snapshot: snapshot() })
    store.applyPush({ event: event(1), snapshot: snapshot() })
    store.applyPush({ event: event(2, { code: 'task.started', level: 'ok' }), snapshot: snapshot() })

    expect(store.selectedEvents.map((item) => item.seq)).toEqual([1, 2])
    expect(store.selectedEvents[1].code).toBe('task.started')
  })

  it('ignores pushes from another run and keeps run-level events', async () => {
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    store.applyPush({ event: event(9, { runId: 'run-9' }), snapshot: { ...snapshot(), run: { ...snapshot().run, id: 'run-9' } } })
    store.applyPush({ event: event(3, { taskId: null, code: 'run.stopped' }), snapshot: snapshot() })

    expect(store.selectedEvents).toHaveLength(0)
    expect(store.runEvents.map((item) => item.code)).toEqual(['run.stopped'])
    expect(store.run?.id).toBe('run-1')
  })

  it('loads persisted events into the selected task', async () => {
    mockRun(snapshot())
    factoryApi.taskEvents.mockResolvedValue([event(1), event(2)])
    const store = useFactoryStore()
    await store.loadRun('/repo')
    await store.loadEvents('/repo', 'run-1', 'bl-1')
    expect(store.selectedEvents).toHaveLength(2)
    expect(store.eventsLoading).toBe(false)
  })

  it('keeps dirty-worktree as a confirmable action error', async () => {
    mockRun(snapshot())
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

/** 卡片与检查器共用同一条放弃动作：store 只保留一份结果与错误。 */
describe('abandon', () => {
  function cancelledSnapshot(): FactoryRunSnapshot {
    const base = snapshot()
    return {
      ...base,
      tasks: base.tasks.map((task) => ({
        ...task,
        lane: 'done' as const,
        stageIdx: 6,
        cancelled: true,
      })),
    }
  }

  it('applies the snapshot returned by the cancel action', async () => {
    mockRun(snapshot())
    factoryApi.taskCancel.mockResolvedValue({ ok: true, snapshot: cancelledSnapshot() })
    const store = useFactoryStore()
    await store.loadRun('/repo')

    const result = await store.cancelTask('/repo', 'run-1', 'bl-1')
    expect(factoryApi.taskCancel).toHaveBeenCalledWith('/repo', 'run-1', 'bl-1')
    expect(result.ok).toBe(true)
    expect(store.tasks[0]).toMatchObject({ lane: 'done', cancelled: true })
    expect(store.actionError).toBeNull()
    expect(store.cancelling).toBe(false)
  })

  it('keeps a refusal as an action error without touching the board', async () => {
    mockRun(snapshot())
    factoryApi.taskCancel.mockResolvedValue({ ok: false, error: 'not-cancellable' })
    const store = useFactoryStore()
    await store.loadRun('/repo')

    const result = await store.cancelTask('/repo', 'run-1', 'bl-1')
    expect(result).toEqual({ ok: false, error: 'not-cancellable' })
    expect(store.actionError).toEqual({ code: 'not-cancellable' })
    expect(store.tasks[0].lane).toBe('queued')
    expect(store.cancelling).toBe(false)
  })

  it('reports a write failure when the call itself throws', async () => {
    mockRun(snapshot())
    factoryApi.taskCancel.mockRejectedValue(new Error('ipc down'))
    const store = useFactoryStore()
    await store.loadRun('/repo')

    expect(await store.cancelTask('/repo', 'run-1', 'bl-1')).toEqual({ ok: false, error: 'write-failed' })
    expect(store.actionError).toEqual({ code: 'write-failed' })
    expect(store.cancelling).toBe(false)
  })
})

describe('run control', () => {
  it('pauses and resumes through IPC and applies the returned snapshot', async () => {
    mockRun(snapshot())
    const store = useFactoryStore()
    await store.loadRun('/repo')

    factoryApi.runPause.mockResolvedValue({
      ok: true,
      snapshot: { ...snapshot(), run: { ...snapshot().run, status: 'paused', paused: true } },
    })
    expect(await store.pauseRun('/repo', 'run-1')).toMatchObject({ ok: true })
    expect(store.run?.paused).toBe(true)
    expect(store.pausing).toBe(false)

    factoryApi.runResume.mockResolvedValue({
      ok: true,
      snapshot: { ...snapshot(), run: { ...snapshot().run, status: 'running', paused: false } },
    })
    expect(await store.resumeRun('/repo', 'run-1')).toMatchObject({ ok: true })
    expect(store.run?.status).toBe('running')
    expect(store.run?.paused).toBe(false)
  })

  it('keeps control failures as action error codes', async () => {
    factoryApi.runPause.mockResolvedValue({ ok: false, error: 'run-stopped' })
    const store = useFactoryStore()
    expect(await store.pauseRun('/repo', 'run-1')).toMatchObject({ ok: false, error: 'run-stopped' })
    expect(store.actionError).toEqual({ code: 'run-stopped' })
    expect(store.pausing).toBe(false)
  })
})

describe('config modal', () => {
  it('opens a deep-cloned draft so edits never touch the live config', () => {
    const store = useFactoryStore()
    store.config = configFixture()
    store.openConfig()

    expect(store.configOpen).toBe(true)
    store.updateStage('implement', { model: 'opus' })
    store.setConfigConcurrency(2)
    store.setConfigVerifyCommand('npm run build')

    expect(store.configDraft?.stages.implement.model).toBe('opus')
    expect(store.configDraft?.agent.maxConcurrency).toBe(2)
    expect(store.configDraft?.commands.verify).toBe('npm run build')
    expect(store.config?.stages.implement.model).toBeUndefined()
    expect(store.config?.agent.maxConcurrency).toBe(4)
  })

  it('saves with the current revision and closes on success', async () => {
    const store = useFactoryStore()
    store.config = configFixture()
    store.openConfig()
    store.setConfigConcurrency(2)
    store.setConfigVerifyCommand('npm run build')

    const saved = {
      ...configFixture(),
      revision: 2,
      agent: { ...configFixture().agent, maxConcurrency: 2 },
      commands: { verify: 'npm run build' },
    }
    factoryApi.configSave.mockResolvedValue({ ok: true, config: saved })

    expect(await store.saveConfig('/repo')).toBe(true)
    expect(factoryApi.configSave).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ expectedRevision: 1 }),
    )
    expect(store.config?.revision).toBe(2)
    expect(store.configOpen).toBe(false)
    expect(store.configSaving).toBe(false)
  })

  it('keeps the modal open and reports field errors for invalid config', async () => {
    const store = useFactoryStore()
    store.config = configFixture()
    store.openConfig()
    factoryApi.configSave.mockResolvedValue({
      ok: false,
      error: 'invalid-config',
      errors: ['stages.implement.permissionMode'],
    })

    expect(await store.saveConfig('/repo')).toBe(false)
    expect(store.configOpen).toBe(true)
    expect(store.configError).toBe('invalid-config')
    expect(store.configFieldErrors).toEqual(['stages.implement.permissionMode'])
    expect(store.configConflictRevision).toBeNull()
  })

  it('reports a revision conflict with the current revision', async () => {
    const store = useFactoryStore()
    store.config = configFixture()
    store.openConfig()
    factoryApi.configSave.mockResolvedValue({ ok: false, error: 'revision-conflict', current: 3 })

    expect(await store.saveConfig('/repo')).toBe(false)
    expect(store.configError).toBe('revision-conflict')
    expect(store.configConflictRevision).toBe(3)
    expect(store.configOpen).toBe(true)
  })

  it('retries turning the merge gate off after explicit confirmation', async () => {
    const store = useFactoryStore()
    store.config = configFixture()
    store.openConfig()
    store.updateStage('merge', { humanGate: false })

    factoryApi.configSave.mockResolvedValueOnce({ ok: false, error: 'confirm-required' })
    expect(await store.saveConfig('/repo')).toBe(false)
    expect(store.configError).toBe('confirm-required')

    store.setConfigGateConfirm(true)
    factoryApi.configSave.mockResolvedValueOnce({
      ok: true,
      config: { ...configFixture(), revision: 2, stages: { ...configFixture().stages, merge: { ...configFixture().stages.merge, humanGate: false } } },
    })
    expect(await store.saveConfig('/repo')).toBe(true)
    expect(factoryApi.configSave).toHaveBeenLastCalledWith(
      '/repo',
      expect.objectContaining({ confirmGateOff: true }),
    )
  })
})
