/**
 * Git Service for Electron Main Process
 *
 * Provides git operations via child_process.execFile.
 * Referenced VSCode SCM architecture: status tracking, staging, committing, branching.
 */

import { execFile } from 'child_process'
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ipcMain } from 'electron'

const GIT_TIMEOUT = 10000
const GIT_BINARY = process.platform === 'win32' ? 'git.exe' : 'git'

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

function gitExec(args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      GIT_BINARY,
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          code: error ? (error as any).code || 1 : 0,
        })
      }
    )
  })
}

// ============================================================================
// Types
// ============================================================================

export interface GitStatusFile {
  path: string
  originalPath?: string
  statusCode: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflict'
  staged: boolean
  isTracked: boolean
}

export interface GitBranch {
  name: string
  current: boolean
  isRemote: boolean
  upstream?: string
  ahead?: number
  behind?: number
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
  refs: string
}

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
}

export interface GitDiffResult {
  path: string
  oldPath?: string
  hunks: GitDiffHunk[]
  additions: number
  deletions: number
  isBinary: boolean
}

export interface GitFullDiffFileStats {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isUntracked?: boolean
}

export interface GitFullDiffResult {
  stats: {
    filesCount: number
    linesAdded: number
    linesRemoved: number
  }
  files: GitFullDiffFileStats[]
  hunks: Record<string, GitDiffHunk[]>
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: GitStatusFile[]
  unstaged: GitStatusFile[]
  untracked: GitStatusFile[]
  conflicted: GitStatusFile[]
}

// ============================================================================
// Core Git Operations
// ============================================================================

async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await gitExec(['rev-parse', '--is-inside-work-tree'], cwd)
  return result.code === 0 && result.stdout.trim() === 'true'
}

async function getGitRoot(cwd: string): Promise<string | null> {
  const result = await gitExec(['rev-parse', '--show-toplevel'], cwd)
  return result.code === 0 ? result.stdout.trim() : null
}

function parseStatusCode(code: string): GitStatusFile['status'] {
  const map: Record<string, GitStatusFile['status']> = {
    'M': 'modified',
    'A': 'added',
    'D': 'deleted',
    'R': 'renamed',
    'C': 'copied',
    '?': 'untracked',
    '!': 'ignored',
    'U': 'conflict',
  }
  return map[code] || 'modified'
}

async function getStatus(cwd: string): Promise<GitStatusResult> {
  const empty: GitStatusResult = {
    isRepo: false,
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  }

  if (!(await isGitRepo(cwd))) {
    return empty
  }

  // Get branch info
  const branchResult = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : ''

  // upstream and ahead/behind will be parsed from porcelain v2 output below
  let upstream: string | null = null
  let ahead = 0
  let behind = 0

  // Get status with porcelain v2 (no -z flag, use line-based parsing)
  const statusResult = await gitExec(
    ['status', '--porcelain=v2', '--branch', '--renames'],
    cwd
  )

  if (statusResult.code !== 0) {
    return { ...empty, isRepo: true, branch, upstream }
  }

  const staged: GitStatusFile[] = []
  const unstaged: GitStatusFile[] = []
  const untracked: GitStatusFile[] = []
  const conflicted: GitStatusFile[] = []

  // Parse porcelain v2 output line by line
  for (const line of statusResult.stdout.split('\n')) {
    if (!line) continue

    if (line.startsWith('# ')) {
      // Branch info lines from porcelain v2
      if (line.startsWith('# branch.upstream ')) {
        upstream = line.substring('# branch.upstream '.length).trim()
      } else if (line.startsWith('# branch.ab ')) {
        const abStr = line.substring('# branch.ab '.length).trim()
        const abMatch = abStr.match(/^\+(\d+)\s+-(\d+)$/)
        if (abMatch) {
          ahead = parseInt(abMatch[1], 10)
          behind = parseInt(abMatch[2], 10)
        }
      }
      continue
    }

    if (line.startsWith('1 ')) {
      // Ordinary entry: 1 XY SUB MH MI MW OH OI path
      const parts = line.split(' ')
      const xy = parts[1]
      const statusCodeX = xy[0] // index status
      const statusCodeY = xy[1] // worktree status
      const filePath = parts.slice(8).join(' ')

      const isStaged = statusCodeX !== '.' && statusCodeX !== '?' && statusCodeX !== '!'
      const isUnstaged = statusCodeY !== '.' && statusCodeY !== '?' && statusCodeY !== '!'

      const stagedStatus = parseStatusCode(statusCodeX === '.' ? ' ' : statusCodeX)
      const unstagedStatus = parseStatusCode(statusCodeY === '.' ? ' ' : statusCodeY)

      if (isStaged) {
        staged.push({
          path: filePath,
          statusCode: statusCodeX,
          status: stagedStatus,
          staged: true,
          isTracked: true,
        })
      }

      if (isUnstaged) {
        unstaged.push({
          path: filePath,
          statusCode: statusCodeY,
          status: unstagedStatus,
          staged: false,
          isTracked: true,
        })
      }

      // Check for conflict
      if (statusCodeX === 'U' || statusCodeY === 'U' ||
          (statusCodeX === 'A' && statusCodeY === 'A') ||
          (statusCodeX === 'D' && statusCodeY === 'D')) {
        conflicted.push({
          path: filePath,
          statusCode: xy,
          status: 'conflict',
          staged: isStaged,
          isTracked: true,
        })
      }
    } else if (line.startsWith('2 ')) {
      // Renamed/copied entry: 2 XY SUB MH MI MW OH OI XP path
      const parts = line.split(' ')
      const xy = parts[1]
      const statusCodeX = xy[0]
      const statusCodeY = xy[1]
      // Find the two paths: they are separated by the rename percentage field
      // Format: 2 XY SUB MH MI MW OH OI XP NEW_PATH\tOLD_PATH
      // The last field contains "new_path\told_path" (tab-separated)
      const pathField = parts.slice(9).join(' ')
      const tabIdx = pathField.indexOf('\t')
      const newPath = tabIdx >= 0 ? pathField.substring(0, tabIdx) : pathField
      const oldPath = tabIdx >= 0 ? pathField.substring(tabIdx + 1) : undefined

      const isStaged = statusCodeX !== '.' && statusCodeX !== '?'
      const isUnstaged = statusCodeY !== '.' && statusCodeY !== '?'

      if (isStaged) {
        staged.push({
          path: newPath,
          originalPath: oldPath,
          statusCode: statusCodeX,
          status: 'renamed',
          staged: true,
          isTracked: true,
        })
      }
      if (isUnstaged) {
        unstaged.push({
          path: newPath,
          originalPath: oldPath,
          statusCode: statusCodeY,
          status: 'modified',
          staged: false,
          isTracked: true,
        })
      }
    } else if (line.startsWith('u ')) {
      // Unmerged entry: u XY SUB MH MI MW OH OM OI WT path
      const parts = line.split(' ')
      const filePath = parts.slice(10).join(' ')
      conflicted.push({
        path: filePath,
        statusCode: 'U',
        status: 'conflict',
        staged: false,
        isTracked: true,
      })
    } else if (line.startsWith('? ')) {
      // Untracked
      const filePath = line.substring(2)
      untracked.push({
        path: filePath,
        statusCode: '?',
        status: 'untracked',
        staged: false,
        isTracked: false,
      })
    } else if (line.startsWith('! ')) {
      // Ignored - skip
    }
  }

  return {
    isRepo: true,
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    conflicted,
  }
}

async function stageFiles(cwd: string, paths: string[]): Promise<boolean> {
  const result = await gitExec(['add', '--', ...paths], cwd)
  return result.code === 0
}

async function unstageFiles(cwd: string, paths: string[]): Promise<boolean> {
  const result = await gitExec(['reset', 'HEAD', '--', ...paths], cwd)
  return result.code === 0
}

async function stageAll(cwd: string): Promise<boolean> {
  const result = await gitExec(['add', '-A'], cwd)
  return result.code === 0
}

async function unstageAll(cwd: string): Promise<boolean> {
  const result = await gitExec(['reset', 'HEAD'], cwd)
  return result.code === 0
}

async function commit(cwd: string, message: string, amend?: boolean): Promise<{ success: boolean; hash?: string; error?: string }> {
  let tmpDir: string | undefined
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'git-commit-'))
    const msgFile = join(tmpDir, 'msg.txt')
    writeFileSync(msgFile, message, 'utf8')

    const args = ['commit', '-F', msgFile]
    if (amend) {
      args.push('--amend', '--no-edit')
    }
    const result = await gitExec(args, cwd)
    if (result.code === 0) {
      const hashResult = await gitExec(['rev-parse', 'HEAD'], cwd)
      return { success: true, hash: hashResult.stdout.trim().substring(0, 7) }
    }
    return { success: false, error: result.stderr || result.stdout }
  } finally {
    if (tmpDir) {
      try { unlinkSync(join(tmpDir, 'msg.txt')) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  }
}

async function getStagedDiffRaw(cwd: string): Promise<string> {
  const result = await gitExec(['diff', '--cached', '--no-color', '--unified=3'], cwd)
  return result.code === 0 ? result.stdout : ''
}

async function getDiff(cwd: string, path: string, staged?: boolean): Promise<GitDiffResult | null> {
  const args = ['diff', '--no-color', '--unified=3']
  if (staged) {
    args.push('--cached')
  }
  args.push('--', path)

  const result = await gitExec(args, cwd)
  if (result.code !== 0) {
    return null
  }

  // Parse unified diff
  const hunks: GitDiffHunk[] = []
  let additions = 0
  let deletions = 0

  const lines = result.stdout.split('\n')
  let i = 0

  // Skip header lines
  while (i < lines.length && !lines[i].startsWith('@@')) {
    i++
  }

  // Parse hunks
  while (i < lines.length) {
    if (lines[i].startsWith('@@')) {
      const match = lines[i].match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const hunkLines: string[] = []
        i++ // skip @@ line
        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff ')) {
          const line = lines[i]
          if (line.startsWith('+')) {
            additions++
          } else if (line.startsWith('-')) {
            deletions++
          }
          hunkLines.push(line)
          i++
        }
        hunks.push({
          oldStart: parseInt(match[1], 10),
          oldLines: parseInt(match[2] || '1', 10),
          newStart: parseInt(match[3], 10),
          newLines: parseInt(match[4] || '1', 10),
          content: hunkLines.join('\n'),
        })
      } else {
        i++
      }
    } else {
      i++
    }
  }

  return {
    path,
    hunks,
    additions,
    deletions,
    isBinary: result.stdout.includes('Binary files'),
  }
}

async function getFullDiff(cwd: string): Promise<GitFullDiffResult | null> {
  const isRepo = await isGitRepo(cwd)
  if (!isRepo) return null

  // Get numstat for file-level stats
  const numstatResult = await gitExec(['--no-optional-locks', 'diff', 'HEAD', '--numstat'], cwd)
  if (numstatResult.code !== 0) return null

  // Parse numstat for per-file stats
  const files: GitFullDiffFileStats[] = []
  let totalAdded = 0
  let totalRemoved = 0
  let fileCount = 0

  const numstatLines = numstatResult.stdout.trim().split('\n').filter(Boolean)
  for (const line of numstatLines) {
    const parts = line.split('\t')
    if (parts.length < 3) continue

    fileCount++
    const addStr = parts[0]!
    const remStr = parts[1]!
    const filePath = parts.slice(2).join('\t')
    const isBinary = addStr === '-' || remStr === '-'
    const fileAdded = isBinary ? 0 : parseInt(addStr, 10) || 0
    const fileRemoved = isBinary ? 0 : parseInt(remStr, 10) || 0

    totalAdded += fileAdded
    totalRemoved += fileRemoved

    files.push({
      path: filePath,
      linesAdded: fileAdded,
      linesRemoved: fileRemoved,
      isBinary,
    })
  }

  // Get untracked files
  const untrackedResult = await gitExec(
    ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard'],
    cwd,
  )
  if (untrackedResult.code === 0 && untrackedResult.stdout.trim()) {
    const untrackedPaths = untrackedResult.stdout.trim().split('\n').filter(Boolean)
    for (const filePath of untrackedPaths) {
      files.push({
        path: filePath,
        linesAdded: 0,
        linesRemoved: 0,
        isBinary: false,
        isUntracked: true,
      })
      fileCount++
    }
  }

  // Get full diff hunks for all files
  const diffResult = await gitExec(
    ['--no-optional-locks', 'diff', 'HEAD', '--no-color', '--unified=3'],
    cwd,
  )

  const hunks: Record<string, GitDiffHunk[]> = {}
  if (diffResult.code === 0 && diffResult.stdout.trim()) {
    const fileDiffs = diffResult.stdout.split(/^diff --git /m).filter(Boolean)
    for (const fileDiff of fileDiffs) {
      const lines = fileDiff.split('\n')
      const headerMatch = lines[0]?.match(/^a\/(.+?) b\/(.+)$/)
      if (!headerMatch) continue
      const filePath = headerMatch[2] ?? headerMatch[1] ?? ''

      const fileHunks: GitDiffHunk[] = []
      let currentHunk: GitDiffHunk | null = null
      let currentLines: string[] = []

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i] ?? ''
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)

        if (hunkMatch) {
          if (currentHunk) {
            currentHunk.content = currentLines.join('\n')
            fileHunks.push(currentHunk)
          }
          currentHunk = {
            oldStart: parseInt(hunkMatch[1] ?? '0', 10),
            oldLines: parseInt(hunkMatch[2] ?? '1', 10),
            newStart: parseInt(hunkMatch[3] ?? '0', 10),
            newLines: parseInt(hunkMatch[4] ?? '1', 10),
            content: '',
          }
          currentLines = []
          continue
        }

        // Skip diff metadata
        if (
          line.startsWith('index ') ||
          line.startsWith('---') ||
          line.startsWith('+++') ||
          line.startsWith('new file') ||
          line.startsWith('deleted file') ||
          line.startsWith('old mode') ||
          line.startsWith('new mode') ||
          line.startsWith('Binary files')
        ) {
          continue
        }

        if (
          currentHunk &&
          (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '')
        ) {
          currentLines.push(line)
        }
      }

      if (currentHunk) {
        currentHunk.content = currentLines.join('\n')
        fileHunks.push(currentHunk)
      }

      if (fileHunks.length > 0) {
        hunks[filePath] = fileHunks
      }
    }
  }

  // Sort files alphabetically
  files.sort((a, b) => a.path.localeCompare(b.path))

  return {
    stats: {
      filesCount: fileCount,
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
    },
    files,
    hunks,
  }
}

async function getBranches(cwd: string): Promise<GitBranch[]> {
  const result = await gitExec(
    ['branch', '-a', '--no-color', '-v', '--abbrev=40'],
    cwd
  )
  if (result.code !== 0) {
    return []
  }

  const branches: GitBranch[] = []
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const current = line.startsWith('*')
    const match = trimmed.replace(/^\*\s+/, '').match(/^([^\s]+)\s+([0-9a-f]{7,40})(?:\s+\[(.*?)\])?\s+(.*)/)
    if (match) {
      const name = match[1]
      const isRemote = name.startsWith('remotes/')
      let upstream: string | undefined
      let ahead: number | undefined
      let behind: number | undefined

      if (match[3]) {
        // Parse upstream tracking info like "origin/main: ahead 2, behind 1"
        const tracking = match[3]
        upstream = tracking.split(':')[0]
        const aheadMatch = tracking.match(/ahead (\d+)/)
        const behindMatch = tracking.match(/behind (\d+)/)
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10)
        if (behindMatch) behind = parseInt(behindMatch[1], 10)
      }

      branches.push({
        name: isRemote ? name : name,
        current,
        isRemote,
        upstream,
        ahead,
        behind,
      })
    }
  }
  return branches
}

async function checkout(cwd: string, ref: string): Promise<{ success: boolean; error?: string }> {
  const result = await gitExec(['checkout', ref], cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

async function createBranch(cwd: string, name: string, checkoutTo?: boolean): Promise<{ success: boolean; error?: string }> {
  const args = checkoutTo ? ['checkout', '-b', name] : ['branch', name]
  const result = await gitExec(args, cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

async function deleteBranch(cwd: string, name: string, force?: boolean): Promise<{ success: boolean; error?: string }> {
  const args = ['branch', force ? '-D' : '-d', name]
  const result = await gitExec(args, cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

async function getLog(cwd: string, count: number = 50): Promise<GitLogEntry[]> {
  const result = await gitExec(
    ['log', `--max-count=${count}`, '--pretty=format:%H%n%h%n%s%n%an%n%ai%n%D', '--no-color'],
    cwd
  )
  if (result.code !== 0) {
    return []
  }

  const entries: GitLogEntry[] = []
  const blocks = result.stdout.split('\n\n')

  for (const block of blocks) {
    const lines = block.split('\n')
    if (lines.length >= 5) {
      entries.push({
        hash: lines[0],
        shortHash: lines[1],
        subject: lines[2],
        author: lines[3],
        date: lines[4],
        refs: lines[5] || '',
      })
    }
  }

  return entries
}

async function showFile(cwd: string, path: string): Promise<string | null> {
  const result = await gitExec(['show', `HEAD:${path}`], cwd)
  if (result.code !== 0) {
    return null
  }
  return result.stdout
}

async function discardChanges(cwd: string, paths: string[]): Promise<boolean> {
  // For tracked files, checkout HEAD version
  // For untracked files, clean them
  const result = await gitExec(['checkout', 'HEAD', '--', ...paths], cwd)
  if (result.code !== 0) {
    // Try clean for untracked
    const cleanResult = await gitExec(['clean', '-f', '--', ...paths], cwd)
    return cleanResult.code === 0
  }
  return true
}

async function pull(cwd: string): Promise<{ success: boolean; error?: string }> {
  const result = await gitExec(['pull'], cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

async function push(cwd: string): Promise<{ success: boolean; error?: string }> {
  const result = await gitExec(['push'], cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

async function stash(cwd: string): Promise<{ success: boolean; error?: string }> {
  const result = await gitExec(['stash'], cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

async function stashPop(cwd: string): Promise<{ success: boolean; error?: string }> {
  const result = await gitExec(['stash', 'pop'], cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerGitIPCHandlers() {
  ipcMain.handle('git:isRepo', async (_event, cwd: string) => {
    return isGitRepo(cwd)
  })

  ipcMain.handle('git:getRoot', async (_event, cwd: string) => {
    return getGitRoot(cwd)
  })

  ipcMain.handle('git:getStatus', async (_event, cwd: string) => {
    return getStatus(cwd)
  })

  ipcMain.handle('git:stage', async (_event, cwd: string, paths: string[]) => {
    return stageFiles(cwd, paths)
  })

  ipcMain.handle('git:unstage', async (_event, cwd: string, paths: string[]) => {
    return unstageFiles(cwd, paths)
  })

  ipcMain.handle('git:stageAll', async (_event, cwd: string) => {
    return stageAll(cwd)
  })

  ipcMain.handle('git:unstageAll', async (_event, cwd: string) => {
    return unstageAll(cwd)
  })

  ipcMain.handle('git:commit', async (_event, cwd: string, message: string, amend?: boolean) => {
    return commit(cwd, message, amend)
  })

  ipcMain.handle('git:getDiff', async (_event, cwd: string, path: string, staged?: boolean) => {
    return getDiff(cwd, path, staged)
  })

  ipcMain.handle('git:getStagedDiff', async (_event, cwd: string) => {
    return getStagedDiffRaw(cwd)
  })

  ipcMain.handle('git:showFile', async (_event, cwd: string, path: string) => {
    return showFile(cwd, path)
  })

  ipcMain.handle('git:getBranches', async (_event, cwd: string) => {
    return getBranches(cwd)
  })

  ipcMain.handle('git:checkout', async (_event, cwd: string, ref: string) => {
    return checkout(cwd, ref)
  })

  ipcMain.handle('git:createBranch', async (_event, cwd: string, name: string, checkoutTo?: boolean) => {
    return createBranch(cwd, name, checkoutTo)
  })

  ipcMain.handle('git:deleteBranch', async (_event, cwd: string, name: string, force?: boolean) => {
    return deleteBranch(cwd, name, force)
  })

  ipcMain.handle('git:getLog', async (_event, cwd: string, count?: number) => {
    return getLog(cwd, count)
  })

  ipcMain.handle('git:discardChanges', async (_event, cwd: string, paths: string[]) => {
    return discardChanges(cwd, paths)
  })

  ipcMain.handle('git:pull', async (_event, cwd: string) => {
    return pull(cwd)
  })

  ipcMain.handle('git:push', async (_event, cwd: string) => {
    return push(cwd)
  })

  ipcMain.handle('git:stash', async (_event, cwd: string) => {
    return stash(cwd)
  })

  ipcMain.handle('git:stashPop', async (_event, cwd: string) => {
    return stashPop(cwd)
  })

  ipcMain.handle('git:fetchAll', async (_event, cwd: string) => {
    const result = await gitExec(['fetch', '--all', '--prune'], cwd)
    return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
  })

  ipcMain.handle('git:getFullDiff', async (_event, cwd: string) => {
    return getFullDiff(cwd)
  })

  console.log('[GitService] IPC handlers registered')
}
