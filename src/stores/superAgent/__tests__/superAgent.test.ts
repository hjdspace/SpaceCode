/**
 * Super Agent renderer store 契约（T01 #71、T13 #83、T05 #75）：
 *  - bind 走 IPC 真命令，把 Router 会话登记进 chatSession（类型 superAgent），
 *    重复 bind 不重复建会话条目；
 *  - loadState 刷新带 seq 的快照，Attention 徽章读到 unanswered；
 *  - Router 会话不出现在普通会话列表；
 *  - 健康面板（T13）：loadHealth 拉取报告，health.changed 只更新当前项目，
 *    问题列表只含 error 且未反映在工单卡片的项，面板开关可切换；
 *  - 派工与队列（T05）：dispatch 走 IPC 幂等命令并刷新队列，queue-changed
 *    只更新当前项目，loadQueue 拉取队列快照。
 *  - 工单卡片（T06 #76）：loadTickets 全量拉取看板；ticket-updated 水位一致
 *    时原位应用（幂等）、断档时全量重拉；ticket-progress 断档不重拉、只存最新。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  SuperAgentHealthItem,
  SuperAgentHealthReport,
  SuperAgentQueueSnapshot,
  SuperAgentTicketCard,
  SuperAgentTicketProgress,
  SuperAgentTicketUpdateEvent,
  SuperAgentWorkerMirror,
} from '@/shared/channels/superAgent'
import { useSuperAgentStore } from '../index'
import { useChatSessionStore } from '../../chatSession'

const mocks = vi.hoisted(() => ({
  routerBind: vi.fn(),
  state: vi.fn(),
  health: vi.fn(),
  onHealthChanged: vi.fn(),
  dispatch: vi.fn(),
  queue: vi.fn(),
  onQueueChanged: vi.fn(),
  tickets: vi.fn(),
  onTicketUpdated: vi.fn(),
  onTicketProgress: vi.fn(),
  workerBind: vi.fn(),
  workerUnbind: vi.fn(),
  traceEvent: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      routerBind: mocks.routerBind,
      state: mocks.state,
      health: mocks.health,
      onHealthChanged: mocks.onHealthChanged,
      dispatch: mocks.dispatch,
      queue: mocks.queue,
      onQueueChanged: mocks.onQueueChanged,
      tickets: mocks.tickets,
      onTicketUpdated: mocks.onTicketUpdated,
      onTicketProgress: mocks.onTicketProgress,
      workerBind: mocks.workerBind,
      workerUnbind: mocks.workerUnbind,
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

function healthItem(overrides: Partial<SuperAgentHealthItem> = {}): SuperAgentHealthItem {
  return {
    category: 'engine',
    status: 'error',
    consecutiveFailures: 3,
    code: 'slotUnavailable',
    codeI18nKey: 'superAgent.errors.slotUnavailable',
    lastFailedAt: '2026-01-01T00:00:00Z',
    ticketId: null,
    reflectedOnTicket: false,
    subjectId: null,
    ...overrides,
  }
}

function healthReport(items: SuperAgentHealthItem[], overrides: Partial<SuperAgentHealthReport> = {}): SuperAgentHealthReport {
  return {
    repoRoot: 'D:/repo',
    problemCount: items.filter((item) => item.status === 'error' && !item.reflectedOnTicket).length,
    degradedCount: items.filter((item) => item.status === 'degraded' && !item.reflectedOnTicket).length,
    items,
    dispositions: [],
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('superAgent store health', () => {
  beforeEach(() => {
    mocks.onHealthChanged.mockReset()
  })

  it('loads the health report and exposes the problem count', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')
    mocks.health.mockResolvedValue(healthReport([healthItem()]))

    await superAgent.loadHealth('D:/repo')

    expect(mocks.health).toHaveBeenCalledWith('D:/repo')
    expect(superAgent.healthProblemCount).toBe(1)
    expect(superAgent.healthProblems).toEqual([healthItem()])
  })

  it('filters the panel list to error items that are not reflected on a ticket', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')

    const onTicket = healthItem({
      category: 'effect:delivery',
      ticketId: 'ticket-1',
      reflectedOnTicket: true,
    })
    const jitter = healthItem({ category: 'source', status: 'degraded', consecutiveFailures: 1 })
    mocks.health.mockResolvedValue(healthReport([onTicket, jitter, healthItem()]))

    await superAgent.loadHealth('D:/repo')

    expect(superAgent.healthProblems.map((item) => item.category)).toEqual(['engine'])
    // 汇总数也排除工单卡片项
    expect(superAgent.healthProblemCount).toBe(1)
  })

  it('reports zero problems before any health load', () => {
    const { superAgent } = loadStores()

    expect(superAgent.healthProblemCount).toBe(0)
    expect(superAgent.healthProblems).toEqual([])
  })

  it('toggles the read-only panel', () => {
    const { superAgent } = loadStores()

    expect(superAgent.healthPanelOpen).toBe(false)
    superAgent.toggleHealthPanel()
    expect(superAgent.healthPanelOpen).toBe(true)
    superAgent.toggleHealthPanel()
    expect(superAgent.healthPanelOpen).toBe(false)
  })

  it('updates the report from health.changed only for the bound repo root', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')

    let listener: ((repoRoot: string, report: SuperAgentHealthReport) => void) | undefined
    mocks.onHealthChanged.mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
    superAgent.watchHealth()

    const other = healthReport([], { repoRoot: 'D:/other' })
    listener?.('D:/other', other)
    expect(superAgent.healthReport).toBeNull()

    const mine = healthReport([healthItem()])
    listener?.('D:/repo', mine)
    expect(superAgent.healthReport).toEqual(mine)
    expect(superAgent.healthProblemCount).toBe(1)
  })
})

function workerMirror(overrides: Partial<SuperAgentWorkerMirror> = {}): SuperAgentWorkerMirror {
  return {
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    title: '修复登录',
    sessionId: 'superagent-worker-ticket-1',
    running: true,
    takenOver: false,
    segments: [
      {
        assignmentId: 'assignment-1',
        generation: 1,
        state: 'running',
        endedReason: null,
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: '2026-01-01T00:00:01Z',
        endedAt: null,
        reportKind: null,
        reportSummary: null,
      },
    ],
    ...overrides,
  }
}

describe('superAgent store worker mirror（T07 #77）', () => {
  it('bindWorker registers the worker session once and keeps it out of the normal list', async () => {
    const { superAgent, chat } = loadStores()
    chat.createSession('Chat', 'D:/repo', 'chat-1', { activate: false })
    mocks.workerBind.mockResolvedValue(workerMirror())

    await superAgent.bindWorker('D:/repo', 'ticket-1')
    await superAgent.bindWorker('D:/repo', 'ticket-1')

    expect(mocks.workerBind).toHaveBeenCalledTimes(2)
    expect(mocks.workerBind).toHaveBeenLastCalledWith('D:/repo', 'ticket-1')
    // Worker 会话登记一次、不激活，也不出现在普通会话列表
    const workerSession = chat.sessions.find(s => s.id === 'superagent-worker-ticket-1')
    expect(workerSession?.sessionType).toBe('superAgentWorker')
    expect(chat.sessions.filter(s => s.sessionType === 'superAgentWorker')).toHaveLength(1)
    // 不抢占当前会话
    expect(chat.currentSessionId).toBeNull()
    expect(chat.normalSessions.map(s => s.id)).toEqual(['chat-1'])
    // 镜像快照入 store，面板按 ticketId 读取
    expect(superAgent.workerMirrors['ticket-1']).toEqual(workerMirror())
  })

  it('unbindWorker stops the mirror but keeps the session transcript for restore', async () => {
    const { superAgent, chat } = loadStores()
    mocks.workerBind.mockResolvedValue(workerMirror())
    mocks.workerUnbind.mockResolvedValue(true)
    await superAgent.bindWorker('D:/repo', 'ticket-1')

    await superAgent.unbindWorker('D:/repo', 'ticket-1')

    expect(mocks.workerUnbind).toHaveBeenCalledWith('D:/repo', 'ticket-1')
    expect(superAgent.workerMirrors['ticket-1']).toBeUndefined()
    // 只停镜像：会话与转录保留，重开标签可从快照恢复
    expect(chat.sessions.find(s => s.id === 'superagent-worker-ticket-1')).toBeTruthy()
  })

  it('rebinding after unbind restores the mirror from the fresh snapshot', async () => {
    const { superAgent } = loadStores()
    mocks.workerBind.mockResolvedValueOnce(workerMirror())
    mocks.workerBind.mockResolvedValueOnce(workerMirror({ running: false }))
    mocks.workerUnbind.mockResolvedValue(true)

    await superAgent.bindWorker('D:/repo', 'ticket-1')
    await superAgent.unbindWorker('D:/repo', 'ticket-1')
    await superAgent.bindWorker('D:/repo', 'ticket-1')

    expect(superAgent.workerMirrors['ticket-1']?.running).toBe(false)
  })
})

function queueSnapshot(overrides: Partial<SuperAgentQueueSnapshot> = {}): SuperAgentQueueSnapshot {
  return {
    repoRoot: 'D:/repo',
    maxWorkers: 1,
    running: [],
    queued: [],
    ...overrides,
  }
}

describe('superAgent store dispatch & queue（T05 #75）', () => {
  it('dispatches through the IPC command and refreshes the queue snapshot', async () => {
    const { superAgent } = loadStores()
    mocks.dispatch.mockResolvedValue({
      ticketId: 'ticket-1',
      assignmentId: 'assignment-1',
      decisionId: 'decision-1',
      mandateId: 'mandate-1',
      queuePosition: 1,
      duplicate: false,
    })
    mocks.queue.mockResolvedValue(
      queueSnapshot({ queued: [{ ticketId: 'ticket-1', title: '修复登录', position: 1, state: 'queued', dirty: null }] }),
    )

    const result = await superAgent.dispatch('D:/repo', {
      requestId: 'dispatch-1',
      title: '修复登录',
      text: '登录按钮无响应',
    })

    expect(mocks.dispatch).toHaveBeenCalledWith('D:/repo', {
      requestId: 'dispatch-1',
      title: '修复登录',
      text: '登录按钮无响应',
    })
    expect(result.ticketId).toBe('ticket-1')
    expect(mocks.queue).toHaveBeenCalledWith('D:/repo')
    expect(superAgent.queue?.queued).toHaveLength(1)
    expect(superAgent.queue?.queued[0].title).toBe('修复登录')
  })

  it('loadQueue mirrors the snapshot from the queue channel', async () => {
    const { superAgent } = loadStores()
    const snapshot = queueSnapshot({
      running: [{ ticketId: 'ticket-1', title: '工单一', position: 0, state: 'running', dirty: true }],
    })
    mocks.queue.mockResolvedValue(snapshot)

    await superAgent.loadQueue('D:/repo')

    expect(superAgent.queue).toEqual(snapshot)
  })

  it('updates the queue from queue-changed only for the bound repo root', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')

    let listener: ((repoRoot: string, snapshot: SuperAgentQueueSnapshot) => void) | undefined
    mocks.onQueueChanged.mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
    superAgent.watchQueue()

    const other = queueSnapshot({ repoRoot: 'D:/other' })
    listener?.('D:/other', other)
    expect(superAgent.queue).toBeNull()

    const mine = queueSnapshot({ queued: [{ ticketId: 'ticket-1', title: '修复登录', position: 1, state: 'queued', dirty: null }] })
    listener?.('D:/repo', mine)
    expect(superAgent.queue).toEqual(mine)
  })
})

function ticketCard(overrides: Partial<SuperAgentTicketCard> = {}): SuperAgentTicketCard {
  return {
    ticketId: 'ticket-1',
    title: '修复登录',
    state: 'working',
    assignmentId: 'assignment-1',
    generation: 1,
    scopePaths: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ended: null,
    reviewRemindedAt: null,
    canRetry: false,
    ...overrides,
  }
}

function ticketProgress(overrides: Partial<SuperAgentTicketProgress> = {}): SuperAgentTicketProgress {
  return {
    repoRoot: 'D:/repo',
    seq: 1,
    ticketId: 'ticket-1',
    state: 'working',
    assignmentId: 'assignment-1',
    currentTool: 'Edit',
    elapsedMs: 1000,
    toolCalls: 3,
    lastActivityAt: '2026-01-01T00:00:01Z',
    ...overrides,
  }
}

describe('superAgent store 工单卡片（T06 #76）', () => {
  it('loadTickets mirrors the full board with the domain seq watermark', async () => {
    const { superAgent } = loadStores()
    mocks.tickets.mockResolvedValue({ repoRoot: 'D:/repo', seq: 5, tickets: [ticketCard()] })

    await superAgent.loadTickets('D:/repo')

    expect(mocks.tickets).toHaveBeenCalledWith('D:/repo')
    expect(superAgent.ticketBoard?.seq).toBe(5)
    expect(superAgent.ticketBoard?.tickets).toHaveLength(1)
  })

  it('applies ticket-updated in place when the seq watermark matches', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')
    mocks.tickets.mockResolvedValue({ repoRoot: 'D:/repo', seq: 2, tickets: [ticketCard({ state: 'queued' })] })
    await superAgent.loadTickets('D:/repo')

    let listener: ((repoRoot: string, event: SuperAgentTicketUpdateEvent) => void) | undefined
    mocks.onTicketUpdated.mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
    superAgent.watchTickets()

    // 水位衔接（fromSeq === 本地 seq）：直接应用全量卡片，Report 原位更新
    const updated = [ticketCard({ state: 'working' })]
    listener?.('D:/repo', { repoRoot: 'D:/repo', fromSeq: 2, toSeq: 3, tickets: updated })
    expect(superAgent.ticketBoard?.seq).toBe(3)
    expect(superAgent.ticketBoard?.tickets).toEqual(updated)
    expect(mocks.tickets).toHaveBeenCalledTimes(1)
  })

  it('re-pulls the full board when the domain seq watermark gaps', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')
    mocks.tickets.mockResolvedValue({ repoRoot: 'D:/repo', seq: 2, tickets: [ticketCard()] })
    await superAgent.loadTickets('D:/repo')

    let listener: ((repoRoot: string, event: SuperAgentTicketUpdateEvent) => void) | undefined
    mocks.onTicketUpdated.mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
    superAgent.watchTickets()

    // fromSeq(5) !== 本地 seq(2)：领域断档，全量重拉而不是错位应用
    mocks.tickets.mockResolvedValue({ repoRoot: 'D:/repo', seq: 6, tickets: [ticketCard({ state: 'idle' })] })
    listener?.('D:/repo', { repoRoot: 'D:/repo', fromSeq: 5, toSeq: 6, tickets: [ticketCard({ state: 'review' })] })
    await vi.waitFor(() => expect(superAgent.ticketBoard?.seq).toBe(6))
    expect(mocks.tickets).toHaveBeenCalledTimes(2)
    expect(superAgent.ticketBoard?.tickets[0].state).toBe('idle')
  })

  it('keeps only the latest ticket-progress and never re-pulls on progress gaps', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')

    let listener: ((repoRoot: string, progress: SuperAgentTicketProgress) => void) | undefined
    mocks.onTicketProgress.mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
    superAgent.watchTickets()

    // 投影 seq 跳跃（节流丢帧）不触发重拉，只应用最新进度
    listener?.('D:/repo', ticketProgress({ seq: 1, currentTool: 'Read' }))
    listener?.('D:/repo', ticketProgress({ seq: 7, currentTool: 'Bash' }))

    expect(superAgent.ticketProgress['ticket-1']?.currentTool).toBe('Bash')
    expect(superAgent.ticketProgress['ticket-1']?.seq).toBe(7)
    expect(mocks.tickets).not.toHaveBeenCalled()
  })

  it('ignores ticket events for other repo roots', async () => {
    const { superAgent } = loadStores()
    mocks.state.mockResolvedValue(snapshot())
    await superAgent.bind('D:/repo')

    let updated: ((repoRoot: string, event: SuperAgentTicketUpdateEvent) => void) | undefined
    let progress: ((repoRoot: string, payload: SuperAgentTicketProgress) => void) | undefined
    mocks.onTicketUpdated.mockImplementation((cb) => {
      updated = cb
      return () => {}
    })
    mocks.onTicketProgress.mockImplementation((cb) => {
      progress = cb
      return () => {}
    })
    superAgent.watchTickets()

    updated?.('D:/other', { repoRoot: 'D:/other', fromSeq: 0, toSeq: 1, tickets: [] })
    progress?.('D:/other', ticketProgress({ repoRoot: 'D:/other' }))

    expect(superAgent.ticketBoard).toBeNull()
    expect(superAgent.ticketProgress['ticket-1']).toBeUndefined()
  })
})
