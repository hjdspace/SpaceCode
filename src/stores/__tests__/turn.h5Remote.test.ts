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
