import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '../chatSession'

// fake api：onSystem/onExit/onResult 等订阅捕获到 _handlers，测试里手动触发事件
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
      // 不自动触发 onResult —— 启动阶段状态要跨微任务保持可观察
      sendMessage: vi.fn().mockResolvedValue(undefined),
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

/**
 * 引擎启动阶段反馈（TTFT 优化 ④）：
 *  - system/init 的 mcp_servers 解析：失败名单入 store，starting → idle；
 *  - 发送时引擎未 init → 标记「启动中」，init 到达后撤销；
 *  - 进程退出 → 阶段标记与 MCP 结果一并作废。
 */
describe('turn store engine init feedback', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('system/init 解析 mcp_servers：失败名单可查，starting → idle', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-init-1'
    const session = sessionStore.createSession('Test', undefined, sessionId)
    session.processStatus = 'starting'

    fake._handlers.onSystem?.({
      sessionId,
      data: {
        subtype: 'init',
        mcp_servers: [
          { name: 'cdp-bridge', status: 'connected' },
          { name: 'chrome-devtools', status: 'failed' },
          { name: 'playwright', status: 'needs_authentication' },
        ],
      },
    })

    expect(turn.getMcpFailures(sessionId)).toEqual(['chrome-devtools', 'playwright'])
    expect(turn.isEngineStarting(sessionId)).toBe(false)
    expect(session.processStatus).toBe('idle')
  })

  it('全部 MCP 连接成功时失败名单为空，但「已 init」事实被记录', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-init-2'
    sessionStore.createSession('Test', undefined, sessionId)

    fake._handlers.onSystem?.({
      sessionId,
      data: { subtype: 'init', mcp_servers: [{ name: 'cdp-bridge', status: 'connected' }] },
    })

    expect(turn.getMcpFailures(sessionId)).toEqual([])
  })

  it('发送时引擎未 init → 标记启动阶段；init 到达后撤销并给出 MCP 失败名单', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-stage-1'
    sessionStore.createSession('Test', undefined, sessionId)

    const sent = turn.sendMessage('hi', undefined, undefined, { sessionId })
    // 等 init（测试环境直接早退）与 dispatch 落定
    await new Promise(r => setTimeout(r, 0))

    expect(turn.getIsLoading(sessionId)).toBe(true)
    expect(turn.isEngineStarting(sessionId)).toBe(true)

    fake._handlers.onSystem?.({
      sessionId,
      data: { subtype: 'init', mcp_servers: [{ name: 'chrome-devtools', status: 'failed' }] },
    })

    expect(turn.isEngineStarting(sessionId)).toBe(false)
    expect(turn.getMcpFailures(sessionId)).toEqual(['chrome-devtools'])

    // 收口轮次（真实引擎会发 result 事件）
    fake._handlers.onResult?.({ sessionId, data: {} })
    await sent
  })

  it('进程退出后：启动阶段标记与 MCP 结果一并作废', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-exit-1'
    sessionStore.createSession('Test', undefined, sessionId)

    const sent = turn.sendMessage('hi', undefined, undefined, { sessionId })
    await new Promise(r => setTimeout(r, 0))
    expect(turn.isEngineStarting(sessionId)).toBe(true)

    fake._handlers.onSystem?.({
      sessionId,
      data: { subtype: 'init', mcp_servers: [{ name: 'x', status: 'failed' }] },
    })
    expect(turn.getMcpFailures(sessionId)).toEqual(['x'])

    // 先收口轮次，再模拟进程退出（干净退出，不触发错误流）
    fake._handlers.onResult?.({ sessionId, data: {} })
    await sent
    expect(turn.getMcpFailures(sessionId)).toEqual(['x'])

    fake._handlers.onExit?.({ sessionId, data: { code: 0 } })

    expect(turn.isEngineStarting(sessionId)).toBe(false)
    expect(turn.getMcpFailures(sessionId)).toEqual([])
  })
})
