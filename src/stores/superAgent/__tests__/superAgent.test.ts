/**
 * Super Agent renderer store 契约（T01 #71）：
 *  - bind 走 IPC 真命令，把 Router 会话登记进 chatSession（类型 superAgent），
 *    重复 bind 不重复建会话条目；
 *  - loadState 刷新带 seq 的快照，Attention 徽章读到 unanswered；
 *  - Router 会话不出现在普通会话列表。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSuperAgentStore } from '../index'
import { useChatSessionStore } from '../../chatSession'

const mocks = vi.hoisted(() => ({
  routerBind: vi.fn(),
  state: vi.fn(),
  traceEvent: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      routerBind: mocks.routerBind,
      state: mocks.state,
    },
    claudeCode: {
      stop: mocks.stop,
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: vi.fn().mockResolvedValue([]),
    },
    agents: { install: vi.fn().mockResolvedValue({ success: true }) },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
    trace: { event: mocks.traceEvent },
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

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: 'D:/repo',
    seq: 1,
    asOf: 1700000000000,
    staleAfterMs: 5000,
    router: { sessionId: 'router-1', running: false },
    attention: { unanswered: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
})

function loadStores() {
  return { superAgent: useSuperAgentStore(), chat: useChatSessionStore() }
}

describe('superAgent store bind', () => {
  it('registers the router session once and keeps it out of the normal list', async () => {
    const { superAgent, chat } = loadStores()
    chat.createSession('Chat', 'D:/repo', 'chat-1', { activate: false })
    mocks.routerBind.mockResolvedValue({
      sessionId: 'router-1',
      running: false,
      snapshot: snapshot(),
    })

    await superAgent.bind('D:/repo')
    await superAgent.bind('D:/repo')

    expect(mocks.routerBind).toHaveBeenCalledTimes(2)
    expect(mocks.routerBind).toHaveBeenLastCalledWith('D:/repo')
    expect(superAgent.boundSessionId).toBe('router-1')
    expect(superAgent.snapshot?.seq).toBe(1)
    expect(chat.sessions.filter(s => s.sessionType === 'superAgent')).toHaveLength(1)
    expect(chat.sessions.find(s => s.id === 'router-1')?.title).toBeTruthy()
    expect(chat.normalSessions.map(s => s.id)).toEqual(['chat-1'])
  })
})

describe('superAgent store state', () => {
  it('refreshes the snapshot and exposes the attention count for the badge', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot({ seq: 4, attention: { unanswered: 2 } }))

    const result = await superAgent.loadState('D:/repo')

    expect(mocks.state).toHaveBeenCalledWith('D:/repo')
    expect(result.seq).toBe(4)
    expect(superAgent.snapshot?.seq).toBe(4)
    expect(superAgent.attentionCount).toBe(2)
  })

  it('reports zero attention before any snapshot is loaded', () => {
    const { superAgent } = loadStores()

    expect(superAgent.attentionCount).toBe(0)
  })
})
