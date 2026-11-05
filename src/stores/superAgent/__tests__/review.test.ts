/**
 * Super Agent renderer store — T10 验收/停止/追问/重试与提醒镜像契约（#80）：
 *  - reviewReminders 从卡片看板派生（state=review 且带提醒水位），同一工单只一条；
 *  - reviewRemindedCount 按工单去重联动徽章；看板未加载时回退快照计数；
 *  - acceptTicket / stopTicket / messageTicket / retryTicket 委托主进程 IPC，
 *    成功后刷新快照与看板，提醒列表随阶段变化即时收敛。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  SuperAgentSnapshot,
  SuperAgentTicketBoard,
  SuperAgentTicketCard,
} from '@/shared/channels/superAgent'
import { useSuperAgentStore } from '../index'

const mocks = vi.hoisted(() => ({
  routerBind: vi.fn(),
  state: vi.fn(),
  tickets: vi.fn(),
  queue: vi.fn(),
  ticketAccept: vi.fn(),
  ticketStop: vi.fn(),
  ticketMessage: vi.fn(),
  ticketRetry: vi.fn(),
  traceEvent: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      routerBind: mocks.routerBind,
      state: mocks.state,
      tickets: mocks.tickets,
      queue: mocks.queue,
      ticketAccept: mocks.ticketAccept,
      ticketStop: mocks.ticketStop,
      ticketMessage: mocks.ticketMessage,
      ticketRetry: mocks.ticketRetry,
    },
    claudeCode: {
      stop: vi.fn().mockResolvedValue(undefined),
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

function snapshot(reminded = 0): SuperAgentSnapshot {
  return {
    repoRoot: 'D:/repo',
    seq: 1,
    asOf: 1700000000000,
    staleAfterMs: 5000,
    router: { sessionId: 'router-1', running: false },
    attention: { unanswered: 0 },
    review: { reminded },
  }
}

function card(overrides: Partial<SuperAgentTicketCard> = {}): SuperAgentTicketCard {
  return {
    ticketId: 'ticket-1',
    title: '修复登录',
    state: 'review',
    assignmentId: 'assignment-1',
    generation: 1,
    scopePaths: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ended: null,
    reviewRemindedAt: null,
    canRetry: false,
    canStop: true,
    ...overrides,
  }
}

function board(tickets: SuperAgentTicketCard[]): SuperAgentTicketBoard {
  return { repoRoot: 'D:/repo', seq: 2, tickets }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.routerBind.mockResolvedValue({
    sessionId: 'router-1',
    running: false,
    snapshot: snapshot(0),
  })
  mocks.state.mockResolvedValue(snapshot(0))
  mocks.tickets.mockResolvedValue(board([]))
  mocks.queue.mockResolvedValue({ repoRoot: 'D:/repo', running: [], queued: [] })
  mocks.ticketAccept.mockResolvedValue({
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    outcome: 'completed',
    endedAt: '2026-01-02T00:00:00.000Z',
  })
  mocks.ticketStop.mockResolvedValue({
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    outcome: 'stopped',
    endedAt: '2026-01-02T00:00:00.000Z',
  })
  mocks.ticketMessage.mockResolvedValue({
    inputId: 'input-1',
    ticketId: 'ticket-1',
    status: 'delivered',
    delivered: true,
    gated: false,
    duplicate: false,
  })
  mocks.ticketRetry.mockResolvedValue({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-2',
    generation: 2,
    queuePosition: 1,
  })
})

describe('superAgent store review mirror', () => {
  it('derives reviewReminders from the ticket board, one bubble per ticket', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')
    // 看板未加载时回退快照计数
    expect(store.reviewRemindedCount).toBe(0)

    mocks.tickets.mockResolvedValue(
      board([
        card({ reviewRemindedAt: '2026-01-02T00:00:00.000Z' }),
        card({
          ticketId: 'ticket-2',
          title: '修复注册',
          reviewRemindedAt: '2026-01-02T00:00:00.000Z',
        }),
        // 未提醒的 review 工单不进列表
        card({ ticketId: 'ticket-3' }),
        // 已离开 review 的提醒过的工单不再提醒
        card({ ticketId: 'ticket-4', state: 'completed', reviewRemindedAt: '2026-01-02T00:00:00.000Z' }),
      ]),
    )
    await store.loadTickets('D:/repo')

    expect(store.reviewReminders.map((item) => item.ticketId)).toEqual(['ticket-1', 'ticket-2'])
    // 按工单去重，不按提醒次数计
    expect(store.reviewRemindedCount).toBe(2)
  })

  it('acceptTicket delegates to IPC and refreshes snapshot and board', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')
    mocks.tickets.mockResolvedValue(board([card({ state: 'completed', ended: { outcome: 'completed', by: 'user', reason: 'ticket-accept', at: '2026-01-02T00:00:00.000Z' } })]))

    await store.acceptTicket('D:/repo', 'ticket-1')

    expect(mocks.ticketAccept).toHaveBeenCalledWith('D:/repo', { ticketId: 'ticket-1' })
    expect(mocks.state).toHaveBeenCalledWith('D:/repo')
    expect(mocks.tickets).toHaveBeenCalledWith('D:/repo')
    // 提醒列表随阶段变化即时收敛
    expect(store.reviewReminders).toHaveLength(0)
  })

  it('stopTicket delegates to IPC and refreshes snapshot and board', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')
    mocks.tickets.mockResolvedValue(board([card({ state: 'stopped' })]))

    const result = await store.stopTicket('D:/repo', 'ticket-1')

    expect(mocks.ticketStop).toHaveBeenCalledWith('D:/repo', { ticketId: 'ticket-1' })
    expect(result.outcome).toBe('stopped')
    expect(store.reviewRemindedCount).toBe(0)
  })

  it('messageTicket delegates to IPC with the requestId idempotency key', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')

    const result = await store.messageTicket('D:/repo', {
      requestId: 'req-1',
      ticketId: 'ticket-1',
      text: '再改一版',
    })

    expect(mocks.ticketMessage).toHaveBeenCalledWith('D:/repo', {
      requestId: 'req-1',
      ticketId: 'ticket-1',
      text: '再改一版',
    })
    expect(result.delivered).toBe(true)
  })

  it('retryTicket delegates to IPC and refreshes queue alongside snapshot and board', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')

    const result = await store.retryTicket('D:/repo', 'ticket-1')

    expect(mocks.ticketRetry).toHaveBeenCalledWith('D:/repo', { ticketId: 'ticket-1' })
    expect(result.generation).toBe(2)
    expect(mocks.queue).toHaveBeenCalledWith('D:/repo')
  })
})
