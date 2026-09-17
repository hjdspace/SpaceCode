import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listAllSessions: vi.fn().mockResolvedValue([]),
  getSessionStatus: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: mocks,
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('chat session startup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('keeps history metadata available without selecting or hydrating a session', async () => {
    localStorage.setItem('chat_sessions_v2', JSON.stringify([{
      id: 'history-1',
      title: 'Previous task',
      messages: [{ id: 'message-1', role: 'user', content: 'old message', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
      workingDirectory: 'D:/repo',
    }]))

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].title).toBe('Previous task')
    expect(store.currentSessionId).toBeNull()
    expect(store.currentMessages).toEqual([])
  })

  it('recovers missing sidebar entries from Claude history', async () => {
    mocks.listAllSessions.mockResolvedValueOnce([{
      sessionId: 'disk-session-1',
      projectPath: '/work/project',
      title: 'Recovered task',
      firstUserMessage: 'Original prompt',
      lastMessageTimestamp: 5000,
    }])

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(await store.recoverSessionsFromHistory()).toBe(1)
    expect(store.sessions).toEqual([
      expect.objectContaining({
        id: 'disk-session-1',
        title: 'Recovered task',
        workingDirectory: '/work/project',
        updatedAt: 5000,
        mode: 'code',
      }),
    ])
    expect(JSON.parse(localStorage.getItem('chat_sessions_v2') || '[]')).toHaveLength(1)
  })

  it('restarts an existing process with the current provider and selected model', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'openai_compatible'
    settings.openaiConfig = { baseUrl: 'https://new.example/v1', apiKey: 'test-key', haikuModel: '', sonnetModel: 'default-model', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'provider-switch')
    session.provider = 'anthropic'
    session.baseUrl = 'https://old.example'
    session.model = 'kimi-k3'
    mocks.getSessionStatus.mockResolvedValue({ isRunning: true, engineSessionId: 'engine-id' })

    await store.initClaudeCodeSession(session.id)

    expect(mocks.stop).toHaveBeenCalledWith(session.id)
    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      provider: 'openai', baseUrl: 'https://new.example/v1', apiKey: 'test-key', model: 'kimi-k3', resumeSessionId: 'engine-id',
    }))
    expect(session.provider).toBe('openai')
    expect(session.baseUrl).toBe('https://new.example/v1')
  })

  it('applies the input-box model choice made before any session exists', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'openai_compatible'
    settings.openaiConfig = { baseUrl: 'https://agnes.example/v1', apiKey: 'test-key', haikuModel: '', sonnetModel: 'agnes-2.5-flash', opusModel: 'agnes-3.0-flash' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    // 桌面启动后处于空会话状态：currentSessionId 为 null
    expect(store.currentSessionId).toBeNull()

    // 用户在输入框选择 opus 槽位模型（无会话 → 暂存，不静默丢弃）
    await store.switchModel('opus', 'agnes-3.0-flash')

    // 发送消息时才创建会话（turn/index.ts sendMessage 的行为）
    const session = store.createSession('Test', 'D:/repo', 'fresh-send')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.initClaudeCodeSession(session.id)

    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      model: 'opus',
    }))
    // 选择落地为新会话的默认模型，后续 init 不再回退到 sonnet 槽位
    expect(session.model).toBe('agnes-3.0-flash')
  })

  it('keys modelContextWindows by the alias so slot-model context windows reach the engine', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: 'https://api.example/v1', apiKey: 'test-key', haikuModel: 'kimi-k3-flash', sonnetModel: 'kimi-k3', opusModel: 'kimi-k3-pro' }
    settings.modelContextWindows = { 'kimi-k3': 400_000 }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'ctx-window')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.initClaudeCodeSession(session.id)

    // effectiveModel 是别名 'sonnet'；sessionProcess 用 config.model 查
    // [1m] 后缀与 CLAUDE_CODE_AUTO_COMPACT_WINDOW，因此别名必须能查到
    // 槽位实际模型 kimi-k3 的上下文窗口
    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      model: 'sonnet',
      modelContextWindows: { 'kimi-k3': 400_000, sonnet: 400_000 },
    }))
  })
})
