import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Message, Session } from '@/types'

/**
 * 消息写入 / 更新与暂存草稿契约。
 *
 * addMessage / updateMessage 是流式渲染期间被调用最密集的路径，也是最容易
 * 出隐性错误的地方：
 *  - addMessage 命中相同 id 必须原地替换而非重复追加（重试/去重依赖此语义）。
 *  - 单会话消息数封顶 500，超出从头部裁剪，保证 retryLastMessage 仍能拿到最近
 *    的用户消息，同时防止长任务把内存打爆。
 *  - updateToolCall 先在目标消息里找工具调用，找不到要跨整个会话兜底扫描
 *    （乱序到达的 tool_result 常常挂在另一条助手消息上）。
 *  - stash（Ctrl+S）会被自动补发，draft（自动保存草稿）绝不能被自动补发，
 *    两者必须是相互独立的存储。
 */

const mocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
  startSession: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  listAllSessions: vi.fn().mockResolvedValue([]),
  getFullSession: vi.fn().mockResolvedValue({ messages: [] }),
  traceEvent: vi.fn(),
  getTurnCheckpoints: vi.fn().mockResolvedValue({ ok: true, checkpoints: [], error: null }),
  getTurnRewindPreviewFiles: vi.fn().mockResolvedValue({ ok: true, files: [], error: null }),
  rewindTurn: vi.fn().mockResolvedValue({ ok: true, error: null }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      getSessionStatus: mocks.getSessionStatus,
      startSession: mocks.startSession,
      stop: mocks.stop,
      resumeSession: mocks.resumeSession,
      setPermissionMode: mocks.setPermissionMode,
      listAgents: mocks.listAgents,
      listAllSessions: mocks.listAllSessions,
      getFullSession: mocks.getFullSession,
    },
    image: null,
    trace: { event: mocks.traceEvent },
    session: {
      getTurnCheckpoints: mocks.getTurnCheckpoints,
      getTurnRewindPreviewFiles: mocks.getTurnRewindPreviewFiles,
      rewindTurn: mocks.rewindTurn,
    },
    getCwd: vi.fn().mockResolvedValue(''),
    injectGuiModelsToSettings: vi.fn().mockResolvedValue({ success: true }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.getSessionStatus.mockResolvedValue({ isRunning: false })
})

async function loadStore() {
  const { useChatSessionStore } = await import('../chatSession')
  return useChatSessionStore()
}

function seedSession(id: string, messages: Message[], extra: Partial<Session> = {}): void {
  localStorage.setItem('chat_sessions_v2', JSON.stringify([{
    id,
    title: 'seeded',
    messages,
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 2,
    workingDirectory: '/repo',
    processStatus: 'none',
    isTabOpen: true,
    ...extra,
  }]))
}

describe('chatSession addMessage', () => {
  it('appends a new message with a generated id and stamps activity time', async () => {
    const store = await loadStore()
    store.createSession('A', '/repo', 'a')

    const msg = store.addMessage({ role: 'user', content: 'hello' }, 'a')

    const session = store.getSession('a')!
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0].id).toBe(msg.id)
    expect(msg.timestamp).toBeTypeOf('number')
    expect(session.updatedAt).toBeGreaterThanOrEqual(msg.timestamp)
  })

  it('replaces an in-flight message in place when the same id arrives again', async () => {
    seedSession('a', [{ id: 'partial', role: 'assistant', content: 'thinking...', timestamp: 1 }])
    const store = await loadStore()

    store.addMessage({ id: 'partial', role: 'assistant', content: 'final answer' }, 'a')

    const session = store.getSession('a')!
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0].content).toBe('final answer')
  })

  it('trims the oldest messages once a session crosses the 500 message ceiling', async () => {
    seedSession('a', [])
    const store = await loadStore()
    const session = store.getSession('a')!
    for (let i = 0; i < 500; i++) {
      session.messages.push({ id: `m${i}`, role: 'assistant', content: `c${i}`, timestamp: i })
    }

    store.addMessage({ id: 'overflow', role: 'assistant', content: 'newest' }, 'a')

    expect(session.messages).toHaveLength(500)
    expect(session.messages[0].id).toBe('m1') // m0 被裁掉
    expect(session.messages[session.messages.length - 1].id).toBe('overflow')
  })

  it('creates a session on the fly when there is no current session to write into', async () => {
    const store = await loadStore()
    expect(store.currentSessionId).toBeNull()

    store.addMessage({ role: 'user', content: 'first thing' })

    expect(store.currentSessionId).not.toBeNull()
    expect(store.getSessionMessages(store.currentSessionId).map(m => m.content)).toEqual(['first thing'])
  })

  it('records an Agent tool call into the subagent transcript registry', async () => {
    seedSession('a', [])
    const store = await loadStore()

    store.addMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tool-agent', name: 'Agent', input: { name: 'Researcher' }, status: 'running' }],
    }, 'a')

    const session = store.getSession('a')!
    // Agent 工具调用被登记后，转录容器已就绪，且非 team（子智能体不进 teamContext）
    expect(session.teammateTranscripts).toBeDefined()
    expect(session.teamContext).toBeUndefined()
  })
})

describe('chatSession updateMessage', () => {
  it('merges the patch into the matched message', async () => {
    seedSession('a', [{ id: 'm1', role: 'assistant', content: 'old', timestamp: 1 }])
    const store = await loadStore()

    store.updateMessage('m1', { content: 'new', metadata: { duration: 5 } }, 'a')

    expect(store.getSession('a')!.messages[0]).toMatchObject({ content: 'new', metadata: { duration: 5 } })
  })

  it('leaves the session untouched when the message id is unknown', async () => {
    seedSession('a', [{ id: 'm1', role: 'assistant', content: 'old', timestamp: 1 }])
    const store = await loadStore()

    store.updateMessage('ghost', { content: 'should not apply' }, 'a')

    expect(store.getSession('a')!.messages[0].content).toBe('old')
  })

  it('is a no-op when neither the target nor a current session exists', async () => {
    const store = await loadStore()

    expect(() => store.updateMessage('m1', { content: 'x' })).not.toThrow()
  })
})

describe('chatSession updateToolCall', () => {
  it('flips the tool call status on the primary message', async () => {
    seedSession('a', [{
      id: 'm1', role: 'assistant', content: '', timestamp: 1,
      toolCalls: [{ id: 'tc1', name: 'Bash', input: {}, status: 'running' }],
    }])
    const store = await loadStore()
    await store.selectSession('a')

    store.updateToolCall('m1', 'tc1', 'completed')

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('completed')
  })

  it('falls back to scanning other messages when the tool call is not on the given message', async () => {
    seedSession('a', [
      { id: 'm1', role: 'assistant', content: '', timestamp: 1, toolCalls: [{ id: 'tc1', name: 'Bash', input: {}, status: 'running' }] },
      { id: 'm2', role: 'assistant', content: '', timestamp: 2 },
    ])
    const store = await loadStore()
    await store.selectSession('a')

    // 用错误的 messageId 调用，兜底扫描仍应命中 tc1
    store.updateToolCall('m2', 'tc1', 'error')

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('error')
  })

  it('does nothing when the tool call id is absent from the whole session', async () => {
    seedSession('a', [{
      id: 'm1', role: 'assistant', content: '', timestamp: 1,
      toolCalls: [{ id: 'tc1', name: 'Bash', input: {}, status: 'running' }],
    }])
    const store = await loadStore()
    await store.selectSession('a')

    store.updateToolCall('m1', 'nope', 'completed')

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('running')
  })

  it('targets a specific session through the SessionSink seam without reading global current', async () => {
    seedSession('a', [{
      id: 'm1', role: 'assistant', content: '', timestamp: 1,
      toolCalls: [{ id: 'tc1', name: 'Read', input: {}, status: 'pending' }],
    }])
    const store = await loadStore()
    // 不设置 currentSessionId，直接用 sessionId 定位
    store.updateToolCallForSession('a', 'm1', 'tc1', 'completed')

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('completed')
  })

  it('silently ignores a per-session tool call update for an unknown session', async () => {
    const store = await loadStore()

    expect(() => store.updateToolCallForSession('ghost', 'm1', 'tc1', 'completed')).not.toThrow()
  })
})

describe('chatSession prompt stash and drafts', () => {
  const payload = {
    text: 'write tests',
    attachments: [],
    images: [],
    editorHtml: '<p>write tests</p>',
  }

  it('stores, reads and clears a stashed prompt independently per session', async () => {
    const store = await loadStore()

    store.stashPrompt('a', payload)

    expect(store.hasStash('a')).toBe(true)
    expect(store.getStash('a')).toEqual(payload)

    store.clearStash('a')

    expect(store.hasStash('a')).toBe(false)
    expect(store.getStash('a')).toBeUndefined()
  })

  it('keeps auto-saved drafts separate from explicit stashes', async () => {
    const store = await loadStore()

    store.saveDraft('a', payload)

    expect(store.getDraft('a')).toEqual(payload)
    expect(store.hasStash('a')).toBe(false) // draft 不会污染 stash，反之也不会被自动补发

    store.clearDraft('a')
    expect(store.getDraft('a')).toBeUndefined()
  })

  it('tracks which session owns the new-chat draft mirror and can forget it', async () => {
    const store = await loadStore()

    store.setNewChatDraft('owner-1', payload)
    expect(store.getNewChatDraft()).toEqual({ ownerSessionId: 'owner-1', data: payload })

    store.clearNewChatDraft()
    expect(store.getNewChatDraft()).toBeNull()
  })
})

describe('chatSession loading state and misc triggers', () => {
  it('flags a session as loading and reflects it through every getter', async () => {
    const store = await loadStore()
    store.createSession('A', '/repo', 'a') // a becomes current

    store.setSessionLoading('a', true)
    expect(store.isSessionLoading('a')).toBe(true)
    expect(store.getIsLoading('a')).toBe(true)
    expect(store.isLoading).toBe(true)

    store.setSessionLoading('a', false)
    expect(store.isSessionLoading('a')).toBe(false)
    expect(store.getIsLoading(undefined)).toBe(false)
  })

  it('bumps the diff panel trigger counter each time it is requested', async () => {
    const store = await loadStore()
    const before = store.diffPanelTrigger

    store.triggerDiffPanel()
    store.triggerDiffPanel()

    expect(store.diffPanelTrigger).toBe(before + 2)
  })

  it('applies a completed TaskCreate result to the task board via the tool result seam', async () => {
    seedSession('a', [{
      id: 'm1', role: 'assistant', content: '', timestamp: 1,
      toolCalls: [{ id: 'tc1', name: 'TaskCreate', input: { description: 'do it' }, status: 'completed' }],
    }])
    const store = await loadStore()
    const { useTaskManager } = await import('@/composables/useTaskManager')

    store.updateTaskStateFromToolResult(
      store.getSession('a')!.messages[0].toolCalls!,
      'tc1',
      'Task #7 created successfully: ship release',
    )

    // 任务真被创建，说明 sync 确实跑到了被测模块（而非空转）
    expect(useTaskManager().getAllTasks().some(t => t.content === 'ship release')).toBe(true)
  })

  it('ignores a tool result whose id does not match any call in the list', async () => {
    seedSession('a', [{
      id: 'm1', role: 'assistant', content: '', timestamp: 1,
      toolCalls: [{ id: 'tc1', name: 'TaskCreate', input: {}, status: 'completed' }],
    }])
    const store = await loadStore()

    expect(() => store.updateTaskStateFromToolResult(
      store.getSession('a')!.messages[0].toolCalls!,
      'unrelated-id',
      'Task #99 created successfully: phantom',
    )).not.toThrow()
  })
})
