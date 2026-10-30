import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSessionStore } from '../chatSession'

const mockState = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: { sessionId: string; data: any }) => void>,
  traceEvent: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      onStreamEvent: (cb: any) => { mockState.handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { mockState.handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { mockState.handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { mockState.handlers.onToolResult = cb; return () => {} },
      onUser: (cb: any) => { mockState.handlers.onUser = cb; return () => {} },
      onSystem: (cb: any) => { mockState.handlers.onSystem = cb; return () => {} },
      onResult: (cb: any) => { mockState.handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { mockState.handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { mockState.handlers.onError = cb; return () => {} },
    },
    image: null,
    trace: { event: mockState.traceEvent },
    getCwd: vi.fn().mockResolvedValue('D:/repo'),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(''),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('turn H5 remote user events', () => {
  function stubCryptoWithoutRandomUUID() {
    let nextByte = 1
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((array: Uint8Array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = nextByte++ & 0xff
        }
        return array
      }),
    })
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    mockState.traceEvent.mockClear()
    for (const key of Object.keys(mockState.handlers)) delete mockState.handlers[key]
    vi.useFakeTimers()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2)}`),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('adds the H5 user bubble and starts an assistant turn for the target session', async () => {
    const { useTurnStore } = await import('../turn')
    const turnStore = useTurnStore()
    const sessionStore = useChatSessionStore()

    mockState.handlers.onUser({
      sessionId: 'h5-session',
      data: {
        __h5RemoteUserMessage: true,
        messageId: 'h5-user-message',
        content: 'hello from phone',
        projectPath: 'D:/repo',
        title: 'hello from phone',
        timestamp: Date.now(),
      },
    })

    const session = sessionStore.sessions.find(s => s.id === 'h5-session')
    expect(session).toBeTruthy()
    expect(session?.workingDirectory).toBe('D:/repo')
    expect(session?.messages[0]).toMatchObject({
      id: 'h5-user-message',
      role: 'user',
      content: 'hello from phone',
    })
    expect(session?.messages[1]).toMatchObject({ role: 'assistant', content: '' })
    expect(turnStore.getIsLoading('h5-session')).toBe(true)
    // 手机端消息保持原有行为：新会话直接切到前台
    expect(sessionStore.currentSessionId).toBe('h5-session')
  })

  interface RevealDetail {
    sessionId: string
    title: string
    projectPath: string | null
  }

  /** App.vue 靠这个事件把中央面板切到会话页签；后台触发方不该抢到用户眼前。 */
  function recordReveals(): { details: RevealDetail[]; stop: () => void } {
    const details: RevealDetail[] = []
    const listener = (event: Event) => details.push((event as CustomEvent<RevealDetail>).detail)
    window.addEventListener('h5-remote-user-message', listener)
    return { details, stop: () => window.removeEventListener('h5-remote-user-message', listener) }
  }

  it('activate:false 只把会话落进列表，不抢走用户正在看的会话', async () => {
    const { useTurnStore } = await import('../turn')
    const turnStore = useTurnStore()
    const sessionStore = useChatSessionStore()
    const main = sessionStore.createSession('主会话', 'D:/repo')
    const reveals = recordReveals()

    mockState.handlers.onUser({
      sessionId: 'cron-session',
      data: {
        __h5RemoteUserMessage: true,
        messageId: null,
        content: '分析当前项目依赖',
        projectPath: 'D:/repo',
        title: '依赖巡检',
        timestamp: Date.now(),
        activate: false,
      },
    })

    const cronSession = sessionStore.sessions.find(s => s.id === 'cron-session')
    expect(cronSession?.title).toBe('依赖巡检')
    expect(cronSession?.messages[0]).toMatchObject({ role: 'user', content: '分析当前项目依赖' })
    expect(turnStore.getIsLoading('cron-session')).toBe(true)
    expect(sessionStore.currentSessionId).toBe(main.id)
    expect(reveals.details).toEqual([])
    reveals.stop()
  })

  it('手机端消息仍会请求把会话切到前台', async () => {
    const { useTurnStore } = await import('../turn')
    useTurnStore()
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('主会话', 'D:/repo')
    const reveals = recordReveals()

    mockState.handlers.onUser({
      sessionId: 'phone-session',
      data: {
        __h5RemoteUserMessage: true,
        messageId: null,
        content: 'hello from phone',
        projectPath: 'D:/repo',
        title: 'hello from phone',
        timestamp: Date.now(),
      },
    })

    expect(reveals.details).toEqual([
      { sessionId: 'phone-session', title: 'hello from phone', projectPath: 'D:/repo' },
    ])
    reveals.stop()
  })

  it('activate:false 推到已有会话时也不切换当前会话', async () => {
    const { useTurnStore } = await import('../turn')
    const turnStore = useTurnStore()
    const sessionStore = useChatSessionStore()
    const main = sessionStore.createSession('主会话', 'D:/repo')
    const takeover = sessionStore.createSession('接管 · 任务 1', 'D:/repo', 'fac-run-1-bl-1-takeover', { activate: false })
    const reveals = recordReveals()

    mockState.handlers.onUser({
      sessionId: 'fac-run-1-bl-1-takeover',
      data: {
        __h5RemoteUserMessage: true,
        messageId: null,
        content: '继续处理',
        projectPath: 'D:/repo',
        title: '接管 · 任务 1',
        timestamp: Date.now(),
        activate: false,
      },
    })

    expect(sessionStore.currentSessionId).toBe(main.id)
    expect(sessionStore.getSession(takeover.id)?.messages.map((m) => m.content)).toContain('继续处理')
    expect(turnStore.getIsLoading(takeover.id)).toBe(true)
    expect(reveals.details).toEqual([])
    reveals.stop()
  })

  it('payload 带 model 时写进会话记录，输入框与续话都沿用任务模型', async () => {
    const { useTurnStore } = await import('../turn')
    const turnStore = useTurnStore()
    const sessionStore = useChatSessionStore()

    mockState.handlers.onUser({
      sessionId: 'cron-model-session',
      data: {
        __h5RemoteUserMessage: true,
        messageId: null,
        content: '整理今日构建失败',
        projectPath: 'D:/repo',
        title: '构建巡检',
        timestamp: Date.now(),
        activate: false,
        model: 'deepseek-v4-flash',
      },
    })

    expect(sessionStore.sessions.find(s => s.id === 'cron-model-session')?.model).toBe('deepseek-v4-flash')
    expect(turnStore.getIsLoading('cron-model-session')).toBe(true)
  })

  it('payload 带 permissionMode 时写进会话记录，会话不被全局默认档降级', async () => {
    const { useTurnStore } = await import('../turn')
    const { usePermissionPolicyStore } = await import('../permissionPolicy')
    const { useSettingsStore } = await import('../settings')
    useTurnStore()
    const sessionStore = useChatSessionStore()
    // 全局档故意与推送档不同：会话记录没拿到模式时，对账就会拿这一档去改正在跑的引擎。
    useSettingsStore().permissionMode = 'plan'

    mockState.handlers.onUser({
      sessionId: 'fac-run-1-bl-1-takeover',
      data: {
        __h5RemoteUserMessage: true,
        messageId: null,
        content: '你已接管流水线任务「任务 1」。',
        projectPath: 'D:/repo',
        title: '接管 · 任务 1',
        timestamp: Date.now(),
        activate: false,
        permissionMode: 'bypassPermissions',
      },
    })

    const policy = usePermissionPolicyStore()
    expect(sessionStore.getSession('fac-run-1-bl-1-takeover')?.permissionMode).toBe('bypassPermissions')
    expect(policy.getPermissionMode('fac-run-1-bl-1-takeover')).toBe('bypassPermissions')
  })

  it('用户在面板里自己切过模式后，重复推送不改写他的选择', async () => {
    const { useTurnStore } = await import('../turn')
    useTurnStore()
    const sessionStore = useChatSessionStore()
    const push = (permissionMode: string) =>
      mockState.handlers.onUser({
        sessionId: 'fac-run-1-bl-2-takeover',
        data: {
          __h5RemoteUserMessage: true,
          messageId: null,
          content: '接管简报',
          projectPath: 'D:/repo',
          title: '接管 · 任务 2',
          timestamp: Date.now(),
          activate: false,
          permissionMode,
        },
      })

    push('bypassPermissions')
    sessionStore.getSession('fac-run-1-bl-2-takeover')!.permissionMode = 'acceptEdits'
    push('bypassPermissions')

    expect(sessionStore.getSession('fac-run-1-bl-2-takeover')?.permissionMode).toBe('acceptEdits')
  })

  it('can create a phone-side session when crypto.randomUUID is unavailable', () => {
    stubCryptoWithoutRandomUUID()
    const sessionStore = useChatSessionStore()

    const session = sessionStore.createSession('New Chat', 'D:/repo')

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(sessionStore.currentSessionId).toBe(session.id)
  })

  it('handles H5 remote user events when crypto.randomUUID is unavailable', async () => {
    stubCryptoWithoutRandomUUID()
    const { useTurnStore } = await import('../turn')
    const turnStore = useTurnStore()
    const sessionStore = useChatSessionStore()

    expect(() => {
      mockState.handlers.onUser({
        sessionId: 'h5-session-no-random-uuid',
        data: {
          __h5RemoteUserMessage: true,
          messageId: 'h5-user-message-no-random-uuid',
          content: 'hello from phone without randomUUID',
          projectPath: 'D:/repo',
          title: 'hello from phone without randomUUID',
          timestamp: Date.now(),
        },
      })
    }).not.toThrow()

    const session = sessionStore.sessions.find(s => s.id === 'h5-session-no-random-uuid')
    expect(session?.messages[0]).toMatchObject({
      id: 'h5-user-message-no-random-uuid',
      role: 'user',
      content: 'hello from phone without randomUUID',
    })
    expect(session?.messages[1]).toMatchObject({ role: 'assistant', content: '' })
    expect(turnStore.getIsLoading('h5-session-no-random-uuid')).toBe(true)
  })
})
