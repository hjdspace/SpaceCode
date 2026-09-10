/**
 * Git Service for Electron Main Process
 *
 * Provides git operations via child_process.execFile.
 * Referenced VSCode SCM architecture: status tracking, staging, committing, branching.
 */

import * as childProcess from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs'
import { watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ipcMain, BrowserWindow } from 'electron'
import { debug } from './logger'
import { LOG_FORMAT, parseLogLine, parseNumstatLine, parseNameStatusLine, parseNumstatPath, parseTrackInfo } from './gitParsers'
import { gitChannels } from '@/shared/channels/git'
import { registerHandlers } from '@/shared/handlerRegistry'

const GIT_TIMEOUT = 10000
const GIT_BINARY = process.platform === 'win32' ? 'git.exe' : 'git'

interface ExecResult {
  stdout: string
  stderr: string
  code: number | string
}

function gitExec(args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    childProcess.execFile(
      GIT_BINARY,
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        let code: number | string = 0
        if (error) {
          // Node.js may set error.code to a string (e.g. 'ENOENT', 'ETIMEDOUT')
          // or a number (process exit code). Normalize to number when possible.
          const errCode = (error as any).code
          if (typeof errCode === 'number') {
            code = errCode
          } else if (typeof errCode === 'string') {
            // String codes like 'ENOENT' mean the process didn't even start
            code = errCode
          } else {
            code = 1
          }
        }
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          code,
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
  [key: string]: unknown
}

export interface GitBranch {
  name: string
  current: boolean
  isRemote: boolean
  upstream?: string
  ahead?: number
  behind?: number
  [key: string]: unknown
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  subject: string
  message: string
  author: string
  date: string
  refs: string
  [key: string]: unknown
}

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  content: string
  [key: string]: unknown
}

export interface GitDiffResult {
  path: string
  oldPath?: string
  hunks: GitDiffHunk[]
  additions: number
  deletions: number
  isBinary: boolean
  [key: string]: unknown
}

export interface GitFullDiffFileStats {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isUntracked?: boolean
  isStaged?: boolean
  [key: string]: unknown
}

export interface GitFullDiffResult {
  stats: {
    filesCount: number
    linesAdded: number
    linesRemoved: number
  }
  files: GitFullDiffFileStats[]
  hunks: Record<string, GitDiffHunk[]>
  [key: string]: unknown
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
  [key: string]: unknown
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
    console.warn('[GitService] isGitRepo returned false for cwd:', cwd)
    return empty
  }

  // Get branch info
  const branchResult = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : ''

  // Get upstream info separately (more reliable than parsing from status)
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const upstreamResult = await gitExec(['rev-parse', '--abbrev-ref', '@{upstream}'], cwd)
  if (upstreamResult.code === 0 && upstreamResult.stdout.trim()) {
    upstream = upstreamResult.stdout.trim()
    const abResult = await gitExec(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], cwd)
    if (abResult.code === 0) {
      const parts = abResult.stdout.trim().split(/\s+/)
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0
        ahead = parseInt(parts[1], 10) || 0
      }
    }
  }

  // Try porcelain v2 first, fall back to v1
  // NOTE: -c core.quotePath=false is a git GLOBAL option, must come BEFORE the subcommand
  const statusResult = await gitExec(
    ['-c', 'core.quotePath=false', 'status', '--porcelain=v2', '--branch', '--renames', '-uall'],
    cwd
  )

  if (statusResult.code !== 0) {
    console.warn('[GitService] git status --porcelain=v2 failed (code:', statusResult.code, '), stderr:', statusResult.stderr)
    // Fallback to porcelain v1
    return getStatusPorcelainV1(cwd, branch, upstream, ahead, behind)
  }

  if (!statusResult.stdout.trim()) {
    // No changes
    return { ...empty, isRepo: true, branch, upstream, ahead, behind }
  }

  const staged: GitStatusFile[] = []
  const unstaged: GitStatusFile[] = []
  const untracked: GitStatusFile[] = []
  const conflicted: GitStatusFile[] = []

  // Parse porcelain v2 output line by line
  // Handle CRLF: split by \n and trim \r from each line
  for (const rawLine of statusResult.stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line) continue

    if (line.startsWith('# ')) {
      // Branch info lines from porcelain v2 (already parsed above, but keep as fallback)
      if (line.startsWith('# branch.upstream ')) {
        if (!upstream) upstream = line.substring('# branch.upstream '.length).trim()
      } else if (line.startsWith('# branch.ab ')) {
        if (ahead === 0 && behind === 0) {
          const abStr = line.substring('# branch.ab '.length).trim()
          const abMatch = abStr.match(/^\+(\d+)\s+-(\d+)$/)
          if (abMatch) {
            ahead = parseInt(abMatch[1], 10)
            behind = parseInt(abMatch[2], 10)
          }
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

/**
 * Fallback: parse git status --porcelain (v1) output
 * Format: XY PATH or XY ORIG_PATH -> PATH
 */
async function getStatusPorcelainV1(
  cwd: string,
  branch: string,
  upstream: string | null,
  ahead: number,
  behind: number
): Promise<GitStatusResult> {
  const empty: GitStatusResult = {
    isRepo: true, branch, upstream, ahead, behind,
    staged: [], unstaged: [], untracked: [], conflicted: [],
  }

  const statusResult = await gitExec(
    ['-c', 'core.quotePath=false', 'status', '--porcelain', '--renames', '-uall'],
    cwd
  )

  if (statusResult.code !== 0) {
    console.error('[GitService] git status --porcelain v1 also failed (code:', statusResult.code, '), stderr:', statusResult.stderr)
    return empty
  }

  if (!statusResult.stdout.trim()) {
    return empty
  }

  const staged: GitStatusFile[] = []
  const unstaged: GitStatusFile[] = []
  const untracked: GitStatusFile[] = []
  const conflicted: GitStatusFile[] = []

  for (const rawLine of statusResult.stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line) continue

    // v1 format: XY PATH or XY ORIG -> PATH
    const statusCodeX = line[0]
    const statusCodeY = line[1]
    let filePath = line.substring(3) // skip "XY "

    // Handle rename: "XY old_path -> new_path"
    let originalPath: string | undefined
    const arrowIdx = filePath.indexOf(' -> ')
    if (arrowIdx >= 0) {
      originalPath = filePath.substring(0, arrowIdx)
      filePath = filePath.substring(arrowIdx + 4)
    }

    // Untracked
    if (statusCodeX === '?' && statusCodeY === '?') {
      untracked.push({
        path: filePath,
        statusCode: '?',
        status: 'untracked',
        staged: false,
        isTracked: false,
      })
      continue
    }

    // Ignored
    if (statusCodeX === '!' && statusCodeY === '!') {
      continue
    }

    const isStaged = statusCodeX !== ' ' && statusCodeX !== '?' && statusCodeX !== '!'
    const isUnstaged = statusCodeY !== ' ' && statusCodeY !== '?' && statusCodeY !== '!'

    if (isStaged) {
      staged.push({
        path: filePath,
        originalPath,
        statusCode: statusCodeX,
        status: parseStatusCode(statusCodeX),
        staged: true,
        isTracked: true,
      })
    }

    if (isUnstaged) {
      unstaged.push({
        path: filePath,
        originalPath,
        statusCode: statusCodeY,
        status: parseStatusCode(statusCodeY),
        staged: false,
        isTracked: true,
      })
    }

    // Conflict detection
    if (statusCodeX === 'U' || statusCodeY === 'U' ||
        (statusCodeX === 'A' && statusCodeY === 'A') ||
        (statusCodeX === 'D' && statusCodeY === 'D')) {
      conflicted.push({
        path: filePath,
        statusCode: `${statusCodeX}${statusCodeY}`,
        status: 'conflict',
        staged: isStaged,
        isTracked: true,
      })
    }
  }

  debug('GitService', `getStatus v1 fallback result: staged=${staged.length}, unstaged=${unstaged.length}, untracked=${untracked.length}, conflicted=${conflicted.length}`)

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
    // git diff may return a non-zero exit code for untracked files in some
    // edge cases (e.g. certain git versions or configurations). Before
    // giving up, try the untracked file diff as a fallback so newly created
    // files are still visible in the SCM diff viewer.
    if (!staged) {
      const untrackedDiff = await getUntrackedFileDiff(cwd, path)
      if (untrackedDiff) {
        return untrackedDiff
      }
    }
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

  // If no hunks were found and this is an unstaged diff, the file may be
  // untracked (git diff does not show untracked files). In that case, build
  // a synthetic diff showing the entire file content as additions so the
  // user can see what was created.
  if (hunks.length === 0 && !staged) {
    const untrackedDiff = await getUntrackedFileDiff(cwd, path)
    if (untrackedDiff) {
      return untrackedDiff
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

/**
 * For untracked files, `git diff` returns empty output because git does not
 * track untracked files in regular diffs. This function detects untracked
 * files and builds a synthetic diff where every line is an addition (prefixed
 * with '+'), so the user can see the full content of newly created files.
 */
async function getUntrackedFileDiff(cwd: string, filePath: string): Promise<GitDiffResult | null> {
  // Check if the file is tracked by git. `git ls-files --error-unmatch`
  // returns exit code 1 when the file is not tracked (i.e. untracked).
  const trackedCheck = await gitExec(['ls-files', '--error-unmatch', '--', filePath], cwd)
  if (trackedCheck.code === 0) {
    // File is tracked — the empty diff is legitimate (no unstaged changes)
    return null
  }

  try {
    const fullPath = join(cwd, filePath)
    const content = readFileSync(fullPath)

    // Binary file check: presence of null byte indicates binary content
    if (content.includes(0)) {
      return {
        path: filePath,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: true,
      }
    }

    const text = content.toString('utf8')
    const contentLines = text.split('\n')

    // Remove trailing empty string that results from a final newline
    if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
      contentLines.pop()
    }

    // Empty file — return a result with no hunks (nothing to show)
    if (contentLines.length === 0) {
      return {
        path: filePath,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: false,
      }
    }

    // Build a single hunk where every line is an addition
    const hunkContent = contentLines.map(line => `+${line}`).join('\n')

    return {
      path: filePath,
      hunks: [{
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: contentLines.length,
        content: hunkContent,
      }],
      additions: contentLines.length,
      deletions: 0,
      isBinary: false,
    }
  } catch {
    return null
  }
}

async function getFullDiff(cwd: string): Promise<GitFullDiffResult | null> {
  const isRepo = await isGitRepo(cwd)
  if (!isRepo) return null

  const filesByKey = new Map<string, GitFullDiffFileStats>()
  const hunks: Record<string, GitDiffHunk[]> = {}

  const addFileStats = (filePath: string, linesAdded: number, linesRemoved: number, isBinary: boolean, isStaged: boolean) => {
    const existing = filesByKey.get(filePath)
    if (existing) {
      existing.linesAdded += linesAdded
      existing.linesRemoved += linesRemoved
      existing.isBinary = existing.isBinary || isBinary
      existing.isStaged = existing.isStaged || isStaged
      return existing
    }

    const fileStats: GitFullDiffFileStats = {
      path: filePath,
      linesAdded,
      linesRemoved,
      isBinary,
      isStaged,
    }
    filesByKey.set(filePath, fileStats)
    return fileStats
  }

  const collectNumstat = async (args: string[], isStaged: boolean): Promise<boolean> => {
    const result = await gitExec(args, cwd)
    if (result.code !== 0) return false

    const lines = result.stdout.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length < 3) continue

      const addStr = parts[0]!
      const remStr = parts[1]!
      const filePath = parseNumstatPath(parts.slice(2).join('\t'))
      const isBinary = addStr === '-' || remStr === '-'
      const fileAdded = isBinary ? 0 : parseInt(addStr, 10) || 0
      const fileRemoved = isBinary ? 0 : parseInt(remStr, 10) || 0

      addFileStats(filePath, fileAdded, fileRemoved, isBinary, isStaged)
    }

    return true
  }

  const collectDiffHunks = async (args: string[]) => {
    const result = await gitExec(args, cwd)
    if (result.code !== 0 || !result.stdout.trim()) return

    const fileDiffs = result.stdout.split(/^diff --git /m).filter(Boolean)
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
        const existing = hunks[filePath] || []
        hunks[filePath] = existing.concat(fileHunks)
      }
    }
  }

  const stagedOk = await collectNumstat(
    ['--no-optional-locks', '-c', 'core.quotePath=false', 'diff', '--cached', '--numstat'],
    true,
  )
  const unstagedOk = await collectNumstat(
    ['--no-optional-locks', '-c', 'core.quotePath=false', 'diff', '--numstat'],
    false,
  )
  if (!stagedOk || !unstagedOk) return null

  // Get untracked files. They are shown as changed files, but line counts stay at 0
  // unless/until they become part of a git diff.
  const untrackedResult = await gitExec(
    ['--no-optional-locks', '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'],
    cwd,
  )
  if (untrackedResult.code === 0 && untrackedResult.stdout.trim()) {
    const untrackedPaths = untrackedResult.stdout.trim().split('\n').filter(Boolean)
    for (const filePath of untrackedPaths) {
      const fileStats = addFileStats(filePath, countFileLines(cwd, filePath), 0, false, false)
      fileStats.isUntracked = true
    }
  }

  await collectDiffHunks(
    ['--no-optional-locks', '-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '--unified=3'],
  )
  await collectDiffHunks(
    ['--no-optional-locks', '-c', 'core.quotePath=false', 'diff', '--no-color', '--unified=3'],
  )

  const files = Array.from(filesByKey.values()).sort((a, b) => a.path.localeCompare(b.path))
  const totalAdded = files.reduce((sum, file) => sum + file.linesAdded, 0)
  const totalRemoved = files.reduce((sum, file) => sum + file.linesRemoved, 0)

  return {
    stats: {
      filesCount: files.length,
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
    },
    files,
    hunks,
  }
}

// parseNumstatPath moved to gitParsers.ts (pure function, unit-tested there)

function countFileLines(cwd: string, filePath: string): number {
  try {
    const content = readFileSync(join(cwd, filePath))
    if (content.includes(0)) return 0
    if (content.length === 0) return 0

    let lines = 1
    for (const byte of content) {
      if (byte === 10) lines++
    }

    return content[content.length - 1] === 10 ? lines - 1 : lines
  } catch {
    return 0
  }
}

async function getBranches(cwd: string): Promise<GitBranch[]> {
  // Use `for-each-ref` instead of `git branch -a -v` because its output is
  // machine-parseable and doesn't depend on locale, padding, or commit subject
  // shape. Each line has a stable `|`-separated layout we control.
  //
  // Fields:
  //   refname                  → full path, e.g. "refs/heads/main"
  //   refname:short            → "main", "origin/main"
  //   HEAD                     → "*" if currently checked out, else " "
  //   symref                   → non-empty for symbolic refs (e.g. origin/HEAD → origin/main)
  //   upstream:short           → upstream tracking branch (local refs only)
  //   upstream:track,nobracket → "ahead 2, behind 1" (no surrounding [])
  const FORMAT = [
    '%(refname)',
    '%(refname:short)',
    '%(HEAD)',
    '%(symref)',
    '%(upstream:short)',
    '%(upstream:track,nobracket)',
  ].join('|')

  const result = await gitExec(
    ['for-each-ref', `--format=${FORMAT}`, 'refs/heads', 'refs/remotes'],
    cwd,
  )

  // Fallback to `git branch -a` if for-each-ref fails (very old git, etc.)
  if (result.code !== 0) {
    console.warn('[GitService] for-each-ref failed, falling back:', result.stderr)
    return getBranchesFallback(cwd)
  }

  // Determine the current branch via rev-parse so we can mark it correctly even
  // when the HEAD field is blank (detached HEAD case).
  const headResult = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const currentBranch = headResult.code === 0 ? headResult.stdout.trim() : ''

  const branches: GitBranch[] = []
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line) continue

    const parts = line.split('|')
    if (parts.length < 6) continue
    const [fullRef, shortRef, headMark, symref, upstreamShort, trackInfo] = parts
    const name = (shortRef || '').trim()
    if (!name) continue

    // Skip symbolic refs (e.g. refs/remotes/origin/HEAD → refs/remotes/origin/main).
    if (symref && symref.trim()) continue

    const isRemote = fullRef.startsWith('refs/remotes/')
    const aheadBehind = parseTrackInfo(trackInfo)

    branches.push({
      name,
      current: headMark === '*' || (!isRemote && name === currentBranch),
      isRemote,
      upstream: upstreamShort || undefined,
      ...aheadBehind,
    })
  }

  debug('GitService', `getBranches found ${branches.length} branches (current: ${currentBranch})`)
  return branches
}

// parseTrackInfo moved to gitParsers.ts (pure function, unit-tested there)

async function getBranchesFallback(cwd: string): Promise<GitBranch[]> {
  // Minimal fallback: parse `git branch -a --no-color` output without -v so we
  // never depend on commit subject formatting.
  const currentResult = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const currentBranch = currentResult.code === 0 ? currentResult.stdout.trim() : ''

  const result = await gitExec(['branch', '-a', '--no-color'], cwd)
  if (result.code !== 0) return []

  const branches: GitBranch[] = []
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('(')) continue // detached HEAD marker

    // Skip the symbolic remote HEAD line: "remotes/origin/HEAD -> origin/main"
    if (trimmed.includes(' -> ')) continue

    const isCurrent = line.startsWith('*')
    const name = trimmed.replace(/^\*?\s+/, '')
    if (!name) continue

    const isRemote = name.startsWith('remotes/')
    branches.push({
      name: isRemote ? name.replace(/^remotes\//, '') : name,
      current: isCurrent || name === currentBranch,
      isRemote,
    })
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
  // Single-line \x1f-separated format (see gitParsers.ts) so subjects containing
  // `|` or newlines cannot break parsing, and parent hashes enable graph rendering.
  const result = await gitExec(
    ['log', `--max-count=${count}`, `--pretty=format:${LOG_FORMAT}`, '--no-color'],
    cwd
  )
  if (result.code !== 0) {
    return []
  }

  const entries: GitLogEntry[] = []
  for (const line of result.stdout.split('\n')) {
    const parsed = parseLogLine(line)
    if (parsed) {
      entries.push(parsed)
    }
  }
  return entries
}

async function showFile(cwd: string, path: string, fromIndex = false): Promise<string | null> {
  // HEAD: = committed version, `:path` = staged (index) version
  const result = await gitExec(['show', `${fromIndex ? ':' : 'HEAD:'}${path}`], cwd)
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
// Raw diff / hunk staging / commit detail (VSCode SCM parity)
// ============================================================================

export interface GitCommitFileStat {
  path: string
  originalPath?: string
  statusCode: string
  /** null for binary files */
  additions: number | null
  deletions: number | null
  isBinary: boolean
  [key: string]: unknown
}

/** Raw unified diff (includes the `diff --git` header) for one file. */
async function getRawDiff(cwd: string, path: string, staged?: boolean): Promise<string> {
  const args = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--unified=3']
  if (staged) {
    args.push('--cached')
  }
  args.push('--', path)
  const result = await gitExec(args, cwd)
  return result.code === 0 ? result.stdout : ''
}

async function getCommitParents(cwd: string, hash: string): Promise<string[]> {
  const result = await gitExec(['rev-list', '--parents', '-n', '1', hash], cwd)
  if (result.code !== 0) return []
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean)
}

async function runCommitDiffArgs(cwd: string, args: string[]): Promise<string> {
  const result = await gitExec(args, cwd)
  return result.code === 0 ? result.stdout : ''
}

/**
 * Per-file stats of one commit. Merge commits use first-parent semantics
 * (diff against the first parent); root commits work via `diff-tree --root`.
 */
async function getCommitFiles(cwd: string, hash: string): Promise<GitCommitFileStat[]> {
  const parents = await getCommitParents(cwd, hash)
  const isMerge = parents.length > 1

  const numstatArgs = isMerge
    ? ['-c', 'core.quotePath=false', 'diff', '--numstat', '--no-color', parents[0]!, hash]
    : ['-c', 'core.quotePath=false', 'diff-tree', '--root', '--no-commit-id', '--numstat', '-r', '--no-color', hash]
  const nameStatusArgs = isMerge
    ? ['-c', 'core.quotePath=false', 'diff', '--name-status', '--no-color', parents[0]!, hash]
    : ['-c', 'core.quotePath=false', 'diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '--no-color', hash]

  const [numstatOut, nameStatusOut] = await Promise.all([
    runCommitDiffArgs(cwd, numstatArgs),
    runCommitDiffArgs(cwd, nameStatusArgs),
  ])

  const numstatByPath = new Map<string, ReturnType<typeof parseNumstatLine>>()
  for (const line of numstatOut.split('\n')) {
    const parsed = parseNumstatLine(line)
    if (parsed) numstatByPath.set(parsed.path, parsed)
  }

  const statusByPath = new Map<string, ReturnType<typeof parseNameStatusLine>>()
  for (const line of nameStatusOut.split('\n')) {
    const parsed = parseNameStatusLine(line)
    if (parsed) statusByPath.set(parsed.path, parsed)
  }

  const paths = new Set<string>([...statusByPath.keys(), ...numstatByPath.keys()])
  const files: GitCommitFileStat[] = []
  for (const path of paths) {
    const ns = statusByPath.get(path)
    const num = numstatByPath.get(path)
    files.push({
      path,
      originalPath: ns?.originalPath ?? num?.originalPath,
      statusCode: ns?.statusCode ?? 'M',
      additions: num ? num.additions : null,
      deletions: num ? num.deletions : null,
      isBinary: num?.isBinary ?? false,
    })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/** Raw patch of one commit (first-parent for merges), optionally limited to one file. */
async function getCommitDiff(cwd: string, hash: string, path?: string): Promise<string> {
  const parents = await getCommitParents(cwd, hash)
  const args = ['-c', 'core.quotePath=false']

  if (parents.length > 1) {
    // Merge commit → first-parent diff (git show's combined diff is unreadable)
    args.push('diff', '--no-color', '--unified=3', parents[0]!, hash)
  } else {
    // `git show` handles both normal and root commits (hash^ does not exist for roots)
    args.push('show', '--format=', '--no-color', '--unified=3', hash)
  }
  if (path) {
    args.push('--', path)
  }
  return runCommitDiffArgs(cwd, args)
}

/**
 * Apply a partial patch to the index (hunk-level stage/unstage).
 * Uses a temp file because `git apply` needs a patch source and execFile
 * has no stdin support.
 */
async function applyHunkPatch(cwd: string, patch: string, reverse: boolean): Promise<{ success: boolean; error?: string }> {
  let tmpDir: string | undefined
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'git-apply-'))
    const patchFile = join(tmpDir, 'patch.diff')
    writeFileSync(patchFile, patch, 'utf8')

    const args = ['apply', '--cached', '--whitespace=nowarn']
    if (reverse) args.push('--reverse')
    args.push(patchFile)

    const result = await gitExec(args, cwd)
    if (result.code !== 0) {
      return { success: false, error: result.stderr || result.stdout || 'git apply failed' }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (tmpDir) {
      try { unlinkSync(join(tmpDir, 'patch.diff')) } catch {}
      try { rmdirSync(tmpDir) } catch {}
    }
  }
}

async function resetTo(cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<{ success: boolean; error?: string }> {
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
    return { success: false, error: `Invalid reset mode: ${mode}` }
  }
  const result = await gitExec(['reset', `--${mode}`, hash], cwd)
  return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
}

// ============================================================================
// Git File Watcher — watches .git directory for changes and notifies renderer
// ============================================================================

let gitWatcher: FSWatcher | null = null
let worktreeWatcher: FSWatcher | null = null
let watchedProjectRoot: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 300

function notifyRendererStatusChanged(): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('git:statusChanged')
    }
  }
}

function startGitWatcher(projectRoot: string): void {
  // Stop existing watcher if watching a different project
  if (gitWatcher && watchedProjectRoot !== projectRoot) {
    stopGitWatcher()
  }

  if (gitWatcher) return // Already watching this project

  watchedProjectRoot = projectRoot
  const gitDir = join(projectRoot, '.git')

  // Watch .git directory for index/HEAD/refs changes (staging, committing, branching)
  try {
    gitWatcher = watch(gitDir, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const relevantPrefixes = ['index', 'HEAD', 'refs/', 'objects/']
      const isRelevant = relevantPrefixes.some(p => filename.startsWith(p))
      if (!isRelevant) return

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        notifyRendererStatusChanged()
        debounceTimer = null
      }, DEBOUNCE_MS)
    })
    debug('GitService', `Watching .git directory: ${gitDir}`)
  } catch (e) {
    console.warn(`[GitService] Failed to watch .git directory: ${gitDir}`, e)
  }

  // Watch worktree for file modifications (recursive to detect new/deleted files in subdirectories)
  // This catches external editor changes and LLM-generated files that don't touch .git immediately.
  // { recursive: true } is supported on Windows and macOS. On Linux it falls back to non-recursive.
  try {
    worktreeWatcher = watch(projectRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return
      // Ignore .git changes (already watched above) and node_modules
      if (filename.startsWith('.git') || filename.startsWith('node_modules')) return

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        notifyRendererStatusChanged()
        debounceTimer = null
      }, DEBOUNCE_MS)
    })
    debug('GitService', `Watching worktree (recursive): ${projectRoot}`)
  } catch (e) {
    // Fallback: try non-recursive watch if recursive is not supported (e.g. Linux)
    try {
      worktreeWatcher = watch(projectRoot, (_event, filename) => {
        if (!filename) return
        if (filename.startsWith('.git') || filename.startsWith('node_modules')) return

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          notifyRendererStatusChanged()
          debounceTimer = null
        }, DEBOUNCE_MS)
      })
      debug('GitService', `Watching worktree (non-recursive fallback): ${projectRoot}`)
    } catch (e2) {
      console.warn(`[GitService] Failed to watch worktree: ${projectRoot}`, e2)
    }
  }
}

function stopGitWatcher(): void {
  if (gitWatcher) {
    gitWatcher.close()
    gitWatcher = null
  }
  if (worktreeWatcher) {
    worktreeWatcher.close()
    worktreeWatcher = null
  }
  watchedProjectRoot = null
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  debug('GitService', 'Stopped git watchers')
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerGitIPCHandlers() {
  registerHandlers(ipcMain, gitChannels, 'git:', {
    isRepo: async (cwd: string) => isGitRepo(cwd),
    getRoot: async (cwd: string) => getGitRoot(cwd),
    getStatus: async (cwd: string) => {
      const result = await getStatus(cwd)
      // Auto-start watcher when we detect a git repo
      if (result.isRepo) {
        startGitWatcher(cwd)
      }
      return result
    },
    stage: async (cwd: string, paths: string[]) => stageFiles(cwd, paths),
    unstage: async (cwd: string, paths: string[]) => unstageFiles(cwd, paths),
    stageAll: async (cwd: string) => stageAll(cwd),
    unstageAll: async (cwd: string) => unstageAll(cwd),
    commit: async (cwd: string, message: string, amend?: boolean) => commit(cwd, message, amend),
    getDiff: async (cwd: string, path: string, staged?: boolean) => getDiff(cwd, path, staged),
    getRawDiff: async (cwd: string, path: string, staged?: boolean) => getRawDiff(cwd, path, staged),
    stageHunks: async (cwd: string, path: string, patch: string) => applyHunkPatch(cwd, patch, false),
    unstageHunks: async (cwd: string, path: string, patch: string) => applyHunkPatch(cwd, patch, true),
    getCommitFiles: async (cwd: string, hash: string) => getCommitFiles(cwd, hash),
    getCommitDiff: async (cwd: string, hash: string, path?: string) => getCommitDiff(cwd, hash, path),
    reset: async (cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard') => resetTo(cwd, hash, mode),
    getStagedDiff: async (cwd: string) => getStagedDiffRaw(cwd),
    showFile: async (cwd: string, path: string, fromIndex?: boolean) => showFile(cwd, path, fromIndex),
    getBranches: async (cwd: string) => getBranches(cwd),
    checkout: async (cwd: string, ref: string) => checkout(cwd, ref),
    createBranch: async (cwd: string, name: string, checkoutTo?: boolean) => createBranch(cwd, name, checkoutTo),
    deleteBranch: async (cwd: string, name: string, force?: boolean) => deleteBranch(cwd, name, force),
    getLog: async (cwd: string, count?: number) => getLog(cwd, count),
    discardChanges: async (cwd: string, paths: string[]) => discardChanges(cwd, paths),
    pull: async (cwd: string) => pull(cwd),
    push: async (cwd: string) => push(cwd),
    stash: async (cwd: string) => stash(cwd),
    stashPop: async (cwd: string) => stashPop(cwd),
    fetchAll: async (cwd: string) => {
      const result = await gitExec(['fetch', '--all', '--prune'], cwd)
      return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined }
    },
    getFullDiff: async (cwd: string) => getFullDiff(cwd),
    watchProject: async (cwd: string) => {
      startGitWatcher(cwd)
      return true
    },
    stopWatch: async () => {
      stopGitWatcher()
      return true
    },
  })

  debug('GitService', 'IPC handlers registered')
}
