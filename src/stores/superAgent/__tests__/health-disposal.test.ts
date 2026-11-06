/**
 * Super Agent renderer store 健康处置契约（T20 #90）：
 *  - reevaluateEval 走 IPC 命令，成功后重拉健康报告（eval 主体项随之收敛）；
 *  - dismissProblem / retryHealthProblem 走 IPC 命令并把响应报告直接写回镜像
 *    （状态回显，无需二次拉取）；
 *  - subjectId 仅在非 null 时携带；null 时省略（系统级问题）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SuperAgentHealthReport, SuperAgentSnapshot } from '@/shared/channels/superAgent'
import { useSuperAgentStore } from '../index'

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  evalReevaluate: vi.fn(),
  problemDismiss: vi.fn(),
  healthRetry: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      health: mocks.health,
      evalReevaluate: mocks.evalReevaluate,
      problemDismiss: mocks.problemDismiss,
      healthRetry: mocks.healthRetry,
    },
    claudeCode: {
      stop: mocks.stop,
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: vi.fn().mockResolvedValue([]),
    },
    agents: { install: vi.fn().mockResolvedValue({ success: true }) },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
    trace: { event: vi.fn() },
    terminal: { onExit: vi.fn() },
    image: null,
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    injectGuiModelsToSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

function report(overrides: Partial<SuperAgentHealthReport> = {}): SuperAgentHealthReport {
  return {
    repoRoot: 'D:/repo',
    problemCount: 0,
    degradedCount: 0,
    items: [],
    dispositions: [],
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
})

/**
 * 项目作用域。生产里只由 bind/switchProject 确立，而镜像写入要求"数据属于当前
 * 绑定的项目"（切换项目时在途旧响应不得覆盖新镜像），所以处置类用例要先进入该状态。
 */
function boundScope(): SuperAgentSnapshot {
  return {
    repoRoot: 'D:/repo',
    seq: 1,
    asOf: 1700000000000,
    staleAfterMs: 5000,
    router: { sessionId: 'router-1', running: false },
    attention: { unanswered: 0 },
    review: { reminded: 0 },
  }
}

describe('superAgent store 健康处置（T20 #90）', () => {
  it('reevaluateEval invokes the channel and refreshes the health report', async () => {
    const store = useSuperAgentStore()
    store.snapshot = boundScope()
    mocks.evalReevaluate.mockResolvedValue({
      evalId: 'eval-1',
      requeuedTriggerIds: ['trigger-1'],
    })
    mocks.health.mockResolvedValue(report({ problemCount: 0 }))

    const result = await store.reevaluateEval('D:/repo', 'eval-1')

    expect(mocks.evalReevaluate).toHaveBeenCalledWith('D:/repo', { evalId: 'eval-1' })
    expect(mocks.health).toHaveBeenCalledWith('D:/repo')
    expect(result.requeuedTriggerIds).toEqual(['trigger-1'])
    expect(store.healthReport?.problemCount).toBe(0)
  })

  it('dismissProblem writes the echoed report back into the mirror', async () => {
    const store = useSuperAgentStore()
    const echoed = report({
      problemCount: 0,
      dispositions: [{ category: 'eval', subjectId: 'eval-1', action: 'dismiss', at: '2026-01-01T00:00:00Z' }],
    })
    mocks.problemDismiss.mockResolvedValue(echoed)

    const result = await store.dismissProblem('D:/repo', 'eval', 'eval-1')

    expect(mocks.problemDismiss).toHaveBeenCalledWith('D:/repo', {
      category: 'eval',
      subjectId: 'eval-1',
    })
    expect(result.dispositions).toHaveLength(1)
    expect(store.healthReport).toEqual(echoed)
  })

  it('retryHealthProblem omits subjectId for system-level problems', async () => {
    const store = useSuperAgentStore()
    const echoed = report({
      dispositions: [{ category: 'engine', subjectId: null, action: 'retry', at: '2026-01-01T00:00:00Z' }],
    })
    mocks.healthRetry.mockResolvedValue(echoed)

    await store.retryHealthProblem('D:/repo', 'engine', null)

    expect(mocks.healthRetry).toHaveBeenCalledWith('D:/repo', { category: 'engine' })
    expect(store.healthReport).toEqual(echoed)
  })
})
