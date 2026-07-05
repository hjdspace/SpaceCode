import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignSession } from '../useDesignSession'
import { useDesignStore } from '@/stores/design'
import { errorHandler } from '@/services/errorHandler'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// 用 vi.hoisted 声明 spy，避免 vi.mock 工厂 hoisting 限制，便于测试中显式断言
const { sendMessageSpy } = vi.hoisted(() => ({
  sendMessageSpy: vi.fn().mockResolvedValue(undefined),
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
      stop: vi.fn(),
      // 补充：initClaudeCodeSession 内部会调用 getSessionStatus 判断会话是否运行
      getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
    },
  },
}))

// 选项 A：mock @/stores/chat，避免真实 chatStore.sendMessage 触发流式 Promise 挂起
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    sendMessage: sendMessageSpy,
  }),
  useChatSessionStore: () => ({
    createSession: vi.fn().mockReturnValue({ id: 'test-session-id', mode: 'chat', messages: [] }),
    initClaudeCodeSession: vi.fn().mockResolvedValue(undefined),
    sessions: [],
    updateMessage: vi.fn(),
    currentSessionId: null,
  }),
  useChatStreamStore: () => ({}),
  useChatControlStore: () => ({}),
}))

describe('useDesignSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    errorHandler.toasts.value = []
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
})
