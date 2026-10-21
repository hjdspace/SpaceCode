import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@/types'

/**
 * 会话生命周期契约：新建 / 删除 / 切换 / 激活。
 *
 * 这些是 UI 最外层、最容易被误改的行为，且大多带隐藏边界：
 *  - createSession 把新会话 unshift 到列表头部并置为当前；activate=false 时
 *    侧边任务必须保持主会话不被切走（否则清掉主会话的 turn checkpoints）。
 *  - deleteSession 删当前会话要回退到剩余第一条，删最后一条要回退到 null；
 *    引擎 stop 失败不能阻断本地删除。
 *  - activateSession 的 suspended 分支区分"引擎换了→重启"与"同引擎→resume"，
 *    resume 抛错必须落到 exited 而不是卡住。
 * 断言的是状态迁移与真实下发到 api 的参数，不是"调用过"。
 */

const mocks = vi.hoisted(() => ({
  getSessionStatus: vi.fn(),
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
    agents: { install: vi.fn().mockResolvedValue({ success: true }) },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
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

describe('chatSession createSession', () => {
  it('places a new session at the head, marks it current and hydrates the empty draft', async () => {
    const { useAppStore } = await import('../app')
    const store = await loadStore()
    const app = useAppStore()

    store.createSession('First', 'D:/repo')
    const created = store.createSession('Second', 'D:/other')

    expect(store.sessions[0].id).toBe(created.id)
    expect(store.currentSessionId).toBe(created.id)
    expect(created.mode).toBe(app.mode)
    expect(created.isTabOpen).toBe(true)
    expect(created.processStatus).toBe('none')
    // 新建会话没有 JSONL 历史，创建事件以 session_created 落 trace
    expect(mocks.traceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session_created', status: 'completed' }),
    )
  })

  it('keeps the main session current when a side task is created with activate=false', async () => {
    const store = await loadStore()
    const main = store.createSession('Main', 'D:/main')

    store.createSession('Side task', 'D:/side', 'side-1', { activate: false })

    expect(store.currentSessionId).toBe(main.id)
    expect(store.sessions.find(s => s.id === 'side-1')).toBeDefined()
  })

  it('restores a session from an explicit id and tags the trace as session_restored', async () => {
    const store = await loadStore()

    store.createSession('Restored', 'D:/repo', 'fixed-id')

    expect(mocks.traceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'fixed-id',
        type: 'session_restored',
        title: 'Chat session restored from history',
      }),
    )
  })

  it('marks ephemeral side sessions so persistence can drop them', async () => {
    const store = await loadStore()

    const session = store.createSession('Ephemeral', undefined, undefined, { ephemeral: true })

    expect(session.ephemeral).toBe(true)
  })
})

describe('chatSession deleteSession', () => {
  it('falls back to the remaining first session when the current one is removed', async () => {
    const store = await loadStore()
    store.createSession('A', undefined, 'a')
    store.createSession('B', undefined, 'b') // b is current
    expect(store.currentSessionId).toBe('b')

    await store.deleteSession('b')

    expect(store.sessions.map(s => s.id)).toEqual(['a'])
    expect(store.currentSessionId).toBe('a')
    expect(mocks.stop).toHaveBeenCalledWith('b')
  })

  it('clears the current selection when the last session is deleted', async () => {
    const store = await loadStore()
    store.createSession('Only', undefined, 'only')

    await store.deleteSession('only')

    expect(store.sessions).toHaveLength(0)
    expect(store.currentSessionId).toBeNull()
  })

  it('ignores a delete for an unknown id and never calls the engine', async () => {
    const store = await loadStore()
    store.createSession('Keep', undefined, 'keep')

    await store.deleteSession('ghost')

    expect(store.sessions.map(s => s.id)).toEqual(['keep'])
    expect(store.currentSessionId).toBe('keep')
  })

  it('still removes the local session even when the engine refuses to stop', async () => {
    mocks.stop.mockRejectedValueOnce(new Error('process gone'))
    const store = await loadStore()
    store.createSession('A', undefined, 'a')
    store.createSession('B', undefined, 'b')

    await store.deleteSession('a')

    expect(store.sessions.map(s => s.id)).toEqual(['b'])
  })

  it('drops the deleted session input draft and its new-chat mirror', async () => {
    const store = await loadStore()
    store.createSession('A', undefined, 'a')
    const data = { text: 'draft', attachments: [], images: [], editorHtml: '' }
    store.saveDraft('a', data)
    store.setNewChatDraft('a', data)

    await store.deleteSession('a')

    expect(store.getDraft('a')).toBeUndefined()
    expect(store.getNewChatDraft()).toBeNull()
  })
})

describe('chatSession selectSession / deactivateSession', () => {
  it('switches the current session and adopts its working directory as project root', async () => {
    const store = await loadStore()
    store.createSession('A', '/proj/first', 'a')

    await store.selectSession('a')

    expect(store.currentSessionId).toBe('a')
    expect(store.currentProjectRoot).toBe('/proj/first')
    // 切换会话会清空上一会话的 turn checkpoints
    expect(store.turnCheckpoints).toEqual([])
  })

  it('pushes the session own permission mode when the backend drifted away from it', async () => {
    mocks.getSessionStatus.mockResolvedValueOnce({ isRunning: true, permissionMode: 'bypassPermissions' })
    const store = await loadStore()
    store.createSession('A', '/proj', 'a')

    await store.selectSession('a')

    // A 从没主动切过模式 → 取全局默认；后端跑在 bypassPermissions → 下发会话口径
    expect(mocks.setPermissionMode).toHaveBeenCalledWith('a', 'default')
  })

  it('switching back to a running session does not re-apply another session mode', async () => {
    const store = await loadStore()
    store.createSession('A', '/proj/a', 'a')
    store.createSession('B', '/proj/b', 'b')
    const { usePermissionPolicyStore } = await import('../permissionPolicy')
    const policy = usePermissionPolicyStore()

    // A 用完全信任，B 用计划模式 —— 两个会话各自记自己的模式
    await policy.setPermissionMode('a', 'bypassPermissions')
    await policy.setPermissionMode('b', 'plan')
    mocks.setPermissionMode.mockClear()
    mocks.getSessionStatus.mockResolvedValue({ isRunning: true, permissionMode: 'bypassPermissions' })

    store.selectSession('a')
    await new Promise(r => setTimeout(r, 0))

    // 这是原来的串扰：B 选的 plan 会被当成"用户偏好"下发给正在跑 bypass 的 A
    expect(mocks.setPermissionMode).not.toHaveBeenCalled()
    expect(policy.getPermissionMode('a')).toBe('bypassPermissions')
    expect(policy.getPermissionMode('b')).toBe('plan')
  })

  it('deactivating marks the tab closed without touching other sessions', async () => {
    const store = await loadStore()
    store.createSession('A', undefined, 'a')
    store.createSession('B', undefined, 'b')

    store.deactivateSession('a')

    expect(store.sessions.find(s => s.id === 'a')!.isTabOpen).toBe(false)
    expect(store.sessions.find(s => s.id === 'b')!.isTabOpen).toBe(true)
  })

  it('deactivating an unknown id is a silent no-op', async () => {
    const store = await loadStore()
    store.createSession('A', undefined, 'a')

    store.deactivateSession('ghost')

    expect(store.sessions.find(s => s.id === 'a')!.isTabOpen).toBe(true)
  })
})

describe('chatSession activateSession', () => {
  it('resumes a suspended session on the same engine and lands it active', async () => {
    const store = await loadStore()
    const session = store.createSession('A', '/proj', 'a')
    session.processStatus = 'suspended'

    await store.activateSession('a')

    expect(mocks.resumeSession).toHaveBeenCalledWith('a')
    expect(session.processStatus).toBe('active')
  })

  it('marks the session exited when the resume call fails', async () => {
    mocks.resumeSession.mockRejectedValueOnce(new Error('resume boom'))
    const store = await loadStore()
    const session = store.createSession('A', '/proj', 'a')
    session.processStatus = 'suspended'

    await store.activateSession('a')

    expect(session.processStatus).toBe('exited')
  })

  it('resumes a suspended session on its own engine even when the global default differs', async () => {
    const store = await loadStore()
    const session = store.createSession('A', '/proj', 'a')
    session.processStatus = 'suspended'
    session.engineType = 'pi' // 全局默认仍是 claude-code；会话归属必须压过全局
    session.messages.push({ id: 'u1', role: 'user', content: 'hi', timestamp: 1 })

    await store.activateSession('a')

    expect(mocks.resumeSession).toHaveBeenCalledWith('a')
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.startSession).not.toHaveBeenCalled()
  })

  it('boots an exited session that still carries history', async () => {
    const store = await loadStore()
    const session = store.createSession('A', '/proj', 'a')
    session.processStatus = 'exited'
    session.messages.push({ id: 'u1', role: 'user', content: 'hi', timestamp: 1 })

    await store.activateSession('a')

    expect(mocks.startSession).toHaveBeenCalledWith('a', expect.anything())
    expect(session.processStatus).toBe('idle')
  })

  it('skips booting an empty session and returns for an unknown id', async () => {
    const store = await loadStore()
    const session = store.createSession('A', '/proj', 'a')
    session.processStatus = 'none'

    await store.activateSession('a')
    await store.activateSession('ghost')

    expect(mocks.startSession).not.toHaveBeenCalled()
    expect(session.processStatus).toBe('none')
  })
})

describe('chatSession ensureSession and by-id selectors', () => {
  it('returns the existing session untouched instead of creating a duplicate', async () => {
    const store = await loadStore()
    const created = store.createSession('Original', '/proj', 'dup')

    const again = store.ensureSession('dup', { title: 'Different' })

    expect(again.id).toBe(created.id)
    expect(again.title).toBe('Original')
    expect(store.sessions.filter(s => s.id === 'dup')).toHaveLength(1)
  })

  it('creates a session bound to the hint when none exists', async () => {
    const store = await loadStore()

    const session = store.ensureSession('fresh', { title: 'From hint', projectPath: '/proj/x' })

    expect(session.title).toBe('From hint')
    expect(session.workingDirectory).toBe('/proj/x')
    expect(store.currentSessionId).toBe('fresh')
  })

  it('reads messages and view state by id without disturbing the global current', async () => {
    const store = await loadStore()
    const a = store.createSession('A', '/proj/a', 'a')
    a.messages.push({ id: 'm1', role: 'user', content: 'hello', timestamp: 1 })
    store.createSession('B', '/proj/b', 'b') // b becomes current

    expect(store.getSessionMessages('a').map(m => m.id)).toEqual(['m1'])
    expect(store.getSession('nope')).toBeNull()
    expect(store.getSessionMessages(undefined)).toEqual([])
    expect(store.getWorkingDirectory('a')).toBe('/proj/a')
    expect(store.getIsViewingTeammate('a')).toBe(false)
    // 未切换 current：仍指向 b
    expect(store.currentSessionId).toBe('b')
  })

  it('returns the teammate transcript through getDisplayMessages when viewing a teammate', async () => {
    const store = await loadStore()
    const session: Session = store.createSession('A', '/proj', 'a')
    session.messages.push({ id: 'main', role: 'user', content: 'main line', timestamp: 1 })
    session.viewingAgentTaskId = 't1'
    session.teammateTranscripts = { t1: [{ id: 'tm1', role: 'assistant', content: 'teammate reply', timestamp: 2 }] }

    expect(store.getDisplayMessages('a').map(m => m.id)).toEqual(['tm1'])
    expect(store.getViewedTeammate('a')).toBeNull() // no teamContext entry yet
    expect(store.getViewedAgentTaskId('a')).toBe('t1')
  })
})

describe('chatSession projects', () => {
  it('normalizes, dedupes and switches the current project root', async () => {
    const store = await loadStore()

    store.addProject('/work/proj')
    store.addProject('/work/proj') // 重复 → 不追加

    expect(store.projects).toEqual(['/work/proj'])
    expect(store.currentProjectRoot).toBe('/work/proj')
  })

  it('exposes union of project list and session directories through allProjects', async () => {
    const store = await loadStore()
    store.createSession('A', '/from/session', 'a')
    store.addProject('/from/list')

    expect(store.allProjects).toContain('/from/session')
    expect(store.allProjects).toContain('/from/list')
  })

  it('clears the current root and drops the entry when a project is removed', async () => {
    const store = await loadStore()
    store.addProject('/drop')

    store.removeProject('/drop')

    expect(store.projects).not.toContain('/drop')
    expect(store.currentProjectRoot).toBe('')
  })
})

describe('chatSession startup state', () => {
  it('resets any persisted non-terminal process status to none on load', async () => {
    localStorage.setItem('chat_sessions_v2', JSON.stringify([{
      id: 'ghost-process',
      title: 'was active',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2,
      processStatus: 'active',
      isTabOpen: true,
    }]))

    const store = await loadStore()

    expect(store.sessions.find(s => s.id === 'ghost-process')!.processStatus).toBe('none')
  })

  it('migrates legacy chat_sessions_* buckets into the live list and clears them', async () => {
    localStorage.setItem('chat_sessions_legacy', JSON.stringify([{
      id: 'legacy-1',
      title: 'old',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      processStatus: 'none',
      isTabOpen: false,
    }]))

    const store = await loadStore()

    expect(store.sessions.map(s => s.id)).toContain('legacy-1')
    expect(localStorage.getItem('chat_sessions_legacy')).toBeNull()
  })
})

describe('chatSession canSwitchWorkingDirectory', () => {
  const userMessage = {
    id: 'm1',
    role: 'user' as const,
    content: 'hi',
    timestamp: 1,
  }

  it('allows the switch before any session exists', async () => {
    const store = await loadStore()

    expect(store.canSwitchWorkingDirectory(null)).toBe(true)
    expect(store.canSwitchWorkingDirectory('never-created')).toBe(true)
  })

  it('allows the switch while the session is still empty', async () => {
    const store = await loadStore()
    const session = store.createSession('Fresh', 'D:/repo')

    expect(store.canSwitchWorkingDirectory(session.id)).toBe(true)
  })

  it('locks the session once it carries a message, and the lock is per session', async () => {
    const store = await loadStore()
    const used = store.createSession('Used', 'D:/repo')
    const fresh = store.createSession('Fresh', 'D:/other')
    used.messages.push(userMessage)

    expect(store.canSwitchWorkingDirectory(used.id)).toBe(false)
    expect(store.canSwitchWorkingDirectory(fresh.id)).toBe(true)
  })
})

describe('chatSession switchWorkAssistant', () => {
  it('rebinds the empty session to the workspace its skills were just installed into', async () => {
    const { normalizeAbsolutePath } = await import('@/utils/normalizePath')
    const { useAppStore } = await import('../app')
    const app = useAppStore()
    const store = await loadStore()
    const session = store.createSession('Work', 'D:/old')
    session.mode = 'work'
    app.setWorkWorkspace('D:/workspace')

    await store.switchWorkAssistant({ name: 'Docx Writer' })

    expect(session.workingDirectory).toBe(normalizeAbsolutePath('D:/workspace'))
  })

  it('keeps the directory of a session that already carries a message', async () => {
    const { useAppStore } = await import('../app')
    const app = useAppStore()
    const store = await loadStore()
    const session = store.createSession('Work', 'D:/old')
    session.mode = 'work'
    session.messages.push({ id: 'm1', role: 'user', content: 'hi', timestamp: 1 })
    app.setWorkWorkspace('D:/workspace')

    await store.switchWorkAssistant({ name: 'Docx Writer' })

    expect(session.workingDirectory).toBe('D:/old')
    // 锁的是目录，不是换助手本身
    expect(session.assistantId).toBe('Docx Writer')
  })
})
