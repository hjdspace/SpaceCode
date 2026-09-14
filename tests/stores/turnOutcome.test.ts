// tests/stores/turnOutcome.test.ts
// turn store 结局订阅点测试 — 验证 settled/failed/aborted 三类信号
// 复用 src/stores/__tests__/turn.test.ts 的 makeFakeApi 模式

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'

function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    claudeCode: {
      onStreamEvent: (cb: any) => { handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { handlers.onToolResult = cb; return () => {} },
      onUser: (cb: any) => { handlers.onUser = cb; return () => {} },
      onSystem: (cb: any) => { handlers.onSystem = cb; return () => {} },
      onResult: (cb: any) => { handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { handlers.onError = cb; return () => {} },
      onPermissionRequest: (cb: any) => { handlers.onPermissionRequest = cb; return () => {} },
      onPermissionRequestCancelled: (cb: any) => { handlers.onPermissionRequestCancelled = cb; return () => {} },
      sendMessage: vi.fn().mockImplementation((sid: string, ...args: any[]) => {
        queueMicrotask(() => handlers.onResult?.({ sessionId: sid, data: {} }))
        return Promise.resolve(undefined)
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

describe('turn store — 结局订阅点 onTurnOutcome', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('settled: onResult 触发 onTurnOutcome(sessionId, "settled")', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('@/stores/turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-settled'
    sessionStore.createSession('Test', undefined, sessionId)

    // 订阅 turn 结局
    const outcomes: Array<{ sessionId: string; outcome: string }> = []
    const unsub = turn.onTurnOutcome((sid, outcome) => {
      outcomes.push({ sessionId: sid, outcome })
    })

    // 发送消息 → fake api 会在微任务中触发 onResult
    await turn.sendMessage('hello', undefined, undefined, { sessionId })
    await vi.runAllTimersAsync()

    expect(outcomes).toContainEqual({ sessionId, outcome: 'settled' })
    unsub()
  })

  it('failed: onError 触发 onTurnOutcome(sessionId, "failed")', async () => {
    // 覆盖 sendMessage 不触发 onResult
    const fake = makeFakeApi()
    vi.mocked(fake.claudeCode.sendMessage).mockImplementation((sid: string) => {
      queueMicrotask(() => fake._handlers.onError?.({ sessionId: sid, data: { message: 'crash' } }))
      return Promise.resolve(undefined)
    })

    vi.spyOn(errorHandler, 'classifyError').mockReturnValue({
      category: ErrorCategory.PROCESS_ERROR,
      title: 'Runtime error',
      message: 'Runtime error',
      technicalDetail: 'crash',
      retryable: false,
      originalError: new Error('crash'),
      timestamp: Date.now(),
    })

    const { useTurnStore } = await import('@/stores/turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-failed'
    sessionStore.createSession('Test', undefined, sessionId)

    const outcomes: Array<{ sessionId: string; outcome: string }> = []
    turn.onTurnOutcome((sid, outcome) => {
      outcomes.push({ sessionId: sid, outcome })
    })

    await turn.sendMessage('hello', undefined, undefined, { sessionId }).catch(() => {})
    await vi.runAllTimersAsync()

    expect(outcomes).toContainEqual({ sessionId, outcome: 'failed' })
  })

  it('aborted: 用户中止触发 onTurnOutcome(sessionId, "aborted")', async () => {
    const fake = makeFakeApi()
    // sendMessage 不触发 onResult（模拟 turn 进行中用户中止）
    vi.mocked(fake.claudeCode.sendMessage).mockResolvedValue(undefined)

    const { useTurnStore } = await import('@/stores/turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-aborted'
    sessionStore.createSession('Test', undefined, sessionId)
    sessionStore.selectSession(sessionId)

    const outcomes: Array<{ sessionId: string; outcome: string }> = []
    turn.onTurnOutcome((sid, outcome) => {
      outcomes.push({ sessionId: sid, outcome })
    })

    // 手动创建一个 turn（模拟 turn 进行中）
    ;(turn as any).beginTurn(sessionId, { isAutonomous: false })
    // 标记用户中止（abort 内部会检查）
    await turn.abort()
    await vi.runAllTimersAsync()

    expect(outcomes).toContainEqual({ sessionId, outcome: 'aborted' })
  })

  it('unsubscribe 停止接收信号', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('@/stores/turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId1 = 'sess-unsub-1'
    const sessionId2 = 'sess-unsub-2'
    sessionStore.createSession('Test', undefined, sessionId1)
    sessionStore.createSession('Test', undefined, sessionId2)

    const outcomes: string[] = []
    const unsub = turn.onTurnOutcome((sid) => {
      outcomes.push(sid)
    })

    await turn.sendMessage('hello', undefined, undefined, { sessionId: sessionId1 })
    await vi.runAllTimersAsync()

    unsub()

    await turn.sendMessage('world', undefined, undefined, { sessionId: sessionId2 })
    await vi.runAllTimersAsync()

    expect(outcomes).toEqual([sessionId1])
  })
})
