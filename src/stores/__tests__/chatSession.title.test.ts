import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listAllSessions: vi.fn().mockResolvedValue([]),
  getSessionStatus: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue(undefined),
  generateSessionTitle: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/aiSessionTitle', () => ({
  generateSessionTitle: mocks.generateSessionTitle,
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

describe('chat session placeholder title auto-rename', () => {
  beforeEach(() => {
    localStorage.clear()
    // 标题生成按 i18n 语言决定提示词；钉住 zh-CN 与本文件的断言一致。
    localStorage.setItem('claude_desktop_settings', JSON.stringify({ language: 'zh-CN' }))
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renames session titled with zh-CN placeholder (新对话) after first user message', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    // 侧边栏 / ChatPanel 均以 t('common.newChat') 创建会话；中文界面下占位标题是「新对话」
    store.createSession('新对话', undefined, 'sess-title-zh')
    store.addMessage({ role: 'user', content: '帮我重构 GUI 目录结构' }, 'sess-title-zh')

    const session = store.sessions.find(s => s.id === 'sess-title-zh')!
    expect(session.title).toBe('帮我重构 GUI 目录结构')
  })

  it('still renames session titled with en-US placeholder (New Chat)', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    store.createSession('New Chat', undefined, 'sess-title-en')
    store.addMessage({ role: 'user', content: 'refactor the GUI directory' }, 'sess-title-en')

    const session = store.sessions.find(s => s.id === 'sess-title-en')!
    expect(session.title).toBe('refactor the GUI directory')
  })

  it('does not rename sessions carrying an explicit title (side task / cron / remote)', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    store.createSession('部署任务', undefined, 'sess-title-keep')
    store.addMessage({ role: 'user', content: '开始部署' }, 'sess-title-keep')

    const session = store.sessions.find(s => s.id === 'sess-title-keep')!
    expect(session.title).toBe('部署任务')
  })

  it('truncates long first messages to 50 chars with ellipsis', async () => {
    const { useChatSessionStore } = await import('../chatSession')
    const store = useChatSessionStore()

    const long = 'x'.repeat(80)
    store.createSession('新对话', undefined, 'sess-title-long')
    store.addMessage({ role: 'user', content: long }, 'sess-title-long')

    const session = store.sessions.find(s => s.id === 'sess-title-long')!
    expect(session.title).toBe(`${'x'.repeat(50)}...`)
  })
})

describe('chat session AI title replacement', () => {
  const longMessage = '帮我把 GUI 目录下面的组件按照特性拆分到各自子目录里，同时更新所有 import 路径与样式引用，最后完整跑一遍构建确认没有遗漏'
  const truncated = `${longMessage.slice(0, 50)}...`
  const settled = () => new Promise(resolve => setTimeout(resolve, 0))

  beforeEach(() => {
    localStorage.clear()
    // 标题生成按 i18n 语言决定提示词；钉住 zh-CN 与本文件的断言一致。
    localStorage.setItem('claude_desktop_settings', JSON.stringify({ language: 'zh-CN' }))
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.generateSessionTitle.mockResolvedValue(null)
  })

  async function createStore(aiTitleEnabled: boolean) {
    const { useSettingsStore } = await import('../settings')
    useSettingsStore().aiSessionTitleEnabled = aiTitleEnabled
    const { useChatSessionStore } = await import('../chatSession')
    return useChatSessionStore()
  }

  it('leaves the truncated title alone while the AI title setting is off', async () => {
    const store = await createStore(false)

    store.createSession('新对话', undefined, 'sess-ai-off')
    store.addMessage({ role: 'user', content: longMessage }, 'sess-ai-off')
    await settled()

    expect(mocks.generateSessionTitle).not.toHaveBeenCalled()
    expect(store.sessions.find(s => s.id === 'sess-ai-off')!.title).toBe(truncated)
  })

  it('replaces the truncated title once the AI returns one', async () => {
    mocks.generateSessionTitle.mockResolvedValue('重构 GUI 目录结构')
    const store = await createStore(true)

    store.createSession('新对话', undefined, 'sess-ai-on')
    store.addMessage({ role: 'user', content: longMessage }, 'sess-ai-on')

    await vi.waitFor(() => {
      expect(store.sessions.find(s => s.id === 'sess-ai-on')!.title).toBe('重构 GUI 目录结构')
    })
    expect(mocks.generateSessionTitle).toHaveBeenCalledWith(longMessage, true)
  })

  it('keeps the truncated title when the AI call yields no title', async () => {
    const store = await createStore(true)

    store.createSession('新对话', undefined, 'sess-ai-null')
    store.addMessage({ role: 'user', content: longMessage }, 'sess-ai-null')
    await settled()

    expect(mocks.generateSessionTitle).toHaveBeenCalledOnce()
    expect(store.sessions.find(s => s.id === 'sess-ai-null')!.title).toBe(truncated)
  })

  it('discards the AI title when the user renamed the session while it was pending', async () => {
    let resolveTitle: (title: string) => void = () => {}
    mocks.generateSessionTitle.mockReturnValue(new Promise(resolve => { resolveTitle = resolve }))
    const store = await createStore(true)

    store.createSession('新对话', undefined, 'sess-ai-race')
    store.addMessage({ role: 'user', content: longMessage }, 'sess-ai-race')
    store.renameSession('sess-ai-race', '我自己起的名字')
    resolveTitle('重构 GUI 目录结构')
    await settled()

    expect(store.sessions.find(s => s.id === 'sess-ai-race')!.title).toBe('我自己起的名字')
  })

  it('never asks the AI about sessions created with an explicit title', async () => {
    mocks.generateSessionTitle.mockResolvedValue('不该出现的标题')
    const store = await createStore(true)

    store.createSession('部署任务', undefined, 'sess-ai-keep')
    store.addMessage({ role: 'user', content: longMessage }, 'sess-ai-keep')
    await settled()

    expect(mocks.generateSessionTitle).not.toHaveBeenCalled()
    expect(store.sessions.find(s => s.id === 'sess-ai-keep')!.title).toBe('部署任务')
  })
})
