import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { loadArchivedWorkspacesFromStorage, loadDeletedSessionIds } from '@/services/sessionPersistence'

/**
 * 工作区归档契约：整组隐藏是导航动作，不是删除。
 *
 * 容易改坏的隐藏边界：
 *  - 会话自身字段（archived / messages / updatedAt）完全不动，引擎不停；
 *  - 过滤并入 normalSessions，侧栏与所有回退消费者一处生效；
 *  - 路径匹配大小写不敏感、跨分隔符风格（归一化为反斜杠）；
 *  - 自动归档跳过已归档工作区下的会话，否则恢复后回不到原位；
 *  - 永久删除跳过只读镜像会话，留墓碑防历史恢复复活。
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

describe('chatSession archiveWorkspace', () => {
  it('hides the whole group from normalSessions without touching session fields or the engine', async () => {
    const store = await loadStore()
    const a = store.createSession('A', 'D:/repo', 'a')
    store.createSession('B', 'D:/repo', 'b')
    store.createSession('Other', 'D:/else', 'other')
    store.addMessage({ role: 'user', content: 'keep' }, a.id)
    const updatedAt = a.updatedAt

    expect(store.archiveWorkspace('D:/repo')).toBe(true)

    expect(store.normalSessions.map(s => s.id)).toEqual(['other'])
    expect(store.getSession('a')?.archived).toBeFalsy()
    expect(store.getSession('a')?.messages).toHaveLength(1)
    expect(store.getSession('a')?.updatedAt).toBe(updatedAt)
    expect(store.archivedSessions).toHaveLength(0)
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('is idempotent and rejects empty paths', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    expect(store.archiveWorkspace('D:/repo')).toBe(true)
    const at = store.archivedWorkspaceList[0].archivedAt
    expect(store.archiveWorkspace('D:/repo')).toBe(false)
    expect(store.archivedWorkspaceList[0].archivedAt).toBe(at)
    expect(store.archiveWorkspace('')).toBe(false)
  })

  it('matches paths case-insensitively and across separator styles', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    expect(store.isWorkspaceArchived('d:\\repo')).toBe(true)
    expect(store.isWorkspaceArchived('D:/else')).toBe(false)
    expect(store.isWorkspaceArchived(undefined)).toBe(false)
  })

  it('moves the current session and clears the current project pointer', async () => {
    const store = await loadStore()
    store.createSession('Other', 'D:/else', 'other')
    const doomed = store.createSession('Doomed', 'D:/repo', 'doomed')
    store.switchProject('D:/repo')
    expect(store.currentSessionId).toBe(doomed.id)

    store.archiveWorkspace('D:/repo')

    expect(store.currentSessionId).toBe('other')
    expect(store.currentProjectRoot).toBe('')
  })

  it('clears the current session when nothing visible is left', async () => {
    const store = await loadStore()
    store.createSession('Only', 'D:/repo', 'only')
    store.archiveWorkspace('D:/repo')
    expect(store.currentSessionId).toBeNull()
  })

  it('persists immediately so a restart keeps the group hidden', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    const persisted = loadArchivedWorkspacesFromStorage()
    expect(Object.keys(persisted)).toEqual(['D:\\repo'])
    expect(persisted['D:\\repo']).toBeGreaterThan(0)
  })
})

describe('chatSession unarchiveWorkspace', () => {
  it('restores every session at its original freshness', async () => {
    const store = await loadStore()
    const older = store.createSession('Older', 'D:/repo', 'older')
    older.updatedAt = Date.now() - 10 * DAY
    store.createSession('Newer', 'D:/repo', 'newer')
    store.archiveWorkspace('D:/repo')

    expect(store.unarchiveWorkspace('D:/repo')).toBe(true)

    expect(store.normalSessions.map(s => s.id)).toEqual(['newer', 'older'])
    expect(store.getSession('older')?.updatedAt).toBe(older.updatedAt)
    expect(store.archivedWorkspaceList).toHaveLength(0)
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
  })

  it('rejects unknown paths', async () => {
    const store = await loadStore()
    expect(store.unarchiveWorkspace('D:/nope')).toBe(false)
  })
})

describe('chatSession archivedWorkspaceList', () => {
  it('counts sessions, derives display names and sorts newest archive first', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/AI/SpaceCode', 'a')
    store.createSession('B', 'D:/AI/SpaceCode', 'b')
    store.createSession('Side', 'D:/AI/SpaceCode', 'side', { ephemeral: true, activate: false })
    store.createSession('C', 'D:/AI/Proma', 'c')
    store.archiveWorkspace('D:/AI/SpaceCode')
    store.archivedWorkspaces['D:\\AI\\SpaceCode'] = 1_000
    store.archiveWorkspace('D:/AI/Proma')
    store.archivedWorkspaces['D:\\AI\\Proma'] = 2_000

    expect(store.archivedWorkspaceList.map(w => w.displayName)).toEqual(['Proma', 'SpaceCode'])
    expect(store.archivedWorkspaceList[1].sessionCount).toBe(2)
  })
})

describe('chatSession runAutoArchive x archived workspace', () => {
  it('skips sessions inside archived workspaces', async () => {
    const store = await loadStore()
    const settings = await loadSettings()
    const hidden = store.createSession('Hidden', 'D:/repo', 'hidden')
    hidden.updatedAt = Date.now() - 90 * DAY
    const visible = store.createSession('Visible', 'D:/else', 'visible')
    visible.updatedAt = Date.now() - 90 * DAY
    store.archiveWorkspace('D:/repo')
    settings.archiveAfterDays = 7

    expect(store.runAutoArchive()).toBe(1)
    expect(store.getSession('hidden')?.archived).toBeFalsy()
    expect(store.getSession('visible')?.archived).toBe(true)
  })
})

describe('chatSession deleteWorkspace', () => {
  it('deletes all sessions with tombstones, removes the project and the marker, skips observed mirrors', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    store.createSession('B', 'D:/repo', 'b')
    const mirror = store.createSession('Mirror', 'D:/repo', 'mirror', { activate: false })
    mirror.observedSession = true
    store.addProject('D:/repo')
    store.archiveWorkspace('D:/repo')

    await store.deleteWorkspace('D:/repo')

    expect(store.getSession('a')).toBeNull()
    expect(store.getSession('b')).toBeNull()
    expect(store.getSession('mirror')).not.toBeNull()
    expect(loadDeletedSessionIds()).toContain('a')
    expect(loadDeletedSessionIds()).toContain('b')
    expect(store.projects).not.toContain('D:\\repo')
    expect(store.archivedWorkspaceList).toHaveLength(0)
    expect(mocks.stop).toHaveBeenCalledWith('a')
  })
})