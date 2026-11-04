/**
 * Super Agent renderer store — Attention 镜像契约（T08 #78）：
 *  - loadAttentions 全量拉取气泡看板，attentionCount 读按工单去重的待处理数；
 *  - 气泡列表过滤 withdrawn（answered 折叠保留审计）；
 *  - attention-asked / answered / withdrawn 三事件应用全量视图（幂等），
 *    且只接受当前绑定项目的事件，退订后不再更新；
 *  - answerAttention 走 IPC 幂等命令并在成功后重拉看板；
 *  - 看板未加载时 attentionCount 回退快照 unanswered。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  SuperAgentAttentionAnswerResult,
  SuperAgentAttentionBoard,
  SuperAgentAttentionEvent,
  SuperAgentAttentionView,
} from '@/shared/channels/superAgent'
import { useSuperAgentStore } from '../index'

const mocks = vi.hoisted(() => ({
  routerBind: vi.fn(),
  state: vi.fn(),
  attentions: vi.fn(),
  attentionAnswer: vi.fn(),
  onAttentionAsked: vi.fn(() => () => {}),
  onAttentionAnswered: vi.fn(() => () => {}),
  onAttentionWithdrawn: vi.fn(() => () => {}),
  traceEvent: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      routerBind: mocks.routerBind,
      state: mocks.state,
      attentions: mocks.attentions,
      attentionAnswer: mocks.attentionAnswer,
      onAttentionAsked: mocks.onAttentionAsked,
      onAttentionAnswered: mocks.onAttentionAnswered,
      onAttentionWithdrawn: mocks.onAttentionWithdrawn,
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

function view(overrides: Partial<SuperAgentAttentionView> = {}): SuperAgentAttentionView {
  return {
    attentionId: 'attention-1',
    ticketId: 'ticket-1',
    ticketTitle: '修复登录',
    assignmentId: 'assignment-1',
    kind: 'question',
    question: '旧接口还要保留吗？',
    askedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    answers: [],
    answeredAt: null,
    ...overrides,
  }
}

function board(attentions: SuperAgentAttentionView[], pendingTickets: number): SuperAgentAttentionBoard {
  return { repoRoot: 'D:/repo', attentions, pendingTickets }
}

function event(
  reason: SuperAgentAttentionEvent['reason'],
  attentions: SuperAgentAttentionView[],
  pendingTickets: number,
): SuperAgentAttentionEvent {
  return {
    repoRoot: 'D:/repo',
    reason,
    attention: attentions[attentions.length - 1],
    attentions,
    pendingTickets,
  }
}

function captureListener(mock: ReturnType<typeof vi.fn>): (repoRoot: string, e: SuperAgentAttentionEvent) => void {
  const call = mock.mock.calls[0]
  return call[0]
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.routerBind.mockResolvedValue({
    sessionId: 'router-1',
    running: false,
    snapshot: {
      repoRoot: 'D:/repo',
      seq: 1,
      asOf: 1700000000000,
      staleAfterMs: 5000,
      router: { sessionId: 'router-1', running: false },
      attention: { unanswered: 2 },
    },
  })
})

describe('superAgent store attention mirror', () => {
  it('loads the bubble board and exposes deduped pending count and non-withdrawn bubbles', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')
    // 看板未加载时徽章回退快照
    expect(store.attentionCount).toBe(2)

    mocks.attentions.mockResolvedValue(
      board(
        [
          view({ status: 'withdrawn' }),
          view({ attentionId: 'attention-2', status: 'answered', answers: ['input-1'] }),
          view({ attentionId: 'attention-3', ticketId: 'ticket-2' }),
        ],
        2,
      ),
    )
    await store.loadAttentions('D:/repo')

    expect(store.attentionCount).toBe(2)
    // 撤回的不出现，已回答的折叠保留审计
    expect(store.attentionBubbles.map((item: SuperAgentAttentionView) => item.attentionId)).toEqual([
      'attention-2',
      'attention-3',
    ])
    expect(store.openAttentions.map((item: SuperAgentAttentionView) => item.attentionId)).toEqual([
      'attention-3',
    ])
  })

  it('applies the full view from asked/answered/withdrawn events idempotently and only for the bound repo', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')

    store.watchAttentions()
    expect(mocks.onAttentionAsked).toHaveBeenCalled()
    expect(mocks.onAttentionAnswered).toHaveBeenCalled()
    expect(mocks.onAttentionWithdrawn).toHaveBeenCalled()

    const onAsked = captureListener(mocks.onAttentionAsked)
    const onAnswered = captureListener(mocks.onAttentionAnswered)
    const onWithdrawn = captureListener(mocks.onAttentionWithdrawn)

    onAsked('D:/repo', event('asked', [view()], 1))
    expect(store.attentionCount).toBe(1)
    expect(store.attentionBubbles).toHaveLength(1)

    // 其他项目的事件不生效
    onAsked('D:/other', event('asked', [view()], 5))
    expect(store.attentionCount).toBe(1)

    onAnswered('D:/repo', event('answered', [view({ status: 'answered', answers: ['input-1'] })], 0))
    expect(store.attentionCount).toBe(0)
    expect(store.openAttentions).toHaveLength(0)
    // answered 仍保留在气泡里（审计）
    expect(store.attentionBubbles).toHaveLength(1)

    onWithdrawn('D:/repo', event('withdrawn', [view({ status: 'withdrawn' })], 0))
    expect(store.attentionBubbles).toHaveLength(0)
  })

  it('unsubscribes all three attention events', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')

    const off = store.watchAttentions()
    off()

    for (const mock of [mocks.onAttentionAsked, mocks.onAttentionAnswered, mocks.onAttentionWithdrawn]) {
      // 每个订阅 mock 返回退订函数；watchAttentions 的聚合退订调用全部三个
      const unsubscribe = mock.mock.results[0].value as () => void
      expect(() => unsubscribe()).not.toThrow()
    }
  })

  it('answers an attention through the IPC command and refreshes the board', async () => {
    const store = useSuperAgentStore()
    await store.bind('D:/repo')

    const result: SuperAgentAttentionAnswerResult = {
      attentionId: 'attention-1',
      ticketId: 'ticket-1',
      inputId: 'input-1',
      status: 'delivered',
      delivered: true,
      gated: false,
      duplicate: false,
    }
    mocks.attentionAnswer.mockResolvedValue(result)
    mocks.attentions
      .mockResolvedValueOnce(board([], 1))
      .mockResolvedValueOnce(board([view({ answers: ['input-1'] })], 1))

    const answered = await store.answerAttention('D:/repo', {
      requestId: 'answer-1',
      attentionId: 'attention-1',
      text: '保留，别删',
    })

    expect(answered).toEqual(result)
    expect(mocks.attentionAnswer).toHaveBeenCalledWith('D:/repo', {
      requestId: 'answer-1',
      attentionId: 'attention-1',
      text: '保留，别删',
    })
    // 成功后重拉看板：气泡视图立即反映已提交的回答
    expect(mocks.attentions).toHaveBeenCalledTimes(1)
    expect(store.attentionBubbles[0].answers).toEqual(['input-1'])
  })
})
