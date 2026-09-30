/**
 * FileTreeNode renders git decorations (file letter badge / directory dot)
 * and passes the mark maps down through recursive children.
 */
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import FileTreeNode from '../FileTreeNode.vue'
import type { GitFileMark, GitTreeMarks } from '@/composables/useGitTreeMarks'

vi.mock('@/services/electronAPI', () => ({
  api: { renameFile: vi.fn() }
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: vi.fn() })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

const ROOT = 'D:/proj'

function marks(overrides: Partial<GitTreeMarks> = {}): GitTreeMarks {
  return { files: new Map(), dirs: new Map(), ...overrides }
}

function fileMarks(path: string, mark: GitFileMark): GitTreeMarks {
  return marks({ files: new Map([[path, mark]]) })
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  children?: TreeNode[]
}

function mountNode(node: TreeNode, gitMarks: GitTreeMarks, expandedPaths = new Set<string>()) {
  return mount(FileTreeNode, {
    props: { node, depth: 1, gitMarks, expandedPaths }
  })
}

describe('FileTreeNode git marks', () => {
  it('shows the status letter on a modified file and tints its name', () => {
    const wrapper = mountNode(
      { name: 'a.ts', path: `${ROOT}/src/a.ts`, type: 'file', extension: 'ts' },
      fileMarks(`${ROOT}/src/a.ts`, { letter: 'M', kind: 'modified' })
    )

    const badge = wrapper.get('.git-mark')
    expect(badge.text()).toBe('M')
    expect(badge.classes()).toContain('git-modified')
    expect(badge.attributes('title')).toBe('fileTree.gitMarkModified')
    expect(wrapper.get('.node-name').classes()).toContain('git-modified')
  })

  it('matches node paths that use windows separators', () => {
    const wrapper = mountNode(
      { name: 'a.ts', path: `${ROOT}\\src\\a.ts`, type: 'file', extension: 'ts' },
      fileMarks(`${ROOT}/src/a.ts`, { letter: 'U', kind: 'untracked' })
    )

    expect(wrapper.get('.git-mark').text()).toBe('U')
  })

  it('shows a dot instead of a letter for a directory holding new files', () => {
    const wrapper = mountNode(
      { name: 'src', path: `${ROOT}/src`, type: 'directory', children: [] },
      marks({ dirs: new Map([[`${ROOT}/src`, 'added']]) })
    )

    expect(wrapper.find('.git-mark').exists()).toBe(false)
    const dot = wrapper.get('.dir-mark')
    expect(dot.classes()).toContain('git-added')
    expect(dot.attributes('title')).toBe('fileTree.gitMarkDirAdded')
  })

  it('leaves unchanged nodes without decorations', () => {
    const wrapper = mountNode(
      { name: 'clean.ts', path: `${ROOT}/src/clean.ts`, type: 'file', extension: 'ts' },
      marks()
    )

    expect(wrapper.find('.git-mark').exists()).toBe(false)
    expect(wrapper.find('.dir-mark').exists()).toBe(false)
  })

  it('passes the marks down to expanded children', async () => {
    const dir: TreeNode = {
      name: 'src',
      path: `${ROOT}/src`,
      type: 'directory',
      children: [{ name: 'a.ts', path: `${ROOT}/src/a.ts`, type: 'file', extension: 'ts' }]
    }
    const childMarks = fileMarks(`${ROOT}/src/a.ts`, { letter: 'D', kind: 'deleted' })

    const collapsed = mountNode(dir, childMarks)
    expect(collapsed.find('.git-mark').exists()).toBe(false)

    const wrapper = mountNode(dir, childMarks, new Set([`${ROOT}/src`]))
    await nextTick()

    const badge = wrapper.get('.git-mark')
    expect(badge.text()).toBe('D')
    expect(badge.classes()).toContain('git-deleted')
  })
})
