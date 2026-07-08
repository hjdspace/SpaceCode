import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '../chatSession'
import { permissionService } from '@/services/permissionService'

// fake api + fake sink，验证 Turn 能在 seam 处被替换
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
      // 返回 resolved Promise 避免 turn.ts 中 `.catch` 在 undefined 上抛 TypeError；
      // 同时在微任务中触发 onResult 事件 settle turn，使 sendMessage 的
      // `await new Promise` 能正常 resolve（模拟引擎收到完整响应）。
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

  // 用例 2a：ensureTurn 对不存在的会话返回 settled 占位 turn
  // 验证占位对象真正满足 TurnState 接口——所有必填字段非 undefined，
  // 防止未来调用方忘记 ts.settled 早返回时访问到 undefined 字段。
  it('ensureTurn 对不存在的会话返回完整 settled turn（所有必填字段已填充）', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)

    const ts = (turn as any).ensureTurn('non-existent-sess')
    expect(ts.settled).toBe(true)
    // 所有必填字段必须存在（非 undefined），使对象真正满足 TurnState 接口
    expect(ts.assistantMessageId).not.toBeUndefined()
    expect(ts.accumulatedContent).not.toBeUndefined()
    expect(ts.currentTextEventId).toBeNull()
    expect(ts.currentReasoningEventId).toBeNull()
    expect(ts.streamingHandledThinking).toBe(false)
    expect(ts.sendStartTime).not.toBeUndefined()
    expect(ts.timeoutId).toBeNull()
    expect(ts.isAutonomous).toBe(false)
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

describe('Turn 事件订阅', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 用 fake timers 避免 autonomous turn 的 45 分钟超时定时器跨用例泄漏
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // 用例 1：onStreamEvent 到达空会话被丢弃（不创建 autonomous turn）
  it('onStreamEvent 到达空会话被丢弃（不创建 autonomous turn）', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    // 会话不存在 → ensureTurn 返回 settled → 事件丢弃
    fake._handlers.onStreamEvent({ sessionId: 'unknown', data: { type: 'content_block_start' } })
    expect(turn.getIsLoading('unknown')).toBe(false)
  })

  // 用例 2：onAssistant 到达有 user 消息的会话 → 创建 autonomous turn + appendMessage
  it('onAssistant 到达有 user 消息的会话 → 创建 autonomous turn + appendMessage', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-evt')
    sessionStore.addMessage({ role: 'user', content: 'hi' }, 'sess-evt')

    // 模拟引擎发 assistant 事件（message.content 为 Claude API 格式数组）
    fake._handlers.onAssistant({
      sessionId: 'sess-evt',
      data: { message: { id: 'msg-a', content: [{ type: 'text', text: 'hello' }] } },
    })

    expect(turn.getIsLoading('sess-evt')).toBe(true)
    const session = sessionStore.sessions.find(s => s.id === 'sess-evt')!
    // 应有 user + assistant 两条消息
    expect(session.messages.length).toBeGreaterThanOrEqual(2)
    expect(session.messages.some(m => m.role === 'assistant')).toBe(true)
  })
})

describe('Turn sendMessage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('sendMessage 创建 user message 并调用 api.claudeCode.sendMessage', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-send')
    sessionStore.selectSession('sess-send')

    await turn.sendMessage('hello world', undefined, undefined)

    const session = sessionStore.sessions.find(s => s.id === 'sess-send')!
    expect(session.messages[0].role).toBe('user')
    expect(session.messages[0].content).toBe('hello world')
    expect(fake.claudeCode.sendMessage).toHaveBeenCalledWith(
      'sess-send', 'hello world', undefined, expect.objectContaining({ clientMessageId: session.messages[0].id })
    )
  })

  it('abort 标记 userAbortedSessions 并调用 api.claudeCode.abort', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-abort')
    sessionStore.selectSession('sess-abort')

    await turn.abort()

    expect(fake.claudeCode.abort).toHaveBeenCalledWith('sess-abort')
    expect(turn.getIsLoading('sess-abort')).toBe(false)
  })

  it('sendMessage 检测到同会话已有 turn 在飞行时直接返回，不创建新 turn 也不调用 IPC', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-concurrent')
    sessionStore.selectSession('sess-concurrent')

    // 模拟已有一个 turn 在飞行
    const existingTs = (turn as any).beginTurn('sess-concurrent', { isAutonomous: false })
    try {
      const beforeMessages = sessionStore.sessions.find(s => s.id === 'sess-concurrent')!.messages.length

      await turn.sendMessage('second message', undefined, undefined)

      // user message 仍被追加，但不应调用 IPC sendMessage
      const session = sessionStore.sessions.find(s => s.id === 'sess-concurrent')!
      expect(session.messages.length).toBe(beforeMessages + 1)
      expect(session.messages[session.messages.length - 1].role).toBe('user')
      expect(session.messages[session.messages.length - 1].content).toBe('second message')
      expect(fake.claudeCode.sendMessage).not.toHaveBeenCalled()
    } finally {
      ;(turn as any).endTurn('sess-concurrent', existingTs)
    }
  })
})

describe('Turn 工具答复', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('submitToolAnswer 调用 api 并 patchToolCall 为 completed', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-tool')
    sessionStore.selectSession('sess-tool')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-tool')

    await turn.submitToolAnswer('sess-tool', msg.id, 'tc1', { path: '/a' })

    expect(fake.claudeCode.submitToolAnswer).toHaveBeenCalledWith('sess-tool', 'tc1', { path: '/a' })
    const updated = sessionStore.sessions.find(s => s.id === 'sess-tool')!.messages.find(m => m.id === msg.id)!
    expect(updated.toolCalls!.find(t => t.id === 'tc1')!.status).toBe('completed')
  })
})

describe('Turn 权限裁决', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    permissionService.clear()
  })

  it('onPermissionRequest 事件填充 pendingPermissions', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)

    fake._handlers.onPermissionRequest({
      sessionId: 'sess-perm',
      data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1', toolName2: 'Bash' },
    })

    expect(turn.hasPendingPermissionForToolUse('tu1', 'sess-perm')).toBe(true)
  })

  it('allowPermission 调用 api.allowPermission 并 patchToolCall', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-perm')
    sessionStore.selectSession('sess-perm')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tu1', name: 'Bash', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-perm')

    fake._handlers.onPermissionRequest({ sessionId: 'sess-perm', data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1' } })
    await turn.allowPermission(msg.id, 'tu1', { command: 'ls' })

    expect(fake.claudeCode.allowPermission).toHaveBeenCalledWith('sess-perm', 'req1', { command: 'ls' }, undefined)
    const updated = sessionStore.sessions.find(s => s.id === 'sess-perm')!.messages.find(m => m.id === msg.id)!
    expect(updated.toolCalls!.find(t => t.id === 'tu1')!.status).toBe('completed')
    expect(turn.hasPendingPermissionForToolUse('tu1', 'sess-perm')).toBe(false)
  })

  it('denyPermission 调用 api.denyPermission', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-perm')
    sessionStore.selectSession('sess-perm')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tu1', name: 'Bash', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-perm')

    fake._handlers.onPermissionRequest({ sessionId: 'sess-perm', data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1' } })
    await turn.denyPermission(msg.id, 'tu1', 'nope')

    expect(fake.claudeCode.denyPermission).toHaveBeenCalledWith('sess-perm', 'req1', 'nope', {})
  })

  it('allowPermission 可传入 sessionId，不依赖 currentSessionId', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-active')
    sessionStore.createSession('Test', undefined, 'sess-pane')
    sessionStore.selectSession('sess-active')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tu1', name: 'Bash', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-pane')

    fake._handlers.onPermissionRequest({ sessionId: 'sess-pane', data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1' } })
    await turn.allowPermission(msg.id, 'tu1', { command: 'ls' }, undefined, 'sess-pane')

    expect(fake.claudeCode.allowPermission).toHaveBeenCalledWith('sess-pane', 'req1', { command: 'ls' }, undefined)
    const updated = sessionStore.sessions.find(s => s.id === 'sess-pane')!.messages.find(m => m.id === msg.id)!
    expect(updated.toolCalls!.find(t => t.id === 'tu1')!.status).toBe('completed')
  })

  it('denyPermission 可传入 sessionId，不依赖 currentSessionId', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-active')
    sessionStore.createSession('Test', undefined, 'sess-pane')
    sessionStore.selectSession('sess-active')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tu1', name: 'Bash', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-pane')

    fake._handlers.onPermissionRequest({ sessionId: 'sess-pane', data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1' } })
    await turn.denyPermission(msg.id, 'tu1', 'nope', {}, 'sess-pane')

    expect(fake.claudeCode.denyPermission).toHaveBeenCalledWith('sess-pane', 'req1', 'nope', {})
  })
})

describe('Turn pending messages', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('addPendingMessage 入队后 getPendingMessages 返回该消息，recallPendingMessage 取出并从队列移除', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)

    const msg = {
      id: 'pm1',
      content: 'test pending',
      attachments: [],
      images: [],
      priority: 'later' as const,
      createdAt: Date.now(),
    }
    turn.addPendingMessage('sess-pm', msg)
    expect(turn.getPendingMessages('sess-pm')).toHaveLength(1)
    expect(turn.getPendingMessages('sess-pm')[0].id).toBe('pm1')

    const recalled = turn.recallPendingMessage('sess-pm', 'pm1')
    expect(recalled?.id).toBe('pm1')
    expect(turn.getPendingMessages('sess-pm')).toHaveLength(0)
  })

  it('removePendingMessage 按消息 id 删除条目，clearPendingMessages 清空整个会话队列', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)

    turn.addPendingMessage('sess-pm2', { id: 'm1', content: 'a', attachments: [], images: [], priority: 'later' as const, createdAt: 1 })
    turn.addPendingMessage('sess-pm2', { id: 'm2', content: 'b', attachments: [], images: [], priority: 'later' as const, createdAt: 2 })

    turn.removePendingMessage('sess-pm2', 'm1')
    expect(turn.getPendingMessages('sess-pm2')).toHaveLength(1)
    expect(turn.getPendingMessages('sess-pm2')[0].id).toBe('m2')

    // recall 不存在的消息返回 undefined，队列不变
    expect(turn.recallPendingMessage('sess-pm2', 'nope')).toBeUndefined()
    expect(turn.getPendingMessages('sess-pm2')).toHaveLength(1)

    turn.clearPendingMessages('sess-pm2')
    expect(turn.getPendingMessages('sess-pm2')).toHaveLength(0)
    // 不存在的会话也安全
    expect(turn.getPendingMessages('never')).toHaveLength(0)
  })
})
