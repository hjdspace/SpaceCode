import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '../chatSession'

// fake api + fake sink，验证 Turn 能在 seam 处被替换
function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    claudeCode: {
      onStreamEvent: (cb: any) => { handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { handlers.onToolResult = cb; return () => {} },
      onResult: (cb: any) => { handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { handlers.onError = cb; return () => {} },
      onPermissionRequest: (cb: any) => { handlers.onPermissionRequest = cb; return () => {} },
      onPermissionRequestCancelled: (cb: any) => { handlers.onPermissionRequestCancelled = cb; return () => {} },
      sendMessage: vi.fn(),
      abort: vi.fn(),
      allowPermission: vi.fn(),
      denyPermission: vi.fn(),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

describe('useTurnStore skeleton', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('can be constructed with a fake api', async () => {
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(makeFakeApi() as any)
    expect(turn).toBeTruthy()
    expect(typeof turn.sendMessage).toBe('function')
    expect(typeof turn.abort).toBe('function')
    expect(typeof turn.allowPermission).toBe('function')
  })
})

describe('TurnState machine', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  // 用例 1：beginTurn 创建 turn 并 appendMessage 一条空 assistant 消息
  it('beginTurn 创建 turn 并 appendMessage 一条空 assistant 消息，并标记 loading', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-1')

    // beginTurn 当前作为内部函数在 return 块导出（测试用，迁移完成后移除）
    const ts = (turn as any).beginTurn('sess-1', { isAutonomous: false })
    try {
      const session = sessionStore.sessions.find(s => s.id === 'sess-1')!
      expect(session.messages.length).toBe(1)
      expect(session.messages[0].role).toBe('assistant')
      expect(session.messages[0].content).toBe('')
      expect(turn.getIsLoading('sess-1')).toBe(true)
      // 自主标志按入参
      expect(ts.isAutonomous).toBe(false)
      expect(ts.settled).toBe(false)
      expect(ts.assistantMessageId).toBe(session.messages[0].id)
    } finally {
      // 清理超时定时器，避免泄漏到后续用例
      ;(turn as any).endTurn('sess-1', ts)
    }
  })

  // 用例 2：ensureTurn 对无消息的空会话返回 settled（不创建 turn）
  it('ensureTurn 对无消息的空会话返回 settled，不创建 turn', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-2')

    const ts = (turn as any).ensureTurn('sess-2')
    expect(ts.settled).toBe(true)
    expect(turn.getIsLoading('sess-2')).toBe(false)
    // 会话本身不应被追加 assistant 消息
    const session = sessionStore.sessions.find(s => s.id === 'sess-2')!
    expect(session.messages.length).toBe(0)
  })

  // 用例 3：ensureTurn 对有 user 消息的会话创建 autonomous turn
  it('ensureTurn 对有 user 消息的会话创建 autonomous turn', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-3')
    // 先塞一条 user 消息，使 ensureTurn 走 beginTurn 路径
    sessionStore.addMessage({ role: 'user', content: 'hi' }, 'sess-3')

    const ts = (turn as any).ensureTurn('sess-3')
    try {
      expect(ts.settled).toBe(false)
      expect(ts.isAutonomous).toBe(true)
      expect(turn.getIsLoading('sess-3')).toBe(true)
      // beginTurn 应追加一条 assistant 消息（已有 1 条 user + 1 条 assistant = 2）
      const session = sessionStore.sessions.find(s => s.id === 'sess-3')!
      expect(session.messages.length).toBe(2)
      expect(session.messages[1].role).toBe('assistant')
    } finally {
      ;(turn as any).endTurn('sess-3', ts)
    }
  })
})
