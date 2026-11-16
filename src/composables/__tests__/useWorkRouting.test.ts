import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
  stop: vi.fn().mockResolvedValue(undefined),
  installAgent: vi.fn().mockResolvedValue({ success: true }),
  installSkill: vi.fn().mockResolvedValue({ success: true }),
  checkInstalled: vi.fn().mockResolvedValue(true),
  getInstalled: vi.fn().mockResolvedValue({ agents: [] }),
  scanLibrary: vi.fn().mockResolvedValue({ agents: [] }),
  sendMessage: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      onStreamEvent: vi.fn(() => () => {}),
      onAssistant: vi.fn(() => () => {}),
      onToolUse: vi.fn(() => () => {}),
      onToolResult: vi.fn(() => () => {}),
      onUser: vi.fn(() => () => {}),
      onSystem: vi.fn(() => () => {}),
      onResult: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
      getSessionStatus: mocks.getSessionStatus,
      stop: mocks.stop,
      listAllSessions: vi.fn().mockResolvedValue([]),
      getFullSession: vi.fn().mockResolvedValue(null),
    },
    agents: {
      install: mocks.installAgent,
      getInstalled: mocks.getInstalled,
      scanLibrary: mocks.scanLibrary,
    },
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

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn().mockResolvedValue(undefined),
  sendMessage: mocks.sendMessage,
}))

function workAgent(name: string, description = `${name} helper`) {
  return {
    name,
    description,
    content: '',
    sourceDir: '',
    agentPath: '',
    isInstalled: false,
    category: 'office',
    mode: 'work' as const,
  }
}

async function freshSetup() {
  vi.resetModules()
  setActivePinia(createPinia())

  const { useAppStore } = await import('@/stores/app')
  const { useChatSessionStore } = await import('@/stores/chatSession')
  const { useAgentsStore } = await import('@/stores/agents')
  const { useSettingsStore } = await import('@/stores/settings')
  const { useTurnStore } = await import('@/stores/turn')
  const { useWorkRouting } = await import('@/composables/useWorkRouting')

  const app = useAppStore()
  app.mode = 'work'
  app.setWorkWorkspace('D:/work')

  const agents = useAgentsStore()
  agents.libraryAgents = [
    workAgent('ppt-creator'),
    workAgent('html-ppt-creator'),
    workAgent('docx-writer'),
    workAgent('xlsx-analyst'),
  ]

  const settings = useSettingsStore()
  settings.anthropicConfig.apiKey = 'sk-test'

  const chat = useChatSessionStore()
  const turn = useTurnStore()
  const send = vi.spyOn(turn, 'sendMessage').mockResolvedValue(undefined)
  const routing = useWorkRouting()

  const session = chat.createSession('新对话', 'D:/work')
  return { app, agents, settings, chat, turn, send, routing, session }
}

function startInput(sessionId: string, content = '做个可编辑的 PPT') {
  return {
    sessionId,
    content,
    messageContent: content,
    attachments: {
      files: [{ name: 'outline.md', path: 'D:/work/outline.md', isFolder: false }],
      images: [],
    },
    isZh: true,
    workspace: 'D:/work',
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.getInstalled.mockResolvedValue({ agents: [] })
  mocks.scanLibrary.mockResolvedValue({ agents: [] })
})

describe('useWorkRouting first message', () => {
  it('auto-binds the top candidate and sends the held message with attachments', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockResolvedValue(JSON.stringify({
      none: false,
      candidates: [{ name: 'ppt-creator', score: 0.92, reason: 'editable deck' }],
    }))

    await routing.startFirstMessageRouting(startInput(session.id))

    expect(session.assistantId).toBe('ppt-creator')
    expect(session.workRouting).toMatchObject({ outcome: 'auto', assistant: 'ppt-creator' })
    expect(chat.getPendingWorkRouting(session.id)).toBeUndefined()
    expect(send).toHaveBeenCalledWith(
      '做个可编辑的 PPT',
      undefined,
      expect.objectContaining({
        files: [expect.objectContaining({ path: 'D:/work/outline.md' })],
        images: [],
      }),
      { sessionId: session.id },
    )
    expect(session.messages).toHaveLength(0)
  })

  it('logs a routing decision trace event with candidates, outcome and model', async () => {
    const { routing, session } = await freshSetup()
    const { api } = await import('@/services/electronAPI')
    mocks.sendMessage.mockResolvedValue(JSON.stringify({
      none: false,
      candidates: [{ name: 'ppt-creator', score: 0.92, reason: 'editable deck' }],
    }))

    await routing.startFirstMessageRouting(startInput(session.id))

    const decisionEvents = vi.mocked(api.trace.event).mock.calls
      .filter(([event]) => (event as unknown as { type?: string }).type === 'work-routing-decision')
    expect(decisionEvents).toHaveLength(1)
    const payload = decisionEvents[0][0] as unknown as Record<string, unknown>
    expect(payload).toMatchObject({
      type: 'work-routing-decision',
      actor: 'system',
      status: 'completed',
      sessionId: session.id,
    })
    const metadata = payload.metadata as Record<string, unknown>
    expect(metadata.outcome).toBe('auto')
    expect(metadata.candidateCount).toBeGreaterThan(0)
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0)
    expect(metadata.model).toBeTruthy()
    // key 永不落日志
    expect(JSON.stringify(payload)).not.toMatch(/sk-|apiKey|api_key/i)
  })

  it('logs a failed decision trace with the failure reason', async () => {
    const { routing, session } = await freshSetup()
    const { api } = await import('@/services/electronAPI')
    // 不可用（无 key）触发 failure
    const { useSettingsStore } = await import('@/stores/settings')
    useSettingsStore().anthropicConfig.apiKey = ''

    await routing.startFirstMessageRouting(startInput(session.id))

    const decisionEvents = vi.mocked(api.trace.event).mock.calls
      .filter(([event]) => (event as unknown as { type?: string }).type === 'work-routing-decision')
    expect(decisionEvents).toHaveLength(1)
    const payload = decisionEvents[0][0] as unknown as Record<string, unknown>
    const metadata = payload.metadata as Record<string, unknown>
    expect(metadata.outcome).toBe('failed')
    expect(metadata.failure).toBe('unavailable')
    // key 永不落日志
    expect(JSON.stringify(payload)).not.toMatch(/sk-|apiKey|api_key/i)
  })

  it('shows the candidate card for a low-confidence decision without sending', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockResolvedValue(JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: 'editable deck' },
        { name: 'html-ppt-creator', score: 0.45, reason: 'web deck' },
      ],
    }))

    await routing.startFirstMessageRouting(startInput(session.id))

    const pending = chat.getPendingWorkRouting(session.id)
    expect(pending?.phase).toBe('candidates')
    expect(pending?.failure).toBeUndefined()
    expect(pending?.ranked.map(entry => entry.name)).toEqual(['ppt-creator', 'html-ppt-creator'])
    expect(session.assistantId).toBeUndefined()
    expect(session.workRouting).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('logs an override trace event when the candidate card picks a non-top-1 assistant', async () => {
    const { routing, session } = await freshSetup()
    const { api } = await import('@/services/electronAPI')
    mocks.sendMessage.mockResolvedValue(JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: 'top1' },
        { name: 'html-ppt-creator', score: 0.45, reason: 'top2' },
      ],
    }))

    await routing.startFirstMessageRouting(startInput(session.id))
    // 点选 top2（非 top1）→ override 信号
    await routing.pickCandidate(session.id, 'html-ppt-creator')

    const overrideEvents = vi.mocked(api.trace.event).mock.calls
      .filter(([event]) => (event as unknown as { type?: string }).type === 'work-routing-override')
    expect(overrideEvents).toHaveLength(1)
    const payload = overrideEvents[0][0] as unknown as Record<string, unknown>
    const metadata = payload.metadata as Record<string, unknown>
    expect(metadata.top1).toBe('ppt-creator')
    expect(metadata.picked).toBe('html-ppt-creator')
    // key 永不落日志
    expect(JSON.stringify(payload)).not.toMatch(/sk-|apiKey|api_key/i)
  })

  it('does not log an override event when the candidate card picks the top-1', async () => {
    const { routing, session } = await freshSetup()
    const { api } = await import('@/services/electronAPI')
    mocks.sendMessage.mockResolvedValue(JSON.stringify({
      none: false,
      candidates: [
        { name: 'ppt-creator', score: 0.5, reason: 'top1' },
        { name: 'html-ppt-creator', score: 0.3, reason: 'top2' },
      ],
    }))

    await routing.startFirstMessageRouting(startInput(session.id))
    await routing.pickCandidate(session.id, 'ppt-creator')

    const overrideEvents = vi.mocked(api.trace.event).mock.calls
      .filter(([event]) => (event as unknown as { type?: string }).type === 'work-routing-override')
    expect(overrideEvents).toHaveLength(0)
  })

  it('offers the general exit when the model says nothing matches', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockResolvedValue(JSON.stringify({ none: true, candidates: [] }))

    await routing.startFirstMessageRouting(startInput(session.id))

    const pending = chat.getPendingWorkRouting(session.id)
    expect(pending).toMatchObject({ phase: 'candidates', failure: 'none' })
    expect(pending?.suggestions.length).toBeGreaterThan(0)
    expect(send).not.toHaveBeenCalled()

    const handled = await routing.chooseGeneral(session.id)

    expect(handled).toBe(true)
    expect(session.assistantId).toBeUndefined()
    expect(session.workRouting).toMatchObject({ outcome: 'general' })
    expect(chat.getPendingWorkRouting(session.id)).toBeUndefined()
    expect(send).toHaveBeenCalledWith(
      '做个可编辑的 PPT',
      undefined,
      expect.objectContaining({ images: [] }),
      { sessionId: session.id },
    )
  })

  it('falls back to the failure card when the router model is unavailable', async () => {
    const { settings, chat, routing, session, send } = await freshSetup()
    settings.anthropicConfig.apiKey = ''

    await routing.startFirstMessageRouting(startInput(session.id))

    const pending = chat.getPendingWorkRouting(session.id)
    expect(pending).toMatchObject({ phase: 'candidates', failure: 'unavailable' })
    expect(pending?.suggestions.map(s => s.name)).toContain('ppt-creator')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('turns a user cancel into the failure card and never sends', async () => {
    const { chat, routing, session, send } = await freshSetup()
    let resolveRouter: ((raw: string) => void) | undefined
    mocks.sendMessage.mockImplementation(() => new Promise<string>((resolve) => { resolveRouter = resolve }))

    const run = routing.startFirstMessageRouting(startInput(session.id))
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())

    routing.cancelRouting(session.id)
    expect(chat.getPendingWorkRouting(session.id)).toMatchObject({
      phase: 'candidates',
      failure: 'abort',
    })

    resolveRouter?.(JSON.stringify({ none: false, candidates: [{ name: 'ppt-creator', score: 0.9, reason: 'late' }] }))
    await run

    expect(chat.getPendingWorkRouting(session.id)).toMatchObject({ phase: 'candidates', failure: 'abort' })
    expect(session.assistantId).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('times out into the failure card after 8 seconds', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockImplementation(() => new Promise<string>(() => {}))

    vi.useFakeTimers()
    try {
      const run = routing.startFirstMessageRouting(startInput(session.id))
      await vi.advanceTimersByTimeAsync(8_000)
      await run

      expect(chat.getPendingWorkRouting(session.id)).toMatchObject({
        phase: 'candidates',
        failure: 'timeout',
      })
      expect(send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts on session switch and lets the card still resolve afterwards', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockImplementation(() => new Promise<string>(() => {}))
    const other = chat.createSession('另一个会话', 'D:/work', undefined, { activate: false })

    const run = routing.startFirstMessageRouting(startInput(session.id))
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())

    await chat.selectSession(other.id)
    expect(chat.getPendingWorkRouting(session.id)).toMatchObject({
      phase: 'candidates',
      failure: 'abort',
    })
    await run
    await flushPromises()

    await chat.selectSession(session.id)
    const picked = await routing.pickCandidate(session.id, 'ppt-creator')

    expect(picked).toBe(true)
    expect(session.assistantId).toBe('ppt-creator')
    expect(session.workRouting).toMatchObject({ outcome: 'picked', assistant: 'ppt-creator' })
    expect(chat.getPendingWorkRouting(session.id)).toBeUndefined()
    expect(send).toHaveBeenCalledWith(
      '做个可编辑的 PPT',
      undefined,
      expect.objectContaining({ images: [] }),
      { sessionId: session.id },
    )
  })

  it('reselects from an auto session into a new session and resends the original input', async () => {
    const { chat, routing, session, send } = await freshSetup()
    session.assistantId = 'ppt-creator'
    session.workRouting = { outcome: 'auto', assistant: 'ppt-creator', at: Date.now() }
    session.messages.push(
      {
        id: 'u1',
        role: 'user',
        content: '把大纲做成可编辑 PPT',
        timestamp: 1,
        attachments: [{
          name: 'outline.md',
          path: 'D:/work/outline.md',
          isFolder: false,
          source: 'upload',
        }],
      },
      { id: 'a1', role: 'assistant', content: '做好了', timestamp: 2 },
    )

    const ok = await routing.reselectAssistant(session.id, 'docx-writer')

    expect(ok).toBe(true)
    const created = chat.currentSession!
    expect(created.id).not.toBe(session.id)
    expect(created.assistantId).toBe('docx-writer')
    expect(created.workRouting).toMatchObject({ outcome: 'picked', assistant: 'docx-writer' })
    // 改选是手动决定：不再调用路由模型
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      '@"D:/work/outline.md" 把大纲做成可编辑 PPT\n\nAttachments: [File: outline.md]',
      '把大纲做成可编辑 PPT',
      expect.objectContaining({
        files: [expect.objectContaining({ path: 'D:/work/outline.md' })],
        images: [],
      }),
      { sessionId: created.id },
    )
    // 旧会话保留（含已产出的回复），且仍是原来的助手
    expect(chat.sessions.some(s => s.id === session.id)).toBe(true)
    expect(session.assistantId).toBe('ppt-creator')
    expect(session.messages.map(m => m.id)).toEqual(['u1', 'a1'])
  })

  it('reselects from a general session and replays the first message', async () => {
    const { chat, routing, session, send } = await freshSetup()
    session.workRouting = { outcome: 'general', at: Date.now() }
    session.messages.push({ id: 'u1', role: 'user', content: '帮我看看这份材料', timestamp: 1 })

    const ok = await routing.reselectAssistant(session.id, 'ppt-creator')

    expect(ok).toBe(true)
    const created = chat.currentSession!
    expect(created.assistantId).toBe('ppt-creator')
    expect(created.workRouting).toMatchObject({ outcome: 'picked', assistant: 'ppt-creator' })
    expect(send).toHaveBeenCalledWith(
      '帮我看看这份材料',
      undefined,
      { files: [], images: [] },
      { sessionId: created.id },
    )
    expect(session.workRouting).toMatchObject({ outcome: 'general' })
  })

  it('ignores reselecting the assistant already in use and unknown names', async () => {
    const { chat, routing, session, send } = await freshSetup()
    session.workRouting = { outcome: 'auto', assistant: 'ppt-creator', at: Date.now() }
    const before = chat.sessions.length

    expect(await routing.reselectAssistant(session.id, 'ppt-creator')).toBe(false)
    expect(await routing.reselectAssistant(session.id, 'not-an-assistant')).toBe(false)

    expect(chat.sessions).toHaveLength(before)
    expect(chat.currentSessionId).toBe(session.id)
    expect(send).not.toHaveBeenCalled()
  })

  it('logs an override trace event when the marker re-selects a different assistant', async () => {
    const { routing, session } = await freshSetup()
    const { api } = await import('@/services/electronAPI')
    session.assistantId = 'ppt-creator'
    session.workRouting = { outcome: 'auto', assistant: 'ppt-creator', at: Date.now() }
    session.messages.push(
      { id: 'u1', role: 'user', content: '把大纲做成可编辑 PPT', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '做好了', timestamp: 2 },
    )

    await routing.reselectAssistant(session.id, 'docx-writer')

    const overrideEvents = vi.mocked(api.trace.event).mock.calls
      .filter(([event]) => (event as unknown as { type?: string }).type === 'work-routing-override')
    expect(overrideEvents).toHaveLength(1)
    const payload = overrideEvents[0][0] as unknown as Record<string, unknown>
    const metadata = payload.metadata as Record<string, unknown>
    expect(metadata.source).toBe('marker-reselect')
    expect(metadata.from).toBe('ppt-creator')
    expect(metadata.to).toBe('docx-writer')
    // key 永不落日志
    expect(JSON.stringify(payload)).not.toMatch(/sk-|apiKey|api_key/i)
  })

  it('binds in place when the assistant is picked from the gallery', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockResolvedValue(JSON.stringify({ none: true, candidates: [] }))
    await routing.startFirstMessageRouting(startInput(session.id))

    routing.openGalleryForRouting(session.id)
    expect(chat.routingGalleryTarget).toBe(session.id)

    const handled = await routing.completeGalleryPick('docx-writer')

    expect(handled).toBe(true)
    expect(chat.routingGalleryTarget).toBeNull()
    expect(session.assistantId).toBe('docx-writer')
    expect(session.workRouting).toMatchObject({ outcome: 'picked', assistant: 'docx-writer' })
    expect(send).toHaveBeenCalledWith(
      '做个可编辑的 PPT',
      undefined,
      expect.objectContaining({ images: [] }),
      { sessionId: session.id },
    )
  })

  it('manually retries routing after a failure and succeeds on the second attempt', async () => {
    const { chat, routing, session, send } = await freshSetup()
    // first routing call fails (429) — exhausts all auto-retries inside routeFirstMessage
    mocks.sendMessage.mockRejectedValue(new Error('API Error: 429 Too Many Requests'))

    vi.useFakeTimers()
    try {
      const run = routing.startFirstMessageRouting(startInput(session.id))
      // advance past auto-retry backoff delays (3 attempts with backoff)
      await vi.advanceTimersByTimeAsync(120_000)
      await run
    } finally {
      vi.useRealTimers()
    }

    // after auto-retry exhaustion the card is in candidates with failure='error'
    let pending = chat.getPendingWorkRouting(session.id)
    expect(pending?.phase).toBe('candidates')
    expect(pending?.failure).toBe('error')
    expect(pending?.retryCount).toBeUndefined()

    // user clicks retry — second call succeeds
    mocks.sendMessage.mockResolvedValueOnce(JSON.stringify({
      none: false,
      candidates: [{ name: 'ppt-creator', score: 0.92, reason: 'PPT' }],
    }))
    await routing.retryRouting(session.id, true)

    expect(session.assistantId).toBe('ppt-creator')
    expect(session.workRouting).toMatchObject({ outcome: 'auto', assistant: 'ppt-creator' })
    expect(chat.getPendingWorkRouting(session.id)).toBeUndefined()
    expect(send).toHaveBeenCalledWith(
      '做个可编辑的 PPT',
      undefined,
      expect.objectContaining({ images: [] }),
      { sessionId: session.id },
    )
  })

  it('manually retries routing after a failure and still fails, increments retryCount', async () => {
    const { chat, routing, session, send } = await freshSetup()
    mocks.sendMessage.mockRejectedValue(new Error('API Error: 429 Too Many Requests'))

    vi.useFakeTimers()
    try {
      const run = routing.startFirstMessageRouting(startInput(session.id))
      await vi.advanceTimersByTimeAsync(120_000)
      await run
    } finally {
      vi.useRealTimers()
    }
    let pending = chat.getPendingWorkRouting(session.id)
    expect(pending?.failure).toBe('error')

    // user clicks retry — still fails
    vi.useFakeTimers()
    try {
      const run = routing.retryRouting(session.id, true)
      await vi.advanceTimersByTimeAsync(120_000)
      await run
    } finally {
      vi.useRealTimers()
    }
    pending = chat.getPendingWorkRouting(session.id)
    expect(pending?.phase).toBe('candidates')
    expect(pending?.failure).toBe('error')
    expect(pending?.retryCount).toBe(1)

    expect(send).not.toHaveBeenCalled()
  })
})
