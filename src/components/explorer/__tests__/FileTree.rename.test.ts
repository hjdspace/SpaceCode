/**
 * FileTree 收到右键菜单的 rename 请求后，必须把它变成下发给节点行的改名请求。
 *
 * 曾经 handleRename 只有 console.log + refreshTree，右键「重命名」点了没有任何反应。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileTree from '../FileTree.vue'
import FileTreeNode from '../FileTreeNode.vue'
import FileContextMenu from '../FileContextMenu.vue'

const mocks = vi.hoisted(() => ({
  readDir: vi.fn(),
  renameFile: vi.fn(),
  stat: vi.fn(),
  showAlert: vi.fn(),
  showConfirm: vi.fn(),
  scmRefresh: vi.fn(),
  app: { projectRoot: 'D:/proj', showHiddenFiles: false, toggleShowHiddenFiles: vi.fn() },
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readDir: mocks.readDir,
    renameFile: mocks.renameFile,
    stat: mocks.stat,
  },
}))

vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.app }))
vi.mock('@/stores/scm', () => ({
  useScmStore: () => ({
    refresh: mocks.scmRefresh,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  }),
}))
vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: mocks.showAlert, showConfirm: mocks.showConfirm }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const ROOT = 'D:/proj'
const FILE_PATH = `${ROOT}/a.ts`

function mountTree() {
  return mount(FileTree, { props: { workingDirectory: ROOT } })
}

function requestRename(wrapper: ReturnType<typeof mountTree>, path = FILE_PATH) {
  wrapper.findComponent(FileContextMenu).vm.$emit('rename', {
    name: 'a.ts',
    path,
    type: 'file',
  })
}

beforeEach(() => {
  mocks.readDir.mockReset().mockResolvedValue([
    { name: 'a.ts', path: FILE_PATH, isDirectory: false },
  ])
  mocks.renameFile.mockReset().mockResolvedValue({ success: true, newPath: FILE_PATH })
  mocks.stat.mockReset().mockResolvedValue(null)
  mocks.scmRefresh.mockClear()
})

describe('FileTree rename wiring', () => {
  it('asks the matching node row to enter inline editing when the context menu renames', async () => {
    const wrapper = mountTree()
    await flushPromises()

    expect(wrapper.findComponent(FileTreeNode).props('renameRequest')).toBe(null)

    requestRename(wrapper)
    await flushPromises()

    expect(wrapper.findComponent(FileTreeNode).props('renameRequest')).toEqual({ path: FILE_PATH })
  })

  it('opens the input on the requested row instead of just refreshing the tree', async () => {
    const wrapper = mountTree()
    await flushPromises()
    const loadsBefore = mocks.readDir.mock.calls.length

    requestRename(wrapper)
    await flushPromises()

    expect(mocks.readDir.mock.calls.length).toBe(loadsBefore)
    const input = wrapper.get('input.rename-input')
    expect((input.element as HTMLInputElement).value).toBe('a.ts')
  })

  it('issues a fresh request each time so rename can be re-armed on the same node', async () => {
    const wrapper = mountTree()
    await flushPromises()

    requestRename(wrapper)
    await flushPromises()
    const first = wrapper.findComponent(FileTreeNode).props('renameRequest')

    requestRename(wrapper)
    await flushPromises()

    expect(wrapper.findComponent(FileTreeNode).props('renameRequest')).not.toBe(first)
  })

  it('reloads the tree after the node row reports a successful rename', async () => {
    const wrapper = mountTree()
    await flushPromises()
    const loadsBefore = mocks.readDir.mock.calls.length

    requestRename(wrapper)
    await flushPromises()
    const input = wrapper.get('input.rename-input')
    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.renameFile).toHaveBeenCalledWith(FILE_PATH, 'renamed.ts')
    expect(mocks.readDir.mock.calls.length).toBeGreaterThan(loadsBefore)
    expect(wrapper.find('input.rename-input').exists()).toBe(false)
  })
})
