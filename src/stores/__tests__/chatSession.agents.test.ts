import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listAllSessions: vi.fn().mockResolvedValue([]),
  getSessionStatus: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  getFullSession: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: mocks,
    image: null,
    trace: { event: vi.fn() },
    session: { getTurnCheckpoints: vi.fn().mockResolvedValue({ ok: false, checkpoints: [] }) },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

// 每个用例都要重新起一份 store：名单缓存键与 agentUnapplied 都是 store 里的状态，
// 模块不重置就会让上一个用例的缓存决定下一个用例的调用次数。
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.listAgents.mockResolvedValue([])
})

/**
 * 「Pi 会话看到的是 Claude 的 agent 名单」这半边缺陷 (issue #46)。
 *
 * engineGateway 在 engineType 缺省时按 claude-code 兜底，而渲染层一直没传第二参 ——
 * 于是 PiEngine.listAgents 从来没被调用过，光把引擎那侧改对并不能让界面变对。
 */
describe('chat session agent list', () => {
  it('asks the currently selected engine for its own agents', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'pi'

    const store = useChatSessionStore()
    store.currentProjectRoot = 'D:/repo'
    await store.loadAgents()

    expect(mocks.listAgents).toHaveBeenCalledWith('D:/repo', 'pi')
  })

  it('keeps the loaded list for the selector', async () => {
    mocks.listAgents.mockResolvedValueOnce([{ agentType: 'reviewer', description: 'd', source: 'project' }])

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    await store.loadAgents()

    expect(store.availableAgents.map(a => a.agentType)).toEqual(['reviewer'])
  })

  it('leaves the list untouched instead of throwing when the engine cannot answer', async () => {
    mocks.listAgents.mockRejectedValueOnce(new Error('engine gone'))

    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    await store.loadAgents()

    expect(store.availableAgents).toEqual([])
  })
})

/**
 * 「选了 agent 却没生效」必须让用户看见 (issue #46)。
 *
 * 引擎按会话回报 agentApplied，渲染层据此提示 —— 以前这条路上只有界面自己的徽章，
 * 于是徽章说「正在以 reviewer 运行」而进程压根没收到过 reviewer。
 */
describe('chat session agent verification', () => {
  beforeEach(async () => {
    const { errorHandler } = await import('@/services/errorHandler')
    errorHandler.toasts.value = []
  })

  async function startWithReportedStatus(status: Record<string, unknown>) {
    const { useChatSessionStore } = await import('../chatSession')
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'pi'
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'k', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }

    const store = useChatSessionStore()
    const session = store.createSession('Agent probe', 'D:/repo', 'agent-verify-1')
    store.currentAgent = 'reviewer'
    // 第一次 = 启动前的对账，第二次 = 启动后回读引擎状态
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    mocks.getSessionStatus.mockResolvedValueOnce(status)

    await store.initClaudeCodeSession(session.id, { agent: 'reviewer' })

    const { errorHandler } = await import('@/services/errorHandler')
    return { store, session, toasts: errorHandler.toasts.value }
  }

  it('marks the session unapplied and tells the user when the engine says it did not land', async () => {
    const { session, toasts } = await startWithReportedStatus({ agentApplied: false })

    expect(session.agentUnapplied).toBe('reviewer')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toContain('reviewer')
  })

  it('keeps no marker and no toast when the engine confirms the agent landed', async () => {
    const { session, toasts } = await startWithReportedStatus({ agentApplied: true })

    expect(session.agentUnapplied).toBeUndefined()
    expect(toasts).toEqual([])
  })

  it('still reports the persona as applied when only the extension failed to load', async () => {
    const { session, toasts } = await startWithReportedStatus({ agentApplied: true, agentExtensionLoaded: false })

    // 人设生效与能委派是两件事：不得因为扩展没装就谎称 agent 没生效，也不得闷着不说
    expect(session.agentUnapplied).toBeUndefined()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toContain('reviewer')
  })

  it('records nothing for an engine that does not report this state', async () => {
    const { session, toasts } = await startWithReportedStatus({})

    expect(session.agentUnapplied).toBeUndefined()
    expect(toasts).toEqual([])
  })

  it('treats a failed status read as unverified rather than killing a started session', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = 'pi'
    settings.authMethod = 'anthropic_compatible'
    settings.anthropicConfig = { baseUrl: '', apiKey: 'k', haikuModel: '', sonnetModel: 'claude-sonnet', opusModel: '' }

    const store = useChatSessionStore()
    const session = store.createSession('Agent probe', 'D:/repo', 'agent-verify-2')
    store.currentAgent = 'reviewer'
    // 启动前的对账正常返回，启动后的回读失败 —— 会话已经起来，不该被一次状态读取判死
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: false })
    mocks.getSessionStatus.mockRejectedValueOnce(new Error('session gone'))

    await expect(store.initClaudeCodeSession(session.id, { agent: 'reviewer' })).resolves.not.toThrow()
    expect(mocks.startSession).toHaveBeenCalledTimes(1)
    expect(session.agentUnapplied).toBeUndefined()
  })

  it('clears an old verdict once the engine says this spawn has no agent', async () => {
    const { session } = await startWithReportedStatus({ agentApplied: false })
    expect(session.agentUnapplied).toBe('reviewer')

    // 换成不带 agent 的一次启动：null = 这次进程压根没选 agent，上一次的账不能留着
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    store.currentAgent = ''
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, engineSessionId: 'e-1' })
    mocks.getSessionStatus.mockResolvedValueOnce({ agentApplied: null })
    await store.initClaudeCodeSession(session.id, { agent: '' })

    expect(session.agentUnapplied).toBeUndefined()
  })
})

/**
 * 名单跟的是「这个引擎 + 这份工作目录」，不是「这次启动问过没有」 (issue #46)。
 * 以前 ChatInput 只在列表为空时才让 store 去取，于是切到 Pi 之后下拉框还全是 Claude 内置项。
 */
describe('chat session agent list caching', () => {
  async function prepare(engineType: 'claude-code' | 'pi') {
    const { useSettingsStore } = await import('../settings')
    const settings = useSettingsStore()
    settings.engineType = engineType
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()
    store.currentProjectRoot = 'D:/repo'
    return store
  }

  it('reloads when the engine changes', async () => {
    const claude = await prepare('claude-code')
    await claude.loadAgents()
    const pi = await prepare('pi')
    await pi.loadAgents()

    expect(mocks.listAgents).toHaveBeenCalledTimes(2)
    expect(mocks.listAgents.mock.calls[0][1]).toBe('claude-code')
    expect(mocks.listAgents.mock.calls[1][1]).toBe('pi')
  })

  it('does not ask twice for the same engine and directory', async () => {
    const store = await prepare('pi')
    await store.loadAgents()
    await store.loadAgents()

    expect(mocks.listAgents).toHaveBeenCalledTimes(1)
  })

  it('asks again after a failed load instead of keeping the list empty forever', async () => {
    mocks.listAgents.mockRejectedValueOnce(new Error('engine gone'))
    const store = await prepare('pi')

    await store.loadAgents()
    mocks.listAgents.mockResolvedValueOnce([{ agentType: 'reviewer', description: '', source: 'project' }])
    await store.loadAgents()

    expect(mocks.listAgents).toHaveBeenCalledTimes(2)
    expect(store.availableAgents.map(a => a.agentType)).toEqual(['reviewer'])
  })
})
