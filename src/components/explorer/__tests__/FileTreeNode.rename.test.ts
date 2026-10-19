/**
 * FileTreeNode 行内改名：由 FileTree 下发的改名请求进入编辑态，确认后走 fs:rename，
 * 非法名称 / 目标已存在 / 后端失败都要有提示。
 *
 * 这里同时钉住曾经真实存在的几个断点：
 *  - 输入框只有 :value 没有 v-model，改名永远读不到用户敲的新名称；
 *  - 右键菜单收起会把焦点抢回 body，输入框拿不到焦点 → 点到别处不触发 blur，
 *    编辑框关不掉（只有先点它一下再 Esc 才行）；
 *  - Enter 提交后组件卸载触发的 blur 会二次进入提交流程，对已改名的旧路径再发一次
 *    renameFile，于是"改名成功"之后紧跟一个失败弹窗；
 *  - 递归子节点没有转发改名请求与 refresh，深层文件改完名后树不刷新。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileTreeNode from '../FileTreeNode.vue'

const mocks = vi.hoisted(() => ({
  renameFile: vi.fn(),
  stat: vi.fn(),
  showAlert: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    renameFile: mocks.renameFile,
    stat: mocks.stat,
  },
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: mocks.showAlert }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: unknown) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  isRoot?: boolean
  children?: TreeNode[]
}

const FILE: TreeNode = { name: 'a.ts', path: 'D:/proj/src/a.ts', type: 'file', extension: 'ts' }

const mounted: { unmount: () => void }[] = []

function mountNode(node: TreeNode, extra: Record<string, unknown> = {}) {
  const wrapper = mount(FileTreeNode, { props: { node, depth: 1, ...extra } })
  mounted.push(wrapper)
  return wrapper
}

async function openRenameInput(wrapper: ReturnType<typeof mountNode>) {
  await wrapper.setProps({ renameRequest: { path: (wrapper.props('node') as TreeNode).path } })
  await flushPromises()
  return wrapper.get('input.rename-input')
}

function clickOutside() {
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
}

function deferredRename() {
  let resolve!: (value: { success: boolean }) => void
  const promise = new Promise<{ success: boolean }>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.renameFile.mockReset().mockResolvedValue({ success: true, newPath: 'x' })
  mocks.stat.mockReset().mockResolvedValue(null)
  mocks.showAlert.mockReset().mockResolvedValue(undefined)
})

// 编辑态挂过 document 监听器，不卸载会串到下一个用例的点击上
afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

describe('FileTreeNode inline rename', () => {
  it('shows an editable input pre-filled with the current name when the tree asks for rename', async () => {
    const wrapper = mountNode(FILE)
    expect(wrapper.find('input.rename-input').exists()).toBe(false)

    const input = await openRenameInput(wrapper)
    expect((input.element as HTMLInputElement).value).toBe('a.ts')
    expect(wrapper.find('.node-name').exists()).toBe(false)
  })

  it('keeps the typed text in the model so the new name actually reaches the IPC call', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.stat).toHaveBeenCalledWith('D:/proj/src/renamed.ts')
    expect(mocks.renameFile).toHaveBeenCalledWith('D:/proj/src/a.ts', 'renamed.ts')
  })

  it('refreshes the tree and leaves edit mode on success', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(wrapper.emitted('refresh')).toHaveLength(1)
    expect(wrapper.find('input.rename-input').exists()).toBe(false)
  })

  it('preserves the separator style of the node path when building the target', async () => {
    const winFile: TreeNode = { name: 'a.ts', path: 'D:\\proj\\src\\a.ts', type: 'file' }
    const wrapper = mountNode(winFile)
    const input = await openRenameInput(wrapper)

    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.stat).toHaveBeenCalledWith('D:\\proj\\src\\renamed.ts')
  })

  it('ends the edit when a click lands outside the input, even without focus', async () => {
    const wrapper = mountNode(FILE)
    await openRenameInput(wrapper)

    clickOutside()
    await flushPromises()

    expect(wrapper.find('input.rename-input').exists()).toBe(false)
    expect(mocks.renameFile).not.toHaveBeenCalled()
  })

  it('commits a typed name when the edit is ended by a click outside', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)
    await input.setValue('renamed.ts')

    clickOutside()
    await flushPromises()

    expect(mocks.renameFile).toHaveBeenCalledWith('D:/proj/src/a.ts', 'renamed.ts')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('ignores a click inside the input itself', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.trigger('mousedown')
    await flushPromises()

    expect(wrapper.find('input.rename-input').exists()).toBe(true)
  })

  it('ignores the enter key pressed to confirm an IME candidate', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)
    await input.setValue('重命名.ts')

    await input.trigger('keydown.enter', { isComposing: true })
    await flushPromises()

    expect(mocks.renameFile).not.toHaveBeenCalled()
    expect(wrapper.find('input.rename-input').exists()).toBe(true)
  })

  it('refuses a name that already exists on disk without touching the file', async () => {
    mocks.stat.mockResolvedValue({ size: 0, isDirectory: false, isFile: true, mtime: 0 })
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('taken.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.renameFile).not.toHaveBeenCalled()
    expect(mocks.showAlert.mock.calls[0][0]).toContain('fileTree.renameNameConflict')
    expect(wrapper.emitted('refresh')).toBeUndefined()
    // 回车提交的失败留在编辑态，让用户换个名字再按一次
    expect(wrapper.find('input.rename-input').exists()).toBe(true)
  })

  it('keeps a case-only rename working on case-insensitive volumes', async () => {
    // stat('A.TS') 在忽略大小写的卷上必然命中 a.ts 自己，不能当成冲突
    mocks.stat.mockResolvedValue({ size: 0, isDirectory: false, isFile: true, mtime: 0 })
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('A.TS')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.renameFile).toHaveBeenCalledWith(FILE.path, 'A.TS')
    expect(mocks.showAlert).not.toHaveBeenCalled()
  })

  it('refuses an illegal name before asking the filesystem', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('bad*name.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.renameFile).not.toHaveBeenCalled()
    expect(mocks.showAlert.mock.calls[0][0]).toContain('fileTree.renameInvalidChars')
    expect(wrapper.find('input.rename-input').exists()).toBe(true)
  })

  it('drops the edit row when the failure was noticed by clicking away', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)
    await input.setValue('bad*name.ts')

    clickOutside()
    await flushPromises()

    expect(mocks.showAlert.mock.calls[0][0]).toContain('fileTree.renameInvalidChars')
    expect(wrapper.find('input.rename-input').exists()).toBe(false)
  })

  it('reports the backend reason when the rename fails and stays editable', async () => {
    mocks.renameFile.mockResolvedValue({ success: false, error: 'EPERM' })
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.showAlert.mock.calls[0][0]).toContain('fileTree.renameFailed')
    expect(mocks.showAlert.mock.calls[0][0]).toContain('EPERM')
    expect(wrapper.emitted('refresh')).toBeUndefined()
    expect(wrapper.find('input.rename-input').exists()).toBe(true)
  })

  it('reports a retryable message when the ipc call itself throws', async () => {
    mocks.renameFile.mockRejectedValue(new Error('boom'))
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.showAlert.mock.calls[0][0]).toContain('fileTree.renameFailedRetry')
  })

  it('exits edit mode without calling the backend on escape', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.setValue('renamed.ts')
    await input.trigger('keydown.escape')
    await flushPromises()

    expect(mocks.renameFile).not.toHaveBeenCalled()
    expect(mocks.showAlert).not.toHaveBeenCalled()
    expect(wrapper.find('input.rename-input').exists()).toBe(false)
  })

  it('treats an unchanged or cleared name as a silent cancel', async () => {
    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)

    await input.trigger('blur')
    await flushPromises()
    expect(mocks.renameFile).not.toHaveBeenCalled()
    expect(mocks.showAlert).not.toHaveBeenCalled()

    // 再次请求改名要能重新进入编辑态（请求对象每次都换新）
    const again = await openRenameInput(wrapper)
    await again.setValue('   ')
    await again.trigger('blur')
    await flushPromises()

    expect(mocks.renameFile).not.toHaveBeenCalled()
    expect(mocks.showAlert).not.toHaveBeenCalled()
    expect(wrapper.find('input.rename-input').exists()).toBe(false)
  })

  it('submits once when the blur caused by unmounting follows enter', async () => {
    const rename = deferredRename()
    mocks.renameFile.mockReturnValue(rename.promise)

    const wrapper = mountNode(FILE)
    const input = await openRenameInput(wrapper)
    await input.setValue('renamed.ts')

    await input.trigger('keydown.enter')
    await flushPromises()
    expect(mocks.renameFile).toHaveBeenCalledTimes(1)

    await input.trigger('blur')
    await flushPromises()

    rename.resolve({ success: true })
    await flushPromises()

    expect(mocks.renameFile).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('forwards the rename request down to nested nodes and their refresh back up', async () => {
    const child: TreeNode = { name: 'a.ts', path: 'D:/proj/src/a.ts', type: 'file' }
    const dir: TreeNode = { name: 'src', path: 'D:/proj/src', type: 'directory', children: [child] }

    const wrapper = mountNode(dir, {
      expandedPaths: new Set(['D:/proj/src']),
    })
    await flushPromises()

    await wrapper.setProps({ renameRequest: { path: child.path } })
    await flushPromises()

    const input = wrapper.get('input.rename-input')
    expect((input.element as HTMLInputElement).value).toBe('a.ts')

    await input.setValue('renamed.ts')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mocks.renameFile).toHaveBeenCalledWith('D:/proj/src/a.ts', 'renamed.ts')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })
})
