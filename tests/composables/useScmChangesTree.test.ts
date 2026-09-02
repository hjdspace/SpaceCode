/**
 * Tests for SCM changes tree building (src/composables/useScmChangesTree.ts).
 */
import { describe, it, expect } from 'vitest'
import { buildChangeTree, flattenVisibleTree } from '@/composables/useScmChangesTree'
import type { ScmFile } from '@/stores/scm'

function file(path: string, status: ScmFile['status'] = 'modified'): ScmFile {
  return { path, statusCode: 'M', status, staged: false, isTracked: true }
}

describe('buildChangeTree', () => {
  it('returns file nodes at root for files without directory', () => {
    const tree = buildChangeTree([{ file: file('README.md'), isStaged: false }])
    expect(tree.length).toBe(1)
    expect(tree[0]).toMatchObject({ name: 'README.md', type: 'file', path: 'README.md' })
  })

  it('groups files under shared directory nodes', () => {
    const tree = buildChangeTree([
      { file: file('src/a.ts'), isStaged: false },
      { file: file('src/b.ts'), isStaged: false },
      { file: file('docs/x.md'), isStaged: false },
    ])
    expect(tree.map(n => n.name)).toEqual(['docs', 'src'])
    expect(tree[1]!.children!.map(n => n.name)).toEqual(['a.ts', 'b.ts'])
  })

  it('sorts directories before files and alphabetically', () => {
    const tree = buildChangeTree([
      { file: file('z.ts'), isStaged: false },
      { file: file('a_dir/x.ts'), isStaged: false },
      { file: file('b_dir/y.ts'), isStaged: false },
    ])
    expect(tree.map(n => n.type)).toEqual(['dir', 'dir', 'file'])
    expect(tree.map(n => n.name)).toEqual(['a_dir', 'b_dir', 'z.ts'])
  })

  it('normalizes windows backslash paths', () => {
    const tree = buildChangeTree([{ file: file('src\\sub\\a.ts'), isStaged: false }])
    const src = tree[0]!
    expect(src.path).toBe('src')
    const sub = src.children![0]!
    expect(sub.path).toBe('src/sub')
    expect(sub.children![0]!.path).toBe('src/sub/a.ts')
  })

  it('carries file and isStaged on leaf nodes', () => {
    const f = file('src/a.ts', 'added')
    const tree = buildChangeTree([{ file: f, isStaged: true }])
    expect(tree[0]!.children![0]).toMatchObject({ file: f, isStaged: true })
  })

  it('handles deeply nested paths', () => {
    const tree = buildChangeTree([{ file: file('a/b/c/d.ts'), isStaged: false }])
    expect(tree[0]!.path).toBe('a')
    expect(tree[0]!.children![0]!.path).toBe('a/b')
    expect(tree[0]!.children![0]!.children![0]!.path).toBe('a/b/c')
  })
})

describe('flattenVisibleTree', () => {
  const tree = buildChangeTree([
    { file: file('src/a.ts'), isStaged: false },
    { file: file('src/deep/b.ts'), isStaged: false },
    { file: file('README.md'), isStaged: false },
  ])

  it('flattens all nodes with depth when nothing is collapsed', () => {
    const flat = flattenVisibleTree(tree, new Set())
    expect(flat.map(f => f.node.path)).toEqual(['src', 'src/deep', 'src/deep/b.ts', 'src/a.ts', 'README.md'])
    expect(flat.map(f => f.depth)).toEqual([0, 1, 2, 1, 0])
  })

  it('skips children of collapsed directories', () => {
    const flat = flattenVisibleTree(tree, new Set(['src']))
    expect(flat.map(f => f.node.path)).toEqual(['src', 'README.md'])
  })

  it('keeps the collapsed dir node itself visible', () => {
    const flat = flattenVisibleTree(tree, new Set(['src/deep']))
    expect(flat.map(f => f.node.path)).toContain('src/deep')
    expect(flat.map(f => f.node.path)).not.toContain('src/deep/b.ts')
  })
})
