import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignSession } from '../useDesignSession'
import { useDesignStore } from '@/stores/design'
import { useChatSessionStore } from '@/stores/chatSession'
import { errorHandler } from '@/services/errorHandler'

vi.mock('vue-i18n', () => ({
  // errorHandler 现在会引入全局 i18n 实例（issue #55），mock 必须提供 createI18n。
  createI18n: () => ({
    global: { locale: { value: 'zh-CN' }, t: (key: string) => key },
  }),
  useI18n: () => ({ t: (key: string) => key }),
}))

// 用 vi.hoisted 声明 spy，避免 vi.mock 工厂 hoisting 限制，便于测试中显式断言
const { sendMessageSpy, stopEngineSpy } = vi.hoisted(() => ({
  sendMessageSpy: vi.fn().mockResolvedValue(undefined),
  stopEngineSpy: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    app: { getPath: vi.fn().mockResolvedValue('/userData') },
    design: {
      composePromptStack: vi.fn().mockResolvedValue('system-prompt'),
      startFileWatcher: vi.fn().mockResolvedValue(undefined),
      stopFileWatcher: vi.fn().mockResolvedValue(undefined),
    },
    claudeCode: {
      onStreamEvent: vi.fn(() => () => {}),
      sendMessage: vi.fn(),
      stop: stopEngineSpy,
      // 补充：initClaudeCodeSession 内部会调用 getSessionStatus 判断会话是否运行
      getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
    },
  },
}))

// 会话 store 用可控的有状态替身：只镜像 initClaudeCodeSession 的两条对外契约
// （成功回写显式 cwd、失败只置 exited 且不外抛），这两条本身由
// chatSession.startup.test.ts 对着真实 store 钉死；本文件只验编排与回滚。
const storeState = vi.hoisted(() => {
  const state: any = {
    sessions: [] as any[],
    currentProjectRoot: '',
    currentSessionId: null as string | null,
    initSucceeds: true,
    updateMessage: vi.fn(),
    saveToStorage: vi.fn(),
  }
  state.createSession = vi.fn((title: string, workingDirectory?: string) => {
    const session = { id: 'test-session-id', title, mode: 'chat', messages: [], processStatus: 'none', workingDirectory }
    state.sessions.length = 0
    state.sessions.push(session)
    return session
  })
  state.initClaudeCodeSession = vi.fn(async (sid: string, overrides?: { cwd?: string }) => {
    const session = state.sessions.find((s: any) => s.id === sid)
    if (!session) return
    if (state.initSucceeds) {
      session.processStatus = 'idle'
      if (overrides?.cwd) session.workingDirectory = overrides.cwd
    } else {
      session.processStatus = 'exited'
    }
  })
  // 镜像「只有空会话能换工作目录」这条契约，真实实现由 chatSession.sessions.test.ts 钉死
  state.canSwitchWorkingDirectory = vi.fn((sid: string | null) => {
    const session = state.sessions.find((s: any) => s.id === sid)
    return session ? session.messages.length === 0 : true
  })
  return state
})

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => storeState,
}))
vi.mock('@/stores/turn', () => ({
  useTurnStore: () => ({
    sendMessage: sendMessageSpy,
    abort: vi.fn().mockResolvedValue(undefined),
  }),
}))

function setupDesignSession(workingDirectory: string) {
  const design = useDesignStore()
  const chat = useChatSessionStore()
  const session = chat.createSession('Design', workingDirectory)
  design.activeSessionId = session.id
  design.designWorkspace = workingDirectory
  chat.currentProjectRoot = workingDirectory
  return session
}

describe('useDesignSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    errorHandler.toasts.value = []
    storeState.sessions.length = 0
    storeState.currentProjectRoot = ''
    storeState.currentSessionId = null
    storeState.initSucceeds = true
  })

  it('createDesignSession 创建会话并注入 system prompt + file watcher', async () => {
    const { createDesignSession } = useDesignSession()
    const sid = await createDesignSession()
    expect(sid).toBeTruthy()
    const { api } = await import('@/services/electronAPI')
    expect(api.design.composePromptStack).toHaveBeenCalled()
    expect(api.design.startFileWatcher).toHaveBeenCalledWith(sid, expect.any(String))
  })

  it('switchToolboxSkill 重新 composePromptStack', async () => {
    const { switchToolboxSkill } = useDesignSession()
    await switchToolboxSkill('canvas-design')
    const { api } = await import('@/services/electronAPI')
    expect(api.design.composePromptStack).toHaveBeenCalledWith(expect.objectContaining({ skillName: 'canvas-design' }))
  })

  it('createDesignSession 传入 designSystemId', async () => {
    const store = useDesignStore()
    store.selectedToolboxSkillId = 'ui-ux-pro-max'
    store.selectedDesignSystemId = 'agentic'
    const { createDesignSession } = useDesignSession()
    await createDesignSession()
    const { api } = await import('@/services/electronAPI')
    expect(api.design.composePromptStack).toHaveBeenCalledWith(
      expect.objectContaining({ skillName: 'ui-ux-pro-max', designSystemId: 'agentic' }),
    )
  })

  it('switchDesignSystem 更新 store 并重新 init session', async () => {
    const store = useDesignStore()
    store.activeSessionId = 'test-session-id'
    store.designWorkspace = '/tmp/ws'
    const { switchDesignSystem } = useDesignSession()
    await switchDesignSystem('apple', 'Apple')
    expect(store.selectedDesignSystemId).toBe('apple')
    expect(store.selectedDesignSystemName).toBe('Apple')
    const { api } = await import('@/services/electronAPI')
    expect(api.design.composePromptStack).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: 'apple' }),
    )
  })

  it('buildDesignMessage 为模板与设计系统拼接前置提示词', () => {
    const store = useDesignStore()
    store.selectedTemplateId = 'wireframe'
    store.selectedDesignSystemName = 'Agentic'
    const { buildDesignMessage } = useDesignSession()
    const result = buildDesignMessage('帮我画一个登录页')
    expect(result).toContain('低保真线框图')
    expect(result).toContain('Agentic')
    expect(result).toContain('帮我画一个登录页')
  })

  it('submitQuestionForm 发送 form answers 消息', async () => {
    const { createDesignSession, submitQuestionForm } = useDesignSession()
    await createDesignSession()
    await submitQuestionForm({ q1: 'a' })
    expect(sendMessageSpy).toHaveBeenCalledWith(expect.stringContaining('form answers'))
  })

  // ── 切换工作目录后会话记录同步 + 失败回滚（issue #41 第 11 票）──

  it('switchWorkingDirectory 成功后会话记录、工作区与文件监听都指向新目录', async () => {
    const design = useDesignStore()
    const chat = useChatSessionStore()
    const session = setupDesignSession('/tmp/old')
    const { switchWorkingDirectory } = useDesignSession()

    await switchWorkingDirectory('/tmp/new')

    expect(session.workingDirectory).toBe('/tmp/new')
    expect(design.designWorkspace).toBe('/tmp/new')
    expect(chat.currentProjectRoot).toBe('/tmp/new')
    const { api } = await import('@/services/electronAPI')
    expect(api.design.stopFileWatcher).toHaveBeenCalled()
    expect(api.design.startFileWatcher).toHaveBeenCalledWith('test-session-id', '/tmp/new')
    expect(errorHandler.toasts.value).toHaveLength(0)
  })

  it('switchWorkingDirectory 引擎起不来时回滚界面与会话状态，监听不跟着搬走', async () => {
    const design = useDesignStore()
    const chat = useChatSessionStore()
    const session = setupDesignSession('/tmp/old')
    storeState.initSucceeds = false
    const { switchWorkingDirectory } = useDesignSession()

    await switchWorkingDirectory('/tmp/new')

    expect(design.designWorkspace).toBe('/tmp/old')
    expect(chat.currentProjectRoot).toBe('/tmp/old')
    expect(session.workingDirectory).toBe('/tmp/old')
    const { api } = await import('@/services/electronAPI')
    expect(api.design.startFileWatcher).not.toHaveBeenCalledWith('test-session-id', '/tmp/new')
    // 引擎启动失败由 initClaudeCodeSession 的分类错误 toast 负责，这里不再补一条
    expect(errorHandler.toasts.value.map(toast => toast.title)).not.toContain('design.workingDirectory.switchFailed')
  })

  it('switchWorkingDirectory 里 composePromptStack 抛错时同样回滚，且不打断调用方', async () => {
    const design = useDesignStore()
    const chat = useChatSessionStore()
    setupDesignSession('/tmp/old')
    const { api } = await import('@/services/electronAPI')
    vi.mocked(api.design.composePromptStack).mockRejectedValueOnce(new Error('ipc down'))
    const { switchWorkingDirectory } = useDesignSession()

    await expect(switchWorkingDirectory('/tmp/new')).resolves.toBeUndefined()

    expect(design.designWorkspace).toBe('/tmp/old')
    expect(chat.currentProjectRoot).toBe('/tmp/old')
    expect(chat.initClaudeCodeSession).not.toHaveBeenCalled()
    // 引擎侧没报错（根本没走到 init），这条回滚说明只能由本函数给出
    expect(errorHandler.toasts.value.map(toast => toast.title)).toContain('design.workingDirectory.switchFailed')
  })

  it('switchWorkingDirectory 收到空路径（picker 清除）时不改动任何会话状态', async () => {
    const design = useDesignStore()
    const chat = useChatSessionStore()
    const session = setupDesignSession('/tmp/old')
    const { switchWorkingDirectory } = useDesignSession()

    await switchWorkingDirectory('')

    expect(design.designWorkspace).toBe('/tmp/old')
    expect(chat.currentProjectRoot).toBe('/tmp/old')
    expect(session.workingDirectory).toBe('/tmp/old')
    expect(chat.initClaudeCodeSession).not.toHaveBeenCalled()
    expect(errorHandler.toasts.value).toHaveLength(0)
  })

  it('switchWorkingDirectory 在会话已有消息时直接拒绝，不停引擎也不提示失败', async () => {
    const design = useDesignStore()
    const chat = useChatSessionStore()
    const session = setupDesignSession('/tmp/old')
    session.messages.push({ id: 'm1', role: 'user', content: 'hi', timestamp: 1 })
    const { switchWorkingDirectory } = useDesignSession()

    await switchWorkingDirectory('/tmp/new')

    expect(design.designWorkspace).toBe('/tmp/old')
    expect(chat.currentProjectRoot).toBe('/tmp/old')
    expect(session.workingDirectory).toBe('/tmp/old')
    // 锁定不是失败：引擎没被停、也没弹"切换失败"，UI 侧由置灰入口解释原因
    expect(stopEngineSpy).not.toHaveBeenCalled()
    expect(chat.initClaudeCodeSession).not.toHaveBeenCalled()
    expect(errorHandler.toasts.value).toHaveLength(0)
  })
})
