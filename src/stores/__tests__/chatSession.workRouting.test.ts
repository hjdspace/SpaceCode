import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
  stop: vi.fn().mockResolvedValue(undefined),
  installAgent: vi.fn().mockResolvedValue({ success: true }),
  installSkill: vi.fn().mockResolvedValue({ success: true }),
  checkInstalled: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      getSessionStatus: mocks.getSessionStatus,
      stop: mocks.stop,
      listAllSessions: vi.fn().mockResolvedValue([]),
      getFullSession: vi.fn().mockResolvedValue(null),
    },
    agents: { install: mocks.installAgent },
    skills: { installLocal: mocks.installSkill },
    officecli: { checkInstalled: mocks.checkInstalled },
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

const STORAGE_KEY = 'chat_sessions_v2'

type Stores = Awaited<ReturnType<typeof loadStores>>

async function loadStores() {
  const { useChatSessionStore } = await import('../chatSession')
  const { useSettingsStore } = await import('../settings')
  const { useAppStore } = await import('../app')
  return {
    chat: useChatSessionStore(),
    settings: useSettingsStore(),
    app: useAppStore(),
  }
}

async function freshStores(): Promise<Stores> {
  vi.resetModules()
  setActivePinia(createPinia())
  const stores = await loadStores()
  stores.app.mode = 'work'
  stores.app.setWorkWorkspace('D:/work')
  return stores
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('work first-message routing gate', () => {
  it('routes a fresh general session created through the new work entry', async () => {
    const { chat } = await freshStores()
    const session = chat.createSession('新对话', 'D:/work')

    expect(session.workRoutable).toBe(true)
    expect(chat.shouldRouteWorkFirstMessage(session.id)).toBe(true)
  })

  it('never routes legacy work sessions that lack the routable marker', async () => {
    const { chat } = await freshStores()
    const session = chat.createSession('旧会话', 'D:/work')
    // 升级前的会话没有这个字段：用户已有的空 work 会话不能被追溯拦截
    session.workRoutable = undefined

    expect(chat.shouldRouteWorkFirstMessage(session.id)).toBe(false)
  })

  it('skips sessions that are already decided, bound, or non-empty', async () => {
    const { chat } = await freshStores()

    const bound = chat.createSession('已绑定', 'D:/work')
    bound.assistantId = 'ppt-creator'
    expect(chat.shouldRouteWorkFirstMessage(bound.id)).toBe(false)

    const decided = chat.createSession('已决策', 'D:/work')
    decided.workRouting = { outcome: 'general', at: Date.now() }
    expect(chat.shouldRouteWorkFirstMessage(decided.id)).toBe(false)

    const used = chat.createSession('已使用', 'D:/work')
    used.messages.push({ id: 'm1', role: 'user', content: 'hello', timestamp: Date.now() })
    expect(chat.shouldRouteWorkFirstMessage(used.id)).toBe(false)
  })

  it('skips non-work and ephemeral sessions', async () => {
    const { chat, app } = await freshStores()
    app.mode = 'code'
    const codeSession = chat.createSession('代码会话', 'D:/work')
    expect(chat.shouldRouteWorkFirstMessage(codeSession.id)).toBe(false)

    app.mode = 'work'
    const sideTask = chat.createSession('侧边任务', 'D:/work', undefined, { ephemeral: true, activate: false })
    expect(chat.shouldRouteWorkFirstMessage(sideTask.id)).toBe(false)
  })

  it('honours the routerConfig switch', async () => {
    const { chat, settings } = await freshStores()
    const session = chat.createSession('新对话', 'D:/work')

    settings.routerConfig = { enabled: false, modelSource: 'follow-fast' }

    expect(chat.shouldRouteWorkFirstMessage(session.id)).toBe(false)
  })
})

describe('auto work routing binding', () => {
  it('binds through switchWorkAssistant, keeps the session id, and persists the decision', async () => {
    const { chat } = await freshStores()
    const session = chat.createSession('新对话', 'D:/work')
    const sessionId = session.id

    await chat.applyAutoWorkRouting(sessionId, {
      assistant: { name: 'ppt-creator', skills: ['pptx'] },
      ranked: [
        { name: 'ppt-creator', score: 0.92 },
        { name: 'html-ppt-creator', score: 0.4 },
      ],
    })

    // 同一个会话就地绑定，不新建会话
    expect(chat.currentSessionId).toBe(sessionId)
    expect(chat.sessions.filter(s => s.id === sessionId)).toHaveLength(1)
    expect(session.assistantId).toBe('ppt-creator')
    expect(session.agent).toBe('ppt-creator')
    expect(session.workRouting).toMatchObject({
      outcome: 'auto',
      assistant: 'ppt-creator',
      ranked: [
        { name: 'ppt-creator', score: 0.92 },
        { name: 'html-ppt-creator', score: 0.4 },
      ],
    })
    expect(mocks.installAgent).toHaveBeenCalledWith('ppt-creator', 'global', 'D:/work')
    expect(mocks.installSkill).toHaveBeenCalledWith('pptx', 'project', 'D:/work')
    expect(chat.shouldRouteWorkFirstMessage(sessionId)).toBe(false)

    chat.flushSaveNow()
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    expect(persisted[0].workRouting).toMatchObject({ outcome: 'auto', assistant: 'ppt-creator' })
  })

  it('falls back to Node skills when OfficeCLI is missing', async () => {
    const { chat } = await freshStores()
    mocks.checkInstalled.mockResolvedValueOnce(false)
    const session = chat.createSession('新对话', 'D:/work')

    await chat.applyAutoWorkRouting(session.id, {
      assistant: { name: 'morph-ppt', skills: ['morph-ppt'], skillRuntime: 'officecli' },
      ranked: [{ name: 'morph-ppt', score: 0.8 }],
    })

    expect(mocks.installSkill).toHaveBeenCalledWith('pptx', 'project', 'D:/work')
  })
})

describe('workRouting hydration', () => {
  it('keeps a persisted decision across a restart', async () => {
    const first = await freshStores()
    const session = first.chat.createSession('新对话', 'D:/work')
    await first.chat.applyAutoWorkRouting(session.id, {
      assistant: { name: 'docx-writer' },
      ranked: [{ name: 'docx-writer', score: 0.88 }],
    })
    first.chat.flushSaveNow()
    const sessionId = session.id

    const second = await freshStores()
    const restored = second.chat.getSession(sessionId)

    expect(restored?.workRouting).toMatchObject({ outcome: 'auto', assistant: 'docx-writer' })
    expect(second.chat.shouldRouteWorkFirstMessage(sessionId)).toBe(false)
  })

  it('tolerates sessions saved before the field existed', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{
      id: 'legacy-work',
      title: '旧对话',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      processStatus: 'none',
      isTabOpen: false,
      lastActivityAt: 1,
      mode: 'work',
    }]))

    const { chat } = await freshStores()
    const legacy = chat.getSession('legacy-work')

    expect(legacy).toBeTruthy()
    expect(legacy?.workRouting).toBeUndefined()
    expect(chat.shouldRouteWorkFirstMessage('legacy-work')).toBe(false)
  })
})

describe('held first message', () => {
  it('holds and clears the message without touching the session messages', async () => {
    const { chat } = await freshStores()
    const session = chat.createSession('新对话', 'D:/work')

    chat.holdWorkFirstMessage({
      sessionId: session.id,
      content: '帮我做个可编辑的 PPT',
      messageContent: '帮我做个可编辑的 PPT',
      userContent: undefined,
      attachments: { files: [], images: [] },
      at: Date.now(),
    })

    expect(chat.pendingWorkFirstMessage?.sessionId).toBe(session.id)
    expect(session.messages).toHaveLength(0)

    chat.clearPendingWorkFirstMessage()
    expect(chat.pendingWorkFirstMessage).toBeNull()
  })
})
