import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { loadDeletedSessionIds, loadSessionsFromStorage } from '@/services/sessionPersistence'

/**
 * 归档契约：归档是导航动作，不是删除。
 *
 * 容易改坏的隐藏边界：
 *  - 归档必须保留消息与 updatedAt —— 取消归档要回到原来的新鲜度位置；
 *  - 归档不停引擎，正在跑的任务照常跑完；
 *  - 侧栏只消费 normalSessions，归档必须从那份列表里消失；
 *  - 自动归档跳过运行中的会话，否则用户看不到进度也找不到停止入口；
 *  - 归档会话又收到用户消息 = 它重新活跃了，必须自动回到侧栏。
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

const DAY = 86_400_000

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

async function loadSettings() {
  const { useSettingsStore } = await import('../settings')
  return useSettingsStore()
}

describe('chatSession archiveSession', () => {
  it('leaves the sidebar list but keeps messages, updatedAt and the engine untouched', async () => {
    const store = await loadStore()
    const session = store.createSession('Keep me', 'D:/repo', 'sess-1')
    store.addMessage({ role: 'user', content: 'hello' }, session.id)
    const updatedAt = session.updatedAt

    expect(store.archiveSession(session.id)).toBe(true)

    expect(store.normalSessions.map(s => s.id)).not.toContain(session.id)
    expect(store.archivedSessions.map(s => s.id)).toEqual([session.id])
    expect(store.getSession(session.id)?.messages).toHaveLength(1)
    expect(store.getSession(session.id)?.updatedAt).toBe(updatedAt)
    expect(store.getSession(session.id)?.isTabOpen).toBe(false)
    expect(store.getSession(session.id)?.archivedAt).toBeGreaterThan(0)
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('is idempotent and rejects unknown ids', async () => {
    const store = await loadStore()
    const session = store.createSession('Once', undefined, 'sess-1')

    expect(store.archiveSession(session.id)).toBe(true)
    const archivedAt = store.getSession(session.id)!.archivedAt
    expect(store.archiveSession(session.id)).toBe(false)
    expect(store.getSession(session.id)!.archivedAt).toBe(archivedAt)
    expect(store.archiveSession('nope')).toBe(false)
  })

  it('moves the current session off the archived one, skipping side tasks', async () => {
    const store = await loadStore()
    store.createSession('Main', undefined, 'main')
    store.createSession('Side', undefined, 'side', { ephemeral: true, activate: false })
    const archived = store.createSession('Doomed', undefined, 'doomed')
    expect(store.currentSessionId).toBe(archived.id)

    store.archiveSession(archived.id)

    expect(store.currentSessionId).toBe('main')
  })

  it('clears the current session when nothing else is left', async () => {
    const store = await loadStore()
    const only = store.createSession('Only', undefined, 'only')

    store.archiveSession(only.id)

    expect(store.currentSessionId).toBeNull()
  })

  it('persists the flag so a restart does not resurrect the session into the sidebar', async () => {
    const store = await loadStore()
    const session = store.createSession('Persisted', undefined, 'sess-1')
    store.archiveSession(session.id)
    store.flushSaveNow()

    const persisted = loadSessionsFromStorage().find(s => s.id === session.id)
    expect(persisted?.archived).toBe(true)
    expect(persisted?.archivedAt).toBe(session.archivedAt)
  })
})

describe('chatSession unarchiveSession', () => {
  it('puts the session back at its original freshness, not at the top', async () => {
    const store = await loadStore()
    const older = store.createSession('Older', undefined, 'older')
    older.updatedAt = Date.now() - 10 * DAY
    const newer = store.createSession('Newer', undefined, 'newer')
    store.archiveSession(older.id)

    expect(store.unarchiveSession(older.id)).toBe(true)

    expect(store.getSession(older.id)?.archived).toBe(false)
    expect(store.getSession(older.id)?.archivedAt).toBeUndefined()
    expect(store.getSession(older.id)?.updatedAt).toBe(older.updatedAt)
    expect(store.archivedSessions).toHaveLength(0)
    const sorted = [...store.normalSessions].sort((a, b) => b.updatedAt - a.updatedAt)
    expect(sorted[0].id).toBe(newer.id)
  })

  it('rejects unarchiving something that is not archived', async () => {
    const store = await loadStore()
    const session = store.createSession('Live', undefined, 'live')
    expect(store.unarchiveSession(session.id)).toBe(false)
    expect(store.unarchiveSession('nope')).toBe(false)
  })
})

describe('chatSession archivedSessions', () => {
  it('lists only chat sessions, newest archive first, and leaves side tasks out', async () => {
    const store = await loadStore()
    const first = store.createSession('First', undefined, 'first')
    const second = store.createSession('Second', undefined, 'second')
    const side = store.createSession('Side', undefined, 'side', { ephemeral: true, activate: false })
    const router = store.createSession('Router', undefined, 'router', { sessionType: 'superAgent', activate: false })

    store.archiveSession(first.id)
    store.getSession(first.id)!.archivedAt = 1_000
    store.archiveSession(second.id)
    store.getSession(second.id)!.archivedAt = 2_000
    store.archiveSession(side.id)
    store.archiveSession(router.id)

    expect(store.archivedSessions.map(s => s.id)).toEqual(['second', 'first'])
  })
})

describe('chatSession runAutoArchive', () => {
  it('does nothing while the threshold is disabled', async () => {
    const store = await loadStore()
    const settings = await loadSettings()
    const stale = store.createSession('Stale', undefined, 'stale')
    stale.updatedAt = Date.now() - 90 * DAY

    expect(settings.archiveAfterDays).toBe(0)
    expect(store.runAutoArchive()).toBe(0)
    expect(store.getSession(stale.id)?.archived).toBeFalsy()
  })

  it('archives stale sessions once a threshold is set, skipping the running one', async () => {
    const store = await loadStore()
    const settings = await loadSettings()
    const stale = store.createSession('Stale', undefined, 'stale')
    stale.updatedAt = Date.now() - 9 * DAY
    const running = store.createSession('Running', undefined, 'running')
    running.updatedAt = Date.now() - 9 * DAY
    running.processStatus = 'active'
    const fresh = store.createSession('Fresh', undefined, 'fresh')

    settings.archiveAfterDays = 7

    expect(store.runAutoArchive()).toBe(1)
    expect(store.getSession(stale.id)?.archived).toBe(true)
    expect(store.getSession(running.id)?.archived).toBeFalsy()
    expect(store.getSession(fresh.id)?.archived).toBeFalsy()
    expect(store.runAutoArchive()).toBe(0)
  })
})

describe('chatSession archive x addMessage', () => {
  it('unarchives when the user talks to an archived session again', async () => {
    const store = await loadStore()
    const session = store.createSession('Revived', undefined, 'revived')
    store.archiveSession(session.id)

    store.addMessage({ role: 'user', content: 'still here' }, session.id)

    expect(store.getSession(session.id)?.archived).toBe(false)
    expect(store.getSession(session.id)?.archivedAt).toBeUndefined()
    expect(store.normalSessions.map(s => s.id)).toContain(session.id)
  })

  it('stays archived while the engine keeps streaming into it', async () => {
    const store = await loadStore()
    const session = store.createSession('Background', undefined, 'background')
    store.archiveSession(session.id)

    store.addMessage({ role: 'assistant', content: 'still working' }, session.id)

    expect(store.getSession(session.id)?.archived).toBe(true)
  })
})

describe('chatSession permanent delete of an archived session', () => {
  it('drops the row and leaves a tombstone so history recovery cannot bring it back', async () => {
    const store = await loadStore()
    const session = store.createSession('Gone', undefined, 'gone')
    store.archiveSession(session.id)

    await store.deleteSession(session.id)

    expect(store.getSession(session.id)).toBeNull()
    expect(store.archivedSessions).toHaveLength(0)
    expect(loadDeletedSessionIds()).toContain(session.id)
    expect(mocks.stop).toHaveBeenCalledWith(session.id)
  })
})