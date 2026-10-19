/**
 * 右键菜单的重命名入口：工作区根目录不给改名（改了会让 projectRoot 指向不存在的
 * 路径），其余节点把请求以 rename 事件交回 FileTree。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileContextMenu from '../FileContextMenu.vue'

vi.mock('@/services/electronAPI', () => ({
  api: { openInEditor: vi.fn(), deleteFile: vi.fn() },
}))
vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }),
}))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ projectRoot: 'D:/proj' }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const RENAME_LABEL = 'fileTree.rename'

interface MenuNode {
  name: string
  path: string
  type: 'file' | 'directory'
  isRoot?: boolean
}

function mountMenu(node: MenuNode) {
  const wrapper = mount(FileContextMenu, {
    props: { visible: true, node, x: 10, y: 10 },
    global: { stubs: { Teleport: true } },
  })
  return wrapper
}

function renameButton(wrapper: ReturnType<typeof mountMenu>) {
  return wrapper.findAll('.menu-item').find((btn) => btn.text().includes(RENAME_LABEL))!
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FileContextMenu rename', () => {
  it('asks the tree to rename the clicked file', async () => {
    const node: MenuNode = { name: 'a.ts', path: 'D:/proj/a.ts', type: 'file' }
    const wrapper = mountMenu(node)
    await flushPromises()

    await renameButton(wrapper).trigger('click')

    expect(wrapper.emitted('rename')).toEqual([[node]])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('disables and refuses rename on the workspace root row', async () => {
    const root: MenuNode = { name: 'proj', path: 'D:/proj', type: 'directory', isRoot: true }
    const wrapper = mountMenu(root)
    await flushPromises()

    const button = renameButton(wrapper)
    expect(button.classes()).toContain('disabled')

    await button.trigger('click')

    expect(wrapper.emitted('rename')).toBeUndefined()
  })
})
