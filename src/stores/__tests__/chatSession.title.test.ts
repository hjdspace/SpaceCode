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

describe('chat session placeholder title auto-rename', () => {
  beforeEach(() => {
    localStorage.clear()
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
