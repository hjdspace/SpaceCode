/**
 * 看板内接管面板的 store 侧行为（issue 09）。
 *
 * 面板是看板的一部分：接管后面板打开、关闭不交回、可从卡片或检查器重新打开、
 * 交回结果决定面板去留。IPC 全部 mock，只观察 store 的公开状态。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FactoryRunSnapshot, FactoryTask, FactoryTakeoverSession } from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    backlogList: vi.fn(),
    runList: vi.fn(),
    runGet: vi.fn(),
    taskTakeover: vi.fn(),
    taskReturn: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))

import { useFactoryStore } from '../index'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '修复会话恢复时序',
    goal: '确认刷新时 session 从哪读',
    lane: 'implementing',
    stageIdx: 2,
    branch: 'agent/task-bl-1',
    worktree: '.spacecode/worktrees/bl-1',
    model: 'claude-sonnet-4-5',
    iteration: 2,
    maxIterations: 5,
    diff: { additions: 12, deletions: 3 },
    timestamps: { claimedAt: '2026-10-28T10:02:00Z', startedAt: '2026-10-28T10:03:00Z' },
    ...overrides,
  }
}

function snapshot(tasks: FactoryTask[]): FactoryRunSnapshot {
  return {
    run: {
      id: 'run-1',
      status: 'running',
      paused: false,
      createdAt: '2026-10-28T10:02:00Z',
      maxConcurrency: 4,
      spendUsd: 0,
      elapsedMs: 0,
    },
    tasks,
  }
}

function session(taskId = 'bl-1'): FactoryTakeoverSession {
  return {
    sessionId: `fac-run-1-${taskId}-takeover`,
    taskId,
    projectPath: 'D:/repo/.spacecode/worktrees/bl-1',
    title: '接管 · 修复会话恢复时序',
    content: '你已接管流水线任务。',
    activate: false,
  }
}

/** 接管后的快照：带 takeover 标记。 */
function takenOver(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return task({ takeover: { at: '2026-10-29T10:00:00Z', sessionId: 'fac-run-1-bl-1-takeover' }, ...overrides })
}

/** 看板要先加载：动作回包只刷新当前运行的快照，这是接管面板能拿到任务的前提。 */
async function openBoard(tasks: FactoryTask[]) {
  factoryApi.runList.mockResolvedValue([snapshot(tasks).run])
  factoryApi.runGet.mockResolvedValue(snapshot(tasks))
  const store = useFactoryStore()
  await store.loadRun('D:/repo')
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  factoryApi.onEvent.mockImplementation(() => () => {})
})

describe('takeover panel state', () => {
  it('接管成功后在看板内打开该任务的接管面板', async () => {
    const store = await openBoard([task()])
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver()]),
      session: session(),
    })

    const result = await store.takeoverTask('D:/repo', 'run-1', 'bl-1')

    expect(result.ok).toBe(true)
    expect(store.takeoverPanelTask?.id).toBe('bl-1')
    expect(store.takeoverPanelTask?.takeover?.sessionId).toBe('fac-run-1-bl-1-takeover')
  })

  it('关闭面板不交回：任务仍是接管中', async () => {
    const store = await openBoard([task()])
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver()]),
      session: session(),
    })
    await store.takeoverTask('D:/repo', 'run-1', 'bl-1')

    store.closeTakeoverPanel()

    expect(store.takeoverPanelTask).toBeNull()
    expect(store.tasks[0].takeover).toMatchObject({ sessionId: 'fac-run-1-bl-1-takeover' })
    expect(store.selectedTask?.takeover).toBeDefined()
    expect(factoryApi.taskReturn).not.toHaveBeenCalled()
  })

  it('接管中的任务可从卡片或检查器重新打开面板', async () => {
    const store = await openBoard([takenOver()])
    expect(store.takeoverPanelTask).toBeNull()

    store.openTakeoverPanel('bl-1')

    expect(store.takeoverPanelTask?.id).toBe('bl-1')
    expect(factoryApi.taskTakeover).not.toHaveBeenCalled()
  })

  it('交回验证失败时面板不关，任务保持接管中', async () => {
    const store = await openBoard([task()])
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver()]),
      session: session(),
    })
    await store.takeoverTask('D:/repo', 'run-1', 'bl-1')
    factoryApi.taskReturn.mockResolvedValue({ ok: true, snapshot: snapshot([takenOver()]), verified: false })

    const result = await store.returnTask('D:/repo', 'run-1', 'bl-1')

    expect(result).toMatchObject({ ok: true, verified: false })
    expect(store.takeoverPanelTask?.id).toBe('bl-1')
  })

  it('交回验证通过后任务回到流水线，面板收起', async () => {
    const store = await openBoard([task()])
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver()]),
      session: session(),
    })
    await store.takeoverTask('D:/repo', 'run-1', 'bl-1')
    factoryApi.taskReturn.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver({ lane: 'reviewing', stageIdx: 4, takeover: undefined })]),
      verified: true,
    })

    const result = await store.returnTask('D:/repo', 'run-1', 'bl-1')

    expect(result).toMatchObject({ ok: true, verified: true })
    expect(store.takeoverPanelTask).toBeNull()
  })

  it('交回验证失败的提示跟着面板走，换任务打开时清掉', async () => {
    const store = await openBoard([task()])
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver()]),
      session: session(),
    })
    factoryApi.taskReturn.mockResolvedValue({ ok: true, snapshot: snapshot([takenOver()]), verified: false })
    await store.takeoverTask('D:/repo', 'run-1', 'bl-1')

    await store.returnTask('D:/repo', 'run-1', 'bl-1')
    expect(store.takeoverVerifyFailed).toBe(true)

    store.openTakeoverPanel('bl-2')
    expect(store.takeoverVerifyFailed).toBe(false)
  })

  it('切走运行页签时收起接管面板', async () => {
    const store = await openBoard([task()])
    factoryApi.taskTakeover.mockResolvedValue({
      ok: true,
      snapshot: snapshot([takenOver()]),
      session: session(),
    })
    await store.takeoverTask('D:/repo', 'run-1', 'bl-1')

    store.reset()

    expect(store.takeoverPanelTask).toBeNull()
  })
})
