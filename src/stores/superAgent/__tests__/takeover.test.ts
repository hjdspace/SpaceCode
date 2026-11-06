/**
 * Super Agent renderer store 接管与交还契约（T09 #79）：
 *  - takeoverWorker 走 IPC 真命令并镜像接管态，takenOver 同步到该工单镜像；
 *  - releaseWorker 幂等清空接管态并让镜像回到只读；unbindWorker 一并清空，
 *    交还/关闭标签不残留接管态；
 *  - sendWorkerMessage 走 IPC 先落库再投递，渲染端不直连引擎；
 *  - takeover-changed 只接受当前绑定项目的事件，并同步各镜像的 takenOver。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SuperAgentSnapshot } from '@/shared/channels/superAgent'
import { useSuperAgentStore } from '../index'

const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  workerBind: vi.fn(),
  workerUnbind: vi.fn(),
  workerTakeover: vi.fn(),
  workerRelease: vi.fn().mockResolvedValue(true as const),
  workerMessage: vi.fn(),
  onTakeoverChanged: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      state: mocks.state,
      workerBind: mocks.workerBind,
      workerUnbind: mocks.workerUnbind,
      workerTakeover: mocks.workerTakeover,
      workerRelease: mocks.workerRelease,
      workerMessage: mocks.workerMessage,
      onTakeoverChanged: mocks.onTakeoverChanged,
    },
    claudeCode: {
      stop: mocks.stop,
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: vi.fn().mockResolvedValue([]),
    },
    agents: { install: vi.fn().mockResolvedValue({ success: true }) },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
  },
}))

function snapshot(repoRoot = 'D:/repo'): SuperAgentSnapshot {
  return {
    repoRoot,
    seq: 1,
    asOf: 1700000000000,
    staleAfterMs: 5000,
    router: { sessionId: 'router-1', running: false },
    attention: { unanswered: 0 },
    review: { reminded: 0 },
  }
}

function mirror(ticketId: string, overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: 'D:/repo',
    ticketId,
    title: '修复登录',
    sessionId: `superagent-worker-${ticketId}`,
    running: false,
    takenOver: false,
    segments: [],
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.workerRelease.mockResolvedValue(true as const)
})

/**
 * 建立项目作用域。
 *
 * 生产里作用域只由 bind/switchProject 确立，镜像写入一律要求"数据属于当前绑定的
 * 项目"（切换项目时在途的旧响应不得覆盖新镜像）。测试落同一份快照来进入该状态，
 * 而不是靠 loadState 去发明作用域。
 */
async function boundStore(repoRoot = 'D:/repo') {
  const store = useSuperAgentStore()
  store.snapshot = snapshot(repoRoot)
  return store
}

describe('superAgent store takeover（T09 #79）', () => {
  it('takeoverWorker 走 IPC 并镜像接管态，takenOver 同步进该工单镜像', async () => {
    const store = await boundStore()
    mocks.workerTakeover.mockResolvedValue({
      repoRoot: 'D:/repo',
      ticketId: 'ticket-1',
      at: '2026-01-01T00:00:00Z',
    })
    store.workerMirrors = { 'ticket-1': mirror('ticket-1') }

    const state = await store.takeoverWorker('D:/repo', 'ticket-1')

    expect(mocks.workerTakeover).toHaveBeenCalledWith('D:/repo', 'ticket-1')
    expect(state.ticketId).toBe('ticket-1')
    expect(store.takeoverTicketId).toBe('ticket-1')
    expect(store.workerMirrors['ticket-1'].takenOver).toBe(true)
  })

  it('takeoverWorker 冲突时（takeoverConflict）不改变本地接管态', async () => {
    const store = await boundStore()
    mocks.workerTakeover.mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'takeoverConflict' }),
    )

    await expect(store.takeoverWorker('D:/repo', 'ticket-2')).rejects.toThrow(/conflict/)
    expect(store.takeoverTicketId).toBeNull()
  })

  it('releaseWorker 幂等清空接管态并让镜像回只读', async () => {
    const store = await boundStore()
    mocks.workerTakeover.mockResolvedValue({
      repoRoot: 'D:/repo',
      ticketId: 'ticket-1',
      at: '2026-01-01T00:00:00Z',
    })
    await store.takeoverWorker('D:/repo', 'ticket-1')
    store.workerMirrors = { 'ticket-1': mirror('ticket-1', { takenOver: true }) }

    expect(await store.releaseWorker('D:/repo', 'ticket-1')).toBe(true)
    expect(store.takeoverTicketId).toBeNull()
    expect(store.workerMirrors['ticket-1'].takenOver).toBe(false)

    // 重复交还依然成功且无残留
    expect(await store.releaseWorker('D:/repo', 'ticket-1')).toBe(true)
    expect(store.takeoverTicketId).toBeNull()
  })

  it('unbindWorker 一并清空接管态：关闭标签不残留面板态', async () => {
    const store = await boundStore()
    mocks.workerTakeover.mockResolvedValue({
      repoRoot: 'D:/repo',
      ticketId: 'ticket-1',
      at: '2026-01-01T00:00:00Z',
    })
    await store.takeoverWorker('D:/repo', 'ticket-1')
    store.workerMirrors = { 'ticket-1': mirror('ticket-1') }
    mocks.workerUnbind.mockResolvedValue(true as const)

    await store.unbindWorker('D:/repo', 'ticket-1')

    expect(store.takeoverTicketId).toBeNull()
    expect(store.workerMirrors['ticket-1']).toBeUndefined()
  })
})

describe('superAgent store sendWorkerMessage（T09 #79）', () => {
  it('接管输入走 IPC 先落库再投递，不直连引擎', async () => {
    const store = await boundStore()
    const result = {
      inputId: 'input-1',
      ticketId: 'ticket-1',
      status: 'delivered' as const,
      delivered: true,
      gated: false,
      duplicate: false,
    }
    mocks.workerMessage.mockResolvedValue(result)

    const outcome = await store.sendWorkerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: 'ticket-1',
      text: '请改用另一个方案',
    })

    expect(mocks.workerMessage).toHaveBeenCalledWith('D:/repo', {
      requestId: 'msg-1',
      ticketId: 'ticket-1',
      text: '请改用另一个方案',
    })
    expect(outcome).toBe(result)
  })
})

describe('superAgent store watchTakeover（T09 #79）', () => {
  it('takeover-changed 只接受当前绑定项目并同步各镜像的 takenOver', async () => {
    const store = await boundStore()
    store.workerMirrors = {
      'ticket-1': mirror('ticket-1'),
      'ticket-2': mirror('ticket-2', { takenOver: true }),
    }
    let listener: ((repoRoot: string, event: unknown) => void) | undefined
    mocks.onTakeoverChanged.mockImplementation((cb: unknown) => {
      listener = cb as typeof listener
      return () => {}
    })

    store.watchTakeover()
    expect(mocks.onTakeoverChanged).toHaveBeenCalled()

    // 其他项目的事件忽略
    listener?.('D:/other', { repoRoot: 'D:/other', takeover: null })
    expect(store.takeoverTicketId).toBeNull()
    expect(store.workerMirrors['ticket-2'].takenOver).toBe(true)

    // 当前项目接管 ticket-1：接管态镜像 + 两张镜像的 takenOver 都同步
    listener?.('D:/repo', {
      repoRoot: 'D:/repo',
      takeover: { repoRoot: 'D:/repo', ticketId: 'ticket-1', at: '2026-01-01T00:00:00Z' },
    })
    expect(store.takeoverTicketId).toBe('ticket-1')
    expect(store.workerMirrors['ticket-1'].takenOver).toBe(true)
    expect(store.workerMirrors['ticket-2'].takenOver).toBe(false)

    // 交还：takeover=null 广播清空所有接管态
    listener?.('D:/repo', { repoRoot: 'D:/repo', takeover: null })
    expect(store.takeoverTicketId).toBeNull()
    expect(store.workerMirrors['ticket-1'].takenOver).toBe(false)
  })
})
