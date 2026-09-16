// tests/integration/orchestrationRun.integration.test.ts
// 集成测试 — 编排引擎 + turn store fake-api 挂具
// 验证 onResult 信号驱动节点 settle → 下游节点真的通过 sendMessage 发出草稿。
// 复用 src/stores/__tests__/turn.test.ts 的 makeFakeApi 模式。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createOrchestrationEngine } from '@/stores/orchestration'
import type { OrchestrationEngine } from '@/stores/orchestration/types'

// ── Fake API (复用 turn.test.ts 的 makeFakeApi 模式) ──

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
      sendMessage: vi.fn().mockImplementation((sid: string) => {
        // 不自动触发 onResult — 测试手动控制
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

// ── 测试 ──

describe('编排集成 — onResult 驱动节点 settle → 下游发出草稿', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('串行链 A→B：A 的 onResult 触发 settle，B 自动启动并发出草稿', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('@/stores/turn')
    const { useChatSessionStore } = await import('@/stores/chatSession')

    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()

    // 创建两个会话（模拟画布节点的 sessionId）
    const sessionA = 'orch-session-A'
    const sessionB = 'orch-session-B'
    sessionStore.createSession('Task A', undefined, sessionA)
    sessionStore.createSession('Task B', undefined, sessionB)

    // 收集 turn 结局信号
    const outcomes: Array<{ sessionId: string; outcome: string }> = []
    turn.onTurnOutcome((sid, outcome) => {
      outcomes.push({ sessionId: sid, outcome })
    })

    // 创建编排引擎，注入真实依赖
    const sendDraftCalls: Array<{ sessionId: string; draft: string }> = []
    const engine: OrchestrationEngine = createOrchestrationEngine({
      sessionLauncher: {
        createSession: async (nodeId: string) => {
          // 返回预创建的 sessionId
          return nodeId === 'A' ? sessionA : sessionB
        },
        sendDraft: async (sessionId: string, draft: string) => {
          sendDraftCalls.push({ sessionId, draft })
          // 通过 turn store 发送消息 — 触发 fake api 的 sendMessage
          await turn.sendMessage(draft, undefined, undefined, { sessionId })
        },
      },
      outcomeSource: {
        subscribe: (listener) => {
          return turn.onTurnOutcome((sessionId, outcome) => {
            listener(sessionId, outcome)
          })
        },
      },
      sessionAborter: {
        abort: async (sessionId: string) => {
          await fake.claudeCode.abort(sessionId)
        },
      },
    })

    // 搭建 A→B 串行链
    engine.addNode({ id: 'A', draft: 'task A draft' })
    engine.addNode({ id: 'B', draft: 'task B draft' })
    engine.addEdge({ source: 'A', target: 'B' })

    // 启动 Run
    const runPromise = engine.run()
    await vi.runAllTimersAsync()

    // A 应该 running，B 应该 pending
    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('B')).toBe('pending')

    // A 的草稿应该已发出
    expect(sendDraftCalls).toContainEqual({ sessionId: sessionA, draft: 'task A draft' })

    // 手动触发 A 的 onResult → A settle
    fake._handlers.onResult?.({ sessionId: sessionA, data: { result: 'done' } })
    await vi.runAllTimersAsync()

    // A 应该 settled
    expect(engine.getNodeStatus('A')).toBe('settled')

    // B 应该 running（A settle 后自动启动）
    expect(engine.getNodeStatus('B')).toBe('running')

    // B 的草稿应该已发出
    expect(sendDraftCalls).toContainEqual({ sessionId: sessionB, draft: 'task B draft' })

    // 手动触发 B 的 onResult
    fake._handlers.onResult?.({ sessionId: sessionB, data: { result: 'done' } })
    await vi.runAllTimersAsync()
    await runPromise

    // B 应该 settled
    expect(engine.getNodeStatus('B')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')

    // 验证 turn 结局信号被正确触发
    expect(outcomes).toContainEqual({ sessionId: sessionA, outcome: 'settled' })
    expect(outcomes).toContainEqual({ sessionId: sessionB, outcome: 'settled' })
  })

  it('并行分叉 A→(B,C)：A settle 后 B 和 C 同时启动', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('@/stores/turn')
    const { useChatSessionStore } = await import('@/stores/chatSession')

    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()

    const sessionA = 'orch-session-A'
    const sessionB = 'orch-session-B'
    const sessionC = 'orch-session-C'
    sessionStore.createSession('Task A', undefined, sessionA)
    sessionStore.createSession('Task B', undefined, sessionB)
    sessionStore.createSession('Task C', undefined, sessionC)

    const sendDraftCalls: Array<{ sessionId: string; draft: string }> = []
    const engine = createOrchestrationEngine({
      sessionLauncher: {
        createSession: async (nodeId: string) => {
          if (nodeId === 'A') return sessionA
          if (nodeId === 'B') return sessionB
          return sessionC
        },
        sendDraft: async (sessionId: string, draft: string) => {
          sendDraftCalls.push({ sessionId, draft })
          await turn.sendMessage(draft, undefined, undefined, { sessionId })
        },
      },
      outcomeSource: {
        subscribe: (listener) => {
          return turn.onTurnOutcome((sessionId, outcome) => {
            listener(sessionId, outcome)
          })
        },
      },
      sessionAborter: {
        abort: async (sessionId: string) => {
          await fake.claudeCode.abort(sessionId)
        },
      },
    })

    // A→(B,C) 并行分叉
    engine.addNode({ id: 'A', draft: 'root task' })
    engine.addNode({ id: 'B', draft: 'branch B' })
    engine.addNode({ id: 'C', draft: 'branch C' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'A', target: 'C' })

    const runPromise = engine.run()
    await vi.runAllTimersAsync()

    // A running, B/C pending
    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('B')).toBe('pending')
    expect(engine.getNodeStatus('C')).toBe('pending')

    // 手动触发 A 的 onResult → A settle
    fake._handlers.onResult?.({ sessionId: sessionA, data: { result: 'done' } })
    await vi.runAllTimersAsync()

    // A settle → B 和 C 同时 running
    expect(engine.getNodeStatus('A')).toBe('settled')
    expect(engine.getNodeStatus('B')).toBe('running')
    expect(engine.getNodeStatus('C')).toBe('running')

    // B 和 C 的草稿都应已发出
    expect(sendDraftCalls).toContainEqual({ sessionId: sessionB, draft: 'branch B' })
    expect(sendDraftCalls).toContainEqual({ sessionId: sessionC, draft: 'branch C' })

    // 手动触发 B 和 C 的 onResult
    fake._handlers.onResult?.({ sessionId: sessionB, data: { result: 'done' } })
    fake._handlers.onResult?.({ sessionId: sessionC, data: { result: 'done' } })
    await vi.runAllTimersAsync()
    await runPromise

    expect(engine.getNodeStatus('B')).toBe('settled')
    expect(engine.getNodeStatus('C')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')
  })
})
