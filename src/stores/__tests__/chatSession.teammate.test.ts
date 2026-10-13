import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Message, TeamContext } from '@/types'

/**
 * Teammate / 子智能体状态聚合契约。
 *
 * Agent Team 的两类成员走完全不同的收纳规则，写错就会污染主时间线：
 *  - recordTeammateMessage：只有真正的 teammate（type=teammate 或带 teamName）才建
 *    teamContext；同一条消息（同 uuid）重复到达要原地更新而非再追加；成员进入
 *    completed/failed 时补一条 task-notification 系统消息，但同一终态不得重复补。
 *  - recordSubagentMessage：普通 Agent 工具的子智能体，只写 teammateTranscripts，
 *    绝不建 teamContext、绝不往主时间线推通知。
 *  - handleTaskNotification：只认 subtype=task_notification 且状态可归一（completed /
 *    failed 系），命中对应 Agent/Task 工具调用后置终态；未知状态或找不到会话直接吞掉。
 *  - viewTeammateTranscript / backToLeaderView 与 displayMessages/viewedTeammate
 *    决定右栏看的是队友转录还是主线消息。
 */

const mocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
  startSession: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
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
      listAgents: vi.fn().mockResolvedValue([]),
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

function seedSession(id: string, extra: Record<string, unknown> = {}): void {
  localStorage.setItem('chat_sessions_v2', JSON.stringify([{
    id,
    title: 'seeded',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 2,
    workingDirectory: '/repo',
    processStatus: 'none',
    isTabOpen: true,
    ...extra,
  }]))
}

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

describe('chatSession recordTeammateMessage', () => {
  it('rejects raw events that are not real teammate messages', async () => {
    seedSession('a')
    const store = await loadStore()

    const result = store.recordTeammateMessage({ message: { content: 'plain' } }, 'a')

    expect(result).toBeNull()
    expect(store.getSession('a')!.teamContext).toBeUndefined()
  })

  it('returns null when the target session no longer exists', async () => {
    seedSession('a')
    const store = await loadStore()

    const result = store.recordTeammateMessage(
      { uuid: 'tm-1', teamName: 'Team', agentName: 'Alice', message: { content: 'x' } },
      'ghost',
    )

    expect(result).toBeNull()
  })

  it('builds the team roster, stores the transcript and notifies on completion', async () => {
    seedSession('a')
    const store = await loadStore()

    const message = store.recordTeammateMessage({
      uuid: 'tm-1',
      teamName: 'Team',
      agentName: 'Alice',
      status: 'completed',
      message: { role: 'assistant', content: 'finished the module' },
      timestamp: '2026-01-01T00:00:00.000Z',
    }, 'a')

    const session = store.getSession('a')!
    expect(message).not.toBeNull()
    expect(message!.id).toBe('tm-1')
    expect(message!.metadata?.agentTaskId).toBe('alice')
    expect(session.teamContext!.teammates.alice).toMatchObject({ name: 'Alice', status: 'completed', messageCount: 1 })
    expect(session.teammateTranscripts!.alice.map(m => m.content)).toEqual(['finished the module'])
    // 完成态补一条系统通知到主时间线
    const note = session.messages.find(m => m.metadata?.kind === 'task-notification')
    expect(note).toBeDefined()
    expect(note!.metadata?.status).toBe('completed')
  })

  it('updates an already-stored teammate message in place instead of duplicating it', async () => {
    seedSession('a')
    const store = await loadStore()

    store.recordTeammateMessage({ uuid: 'tm-1', teamName: 'Team', agentName: 'Alice', status: 'running', message: { content: 'draft one' } }, 'a')
    store.recordTeammateMessage({ uuid: 'tm-1', teamName: 'Team', agentName: 'Alice', status: 'running', message: { content: 'draft two' } }, 'a')

    const transcript = store.getSession('a')!.teammateTranscripts!.alice
    expect(transcript).toHaveLength(1)
    expect(transcript[0].content).toBe('draft two')
  })

  it('never adds a second notification once a teammate has already reported that terminal status', async () => {
    seedSession('a')
    const store = await loadStore()
    const raw = { uuid: 'tm-x', teamName: 'Team', agentName: 'Bob', status: 'failed', message: { content: 'crashed' } }

    store.recordTeammateMessage(raw, 'a')
    store.recordTeammateMessage(raw, 'a')

    const notes = store.getSession('a')!.messages.filter(m => m.metadata?.kind === 'task-notification')
    expect(notes).toHaveLength(1)
  })
})

describe('chatSession recordSubagentMessage', () => {
  it('keeps subagent transcripts out of the team roster entirely', async () => {
    seedSession('a')
    const store = await loadStore()

    const message = store.recordSubagentMessage({
      uuid: 'sub-1',
      isSidechain: true,
      agentName: 'Researcher',
      subagent_type: 'general-purpose',
      message: { role: 'assistant', content: 'found three sources' },
      timestamp: '2026-01-01T00:00:00.000Z',
    }, 'a')

    const session = store.getSession('a')!
    expect(message).not.toBeNull()
    expect(session.teamContext).toBeUndefined() // 关键区别：子智能体不进 teamContext
    expect(session.teammateTranscripts!.researcher.map(m => m.content)).toEqual(['found three sources'])
    // 也不往主时间线推系统通知
    expect(session.messages).toHaveLength(0)
  })

  it('returns null for a subagent event aimed at a missing session', async () => {
    seedSession('a')
    const store = await loadStore()

    expect(store.recordSubagentMessage({ uuid: 's1', isSidechain: true, message: { content: 'x' } }, 'ghost')).toBeNull()
  })
})

describe('chatSession handleTaskNotification', () => {
  function sessionWithAgentTool() {
    seedSession('a', {
      messages: [{
        id: 'm1', role: 'assistant', content: '', timestamp: 1,
        toolCalls: [{ id: 'tool-1', name: 'Agent', input: { name: 'Worker' }, status: 'running' }],
      }],
    })
  }

  it('ignores events that are not task notifications', async () => {
    sessionWithAgentTool()
    const store = await loadStore()

    store.handleTaskNotification(null, 'a')
    store.handleTaskNotification({ subtype: 'other', status: 'completed' }, 'a')

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('running')
  })

  it('ignores notification statuses that carry no settled terminal meaning', async () => {
    sessionWithAgentTool()
    const store = await loadStore()

    store.handleTaskNotification({ subtype: 'task_notification', status: 'running', tool_use_id: 'tool-1' }, 'a')

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('running')
  })

  it('is a no-op when the notification targets an unknown session', async () => {
    sessionWithAgentTool()
    const store = await loadStore()

    expect(() => store.handleTaskNotification(
      { subtype: 'task_notification', status: 'completed', tool_use_id: 'tool-1' },
      'ghost',
    )).not.toThrow()
  })

  it('settles the matching Agent tool call and records its terminal teammate state', async () => {
    sessionWithAgentTool()
    const store = await loadStore()

    store.handleTaskNotification(
      { subtype: 'task_notification', status: 'completed', tool_use_id: 'tool-1', summary: 'all good' },
      'a',
    )

    const tc = store.getSession('a')!.messages[0].toolCalls![0]
    expect(tc.status).toBe('completed')
    expect(tc.endTime).toBeTypeOf('number')
  })

  it('maps a failed notification onto an errored tool call', async () => {
    sessionWithAgentTool()
    const store = await loadStore()

    store.handleTaskNotification(
      { subtype: 'task_notification', status: 'killed', tool_use_id: 'tool-1' },
      'a',
    )

    expect(store.getSession('a')!.messages[0].toolCalls![0].status).toBe('error')
  })
})

describe('chatSession teammate view switching', () => {
  const teamContext: TeamContext = {
    teamName: 'Team',
    isLeader: true,
    teammates: {
      alice: { name: 'Alice', status: 'running', color: 'red', messageCount: 1 },
    },
  }
  const transcript: Record<string, Message[]> = {
    alice: [{ id: 'tm-1', role: 'assistant', content: 'teammate says hi', timestamp: 2 }],
  }

  it('shows the leader timeline until a teammate transcript is opened', async () => {
    seedSession('a', {
      teamContext,
      teammateTranscripts: transcript,
      messages: [{ id: 'main', role: 'user', content: 'main line', timestamp: 1 }],
    })
    const store = await loadStore()
    await store.selectSession('a')

    expect(store.displayMessages.map(m => m.id)).toEqual(['main'])

    store.viewTeammateTranscript('alice')

    expect(store.isViewingTeammate).toBe(true)
    expect(store.viewedTeammate).toMatchObject({ name: 'Alice' })
    expect(store.displayMessages.map(m => m.id)).toEqual(['tm-1'])
    expect(store.getSession('a')!.expandedView).toBe('teammates')
  })

  it('refuses to view a teammate id that is not on the roster', async () => {
    seedSession('a', { teamContext, teammateTranscripts: transcript })
    const store = await loadStore()
    await store.selectSession('a')

    store.viewTeammateTranscript('nobody')

    expect(store.isViewingTeammate).toBe(false)
  })

  it('returns to leader view, keeping the teammates panel expanded when a team exists', async () => {
    seedSession('a', {
      teamContext,
      teammateTranscripts: transcript,
      viewingAgentTaskId: 'alice',
      expandedView: 'teammates',
    })
    const store = await loadStore()
    await store.selectSession('a')

    store.backToLeaderView()

    expect(store.getSession('a')!.viewingAgentTaskId).toBeUndefined()
    expect(store.getSession('a')!.expandedView).toBe('teammates')
    expect(store.isViewingTeammate).toBe(false)
  })

  it('collapses to the none panel on backToLeaderView for a team-less session', async () => {
    seedSession('a', { viewingAgentTaskId: 'leftover' })
    const store = await loadStore()
    await store.selectSession('a')

    store.backToLeaderView()

    expect(store.getSession('a')!.expandedView).toBe('none')
  })
})
