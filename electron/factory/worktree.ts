/**
 * 任务工作树：固定根目录 `.spacecode/worktrees/<taskId>`，分支 `agent/task-<id>`
 * （GitHub 任务为 `agent/issue-<n>-<slug>`）。
 *
 * 所有 Git 调用都通过注入的 runner 发起，便于单测覆盖错误映射；路径在动 Git
 * 之前先做白名单与符号链接校验，绝不把用户输入直接拼进 shell。
 */
import { execFile } from 'child_process'
import { existsSync, lstatSync } from 'fs'
import { join, resolve, sep } from 'path'
import {
  FACTORY_SANDBOX_WORKTREE_ROOT,
  type FactoryCommit,
  type FactoryTaskDiff,
} from '@/shared/factory'

const GIT_TIMEOUT = 10000
const GIT_MAX_BUFFER = 10 * 1024 * 1024
const GIT_BINARY = process.platform === 'win32' ? 'git.exe' : 'git'
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const SLUG_MAX = 40

export interface GitExecResult {
  ok: boolean
  stdout: string
  stderr: string
}

export type GitRunner = (args: string[], cwd?: string) => Promise<GitExecResult>

export interface WorktreeDeps {
  git?: GitRunner
  pathExists?: (path: string) => boolean
  isSymlink?: (path: string) => boolean
  platform?: NodeJS.Platform
}

function defaultIsSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

const defaultGit: GitRunner = (args, cwd) =>
  new Promise((resolveResult) => {
    execFile(
      GIT_BINARY,
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT,
        maxBuffer: GIT_MAX_BUFFER,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        resolveResult({
          ok: !error,
          stdout: stdout || '',
          stderr: stderr || '',
        })
      },
    )
  })

export const defaultGitRunner: GitRunner = defaultGit

export function isValidTaskId(taskId: string): boolean {
  return TASK_ID_PATTERN.test(taskId)
}

/** 相对仓库根的展示路径，统一用正斜杠，跨平台一致。 */
export function worktreeRelativePath(taskId: string): string {
  return `${FACTORY_SANDBOX_WORKTREE_ROOT}/${taskId}`
}

export function worktreeAbsolutePath(repoRoot: string, taskId: string): string {
  return join(repoRoot, ...FACTORY_SANDBOX_WORKTREE_ROOT.split('/'), taskId)
}

export type WorktreePathResult =
  | { ok: true; absolute: string; relative: string }
  | { ok: false; error: 'invalid-task-id' | 'permission' }

export function resolveWorktreePath(
  repoRoot: string,
  taskId: string,
  deps: Pick<WorktreeDeps, 'isSymlink'> = {},
): WorktreePathResult {
  if (!isValidTaskId(taskId)) return { ok: false, error: 'invalid-task-id' }

  const root = resolve(repoRoot, ...FACTORY_SANDBOX_WORKTREE_ROOT.split('/'))
  const absolute = resolve(root, taskId)
  // 白名单已排除分隔符，这里再做一次包含性检查，防止未来放宽 id 规则时逃逸。
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    return { ok: false, error: 'invalid-task-id' }
  }
  if ((deps.isSymlink ?? defaultIsSymlink)(absolute)) return { ok: false, error: 'invalid-task-id' }

  return { ok: true, absolute, relative: worktreeRelativePath(taskId) }
}

function slugify(title: string, taskId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  return slug || `task-${taskId}`
}

/** 本地任务固定 `agent/task-<id>`；GitHub 任务用编号 + 标题短 slug。 */
export function buildBranchName(input: { taskId: string; issueNumber?: number; title?: string }): string {
  if (typeof input.issueNumber === 'number' && Number.isFinite(input.issueNumber)) {
    return `agent/issue-${input.issueNumber}-${slugify(input.title ?? '', input.taskId)}`
  }
  return `agent/task-${input.taskId}`
}

export interface WorktreeEntry {
  path: string
  branch: string | null
  bare: boolean
  detached: boolean
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> | null = null

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('worktree ')) {
      if (current?.path) entries.push(finishEntry(current))
      current = { path: line.slice('worktree '.length) }
      continue
    }
    if (!current) continue
    if (line.startsWith('branch ')) current.branch = line.slice('branch '.length)
    else if (line === 'bare') current.bare = true
    else if (line === 'detached') current.detached = true
  }
  if (current?.path) entries.push(finishEntry(current))

  return entries
}

function finishEntry(partial: Partial<WorktreeEntry>): WorktreeEntry {
  return {
    path: partial.path ?? '',
    branch: partial.branch ?? null,
    bare: partial.bare === true,
    detached: partial.detached === true,
  }
}

export type WorktreeGitError = 'not-git-repo' | 'permission' | 'path-too-long' | 'branch-in-use' | 'git-error'

export function mapGitFailure(text: string): WorktreeGitError {
  const normalized = text.toLowerCase()
  if (normalized.includes('not a git repository')) return 'not-git-repo'
  if (normalized.includes('permission denied') || normalized.includes('eacces') || normalized.includes('eperm')) {
    return 'permission'
  }
  if (
    normalized.includes('filename too long') ||
    normalized.includes('file name too long') ||
    normalized.includes('enametoolong')
  ) {
    return 'path-too-long'
  }
  if (
    normalized.includes('already exists') ||
    normalized.includes('already checked out') ||
    normalized.includes('is already used by worktree')
  ) {
    return 'branch-in-use'
  }
  return 'git-error'
}

export function gitErrorHint(error: WorktreeGitError, platform: NodeJS.Platform = process.platform): string | null {
  if (error === 'path-too-long' && platform === 'win32') {
    return 'git config --global core.longpaths true'
  }
  return null
}

export interface PrepareWorktreeInput {
  repoRoot: string
  taskId: string
  branch: string
  baseBranch: string
}

export type PrepareWorktreeResult =
  | {
      ok: true
      worktree: { absolute: string; relative: string; branch: string; reused: boolean }
    }
  | {
      ok: false
      error: 'invalid-task-id' | 'permission' | 'not-git-repo' | 'path-too-long' | 'branch-in-use' | 'worktree-mismatch' | 'git-error'
      detail?: string
    }

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function failure(error: WorktreeGitError, stderr: string, platform: NodeJS.Platform): PrepareWorktreeResult {
  const hint = gitErrorHint(error, platform)
  return { ok: false, error, detail: hint ? `${stderr.trim()} (${hint})` : stderr.trim() }
}

/** 幂等准备：同分支同路径复用，其它情况明确阻塞，绝不复用错误分支。 */
export async function prepareWorktree(
  input: PrepareWorktreeInput,
  deps: WorktreeDeps = {},
): Promise<PrepareWorktreeResult> {
  const platform = deps.platform ?? process.platform
  const git = deps.git ?? defaultGit
  const pathExists = deps.pathExists ?? existsSync

  const pathResult = resolveWorktreePath(input.repoRoot, input.taskId, deps)
  if (!pathResult.ok) return { ok: false, error: pathResult.error }
  const { absolute, relative } = pathResult

  const list = await git(['worktree', 'list', '--porcelain'], input.repoRoot)
  if (!list.ok) return failure(mapGitFailure(list.stderr), list.stderr, platform)
  const entries = parseWorktreeList(list.stdout)

  const existingAtPath = entries.find((entry) => samePath(entry.path, absolute, platform))
  if (pathExists(absolute)) {
    if (!existingAtPath) return { ok: false, error: 'worktree-mismatch', detail: relative }
    if (existingAtPath.branch !== `refs/heads/${input.branch}`) {
      return {
        ok: false,
        error: 'worktree-mismatch',
        detail: `${relative} @ ${existingAtPath.branch ?? 'detached'}`,
      }
    }
    return { ok: true, worktree: { absolute, relative, branch: input.branch, reused: true } }
  }

  if (existingAtPath) {
    // 注册过但目录已不在：不擅自重建，留给人工确认。
    return { ok: false, error: 'worktree-mismatch', detail: relative }
  }

  const occupied = entries.find((entry) => entry.branch === `refs/heads/${input.branch}`)
  if (occupied) return { ok: false, error: 'branch-in-use', detail: occupied.path }

  const add = await git(
    ['worktree', 'add', '-b', input.branch, absolute, input.baseBranch],
    input.repoRoot,
  )
  if (!add.ok) return failure(mapGitFailure(add.stderr), add.stderr, platform)

  return { ok: true, worktree: { absolute, relative, branch: input.branch, reused: false } }
}

export interface WorktreeState {
  diff: FactoryTaskDiff
  commits: FactoryCommit[]
  clean: boolean
}

function parseNumstat(stdout: string): FactoryTaskDiff {
  let additions = 0
  let deletions = 0
  const files: NonNullable<FactoryTaskDiff['files']> = []

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const [left, middle, ...rest] = line.split('\t')
    if (middle === undefined) continue
    const path = rest.join('\t').replace(/^"|"$/g, '')
    const add = left === '-' ? 0 : Number(left)
    const del = middle === '-' ? 0 : Number(middle)
    const safeAdd = Number.isFinite(add) ? add : 0
    const safeDel = Number.isFinite(del) ? del : 0
    additions += safeAdd
    deletions += safeDel
    if (path) files.push({ path, additions: safeAdd, deletions: safeDel })
  }

  return {
    additions,
    deletions,
    ...(files.length > 0 ? { files } : {}),
  }
}

function parseCommits(stdout: string): FactoryCommit[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ...message] = line.split('\t')
      return { sha, message: message.join('\t') }
    })
    .filter((commit) => commit.sha !== '')
}

/** 采集工作树相对基础分支的变更、提交与是否干净。读不到工作树时返回 null。 */
export async function collectWorktreeState(
  repoRoot: string,
  taskId: string,
  baseBranch: string,
  deps: WorktreeDeps = {},
): Promise<WorktreeState | null> {
  if (!isValidTaskId(taskId)) return null
  const git = deps.git ?? defaultGit
  const cwd = worktreeAbsolutePath(repoRoot, taskId)

  const numstat = await git(['diff', '--numstat', baseBranch], cwd)
  if (!numstat.ok) return null

  const log = await git(['log', '--format=%H%x09%s', `${baseBranch}..HEAD`], cwd)
  const status = await git(['status', '--porcelain'], cwd)

  return {
    diff: parseNumstat(numstat.stdout),
    commits: log.ok ? parseCommits(log.stdout) : [],
    clean: status.ok ? status.stdout.trim() === '' : false,
  }
}
