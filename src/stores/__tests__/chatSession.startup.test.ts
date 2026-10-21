import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listAllSessions: vi.fn().mockResolvedValue([]),
  getSessionStatus: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue(undefined),
  getFullSession: vi.fn().mockResolvedValue(null),
  getTurnCheckpoints: vi.fn().mockResolvedValue({ ok: false, checkpoints: [] }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: mocks,
    image: null,
    trace: { event: vi.fn() },
    session: { getTurnCheckpoints: mocks.getTurnCheckpoints },
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

  it('recovers pi history entries with their engine identity', async () => {
    mocks.listAllSessions.mockResolvedValueOnce([{
      sessionId: 'pi-history-1',
      projectPath: 'D:/repo',
      title: 'Pi task',
      firstUserMessage: 'Original pi prompt',
      lastMessageTimestamp: 6000,
      engineType: 'pi',
      engineSessionId: 'pi-internal-1',
    }])

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(await store.recoverSessionsFromHistory()).toBe(1)
    expect(store.sessions[0]).toMatchObject({
      id: 'pi-history-1',
      engineType: 'pi',
      engineSessionId: 'pi-internal-1',
      workingDirectory: 'D:\\repo',
    })
    const persisted = JSON.parse(localStorage.getItem('chat_sessions_v2') || '[]')
    expect(persisted[0]).toMatchObject({ engineType: 'pi', engineSessionId: 'pi-internal-1' })
  })

  it('backfills engineType on an existing session from durable history', async () => {
    localStorage.setItem('chat_sessions_v2', JSON.stringify([{
      id: 'legacy-pi',
      title: 'Legacy pi',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      workingDirectory: 'D:/repo',
      processStatus: 'none',
      isTabOpen: true,
      lastActivityAt: 2,
      mode: 'code',
    }]))
    mocks.listAllSessions.mockResolvedValueOnce([{
      sessionId: 'legacy-pi',
      projectPath: 'D:/repo',
      engineType: 'pi',
      engineSessionId: 'pi-internal-2',
      lastMessageTimestamp: 2,
    }])

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(await store.recoverSessionsFromHistory()).toBe(0)
    expect(store.sessions[0].engineType).toBe('pi')
    expect(store.sessions[0].engineSessionId).toBe('pi-internal-2')
  })

  it('does not resurrect a session that was explicitly deleted', async () => {
    localStorage.setItem('chat_deleted_sessions_v1', JSON.stringify(['deleted-1']))
    mocks.listAllSessions.mockResolvedValueOnce([{
      sessionId: 'deleted-1',
      projectPath: 'D:/repo',
      title: 'Deleted',
      engineType: 'pi',
      lastMessageTimestamp: 1,
    }])

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    expect(await store.recoverSessionsFromHistory()).toBe(0)
    expect(store.sessions.find(s => s.id === 'deleted-1')).toBeUndefined()
  })

  it('writes a tombstone on delete so durable history cannot re-add the session', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Temporary', 'D:/repo', 'deleted-2')

    await store.deleteSession(session.id)
    mocks.listAllSessions.mockResolvedValueOnce([{
      sessionId: 'deleted-2',
      projectPath: 'D:/repo',
      engineType: 'pi',
      lastMessageTimestamp: 1,
    }])

    expect(await store.recoverSessionsFromHistory()).toBe(0)
    expect(store.sessions.find(s => s.id === 'deleted-2')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('chat_deleted_sessions_v1') || '[]')).toContain('deleted-2')
  })

  it('starts a historical session on its own engine, not the global default', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'claude-code'

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Pi history', 'D:/repo', 'pi-engine-1')
    session.engineType = 'pi'
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.initClaudeCodeSession(session.id)

    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      engineType: 'pi',
    }))
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

  it('persists the input-box model choice across a GUI restart', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'openai_compatible'
    settings.openaiConfig = { baseUrl: 'https://kimi.example/v1', apiKey: 'test-key', haikuModel: '', sonnetModel: 'glm-5.2', opusModel: 'kimi-k3' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    // 用户在输入框选择 opus 槽位模型（无会话状态）
    await store.switchModel('opus', 'kimi-k3')
    expect(settings.lastSelectedModel).toBe('kimi-k3')

    // 模拟 GUI 重启：localStorage 中应持久化了用户的选择
    const saved = JSON.parse(localStorage.getItem('claude_desktop_settings') || '{}')
    expect(saved.lastSelectedModel).toBe('kimi-k3')
  })

  it('restores the persisted model choice for a new session after restart', async () => {
    // 模拟上一次 GUI 会话中用户选择了 kimi-k3
    localStorage.setItem('claude_desktop_settings', JSON.stringify({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: 'https://kimi.example/v1', apiKey: 'test-key', haikuModel: '', sonnetModel: 'glm-5.2', opusModel: 'kimi-k3' },
      lastSelectedModel: 'kimi-k3',
    }))

    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    expect(settings.lastSelectedModel).toBe('kimi-k3')

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    expect(store.currentSessionId).toBeNull()

    // 重启后新建会话，引擎应拿到用户上次选择的模型，而非 sonnet 槽位
    const session = store.createSession('Test', 'D:/repo', 'after-restart')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.initClaudeCodeSession(session.id)

    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      model: 'opus',
    }))
    expect(session.model).toBe('kimi-k3')
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

  it('pi 引擎的普通会话同样保留真实模型 id，与定时任务共用一条规则', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: 'https://api.example/v1', apiKey: 'test-key', haikuModel: '', sonnetModel: 'kimi-k3', opusModel: '' }
    settings.engineType = 'pi'
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'pi-engine')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.initClaudeCodeSession(session.id)

    // Pi 的 --model 直接给上游，'sonnet' 在它眼里是个不存在的模型
    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      engineType: 'pi',
      model: 'kimi-k3',
    }))
  })

  it('设置页高级配置里的上下文窗口（modelCapabilities）同样送达引擎', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: 'https://api.example/v1', apiKey: 'test-key', haikuModel: 'kimi-k3-flash', sonnetModel: 'kimi-k3', opusModel: 'kimi-k3-pro' }
    settings.modelCapabilities = { 'kimi-k3': { contextWindow: 200_000 } }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'ctx-capability')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.initClaudeCodeSession(session.id)

    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      model: 'sonnet',
      modelContextWindows: { 'kimi-k3': 200_000, sonnet: 200_000 },
    }))
  })

  // ── 运行中会话的启动配置对账（issue #41 第 10 票）──

  it('切换设计系统/技能时对运行中的会话下发新 systemPrompt 与 agent', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'direct-key', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Design', 'D:/design', 'design-reconcile')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id, {
      systemPrompt: 'OLD-DESIGN-SYSTEM',
      agent: 'OLD-SKILL',
    })
    expect(mocks.startSession).toHaveBeenCalledTimes(1)

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, engineSessionId: 'engine-1' })
    await store.initClaudeCodeSession(session.id, {
      systemPrompt: 'NEW-DESIGN-SYSTEM',
      agent: 'NEW-SKILL',
    })

    expect(mocks.stop).toHaveBeenCalledWith(session.id)
    expect(mocks.startSession).toHaveBeenCalledTimes(2)
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({
      systemPrompt: 'NEW-DESIGN-SYSTEM',
      agent: 'NEW-SKILL',
      resumeSessionId: 'engine-1',
    }))
  })

  it('只更换 API Key 时直连模式重启会话以注入新凭据，且密钥不落盘明文', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'key-rotate-direct')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id)
    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({ apiKey: 'key-A' }))

    settings.anthropicConfig = { ...settings.anthropicConfig, apiKey: 'key-B' }
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, engineSessionId: 'engine-2' })
    await store.initClaudeCodeSession(session.id)

    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.startSession).toHaveBeenCalledTimes(2)
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ apiKey: 'key-B' }))
    // 会话存储（会写入 localStorage）只保存指纹，不保存 Key 明文
    expect(JSON.stringify(session)).not.toContain('key-B')
  })

  it('代理模式只换 Key 时不重启引擎：凭据由本地代理层对账', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'openai_compatible'
    settings.openaiConfig = { baseUrl: 'https://upstream.example/v1', apiKey: 'key-A', haikuModel: '', sonnetModel: 'gpt-x', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'key-rotate-proxy')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id)

    settings.openaiConfig = { ...settings.openaiConfig, apiKey: 'key-B' }
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, permissionMode: 'default' })
    await store.initClaudeCodeSession(session.id)

    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.startSession).toHaveBeenCalledTimes(1)
  })

  it('启动配置未变化时复用运行中的进程，不重启', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Design', 'D:/design', 'startup-unchanged')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id, { systemPrompt: 'SAME-PROMPT', agent: 'SAME-SKILL' })

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, permissionMode: 'default' })
    await store.initClaudeCodeSession(session.id, { systemPrompt: 'SAME-PROMPT', agent: 'SAME-SKILL' })

    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.startSession).toHaveBeenCalledTimes(1)
  })

  // ── 切换工作目录后会话记录同步（issue #41 第 11 票）──

  it('显式指定 cwd 时同步 session.workingDirectory，后续 init 不再退回旧目录', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Design', '/tmp/old', 'cwd-switch')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id, { cwd: '/tmp/new', systemPrompt: 'P', agent: 'ui-ux-pro-max' })

    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ cwd: '/tmp/new' }))
    expect(session.workingDirectory).toBe('/tmp/new')
    // 落盘：重启客户端后 selectSession / DesignChatPane 都读这个值恢复目录
    store.flushSaveNow()
    expect((JSON.parse(localStorage.getItem('chat_sessions_v2') || '[]') as any[])[0].workingDirectory).toBe('/tmp/new')

    // 换模型 / 引擎崩溃自动重启 / 重启恢复都不带 cwd，走 session.workingDirectory 兜底
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id)
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ cwd: '/tmp/new' }))
  })

  it('会话记录保存归一化后的路径，不把斜杠混写的新目录带进侧边栏分组', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Design', 'D:/old', 'cwd-normalize')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id, { cwd: 'D:/new//design/' })

    // 引擎 spawn 的 cwd 与会话记录必须是同一个字符串，历史记录才能按同一路径找回项目目录
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ cwd: 'D:\\new\\design' }))
    expect(session.workingDirectory).toBe('D:\\new\\design')
  })

  it('未显式指定 cwd 时不把兜底 cwd 写进会话记录', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    // 无项目会话：workingDirectory 与 currentProjectRoot 均空，引擎落到 '/' 兜底
    const session = store.createSession('Chat', '', 'cwd-fallback')
    expect(session.workingDirectory).toBeUndefined()

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id)

    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ cwd: '/' }))
    expect(session.workingDirectory).toBeUndefined()
  })

  it('引擎启动失败时不回写工作目录，记录停在最后一次真实运行的目录', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Design', '/tmp/old', 'cwd-switch-failed')
    mocks.startSession.mockRejectedValueOnce(new Error('spawn ENOENT'))

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id, { cwd: '/tmp/new' })

    // 切换方据此判据回滚界面（initClaudeCodeSession 内部吞异常，不外抛）
    expect(session.processStatus).toBe('exited')
    expect(session.workingDirectory).toBe('/tmp/old')

    // 恢复路径：回滚后下一次发消息 / 激活会话的重启，落在的还是旧目录
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id)
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({ cwd: '/tmp/old' }))
  })

  it('重启客户端后打开设计会话，落盘记录与项目根都落在新目录', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    store.createSession('Design', '/tmp/old', 'cwd-switch-restart')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession('cwd-switch-restart', { cwd: '/tmp/new', systemPrompt: 'P', agent: 'ui-ux-pro-max' })
    store.flushSaveNow()

    // 模拟重启：换一份 pinia 让 setup store 重新从 localStorage 载入
    setActivePinia(createPinia())
    const reloaded = useChatSessionStore()
    expect(reloaded.sessions[0].workingDirectory).toBe('/tmp/new')

    // selectSession 拿旧值覆盖 currentProjectRoot 是这条链上最刺眼的表现
    await reloaded.selectSession('cwd-switch-restart')
    expect(reloaded.currentProjectRoot).toBe('/tmp/new')
  })

  it('DEFECT: 换 cwd 时把旧项目目录的 engineSessionId 一起下发给 --resume', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'key-A', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Design', '/tmp/old', 'cwd-switch-resume')

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    await store.initClaudeCodeSession(session.id, { systemPrompt: 'OLD', agent: 'ui-ux-pro-max' })

    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, engineSessionId: 'engine-in-old-dir' })
    await store.initClaudeCodeSession(session.id, { systemPrompt: 'NEW', cwd: '/tmp/new', agent: 'ui-ux-pro-max' })

    // 现状钉死（不在本票修复范围）：引擎按 cwd 解析 ~/.claude/projects/<sanitized-cwd>/<id>.jsonl，
    // 在新目录里找不到旧目录的 transcript，--resume 会静默落空 → 切目录即丢上下文。
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({
      cwd: '/tmp/new',
      resumeSessionId: 'engine-in-old-dir',
    }))
  })
})
