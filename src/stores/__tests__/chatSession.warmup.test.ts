import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listAllSessions: vi.fn().mockResolvedValue([]),
  getSessionStatus: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
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

/**
 * 预热（TTFT 优化 ②）的渲染层行为：
 *  - initClaudeCodeSession 的 per-session single-flight：并发调用共享一次 spawn；
 *  - warmup 复用完整 init 路径并带 warmed 标记（主进程空闲回收的依据）；
 *  - warmup 不重启有配置漂移的运行中会话（对账留给真正的发送）。
 */
describe('chat session warmup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.startSession.mockResolvedValue(undefined)
    mocks.getSessionStatus.mockReset()
    // 默认「未运行」：每个用例可按需覆盖；也让跨用例悬挂的 warmup 不至于 reject
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })
  })

  it('init single-flight：并发初始化同一会话只拉一次引擎进程', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'claude-code'
    // settings hydration 是异步的：若并发 init 跨越 hydration 窗口，p1 与 p2 重走
    // 读到的 config 可能瞬时不同 → 对账误判漂移 → stop+重启（startSession 计 2 次）。
    // 先等 hydration 落地，用例只测 single-flight 语义本身。
    await vi.waitFor(() => { expect(settings.settingsReady).toBe(true) })

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'sf-1')

    // 状态随 spawn 落地翻转，模拟真实进程池
    let running = false
    mocks.getSessionStatus.mockImplementation(async () => ({ isRunning: running }))
    mocks.startSession.mockImplementation(async () => { running = true })

    const p1 = store.initClaudeCodeSession(session.id)
    const p2 = store.initClaudeCodeSession(session.id)
    await Promise.all([p1, p2])

    expect(mocks.startSession).toHaveBeenCalledTimes(1)
  })

  it('init single-flight：不同 overrides 的并发初始化 —— 后到者等待在飞完成后按自己的 overrides 重启', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'claude-code'
    // 同上：先等 hydration 落地，排除 config 瞬时漂移对重启对账的干扰
    await vi.waitFor(() => { expect(settings.settingsReady).toBe(true) })

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'sf-2')

    let running = false
    mocks.getSessionStatus.mockImplementation(async () => ({ isRunning: running }))
    mocks.startSession.mockImplementation(async () => { running = true })

    const p1 = store.initClaudeCodeSession(session.id)
    const p2 = store.initClaudeCodeSession(session.id, { systemPrompt: 'CUSTOM' })
    await Promise.all([p1, p2])

    // 第一次 spawn 用默认配置；第二次等待在飞完成后，按 CUSTOM overrides 重启对账
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.startSession).toHaveBeenCalledTimes(2)
    expect(mocks.startSession).toHaveBeenLastCalledWith(session.id, expect.objectContaining({
      systemPrompt: 'CUSTOM',
    }))
    expect(session.startupFingerprint).toBeTruthy()
  })

  it('warmup 复用完整 init 路径，config 带 warmed 标记', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'claude-code'

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'warm-1')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })

    await store.warmupSession(session.id)

    expect(mocks.startSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
      warmed: true,
    }))
    // 预热写齐了指纹与 provider —— 之后的发送不会再判定漂移重启
    expect(session.startupFingerprint).toBeTruthy()
    expect(session.processStatus).toBe('idle')
  })

  it('warmup 遇到已在运行的会话直接跳过，不起进程', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'claude-code'

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'warm-2')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: true })

    await store.warmupSession(session.id)

    expect(mocks.startSession).not.toHaveBeenCalled()
  })

  it('warmup 模式下 init 不因配置漂移重启运行中的会话 —— 对账留给真正的发送', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.authMethod = 'openai_compatible'
    settings.openaiConfig = { baseUrl: 'https://new.example/v1', apiKey: 'test-key', haikuModel: '', sonnetModel: 'default-model', opusModel: '' }

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'warm-3')
    session.provider = 'anthropic'
    session.baseUrl = 'https://old.example'
    mocks.getSessionStatus.mockResolvedValue({ isRunning: true, engineSessionId: 'engine-1' })

    await store.initClaudeCodeSession(session.id, undefined, { warmup: true })

    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.startSession).not.toHaveBeenCalled()
    // 会话原状态不被 warmup 破坏
    expect(session.provider).toBe('anthropic')
  })

  it('warmup 失败静默：不弹错误、状态记为 exited', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'claude-code'

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Test', 'D:/repo', 'warm-4')
    mocks.getSessionStatus.mockResolvedValue({ isRunning: false })
    mocks.startSession.mockRejectedValue(new Error('spawn failed'))

    await store.warmupSession(session.id)

    expect(session.processStatus).toBe('exited')
  })

  it('pi 引擎的会话不预热', async () => {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'pi'

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    const session = store.createSession('Pi', 'D:/repo', 'warm-6')

    await store.warmupSession(session.id)

    expect(mocks.startSession).not.toHaveBeenCalled()
  })
})
