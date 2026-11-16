import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ArchiveSettings from '../ArchiveSettings.vue'
import { useChatSessionStore } from '@/stores/chatSession'

/**
 * 归档管理页·工作区 tab 契约。用真实 chatSession store（只桩掉 IPC），
 * 验的是状态真的迁移了：恢复整组回到侧栏、永久删除留墓碑、
 * 「全部删除」只作用于当前筛选结果。
 */

const mocks = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  showAlert: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showConfirm: mocks.showConfirm, showAlert: mocks.showAlert }),
}))

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'en-US' }, t: (key: string) => key } }),
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
    locale: { value: 'en-US' },
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      startSession: vi.fn().mockResolvedValue(undefined),
      stop: mocks.stop,
      resumeSession: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: vi.fn().mockResolvedValue([]),
      getFullSession: vi.fn().mockResolvedValue({ messages: [] }),
    },
    image: null,
    agents: { install: vi.fn().mockResolvedValue({ success: true }) },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
    trace: { event: vi.fn() },
    session: {
      getTurnCheckpoints: vi.fn().mockResolvedValue({ ok: true, checkpoints: [], error: null }),
      getTurnRewindPreviewFiles: vi.fn().mockResolvedValue({ ok: true, files: [], error: null }),
      rewindTurn: vi.fn().mockResolvedValue({ ok: true, error: null }),
    },
    getCwd: vi.fn().mockResolvedValue(''),
    injectGuiModelsToSettings: vi.fn().mockResolvedValue({ success: true }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

let store: ReturnType<typeof useChatSessionStore>
let wrapper: ReturnType<typeof mount>

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
  mocks.showConfirm.mockResolvedValue(true)
  mocks.showAlert.mockResolvedValue(undefined)
  store = useChatSessionStore()
})

function mountPage() {
  wrapper = mount(ArchiveSettings)
  return wrapper
}

async function openWorkspacesTab() {
  await wrapper!.find('[data-testid="archive-tab-workspaces"]').trigger('click')
  await flushPromises()
}

describe('ArchiveSettings workspaces tab', () => {
  it('defaults to the sessions tab and shows the workspace count on the tab', async () => {
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    mountPage()
    await flushPromises()

    expect(wrapper!.find('[data-testid="archive-empty"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="archive-tab-workspaces"]').text()).toContain('1')
  })

  it('lists archived workspaces with session counts and restores them', async () => {
    store.createSession('A', 'D:/AI/SpaceCode', 'a')
    store.createSession('B', 'D:/AI/SpaceCode', 'b')
    store.archiveWorkspace('D:/AI/SpaceCode')
    mountPage()
    await openWorkspacesTab()

    const rows = wrapper!.findAll('[data-testid="archive-workspace-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('SpaceCode')
    expect(rows[0].text()).toContain('archive.sessionCount:2')

    await wrapper!.find('[data-testid="archive-workspace-restore"]').trigger('click')
    await flushPromises()

    expect(store.archivedWorkspaceList).toHaveLength(0)
    expect(store.normalSessions.map(s => s.id)).toEqual(['b', 'a'])
    expect(wrapper!.find('[data-testid="archive-workspace-empty"]').exists()).toBe(true)
  })

  it('filters workspaces by search and scopes delete-all to the filter', async () => {
    store.createSession('A', 'D:/AI/SpaceCode', 'a')
    store.createSession('B', 'D:/AI/Proma', 'b')
    store.archiveWorkspace('D:/AI/SpaceCode')
    store.archiveWorkspace('D:/AI/Proma')
    mountPage()
    await openWorkspacesTab()

    await wrapper!.find('[data-testid="archive-workspace-search"]').setValue('proma')
    expect(wrapper!.findAll('[data-testid="archive-workspace-row"]')).toHaveLength(1)

    await wrapper!.find('[data-testid="archive-workspace-delete-all"]').trigger('click')
    await flushPromises()

    expect(mocks.showConfirm).toHaveBeenCalledTimes(1)
    expect(store.archivedWorkspaceList.map(w => w.displayName)).toEqual(['SpaceCode'])
    expect(store.getSession('a')).not.toBeNull()
    expect(store.getSession('b')).toBeNull()
  })

  it('asks for confirmation before permanently deleting a workspace', async () => {
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    mountPage()
    await openWorkspacesTab()

    mocks.showConfirm.mockResolvedValueOnce(false)
    await wrapper!.find('[data-testid="archive-workspace-delete"]').trigger('click')
    await flushPromises()
    expect(store.getSession('a')).not.toBeNull()

    await wrapper!.find('[data-testid="archive-workspace-delete"]').trigger('click')
    await flushPromises()
    expect(store.getSession('a')).toBeNull()
    expect(store.archivedWorkspaceList).toHaveLength(0)
  })

  it('shows the empty state when nothing is archived', async () => {
    mountPage()
    await openWorkspacesTab()
    expect(wrapper!.find('[data-testid="archive-workspace-empty"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="archive-workspace-delete-all"]').attributes('disabled')).toBeDefined()
  })
})