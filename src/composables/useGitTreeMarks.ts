/**
 * Git decorations for the file tree — VS Code style:
 * files carry a status letter (M/A/U/D/R/C), directories an aggregated kind
 * that bubbles up through every ancestor. 'modified' outranks 'added', so a
 * folder holding both reads as yellow.
 */
import type { ScmFile } from '@/stores/scm'

export type GitFileMarkKind =
  | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflict'
export type GitDirMarkKind = 'modified' | 'added'

export interface GitFileMark {
  letter: string
  kind: GitFileMarkKind
}

export interface GitTreeMarks {
  /** Absolute normalized path → mark. */
  files: Map<string, GitFileMark>
  /** Absolute normalized directory path → aggregated kind. */
  dirs: Map<string, GitDirMarkKind>
}

export interface GitStatusGroups {
  staged: ScmFile[]
  unstaged: ScmFile[]
  untracked: ScmFile[]
  conflicted: ScmFile[]
}

export const GIT_FILE_MARK_LETTER: Record<GitFileMarkKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflict: 'C',
}

/** Highest first — a file staged as added but also edited reads as A. */
const FILE_MARK_PRIORITY: GitFileMarkKind[] = [
  'conflict', 'deleted', 'renamed', 'copied', 'added', 'untracked', 'modified',
]

const DIR_MARK_KIND: Record<GitFileMarkKind, GitDirMarkKind> = {
  added: 'added',
  untracked: 'added',
  modified: 'modified',
  deleted: 'modified',
  renamed: 'modified',
  copied: 'modified',
  conflict: 'modified',
}

export function normalizeTreePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function toAbsolutePath(root: string, repoRelativePath: string): string {
  return `${root}/${normalizeTreePath(repoRelativePath)}`
}

function withoutTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

export function buildGitTreeMarks(basePath: string, groups: GitStatusGroups): GitTreeMarks {
  const files = new Map<string, GitFileMark>()
  const dirs = new Map<string, GitDirMarkKind>()

  const root = withoutTrailingSlash(normalizeTreePath(basePath))
  if (!root) return { files, dirs }

  const bestKindByPath = new Map<string, GitFileMarkKind>()
  for (const entry of [...groups.conflicted, ...groups.untracked, ...groups.staged, ...groups.unstaged]) {
    if (entry.status === 'ignored') continue
    const kind = entry.status as GitFileMarkKind
    const absPath = toAbsolutePath(root, entry.path)
    const current = bestKindByPath.get(absPath)
    if (!current || FILE_MARK_PRIORITY.indexOf(kind) < FILE_MARK_PRIORITY.indexOf(current)) {
      bestKindByPath.set(absPath, kind)
    }
  }

  for (const [absPath, kind] of bestKindByPath) {
    files.set(absPath, { letter: GIT_FILE_MARK_LETTER[kind], kind })

    const dirKind = DIR_MARK_KIND[kind]
    let dir = absPath.slice(0, absPath.lastIndexOf('/'))
    while (dir.length > root.length) {
      const existing = dirs.get(dir)
      // Already at this rank — every higher ancestor has it too.
      if (existing === dirKind || (dirKind === 'added' && existing === 'modified')) break
      dirs.set(dir, dirKind)
      dir = dir.slice(0, dir.lastIndexOf('/'))
    }
  }

  return { files, dirs }
}
