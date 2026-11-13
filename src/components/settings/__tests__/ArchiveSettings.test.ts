import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@/types'
import ArchiveSettings from '../ArchiveSettings.vue'
import { useChatSessionStore } from '@/stores/chatSession'

/**
 * 归档管理页契约。用真实 chatSession store（只桩掉 IPC），
 * 这样「取消归档」「永久删除」验的是状态真的迁移了，而不是某个 mock 被调用过。
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

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)

let store: ReturnType<typeof useChatSessionStore>
let wrapper: ReturnType<typeof mount>

function seedArchived(
  id: string,
  title: string,
  workingDirectory: string | undefined,
  archivedAt: number,
): Session {
  const session = store.createSession(title, workingDirectory, id, { activate: false })
  store.archiveSession(id)
  session.archivedAt = archivedAt
  return session
}

function mountPage() {
  wrapper = mount(ArchiveSettings)
  return wrapper
}

function rowTitles(): string[] {
  return wrapper.findAll('[data-testid="archive-row"] .archive-row-title').map(node => node.text())
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
  mocks.showConfirm.mockResolvedValue(true)
  mocks.showAlert.mockResolvedValue(undefined)
  store = useChatSessionStore()
})

describe('ArchiveSettings rendering', () => {
  it('explains how to fill the archive when it is empty', () => {
    mountPage()

    expect(wrapper!.find('[data-testid="archive-empty"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="archive-delete-all"]').attributes('disabled')).toBeDefined()
    expect(rowTitles()).toEqual([])
  })

  it('lists only archived sessions, grouped by project, newest archive first', async () => {
    store.createSession('Still live', 'D:/AI/SpaceCode', 'live')
    seedArchived('old', 'Old task', 'D:/AI/SpaceCode', NOW - 5 * DAY)
    seedArchived('new', 'New task', 'D:\\AI\\SpaceCode', NOW)
    seedArchived('other', 'Proma task', 'D:/AI/Proma', NOW - DAY)
    mountPage()
    await flushPromises()

    expect(wrapper!.find('[data-testid="archive-count"]').text()).toContain('3')
    expect(wrapper!.findAll('.archive-group-name').map(n => n.text())).toEqual(['SpaceCode', 'Proma'])
    expect(rowTitles()).toEqual(['New task', 'Old task', 'Proma task'])
    expect(wrapper!.find('.archive-group-count').text()).toBe('archive.sessionCount:2')
    expect(wrapper!.find('.archive-row-time').text()).toContain('2026')
  })

  it('labels sessions without a project instead of showing a blank group', async () => {
    seedArchived('loose', 'Loose end', undefined, NOW)
    mountPage()
    await flushPromises()

    expect(wrapper!.find('.archive-group-name').text()).toBe('archive.unassignedProject')
  })
})

describe('ArchiveSettings filtering', () => {
  beforeEach(() => {
    seedArchived('a', 'Fix login bug', 'D:/AI/SpaceCode', NOW)
    seedArchived('b', 'Write docs', 'D:/AI/Proma', NOW - DAY)
  })

  it('narrows the list by search text and reports a no-match state', async () => {
    mountPage()
    const search = wrapper!.find('[data-testid="archive-search"]')

    await search.setValue('login')
    expect(rowTitles()).toEqual(['Fix login bug'])

    await search.setValue('nothing here')
    expect(rowTitles()).toEqual([])
    expect(wrapper!.find('[data-testid="archive-no-match"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="archive-delete-all"]').attributes('disabled')).toBeDefined()
  })

  it('keeps every project selectable while a search is active', async () => {
    mountPage()
    await wrapper!.find('[data-testid="archive-search"]').setValue('login')

    const options = wrapper!.find('[data-testid="archive-project-filter"]').findAll('option')
    expect(options.map(o => o.text())).toEqual(['archive.allProjects', 'Proma', 'SpaceCode'])

    await wrapper!.find('[data-testid="archive-project-filter"]').setValue('D:\\AI\\Proma')
    expect(rowTitles()).toEqual([])

    await wrapper!.find('[data-testid="archive-search"]').setValue('')
    expect(rowTitles()).toEqual(['Write docs'])
  })
})

describe('ArchiveSettings unarchive', () => {
  it('sends the session back to the sidebar and drops its row', async () => {
    seedArchived('a', 'Restore me', 'D:/AI/SpaceCode', NOW)
    seedArchived('b', 'Stay here', 'D:/AI/SpaceCode', NOW - DAY)
    mountPage()
    await flushPromises()

    await wrapper!.findAll('[data-testid="archive-row-restore"]')[0].trigger('click')
    await flushPromises()

    expect(store.getSession('a')?.archived).toBe(false)
    expect(store.normalSessions.map(s => s.id)).toContain('a')
    expect(rowTitles()).toEqual(['Stay here'])
    expect(mocks.showConfirm).not.toHaveBeenCalled()
  })
})

describe('ArchiveSettings permanent delete', () => {
  it('asks before deleting a single session and keeps it when cancelled', async () => {
    seedArchived('a', 'Careful', 'D:/AI/SpaceCode', NOW)
    mountPage()
    await flushPromises()
    mocks.showConfirm.mockResolvedValue(false)

    await wrapper!.find('[data-testid="archive-row-delete"]').trigger('click')
    await flushPromises()

    expect(mocks.showConfirm).toHaveBeenCalledWith(
      'archive.confirmDelete:Careful',
      { title: 'archive.confirmDeleteTitle', variant: 'danger' },
    )
    expect(store.getSession('a')).toBeDefined()
    expect(rowTitles()).toEqual(['Careful'])
  })

  it('removes the session for good once confirmed', async () => {
    seedArchived('a', 'Gone', 'D:/AI/SpaceCode', NOW)
    mountPage()
    await flushPromises()

    await wrapper!.find('[data-testid="archive-row-delete"]').trigger('click')
    await flushPromises()

    expect(store.getSession('a')).toBeNull()
    expect(rowTitles()).toEqual([])
    expect(wrapper!.find('[data-testid="archive-empty"]').exists()).toBe(true)
  })

  it('scopes delete-all to the current filter so a search cannot wipe the whole archive', async () => {
    seedArchived('a', 'Fix login bug', 'D:/AI/SpaceCode', NOW)
    seedArchived('b', 'Write docs', 'D:/AI/Proma', NOW - DAY)
    mountPage()
    await flushPromises()
    await wrapper!.find('[data-testid="archive-search"]').setValue('login')

    await wrapper!.find('[data-testid="archive-delete-all"]').trigger('click')
    await flushPromises()

    expect(mocks.showConfirm).toHaveBeenCalledWith(
      'archive.confirmDeleteAll:1',
      { title: 'archive.confirmDeleteAllTitle', variant: 'danger' },
    )
    expect(store.getSession('a')).toBeNull()
    expect(store.getSession('b')?.archived).toBe(true)
  })

  it('surfaces a failure and re-enables the controls instead of staying stuck', async () => {
    seedArchived('a', 'Stubborn', 'D:/AI/SpaceCode', NOW)
    mountPage()
    await flushPromises()
    mocks.stop.mockRejectedValueOnce(new Error('ipc down'))
    const spy = vi.spyOn(store, 'deleteSession').mockRejectedValueOnce(new Error('disk full'))

    await wrapper!.find('[data-testid="archive-row-delete"]').trigger('click')
    await flushPromises()

    expect(mocks.showAlert).toHaveBeenCalledWith('archive.deleteFailed')
    expect(wrapper!.find('[data-testid="archive-row-delete"]').attributes('disabled')).toBeUndefined()
    expect(wrapper!.find('[data-testid="archive-delete-all"]').attributes('disabled')).toBeUndefined()
    spy.mockRestore()
  })
})