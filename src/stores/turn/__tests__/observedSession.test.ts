// @vitest-environment jsdom
/**
 * 流水线观察会话在 turn store 里的边界：只做镜像，不接管流水线的引擎。
 * Seam: 真实的 turn store + chatSession store，引擎/通知在模块边界替换。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'

vi.mock('@/services/waitNotification', () => ({
  notifyWaitingForUser: vi.fn(() => 'sent'),
  notifyExtensionDialogWaiting: vi.fn(() => 'sent'),
}))

import { notifyWaitingForUser } from '@/services/waitNotification'
import { errorHandler } from '@/services/errorHandler'

const OBS = 'fac-run-1-bl-1-impl'

function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const subscribe = (key: string) => (cb: any) => {
    handlers[key] = cb
    return () => {}
  }
  return {
    claudeCode: {
      onStreamEvent: subscribe('onStreamEvent'),
      onAssistant: subscribe('onAssistant'),
      onToolUse: subscribe('onToolUse'),
      onToolResult: subscribe('onToolResult'),
      onUser: subscribe('onUser'),
      onSystem: subscribe('onSystem'),
      onResult: subscribe('onResult'),
      onExit: subscribe('onExit'),
      onError: subscribe('onError'),
      onPermissionRequest: subscribe('onPermissionRequest'),
      onPermissionRequestCancelled: subscribe('onPermissionRequestCancelled'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    artifacts: { list: vi.fn().mockResolvedValue({ artifacts: [] }) },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

type Fake = ReturnType<typeof makeFakeApi>

async function setup(messages = [{ id: 'm-1', role: 'user' as const, content: '修一下恢复顺序', timestamp: 0 }]) {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('@/stores/turn')
  const turn = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.attachObservedSession({ sessionId: OBS, title: '登录态在刷新后丢失', messages })
  return { fake, turn, sessionStore }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('observed factory sessions', () => {
  it('opens a turn on the first event even when the mirror has no messages yet', async () => {
    const { turn } = await setup([])

    const ts = (turn as any).ensureTurn(OBS)
    try {
      expect(ts.settled).toBe(false)
      expect(turn.getIsLoading(OBS)).toBe(true)
    } finally {
      ;(turn as any).endTurn(OBS, ts)
    }
  })

  it('suppresses the waiting notification for the mirror but keeps it for real sessions', async () => {
    const { fake, sessionStore } = await setup()
    sessionStore.createSession('Normal', undefined, 'sess-normal')
    sessionStore.addMessage({ role: 'user', content: 'hi' }, 'sess-normal')

    const request = (id: string) => ({
      toolUseId: `tu-${id}`,
      requestId: `req-${id}`,
      toolName: 'Bash',
      input: {},
      description: 'run',
    })
    fake._handlers.onPermissionRequest({ sessionId: OBS, data: request('obs') })
    fake._handlers.onPermissionRequest({ sessionId: 'sess-normal', data: request('normal') })

    const calls = vi.mocked(notifyWaitingForUser).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe(OBS)
    expect(calls[0][2].enabled()).toBe(false)
    expect(calls[1][2].enabled()).toBe(true)
  })

  it('does not auto-retry a 429 in the renderer — that turn belongs to the pipeline', async () => {
    const { fake, turn } = await setup()
    const classified = errorHandler.classifyError(new Error('API Error: 429 Too Many Requests'))
    expect(classified.retryable).toBe(true)

    const ts = (turn as any).ensureTurn(OBS)
    fake._handlers.onError({ sessionId: OBS, data: { message: 'API Error: 429 Too Many Requests' } })

    expect(fake.claudeCode.abort).not.toHaveBeenCalled()
    expect(turn.retryStates.has(OBS)).toBe(false)
    ;(turn as any).endTurn(OBS, ts)
  })

  it('releaseObservedSession clears local turn state without stopping the engine', async () => {
    const { fake, turn, sessionStore } = await setup()
    ;(turn as any).ensureTurn(OBS)
    expect(turn.getIsLoading(OBS)).toBe(true)

    turn.releaseObservedSession(OBS)

    expect(turn.getIsLoading(OBS)).toBe(false)
    expect(fake.claudeCode.abort).not.toHaveBeenCalled()
    expect(sessionStore.getSession(OBS)?.messages.length).toBeGreaterThan(0)
  })

  it('appends newer snapshots without overwriting live content or duplicating messages', async () => {
    const { sessionStore } = await setup()
    const session = sessionStore.getSession(OBS)!
    session.messages[0]!.content = '实时流式内容'
    const messages = [
      { id: 'm-1', role: 'user' as const, content: '旧快照', timestamp: 0 },
      { id: 'm-2', role: 'assistant' as const, content: '新回复', timestamp: 1 },
    ]

    sessionStore.attachObservedSession({ sessionId: OBS, title: '任务', messages })
    sessionStore.attachObservedSession({ sessionId: OBS, title: '任务', messages })

    expect(session.messages.map(message => message.id)).toEqual(['m-1', 'm-2'])
    expect(session.messages[0]?.content).toBe('实时流式内容')
  })
})
