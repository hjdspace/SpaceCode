/**
 * Tests for git tree decorations (src/composables/useGitTreeMarks.ts).
 */
import { describe, it, expect } from 'vitest'
import { buildGitTreeMarks } from '@/composables/useGitTreeMarks'
import type { GitStatusGroups } from '@/composables/useGitTreeMarks'
import type { ScmFile } from '@/stores/scm'

function file(path: string, status: ScmFile['status'], statusCode = 'M'): ScmFile {
  return { path, statusCode, status, staged: status !== 'untracked', isTracked: status !== 'untracked' }
}

function groups(partial: Partial<GitStatusGroups> = {}): GitStatusGroups {
  return { staged: [], unstaged: [], untracked: [], conflicted: [], ...partial }
}

const ROOT = 'D:/AI/SpaceCode'

describe('buildGitTreeMarks file marks', () => {
  it('keys marks by absolute path built from the base path and repo-relative path', () => {
    const { files } = buildGitTreeMarks(ROOT, groups({ unstaged: [file('src/a.ts', 'modified')] }))
    expect(files.get(`${ROOT}/src/a.ts`)).toEqual({ letter: 'M', kind: 'modified' })
  })

  it('accepts a backslash base path', () => {
    const { files } = buildGitTreeMarks('D:\\AI\\SpaceCode', groups({ unstaged: [file('src/a.ts', 'modified')] }))
    expect(files.has(`${ROOT}/src/a.ts`)).toBe(true)
  })

  it('maps status to badge letters', () => {
    const { files } = buildGitTreeMarks(ROOT, groups({
      untracked: [file('new.ts', 'untracked', '?')],
      staged: [file('added.ts', 'added', 'A'), file('gone.ts', 'deleted', 'D'), file('moved.ts', 'renamed', 'R')],
    }))
    expect(files.get(`${ROOT}/new.ts`)!.letter).toBe('U')
    expect(files.get(`${ROOT}/added.ts`)!.letter).toBe('A')
    expect(files.get(`${ROOT}/gone.ts`)!.letter).toBe('D')
    expect(files.get(`${ROOT}/moved.ts`)!.letter).toBe('R')
  })

  it('lets the higher-priority status win when a file is in two groups', () => {
    const { files } = buildGitTreeMarks(ROOT, groups({
      staged: [file('src/both.ts', 'added', 'A')],
      unstaged: [file('src/both.ts', 'modified')],
    }))
    expect(files.get(`${ROOT}/src/both.ts`)).toEqual({ letter: 'A', kind: 'added' })
  })

  it('skips ignored files', () => {
    const { files, dirs } = buildGitTreeMarks(ROOT, groups({
      unstaged: [file('build/out.js', 'ignored', '!')],
    }))
    expect(files.size).toBe(0)
    expect(dirs.size).toBe(0)
  })

  it('returns empty maps without a base path', () => {
    const { files, dirs } = buildGitTreeMarks('', groups({ unstaged: [file('a.ts', 'modified')] }))
    expect(files.size).toBe(0)
    expect(dirs.size).toBe(0)
  })
})

describe('buildGitTreeMarks directory marks', () => {
  it('bubbles a mark through every ancestor below the root', () => {
    const { dirs } = buildGitTreeMarks(ROOT, groups({ unstaged: [file('src/a/b/c.ts', 'modified')] }))
    expect(dirs.get(`${ROOT}/src/a/b`)).toBe('modified')
    expect(dirs.get(`${ROOT}/src/a`)).toBe('modified')
    expect(dirs.get(`${ROOT}/src`)).toBe('modified')
  })

  it('never marks the project root itself', () => {
    const { dirs } = buildGitTreeMarks(ROOT, groups({ unstaged: [file('a.ts', 'modified')] }))
    expect(dirs.has(ROOT)).toBe(false)
  })

  it('reads untracked and staged-added directories as added', () => {
    const { dirs } = buildGitTreeMarks(ROOT, groups({
      untracked: [file('drafts/new.md', 'untracked', '?')],
      staged: [file('src/brand-new.ts', 'added', 'A')],
    }))
    expect(dirs.get(`${ROOT}/drafts`)).toBe('added')
    expect(dirs.get(`${ROOT}/src`)).toBe('added')
  })

  it('lets modified outrank added within the same directory', () => {
    const { dirs } = buildGitTreeMarks(ROOT, groups({
      untracked: [file('src/new.ts', 'untracked', '?')],
      unstaged: [file('src/old.ts', 'modified')],
    }))
    expect(dirs.get(`${ROOT}/src`)).toBe('modified')
  })

  it('keeps modified when a weaker status arrives later', () => {
    const { dirs } = buildGitTreeMarks(ROOT, groups({
      unstaged: [file('src/deep/old.ts', 'modified')],
      untracked: [file('src/deep/new.ts', 'untracked', '?')],
    }))
    expect(dirs.get(`${ROOT}/src/deep`)).toBe('modified')
    expect(dirs.get(`${ROOT}/src`)).toBe('modified')
  })

  it('keeps sibling directories independent', () => {
    const { dirs } = buildGitTreeMarks(ROOT, groups({
      untracked: [file('src/a/x.ts', 'untracked', '?')],
      unstaged: [file('src/b/y.ts', 'modified')],
    }))
    expect(dirs.get(`${ROOT}/src/a`)).toBe('added')
    expect(dirs.get(`${ROOT}/src/b`)).toBe('modified')
    expect(dirs.get(`${ROOT}/src`)).toBe('modified')
  })
})
