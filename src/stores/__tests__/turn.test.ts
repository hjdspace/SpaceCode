import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '../chatSession'
import { permissionService } from '@/services/permissionService'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'

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

describe('Turn engine retry lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('engine auto_retry_end success clears the retry indicator state', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-engine-retry'
    sessionStore.createSession('Test', undefined, sessionId)

    vi.spyOn(errorHandler, 'classifyError').mockReturnValue({
      category: ErrorCategory.TIMEOUT,
      title: '请求超时',
      message: '请求超时',
      technicalDetail: 'request timed out',
      retryable: true,
      originalError: new Error('request timed out'),
      timestamp: Date.now(),
    })

    ;(turn as any).beginTurn(sessionId, { isAutonomous: false })
    fake._handlers.onError?.({ sessionId, data: { message: 'request timed out' } })
    await Promise.resolve()

    const retryStates = () => turn.retryStates as unknown as Map<string, unknown>
    expect(retryStates().has(sessionId)).toBe(true)

    fake._handlers.onSystem?.({
      sessionId,
      data: { subtype: 'auto_retry_end', success: true, attempt: 1 },
    })

    expect(retryStates().has(sessionId)).toBe(false)

    await vi.runAllTimersAsync()
  })

  it('late successful result clears retry state even when the old turn is settled', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    const sessionId = 'sess-late-result'
    sessionStore.createSession('Test', undefined, sessionId)

    vi.spyOn(errorHandler, 'classifyError').mockReturnValue({
      category: ErrorCategory.TIMEOUT,
      title: '请求超时',
      message: '请求超时',
      technicalDetail: 'request timed out',
      retryable: true,
      originalError: new Error('request timed out'),
      timestamp: Date.now(),
    })

    ;(turn as any).beginTurn(sessionId, { isAutonomous: false })
    fake._handlers.onError?.({ sessionId, data: { message: 'request timed out' } })
    await Promise.resolve()
    expect((turn.retryStates as unknown as Map<string, unknown>).has(sessionId)).toBe(true)

    fake._handlers.onResult?.({ sessionId, data: { result: 'reconnected response' } })

    expect((turn.retryStates as unknown as Map<string, unknown>).has(sessionId)).toBe(false)
    await vi.runAllTimersAsync()
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
      // 清理测试创建的 turn
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
    // 控制流式内容批量更新的定时器
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

  it('合并后台积压的 text_delta 写回，避免恢复窗口时逐条刷新消息', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-stream-burst')
    sessionStore.addMessage({ role: 'user', content: 'hello' }, 'sess-stream-burst')
    const updateMessageSpy = vi.spyOn(sessionStore, 'updateMessage')

    fake._handlers.onStreamEvent({
      sessionId: 'sess-stream-burst',
      data: { event: { type: 'content_block_start', content_block: { type: 'text' } } },
    })
    for (let i = 0; i < 100; i++) {
      fake._handlers.onStreamEvent({
        sessionId: 'sess-stream-burst',
        data: { event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
      })
    }

    vi.advanceTimersByTime(50)
    await Promise.resolve()

    const session = sessionStore.sessions.find(s => s.id === 'sess-stream-burst')!
    const assistant = session.messages.find(message => message.role === 'assistant')!
    expect(assistant.content).toBe('x'.repeat(100))
    expect(updateMessageSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the session active when the process exits before the turn result', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-exit-before-result')
    sessionStore.addMessage({ role: 'user', content: 'hello world' }, 'sess-exit-before-result')

    const ts = (turn as any).beginTurn('sess-exit-before-result', { isAutonomous: false })

    const session = sessionStore.sessions.find(s => s.id === 'sess-exit-before-result')!
    expect(session.processStatus).toBe('active')
    expect(turn.getIsLoading('sess-exit-before-result')).toBe(true)

    fake._handlers.onExit({ sessionId: 'sess-exit-before-result', data: 0 })

    expect(session.processStatus).toBe('active')
    expect(turn.getIsLoading('sess-exit-before-result')).toBe(true)

    fake._handlers.onResult({ sessionId: 'sess-exit-before-result', data: { result: 'done' } })

    expect(session.processStatus).toBe('idle')
    expect(turn.getIsLoading('sess-exit-before-result')).toBe(false)
    ;(turn as any).endTurn('sess-exit-before-result', ts)
  })
})

describe('Turn 工具输入流式提取 (Write 卡片逐行渲染数据源)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 模拟一次工具调用的 stream_event（partial_json 为原始 JSON 文本，代码以 \n 转义传输） */
  function fireToolStreamEvent(
    fake: ReturnType<typeof makeFakeApi>,
    sessionId: string,
    ev: { type: string; content_block?: any; delta?: any },
  ) {
    fake._handlers.onStreamEvent({ sessionId, data: { event: ev } })
  }

  it('input_json_delta 节流提取 content 字段并完整反转义换行，流式期间逐行可见', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-write-stream')
    sessionStore.addMessage({ role: 'user', content: 'write a file' }, 'sess-write-stream')

    fireToolStreamEvent(fake, 'sess-write-stream', {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-w1', name: 'Write' },
    })
    fireToolStreamEvent(fake, 'sess-write-stream', {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"/tmp/a.ts","content":"const a = 1\\nconst b = 2' },
    })

    const getTool = () => sessionStore.sessions
      .find(s => s.id === 'sess-write-stream')!
      .messages.find(m => m.role === 'assistant')!
      .toolCalls?.find(tc => tc.id === 'tu-w1')

    // 工具卡片在 content_block_start 时即创建
    expect(getTool()).toBeTruthy()
    // 节流窗口（100ms）内尚未写入
    expect(getTool()?.input.content).toBeUndefined()

    vi.advanceTimersByTime(100)

    // content 提取 + \n 反转义（否则整段代码会挤成一行，无法逐行流式渲染）
    expect(getTool()?.input.file_path).toBe('/tmp/a.ts')
    expect(getTool()?.input.content).toBe('const a = 1\nconst b = 2')
  })

  it('content_block_stop 用完整 JSON 覆盖部分提取，迟到的节流刷新不回退完整 input', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-write-stream-2')
    sessionStore.addMessage({ role: 'user', content: 'write a file' }, 'sess-write-stream-2')

    fireToolStreamEvent(fake, 'sess-write-stream-2', {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-w2', name: 'Write' },
    })
    fireToolStreamEvent(fake, 'sess-write-stream-2', {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"/tmp/b.ts","content":"par' },
    })
    fireToolStreamEvent(fake, 'sess-write-stream-2', {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: 'tial code"}' },
    })
    fireToolStreamEvent(fake, 'sess-write-stream-2', { type: 'content_block_stop' })

    const getTool = () => sessionStore.sessions
      .find(s => s.id === 'sess-write-stream-2')!
      .messages.find(m => m.role === 'assistant')!
      .toolCalls?.find(tc => tc.id === 'tu-w2')

    // stop 时整体解析完整 JSON，立即生效
    expect(getTool()?.input).toEqual({ file_path: '/tmp/b.ts', content: 'partial code' })

    // 已排程的节流 flush 到期后不得用陈旧分片覆盖完整 input
    vi.advanceTimersByTime(300)
    expect(getTool()?.input).toEqual({ file_path: '/tmp/b.ts', content: 'partial code' })
  })

  it('部分值末尾挂着不完整的转义序列时安全解码', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-write-stream-3')
    sessionStore.addMessage({ role: 'user', content: 'write a file' }, 'sess-write-stream-3')

    fireToolStreamEvent(fake, 'sess-write-stream-3', {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-w3', name: 'Write' },
    })
    // 值以落单的反斜杠结尾（转义序列尚未传完）
    fireToolStreamEvent(fake, 'sess-write-stream-3', {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"content":"abc\\' },
    })

    vi.advanceTimersByTime(100)

    const tool = sessionStore.sessions
      .find(s => s.id === 'sess-write-stream-3')!
      .messages.find(m => m.role === 'assistant')!
      .toolCalls?.find(tc => tc.id === 'tu-w3')
    expect(tool?.input.content).toBe('abc')
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

describe('Turn 生命周期边界场景', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  // 用例 4：abort 后残留事件不创建 autonomous turn
  // 验证 userAbortedSessions 守卫：abort 后到达的 onToolUse 事件应被 ensureTurn 丢弃，
  // 不创建 autonomous turn，也不追加 assistant 消息（防止会话「自动恢复运行」）。
  it('abort 后残留 onToolUse 事件不创建 autonomous turn', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-a')
    sessionStore.selectSession('sess-a')
    sessionStore.addMessage({ role: 'user', content: 'hi' }, 'sess-a')

    await turn.abort()  // 标记 userAbortedSessions

    // 模拟 abort 后引擎残留事件
    fake._handlers.onToolUse({ sessionId: 'sess-a', data: { id: 'tu1', name: 'Bash', input: {} } })
    // 不应创建 turn，不应 appendMessage
    expect(turn.getIsLoading('sess-a')).toBe(false)
    const session = sessionStore.sessions.find(s => s.id === 'sess-a')!
    // 不应有新的 assistant 消息（只有原本的 user 消息）
    expect(session.messages.filter(m => m.role === 'assistant')).toHaveLength(0)
  })

  // 用例 5：并发多 turn 互不污染
  // 验证多 sessionId 场景下 sendMessage 各自写入对应会话，不串扰。
  it('两个 sessionId 同时 sendMessage 互不污染', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'sess-a')
    sessionStore.createSession('B', undefined, 'sess-b')

    // sendMessage 使用 currentSessionId，需在发送前切换
    sessionStore.selectSession('sess-a')
    await turn.sendMessage('msg-a', undefined, undefined)
    sessionStore.selectSession('sess-b')
    await turn.sendMessage('msg-b', undefined, undefined)

    const sessionA = sessionStore.sessions.find(s => s.id === 'sess-a')!
    const sessionB = sessionStore.sessions.find(s => s.id === 'sess-b')!
    expect(sessionA.messages[0].content).toBe('msg-a')
    expect(sessionB.messages[0].content).toBe('msg-b')
    // 互不污染：A 中不含 msg-b，B 中不含 msg-a
    expect(sessionA.messages.some(m => m.content === 'msg-b')).toBe(false)
    expect(sessionB.messages.some(m => m.content === 'msg-a')).toBe(false)
  })

  // 用例 6（简化版）：auto-retry API 存在性
  // 完整 429 自动重试状态机涉及 fake timers + 退避 + 引擎重启，过于复杂；
  // 此处验证 retryStates 初始为空 Map 且 cancelRetry 为可调用函数，
  // 至少覆盖 auto-retry 公共 API 的存在性与初始状态。
  it('retryStates 初始为空 Map，cancelRetry 是可调用函数', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    // retryStates 在 Pinia setup store 中可能被 unwrap 为 Map，也可能保留为 Ref<Map>
    const rs: any = turn.retryStates
    const map = rs instanceof Map ? rs : rs?.value
    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(0)
    expect(typeof turn.cancelRetry).toBe('function')
  })

  it('完成汇总使用本轮流式响应的实际模型，而不是设置中的当前模型', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-model-meta')
    sessionStore.addMessage({ role: 'user', content: 'which model?' }, 'sess-model-meta')

    // message_start 是引擎报告本轮实际模型的权威事件；随后 result 触发完成汇总。
    fake._handlers.onStreamEvent({
      sessionId: 'sess-model-meta',
      data: { type: 'message_start', message: { model: 'deepseek-v4-flash' } },
    })
    fake._handlers.onResult({
      sessionId: 'sess-model-meta',
      data: { result: 'I am DeepSeek', usage: { input_tokens: 10, output_tokens: 4 } },
    })

    const session = sessionStore.sessions.find(s => s.id === 'sess-model-meta')!
    const assistant = session.messages.find(message => message.role === 'assistant')
    expect(assistant?.metadata?.model).toBe('deepseek-v4-flash')
  })
})

describe('Turn 长时间等待', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([false, true])('无事件不会自动结束 turn（isAutonomous=%s）', async (isAutonomous) => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-to')

    const resolve = vi.fn()
    const ts = turn.beginTurn('sess-to', { isAutonomous, resolve })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(ts.settled).toBe(false)
    expect(turn.getIsLoading('sess-to')).toBe(true)
    expect(resolve).not.toHaveBeenCalled()
    expect(fake.claudeCode.abort).not.toHaveBeenCalled()
    const session = sessionStore.sessions.find(s => s.id === 'sess-to')!
    expect(session.processStatus).toBe('active')

    fake._handlers.onResult({ sessionId: 'sess-to', data: { result: 'done' } })
    expect(turn.getIsLoading('sess-to')).toBe(false)
    expect(resolve).toHaveBeenCalledOnce()
    expect(session.processStatus).toBe('idle')
  })

  it.each([false, true])('提问在后续流事件到达后仍无限等待，回答后继续原轮次（permission=%s）', async (withPermission) => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessions = useChatSessionStore()
    const sid = 'sess-question-wait'
    sessions.createSession('Test', undefined, sid)
    const resolve = vi.fn()
    const ts = turn.beginTurn(sid, { isAutonomous: false, resolve })
    const input = { questions: [{ question: 'Which path?', header: 'Path', options: [{ label: 'A', description: 'Path A' }], multiSelect: false }] }
    fake._handlers.onToolUse({ sessionId: sid, data: { id: 'question-1', name: 'AskUserQuestion', input } })
    if (withPermission) {
      fake._handlers.onPermissionRequest({ sessionId: sid, data: { requestId: 'req-wait', toolUseId: 'question-1', toolName: 'AskUserQuestion', input } })
    }
    // CLI 可在权限请求后发送剩余流事件，不能因此重新启用自动结算。
    fake._handlers.onStreamEvent({ sessionId: sid, data: { type: 'message_stop' } })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(ts.settled).toBe(false)
    expect(turn.getIsLoading(sid)).toBe(true)
    expect(resolve).not.toHaveBeenCalled()
    const session = sessions.sessions.find(s => s.id === sid)!
    const message = session.messages.find(m => m.id === ts.assistantMessageId)!
    expect(message.toolCalls?.find(tc => tc.id === 'question-1')?.status).not.toBe('completed')
    expect(fake.claudeCode.abort).not.toHaveBeenCalled()
    expect(fake.claudeCode.skipToolAnswer).not.toHaveBeenCalled()

    const answers = { 'Which path?': 'A' }
    if (withPermission) {
      const updatedInput = { ...input, answers }
      await turn.allowPermission(ts.assistantMessageId, 'question-1', updatedInput, undefined, sid)
      expect(fake.claudeCode.allowPermission).toHaveBeenCalledWith(sid, 'req-wait', updatedInput, undefined)
      expect(turn.hasPendingPermissionForToolUse('question-1', sid)).toBe(false)
    } else {
      await turn.submitToolAnswer(sid, ts.assistantMessageId, 'question-1', answers)
      expect(fake.claudeCode.submitToolAnswer).toHaveBeenCalledWith(sid, 'question-1', answers)
    }
    expect(ts.settled).toBe(false)
    fake._handlers.onResult({ sessionId: sid, data: { result: 'continued' } })
    expect(turn.getIsLoading(sid)).toBe(false)
    expect(resolve).toHaveBeenCalledOnce()
    permissionService.consumePermissionFor('question-1', sid)
  })

  it('长时间等待后仍可主动停止，残留流事件不会重启会话', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessions = useChatSessionStore()
    const sid = 'sess-wait-abort'
    sessions.createSession('Test', undefined, sid)
    sessions.currentSessionId = sid
    const resolve = vi.fn()
    const ts = turn.beginTurn(sid, { isAutonomous: false, resolve })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(turn.getIsLoading(sid)).toBe(true)

    await turn.abort()
    expect(fake.claudeCode.abort).toHaveBeenCalledWith(sid)
    expect(ts.settled).toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    fake._handlers.onStreamEvent({ sessionId: sid, data: { type: 'message_stop' } })
    expect(turn.getIsLoading(sid)).toBe(false)
    expect(sessions.sessions.find(s => s.id === sid)?.messages).toHaveLength(1)
  })
})
