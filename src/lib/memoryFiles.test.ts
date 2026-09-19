import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_PATH,
  buildMemoryFileTree,
  fileNameFromPath,
  filterMemoryFiles,
  filterMemoryProjects,
  projectDisplayName,
  resolveMarkdownMemoryLink,
  resolveMemoryFileTarget,
  stripMarkdownFrontmatter,
} from './memoryFiles'
import type { MemoryFile, MemoryProject } from '@/types/memory'

function file(path: string, extra: Partial<MemoryFile> = {}): MemoryFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    bytes: 10,
    updatedAt: '2026-05-01T00:00:00.000Z',
    title: path === DEFAULT_MEMORY_PATH ? DEFAULT_MEMORY_PATH : (path.split('/').pop() ?? path).replace(/\.md$/, ''),
    isIndex: path === DEFAULT_MEMORY_PATH,
    ...extra,
  }
}

function project(id: string, extra: Partial<MemoryProject> = {}): MemoryProject {
  return {
    id,
    label: `/workspace/${id}`,
    memoryDir: `/tmp/claude/projects/${id}/memory`,
    exists: true,
    fileCount: 1,
    isCurrent: false,
    ...extra,
  }
}

describe('projectDisplayName', () => {
  it('keeps the last two path segments', () => {
    expect(projectDisplayName('C:\\Programs\\claude-code')).toBe('Programs/claude-code')
    expect(projectDisplayName('/workspace/demo/')).toBe('workspace/demo')
  })

  it('falls back to a single segment', () => {
    expect(projectDisplayName('demo')).toBe('demo')
  })
})

describe('fileNameFromPath', () => {
  it('returns the trailing segment', () => {
    expect(fileNameFromPath('notes/manual.md')).toBe('manual.md')
    expect(fileNameFromPath('MEMORY.md')).toBe('MEMORY.md')
  })
})

describe('stripMarkdownFrontmatter', () => {
  it('removes the frontmatter block but keeps the body', () => {
    expect(stripMarkdownFrontmatter('---\ntype: project\n---\n\n# Title\n')).toBe('# Title\n')
  })

  it('returns the content unchanged when there is no frontmatter', () => {
    expect(stripMarkdownFrontmatter('# Title\n')).toBe('# Title\n')
  })

  it('returns the content unchanged when the block is unterminated', () => {
    expect(stripMarkdownFrontmatter('---\ntype: project\n')).toBe('---\ntype: project\n')
  })
})

describe('buildMemoryFileTree', () => {
  it('nests files by path and orders folders before files', () => {
    const tree = buildMemoryFileTree([
      file('notes/manual.md'),
      file('MEMORY.md'),
      file('notes/archive/old.md'),
      file('alpha.md'),
    ])

    expect(tree.map((node) => node.kind)).toEqual(['folder', 'file', 'file'])
    expect(tree[0]).toMatchObject({ kind: 'folder', name: 'notes', fileCount: 2 })
    const notes = tree[0]
    expect(notes.kind === 'folder' && notes.children.map((child) => child.name)).toEqual([
      'archive',
      'manual.md',
    ])
    expect(tree[1]).toMatchObject({ kind: 'file', name: 'MEMORY.md' })
    expect(tree[2]).toMatchObject({ kind: 'file', name: 'alpha.md' })
  })

  it('keeps the index file first among siblings', () => {
    const tree = buildMemoryFileTree([file('alpha.md'), file('MEMORY.md')])
    expect(tree.map((node) => node.name)).toEqual(['MEMORY.md', 'alpha.md'])
  })
})

describe('filterMemoryFiles', () => {
  it('matches title, path, description and type', () => {
    const files = [
      file('notes/manual.md', { description: 'Operator workflow', type: 'feedback' }),
      file('preferences.md'),
    ]
    expect(filterMemoryFiles(files, 'manual').map((entry) => entry.path)).toEqual(['notes/manual.md'])
    expect(filterMemoryFiles(files, 'workflow').map((entry) => entry.path)).toEqual(['notes/manual.md'])
    expect(filterMemoryFiles(files, 'feedback').map((entry) => entry.path)).toEqual(['notes/manual.md'])
    expect(filterMemoryFiles(files, '')).toHaveLength(2)
  })
})

describe('filterMemoryProjects', () => {
  it('matches project identity and the selected project files', () => {
    const projects = [project('alpha'), project('beta')]
    expect(filterMemoryProjects(projects, 'beta', 'alpha', []).map((entry) => entry.id)).toEqual(['beta'])
    expect(
      filterMemoryProjects(projects, 'manual', 'alpha', [file('notes/manual.md')]).map((entry) => entry.id),
    ).toEqual(['alpha'])
    // 已选项目的文件参与匹配：项目自身路径不命中，但文件命中时仍保留（便于继续浏览）
    expect(
      filterMemoryProjects(projects, 'manual', 'beta', [file('notes/manual.md')]).map((entry) => entry.id),
    ).toEqual(['beta'])
    // 未选中的项目不会因为别的项目的文件而命中
    expect(filterMemoryProjects(projects, 'manual', 'alpha', [])).toHaveLength(0)
    expect(filterMemoryProjects(projects, 'nope', 'beta', [file('notes/manual.md')])).toHaveLength(0)
  })
})

describe('resolveMemoryFileTarget', () => {
  it('maps an absolute path inside the memory dir to project + relative path', () => {
    const projects = [project('demo')]
    expect(
      resolveMemoryFileTarget(projects, '/tmp/claude/projects/demo/memory/notes/manual.md'),
    ).toEqual({ projectId: 'demo', path: 'notes/manual.md' })
  })

  it('maps the memory dir itself to the index file', () => {
    const projects = [project('demo')]
    expect(resolveMemoryFileTarget(projects, '/tmp/claude/projects/demo/memory')).toEqual({
      projectId: 'demo',
      path: DEFAULT_MEMORY_PATH,
    })
  })

  it('handles windows separators and returns null for unknown paths', () => {
    const projects = [project('demo', { memoryDir: 'C:\\Users\\me\\.claude\\projects\\demo\\memory' })]
    expect(
      resolveMemoryFileTarget(projects, 'C:/Users/me/.claude/projects/demo/memory/MEMORY.md'),
    ).toEqual({ projectId: 'demo', path: DEFAULT_MEMORY_PATH })
    expect(resolveMemoryFileTarget(projects, '/elsewhere/MEMORY.md')).toBeNull()
  })
})

describe('resolveMarkdownMemoryLink', () => {
  const files = [file('MEMORY.md'), file('notes/manual.md'), file('notes/archive/old.md')]

  it('resolves a relative link against the current file directory', () => {
    expect(resolveMarkdownMemoryLink('notes/manual.md', 'MEMORY.md', '/mem', files)).toBe('notes/manual.md')
    expect(resolveMarkdownMemoryLink('archive/old.md', 'notes/manual.md', '/mem', files)).toBe(
      'notes/archive/old.md',
    )
    expect(resolveMarkdownMemoryLink('../MEMORY.md', 'notes/manual.md', '/mem', files)).toBe('MEMORY.md')
  })

  it('resolves an absolute link inside the memory dir', () => {
    expect(resolveMarkdownMemoryLink('/mem/notes/manual.md', 'MEMORY.md', '/mem', files)).toBe(
      'notes/manual.md',
    )
    expect(resolveMarkdownMemoryLink('file:///mem/notes/manual.md', 'MEMORY.md', '/mem', files)).toBe(
      'notes/manual.md',
    )
  })

  it('ignores anchors, external links, non-markdown targets and unknown files', () => {
    expect(resolveMarkdownMemoryLink('#section', 'MEMORY.md', '/mem', files)).toBeNull()
    expect(resolveMarkdownMemoryLink('https://example.com/a.md', 'MEMORY.md', '/mem', files)).toBeNull()
    expect(resolveMarkdownMemoryLink('notes/manual.txt', 'MEMORY.md', '/mem', files)).toBeNull()
    expect(resolveMarkdownMemoryLink('missing.md', 'MEMORY.md', '/mem', files)).toBeNull()
    expect(resolveMarkdownMemoryLink('/other/place/manual.md', 'MEMORY.md', '/mem', files)).toBeNull()
  })

  it('strips anchors and query strings from the link target', () => {
    expect(resolveMarkdownMemoryLink('notes/manual.md#step-2', 'MEMORY.md', '/mem', files)).toBe(
      'notes/manual.md',
    )
  })
})
