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
 *    时原位应用（幂等）、断档时全量重拉；ticket-progress 断档不重拉、只存最新；
 *  - Router 对话（T21 #91）：发消息交给主进程 RouterRunner（不走渲染端 turn），
 *    routerRunning 跟着 IPC 返回与 router-status 广播走，bind/bindWorker 都重读
 *    引擎转录，重启后 IM 历史与 Worker 面板不会变成空白。
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
  routerMessage: vi.fn(),
  routerAbort: vi.fn(),
  onRouterStatus: vi.fn(),
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
  onWorkerUpdated: vi.fn().mockReturnValue(() => {}),
  authorizationPolicy: vi.fn(),
  authorizationPolicySet: vi.fn(),
  traceEvent: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  getFullSession: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      routerBind: mocks.routerBind,
      routerMessage: mocks.routerMessage,
      routerAbort: mocks.routerAbort,
      onRouterStatus: mocks.onRouterStatus,
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
      onWorkerUpdated: mocks.onWorkerUpdated,
      authorizationPolicy: mocks.authorizationPolicy,
      authorizationPolicySet: mocks.authorizationPolicySet,
    },
    claudeCode: {
      stop: mocks.stop,
      getFullSession: mocks.getFullSession,
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
    review: { reminded: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
  mocks.getFullSession.mockResolvedValue(null)
  mocks.workerBind.mockReset()
  mocks.workerUnbind.mockReset().mockResolvedValue(true)
  mocks.onWorkerUpdated.mockReset().mockReturnValue(() => {})
})

function loadStores() {
  return { superAgent: useSuperAgentStore(), chat: useChatSessionStore() }
}

/**
 * 先进入项目作用域：镜像只接受"属于当前绑定项目"的数据（切换项目时在途旧请求
 * 不得覆盖新镜像），所以任何 load* 用例都得先 bind。
 */
async function bindProject(superAgent: ReturnType<typeof useSuperAgentStore>): Promise<void> {
  mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
  await superAgent.bind('D:/repo')
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

  it('补认修复前以普通聊天落行的 Router 会话', async () => {
    const { superAgent, chat } = loadStores()
    // 修复前的现场：主进程推送气泡时没带归属，Router 就这样落了普通聊天行
    chat.createSession('当前正在进行的任务有哪些', 'D:/repo', 'router-1', { activate: false })
    expect(chat.normalSessions.map(s => s.id)).toEqual(['router-1'])
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })

    await superAgent.bind('D:/repo')

    expect(chat.sessions.find(s => s.id === 'router-1')?.sessionType).toBe('superAgent')
    expect(chat.normalSessions).toEqual([])
  })
})

/**
 * 项目作用域切换。
 *
 * 中置页那份镜像一次只能属于一个项目：换根必须整套清空重绑，否则屏幕上是一个项目
 * 的卡片、动作打到另一个项目；而右侧 Worker 标签带着自己打开时的项目根，不该被牵连。
 */
describe('superAgent store 项目作用域切换', () => {
  it('换根即清空中置页镜像并重绑新项目，Worker 标签镜像不受影响', async () => {
    const { superAgent } = loadStores()
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
    await superAgent.bind('D:/repo')
    mocks.queue.mockResolvedValue(queueSnapshot())
    await superAgent.loadQueue('D:/repo')
    mocks.tickets.mockResolvedValue({ repoRoot: 'D:/repo', seq: 3, tickets: [ticketCard()] })
    await superAgent.loadTickets('D:/repo')
    mocks.workerBind.mockResolvedValue(workerMirror())
    await superAgent.bindWorker('D:/repo', 'ticket-1')

    mocks.routerBind.mockResolvedValue({
      sessionId: 'router-2',
      running: false,
      snapshot: snapshot({ repoRoot: 'D:/other' }),
    })
    await superAgent.switchProject('D:/other')

    expect(superAgent.boundRepoRoot).toBe('D:/other')
    expect(superAgent.queue).toBeNull()
    expect(superAgent.ticketBoard).toBeNull()
    expect(superAgent.workerMirrors['ticket-1']).toBeTruthy()
  })

  it('同一根重复切换不再绑定', async () => {
    const { superAgent } = loadStores()
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
    await superAgent.switchProject('D:/repo')

    const callsAfterFirst = mocks.routerBind.mock.calls.length
    await superAgent.switchProject('D:/repo')

    expect(mocks.routerBind).toHaveBeenCalledTimes(callsAfterFirst)
  })

  it('关闭文件夹（空根）即退出作用域，页面不留旧项目的卡片', async () => {
    const { superAgent } = loadStores()
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
    await superAgent.bind('D:/repo')
    mocks.queue.mockResolvedValue(queueSnapshot())
    await superAgent.loadQueue('D:/repo')

    await superAgent.switchProject('')

    expect(superAgent.boundRepoRoot).toBeNull()
    expect(superAgent.boundSessionId).toBeNull()
    expect(superAgent.queue).toBeNull()
  })

  it('切换后在途的旧项目响应不得覆盖新项目的镜像', async () => {
    const { superAgent } = loadStores()
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
    await superAgent.bind('D:/repo')

    let resolveStale: (board: unknown) => void = () => {}
    mocks.tickets.mockImplementationOnce(
      () => new Promise(resolve => { resolveStale = resolve }),
    )
    const inFlight = superAgent.loadTickets('D:/repo')

    mocks.routerBind.mockResolvedValue({
      sessionId: 'router-2',
      running: false,
      snapshot: snapshot({ repoRoot: 'D:/other' }),
    })
    await superAgent.switchProject('D:/other')

    // 旧项目 A 的慢响应此刻才回来：它不属于当前绑定项目，必须整份丢弃
    resolveStale({ repoRoot: 'D:/repo', seq: 9, tickets: [ticketCard()] })
    await inFlight

    expect(superAgent.boundRepoRoot).toBe('D:/other')
    expect(superAgent.ticketBoard).toBeNull()
  })
})

describe('superAgent store state', () => {
  it('refreshes the snapshot and exposes the attention count for the badge', async () => {
    const { superAgent } = loadStores()
    await bindProject(superAgent)
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
    ticketState: 'working',
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
  it('updates an open old-project tab in the same generation without reloading its transcript', async () => {
    const { superAgent } = loadStores()
    await bindProject(superAgent)
    mocks.workerBind.mockResolvedValue(workerMirror())
    await superAgent.bindWorker('D:/repo', 'ticket-1')
    const onUpdate = mocks.onWorkerUpdated.mock.calls[0]?.[0]
    expect(onUpdate).toBeTypeOf('function')
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-2', running: false, snapshot: snapshot({ repoRoot: 'D:/other' }) })
    await superAgent.switchProject('D:/other')
    mocks.getFullSession.mockClear()
    const ready = workerMirror({ running: false, ticketState: 'review' })
    onUpdate('D:/repo', ready)
    expect(superAgent.workerMirrors['ticket-1']).toEqual(ready)
    onUpdate('D:/repo', workerMirror({ running: true, ticketState: 'working' }))
    expect(superAgent.workerMirrors['ticket-1']?.running).toBe(true)
    onUpdate('D:/other', workerMirror({ repoRoot: 'D:/other', running: false }))
    onUpdate('D:/repo', workerMirror({ ticketId: 'unopened' }))
    expect(superAgent.workerMirrors['ticket-1']?.repoRoot).toBe('D:/repo')
    expect(superAgent.workerMirrors['ticket-1']?.running).toBe(true)
    expect(superAgent.workerMirrors.unopened).toBeUndefined()
    expect(mocks.getFullSession).not.toHaveBeenCalled()
    expect(mocks.workerBind).toHaveBeenCalledTimes(1)
  })

  it('releases a failed binding so later events cannot create an unopened mirror', async () => {
    const { superAgent } = loadStores()
    const off = vi.fn()
    mocks.onWorkerUpdated.mockReturnValueOnce(off)
    mocks.workerBind.mockRejectedValueOnce(new Error('ticket not found'))
    await expect(superAgent.bindWorker('D:/repo', 'ticket-1')).rejects.toThrow('ticket not found')
    const onUpdate = mocks.onWorkerUpdated.mock.calls[0]?.[0]
    onUpdate('D:/repo', workerMirror())
    expect(superAgent.workerMirrors['ticket-1']).toBeUndefined()
    expect(off).toHaveBeenCalledOnce()
  })

  it('ignores a slow snapshot for a previous project binding of the same ticket id', async () => {
    const { superAgent } = loadStores()
    let resolveOld!: (mirror: SuperAgentWorkerMirror) => void
    mocks.workerBind.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const old = superAgent.bindWorker('D:/repo', 'ticket-1')
    const next = workerMirror({ repoRoot: 'D:/other', running: false })
    mocks.workerBind.mockResolvedValueOnce(next)
    await superAgent.bindWorker('D:/other', 'ticket-1')
    resolveOld(workerMirror())
    await old
    expect(superAgent.workerMirrors['ticket-1']).toEqual(next)
    expect(mocks.getFullSession).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a newer event with a slow bind snapshot', async () => {
    const { superAgent } = loadStores()
    let resolveSnapshot!: (mirror: SuperAgentWorkerMirror) => void
    mocks.workerBind.mockImplementationOnce(() => new Promise(resolve => { resolveSnapshot = resolve }))
    const binding = superAgent.bindWorker('D:/repo', 'ticket-1')
    const onUpdate = mocks.onWorkerUpdated.mock.calls[0]?.[0]
    expect(onUpdate).toBeTypeOf('function')
    const ready = workerMirror({ running: false, ticketState: 'review' })
    onUpdate('D:/repo', ready)
    resolveSnapshot(workerMirror())
    await binding
    expect(superAgent.workerMirrors['ticket-1']).toEqual(ready)
  })

  it('invalidates pending snapshots and events immediately on unbind, without removing a reopened tab', async () => {
    const { superAgent } = loadStores()
    const off = vi.fn()
    mocks.onWorkerUpdated.mockReturnValueOnce(off)
    let resolveSnapshot!: (mirror: SuperAgentWorkerMirror) => void
    let resolveUnbind!: (value: boolean) => void
    mocks.workerBind.mockImplementationOnce(() => new Promise(resolve => { resolveSnapshot = resolve }))
    mocks.workerUnbind.mockImplementationOnce(() => new Promise(resolve => { resolveUnbind = resolve }))
    const binding = superAgent.bindWorker('D:/repo', 'ticket-1')
    const onUpdate = mocks.onWorkerUpdated.mock.calls[0]?.[0]
    expect(onUpdate).toBeTypeOf('function')
    const unbinding = superAgent.unbindWorker('D:/repo', 'ticket-1')
    onUpdate('D:/repo', workerMirror())
    resolveSnapshot(workerMirror())
    await binding
    expect(superAgent.workerMirrors['ticket-1']).toBeUndefined()
    expect(mocks.getFullSession).not.toHaveBeenCalled()
    expect(off).toHaveBeenCalledOnce()
    mocks.workerBind.mockResolvedValueOnce(workerMirror({ running: false }))
    await superAgent.bindWorker('D:/repo', 'ticket-1')
    resolveUnbind(true)
    await unbinding
    expect(superAgent.workerMirrors['ticket-1']?.running).toBe(false)
  })

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

  it('补认派工时以普通聊天落行的 Worker 会话', async () => {
    const { superAgent, chat } = loadStores()
    // 修复前的现场：Worker 首条指派气泡把会话建成了普通聊天，侧边栏当场多出一条
    chat.createSession('修登录页', 'D:/repo', 'superagent-worker-ticket-1', { activate: false })
    mocks.workerBind.mockResolvedValue(workerMirror())

    await superAgent.bindWorker('D:/repo', 'ticket-1')

    expect(chat.sessions.find(s => s.id === 'superagent-worker-ticket-1')?.sessionType)
      .toBe('superAgentWorker')
    expect(chat.normalSessions).toEqual([])
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
    await bindProject(superAgent)
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
    await bindProject(superAgent)
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
    canStop: true,
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
    await bindProject(superAgent)
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

describe('superAgent store router conversation（T21 #91）', () => {
  it('sends through the main-process router runner, not the renderer turn', async () => {
    const { superAgent } = loadStores()
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
    mocks.routerMessage.mockResolvedValue({ sessionId: 'router-1', running: true })

    await superAgent.bind('D:/repo')
    const result = await superAgent.sendRouterMessage('D:/repo', {
      requestId: 'req-1',
      text: '帮我把登录页修好',
    })

    expect(mocks.routerMessage).toHaveBeenCalledWith('D:/repo', {
      requestId: 'req-1',
      text: '帮我把登录页修好',
    })
    expect(result.sessionId).toBe('router-1')
    expect(superAgent.routerRunning).toBe(true)
  })

  it('clears the running flag when the abort is acknowledged', async () => {
    const { superAgent } = loadStores()
    mocks.routerMessage.mockResolvedValue({ sessionId: 'router-1', running: true })
    mocks.routerAbort.mockResolvedValue(true)

    await superAgent.sendRouterMessage('D:/repo', { requestId: 'req-1', text: '干活' })
    await superAgent.abortRouter('D:/repo')

    expect(mocks.routerAbort).toHaveBeenCalledWith('D:/repo')
    expect(superAgent.routerRunning).toBe(false)
  })

  it('follows router-status only for the bound project, and stops after unsubscribe', () => {
    const { superAgent } = loadStores()
    let listener: ((repoRoot: string, router: { sessionId: string; running: boolean }) => void) | undefined
    mocks.onRouterStatus.mockImplementation((cb) => {
      listener = cb
      return () => {}
    })

    const unsubscribe = superAgent.watchRouterStatus()
    superAgent.snapshot = snapshot()

    listener?.('D:/other', { sessionId: 'router-x', running: true })
    expect(superAgent.routerRunning).toBe(false)

    listener?.('D:/repo', { sessionId: 'router-1', running: true })
    expect(superAgent.routerRunning).toBe(true)

    unsubscribe()
    expect(mocks.onRouterStatus).toHaveBeenCalledTimes(1)
  })

  it('re-reads the router transcript on bind: IM history survives a restart', async () => {
    const { superAgent, chat } = loadStores()
    mocks.routerBind.mockResolvedValue({ sessionId: 'router-1', running: false, snapshot: snapshot() })
    mocks.getFullSession.mockResolvedValue({
      messages: [
        { type: 'user', uuid: 'u1', timestamp: '2026-11-05T02:00:00.000Z', message: { role: 'user', content: '做一个考勤表' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-11-05T02:00:05.000Z', message: { role: 'assistant', content: '已派给 worker。' } },
      ],
    })

    await superAgent.bind('D:/repo')

    expect(mocks.getFullSession).toHaveBeenCalledWith('D:/repo', 'router-1', undefined)
    const contents = chat.sessions.find(s => s.id === 'router-1')!.messages.map(m => m.content)
    expect(contents).toEqual(['做一个考勤表', '已派给 worker。'])
  })

  it('re-reads the worker transcript on bindWorker: 右侧面板接的是真实转录', async () => {
    const { superAgent, chat } = loadStores()
    mocks.workerBind.mockResolvedValue(workerMirror())
    mocks.getFullSession.mockResolvedValue({
      messages: [
        { type: 'user', uuid: 'w1', timestamp: '2026-11-05T02:00:00.000Z', message: { role: 'user', content: '工单任务正文' } },
        { type: 'assistant', uuid: 'w2', timestamp: '2026-11-05T02:00:09.000Z', message: { role: 'assistant', content: '已改完。' } },
      ],
    })

    await superAgent.bindWorker('D:/repo', 'ticket-1')

    expect(mocks.getFullSession).toHaveBeenCalledWith('D:/repo', 'superagent-worker-ticket-1', undefined)
    const contents = chat.sessions.find(s => s.id === 'superagent-worker-ticket-1')!.messages.map(m => m.content)
    expect(contents).toEqual(['工单任务正文', '已改完。'])
  })
})

describe('superAgent store authorization policy（T25 #96）', () => {
  function policyView(overrides: Record<string, unknown> = {}) {
    return {
      repoRoot: 'D:/repo',
      policy: { version: 1, acceptMode: 'off', rules: [], admissions: [] },
      ...overrides,
    }
  }

  it('loads the policy mirror and delegates changes to authorizationPolicySet', async () => {
    const { superAgent } = loadStores()
    await bindProject(superAgent)

    mocks.authorizationPolicy.mockResolvedValue(policyView())
    mocks.authorizationPolicySet.mockResolvedValue({
      ...policyView({
        policy: {
          version: 2,
          acceptMode: 'observe',
          rules: [{ name: 'Guard', instruction: 'Only src/' }],
          admissions: [],
        },
      }),
      changed: true,
      discardedEvalIds: [],
    })

    const loaded = await superAgent.loadAuthorizationPolicy('D:/repo')
    expect(mocks.authorizationPolicy).toHaveBeenCalledWith('D:/repo')
    expect(loaded.policy.version).toBe(1)
    expect(superAgent.authorizationPolicy?.policy.acceptMode).toBe('off')

    const saved = await superAgent.setAuthorizationPolicy('D:/repo', {
      acceptMode: 'observe',
      rules: [{ name: 'Guard', instruction: 'Only src/' }],
    })
    expect(mocks.authorizationPolicySet).toHaveBeenCalledWith('D:/repo', {
      acceptMode: 'observe',
      rules: [{ name: 'Guard', instruction: 'Only src/' }],
    })
    expect(saved.changed).toBe(true)
    expect(superAgent.authorizationPolicy?.policy.version).toBe(2)
    expect(superAgent.authorizationPolicy?.policy.acceptMode).toBe('observe')
  })

  it('ignores policy responses from another project and clears the mirror on switch', async () => {
    const { superAgent } = loadStores()
    await bindProject(superAgent)

    mocks.authorizationPolicy.mockResolvedValue(policyView({ repoRoot: 'D:/other' }))
    await superAgent.loadAuthorizationPolicy('D:/repo')
    expect(superAgent.authorizationPolicy).toBeNull()

    mocks.authorizationPolicy.mockResolvedValue(policyView())
    await superAgent.loadAuthorizationPolicy('D:/repo')
    expect(superAgent.authorizationPolicy?.policy.version).toBe(1)

    await superAgent.switchProject('')
    expect(superAgent.authorizationPolicy).toBeNull()
  })
})
