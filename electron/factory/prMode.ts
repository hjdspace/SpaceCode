/**
 * PR 模式交付（spec §6.6）：推送任务分支并创建/复用 Pull Request。
 *
 * 与本地合并的分界线是「远端」：本地绝不落 merge commit，远端目标分支不动，
 * 只有任务分支被推上去。失败（无权限、远端拒绝、创建失败）一律把任务转阻塞
 * 并保留工作树，绝不 force push。凭据只在主进程使用，PR 正文落盘前脱敏。
 */
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import {
  FACTORY_RUNS_PATH,
  type FactoryMergeError,
  type FactoryMergePreflight,
  type FactoryMergeResult,
  type FactoryPullRequest,
  type FactoryReview,
  type FactoryTask,
  type FactoryTestRun,
} from '@/shared/factory'
import { readFactoryConfig } from './config'
import { readRunSnapshot } from './runs'
import { transitionTask } from './runtime'
import {
  defaultGitRunner,
  isValidTaskId,
  worktreeAbsolutePath,
  type GitRunner,
} from './worktree'
import { classifyGhFailure, type GhRunner } from './githubClient'
import { defaultGhRunner } from './github'
import { openEventLog, redactSecrets, type FactoryEventInput } from './events'

const DETAIL_MAX = 500

export interface PullRequestDeliveryDeps {
  git?: GitRunner
  gh?: GhRunner
  now?: () => Date
  emit?: (input: FactoryEventInput) => void
  /** 显式指定推送远端名；默认读 `git remote` 并优先 origin。 */
  remote?: string
}

export interface PullRequestBodyInput {
  task: FactoryTask
  targetBranch: string
  commits: number
  tests?: FactoryTestRun
  review?: FactoryReview
}

export interface PullRequestDeliveryInput {
  repoRoot: string
  runId: string
  taskId: string
  task: FactoryTask
  targetBranch: string
  commits: number
  tests?: FactoryTestRun
  review?: FactoryReview
  preflight: FactoryMergePreflight
  deps?: PullRequestDeliveryDeps
}

function trimDetail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > DETAIL_MAX ? trimmed.slice(0, DETAIL_MAX) : trimmed
}

function testStatusLabel(status: FactoryTestRun['status']): string {
  if (status === 'pass') return '通过'
  if (status === 'timeout') return '超时'
  if (status === 'stopped') return '中止'
  return '失败'
}

/** 正文里只放可核对事实；整段最后统一脱敏，避免任务内容夹带密钥。 */
export function buildPullRequestBody(input: PullRequestBodyInput): string {
  const { task, targetBranch, commits, tests, review } = input
  const lines: string[] = []
  lines.push(`## 来源`)
  lines.push(task.issueNumber ? `Closes #${task.issueNumber}` : `任务 ${task.id}`)
  lines.push('')
  lines.push(`## 目标`)
  lines.push(`- 标题：${task.title}`)
  lines.push(`- 目标分支：${targetBranch}`)
  lines.push(`- 提交数：${commits}`)
  lines.push('')
  lines.push(`## 验证`)
  if (tests) {
    lines.push(`- \`${tests.command}\`：${testStatusLabel(tests.status)}`)
  } else {
    lines.push('- 未记录验证结果')
  }
  lines.push('')
  lines.push(`## 审查`)
  if (review) {
    const verdict = review.verdict === 'approved' ? '批准' : '需要修改'
    lines.push(`- 结论：${verdict}`)
    if (review.summary) lines.push(`- 摘要：${review.summary}`)
  } else {
    lines.push('- 未记录审查结论')
  }
  lines.push('')
  lines.push(`## 说明`)
  lines.push(task.goal || '（无）')
  lines.push('')
  lines.push('> 由 SpaceCode Factory 自动创建，合并前请人工确认。')
  return redactSecrets(lines.join('\n'))
}

/** 任务分支 → 同名远端分支，显式写全 refspec 避免歧义。 */
export function buildPushArgs(branch: string, remote: string): string[] {
  return ['push', remote, `${branch}:refs/heads/${branch}`]
}

/** 任何 force 意图都直接拒绝；PR 模式不允许改写远端历史。 */
export function assertPushSafe(args: string[]): void {
  for (const arg of args) {
    if (arg.startsWith('+') || arg === '-f' || /^--force/.test(arg)) {
      throw new Error(`force push is not allowed: ${arg}`)
    }
  }
}

async function resolveRemote(git: GitRunner, repoRoot: string): Promise<string | null> {
  const result = await git(['remote'], repoRoot)
  if (!result.ok) return null
  const names = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (names.includes('origin')) return 'origin'
  return names[0] ?? null
}

interface DeliveryState {
  repoRoot: string
  runId: string
  taskId: string
  git: GitRunner
  gh: GhRunner
  now: () => Date
  emit: (input: FactoryEventInput) => void
}

function defaultEmitter(repoRoot: string, runId: string, now: () => Date) {
  const path = join(repoRoot, FACTORY_RUNS_PATH, runId, 'events.jsonl')
  let sink: ReturnType<typeof openEventLog> | null = null
  return (input: FactoryEventInput): void => {
    sink ??= openEventLog(path, { runId, now })
    sink.append(input)
  }
}

interface ExistingPullRequest {
  number: number
  url: string
  state?: string
}

function parseExistingPrs(stdout: string): ExistingPullRequest[] {
  try {
    const parsed = JSON.parse(stdout) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => item as Record<string, unknown>)
      .filter((item) => typeof item.number === 'number' && typeof item.url === 'string')
      .map((item) => ({
        number: item.number as number,
        url: item.url as string,
        ...(typeof item.state === 'string' ? { state: item.state } : {}),
      }))
  } catch {
    return []
  }
}

function parseCreatedPr(stdout: string): ExistingPullRequest | null {
  const text = stdout.trim()
  if (!text) return null
  const byUrl = /https:\/\/\S+\/pull\/(\d+)/.exec(text)
  if (byUrl) {
    const number = Number(byUrl[1])
    if (Number.isFinite(number)) {
      return { number, url: byUrl[0] }
    }
  }
  return null
}

async function blockDelivery(
  state: DeliveryState,
  error: FactoryMergeError,
  preflight: FactoryMergePreflight,
  code: string,
  detail?: string,
): Promise<FactoryMergeResult> {
  transitionTask(
    state.repoRoot,
    state.runId,
    state.taskId,
    { lane: 'blocked' },
    code,
    {},
    { now: state.now },
  )
  state.emit({ taskId: state.taskId, stage: 'merge', code, level: 'error' })
  return {
    ok: false,
    error,
    ...(detail ? { detail: trimDetail(detail) } : {}),
    preflight,
  }
}

/** 交付成功后清理：工作树干净才移除目录与本地分支，脏则保留。 */
async function cleanupAfterDelivery(
  state: DeliveryState,
  task: FactoryTask,
): Promise<'removed' | 'kept'> {
  if (!isValidTaskId(state.taskId)) return 'kept'
  const absolute = worktreeAbsolutePath(state.repoRoot, state.taskId)
  if (!existsSync(absolute)) return 'kept'

  const status = await state.git(['status', '--porcelain'], absolute)
  if (!status.ok || status.stdout.trim() !== '') {
    state.emit({
      taskId: state.taskId,
      stage: 'merge',
      code: 'merge.cleanup.worktreeDirty',
      level: 'warn',
    })
    return 'kept'
  }

  const remove = await state.git(['worktree', 'remove', absolute], state.repoRoot)
  if (!remove.ok) {
    if (existsSync(absolute)) {
      try {
        rmSync(absolute, { recursive: true, force: true })
      } catch {
        // 清理失败不掩盖交付结果
      }
    }
  }
  await state.git(['branch', '-D', task.branch], state.repoRoot)
  return 'removed'
}

export async function executePullRequestDelivery(
  input: PullRequestDeliveryInput,
): Promise<FactoryMergeResult> {
  const { repoRoot, runId, taskId, task, targetBranch, commits, preflight } = input
  const deps = input.deps ?? {}
  const git = deps.git ?? defaultGitRunner
  const gh = deps.gh ?? defaultGhRunner
  const now = deps.now ?? (() => new Date())
  const emit = deps.emit ?? defaultEmitter(repoRoot, runId, now)
  const state: DeliveryState = { repoRoot, runId, taskId, git, gh, now, emit }

  const config = readFactoryConfig(repoRoot)
  const repo = config?.tracker.type === 'github-issues' ? config.tracker.repo : ''
  const tests = input.tests ?? task.tests
  const review = input.review ?? task.review

  const remote = deps.remote ?? (await resolveRemote(git, repoRoot))
  if (!remote) {
    return blockDelivery(state, 'pr-remote', preflight, 'pr.remote.missing')
  }

  emit({
    taskId,
    stage: 'merge',
    code: 'pr.push.started',
    level: 'info',
    params: { branch: task.branch, remote },
  })

  const pushArgs = buildPushArgs(task.branch, remote)
  assertPushSafe(pushArgs)
  const pushed = await git(pushArgs, repoRoot)
  if (!pushed.ok) {
    return blockDelivery(
      state,
      'push-failed',
      preflight,
      'pr.push.failed',
      `${pushed.stderr}\n${pushed.stdout}`,
    )
  }

  const body = buildPullRequestBody({ task, targetBranch, commits, tests, review })
  const title = task.title

  const listArgs = [
    'pr',
    'list',
    '--head',
    task.branch,
    '--repo',
    repo,
    '--state',
    'open',
    '--json',
    'number,url,state',
  ]
  const listed = await gh(listArgs)
  const existing =
    listed.code === 0 ? parseExistingPrs(listed.stdout).find((item) => (item.state ?? 'OPEN').toUpperCase() !== 'CLOSED') : undefined

  let pullRequest: FactoryPullRequest
  if (existing) {
    await gh(['pr', 'edit', String(existing.number), '--repo', repo, '--title', title, '--body', body])
    pullRequest = {
      number: existing.number,
      url: existing.url,
      reused: true,
      createdAt: now().toISOString(),
    }
    emit({
      taskId,
      stage: 'merge',
      code: 'pr.reused',
      level: 'ok',
      params: { number: existing.number, url: existing.url },
    })
  } else {
    const created = await gh([
      'pr',
      'create',
      '--repo',
      repo,
      '--head',
      task.branch,
      '--base',
      targetBranch,
      '--title',
      title,
      '--body',
      body,
    ])
    const parsed = created.code === 0 ? parseCreatedPr(created.stdout) : null
    if (!parsed) {
      const detail =
        created.code !== 0
          ? classifyGhFailure(created.code, created.stdout ?? '')
          : 'pull request url missing'
      return blockDelivery(
        state,
        'pr-create-failed',
        preflight,
        'pr.create.failed',
        `${detail}\n${created.stdout ?? ''}`,
      )
    }
    pullRequest = {
      number: parsed.number,
      url: parsed.url,
      createdAt: now().toISOString(),
    }
    emit({
      taskId,
      stage: 'merge',
      code: 'pr.created',
      level: 'ok',
      params: { number: parsed.number, url: parsed.url },
    })
  }

  const cleanup = await cleanupAfterDelivery(state, task)
  const mergedAt = now().toISOString()
  const moved = transitionTask(
    repoRoot,
    runId,
    taskId,
    { lane: 'done', stageIdx: 6 },
    'task.pr.created',
    {
      pullRequest,
      mergedCommits: commits,
      targetBranch,
      timestamps: { ...task.timestamps, mergedAt },
      worktree: cleanup === 'removed' ? null : task.worktree,
    },
    { now },
  )
  if (!moved.ok) {
    emit({ taskId, stage: 'merge', code: 'pr.write.failed', level: 'error' })
    return { ok: false, error: 'write-failed' }
  }

  emit({
    taskId,
    stage: 'merge',
    code: 'pr.completed',
    level: 'ok',
    params: { number: pullRequest.number, commits },
  })

  const latest = readRunSnapshot(repoRoot, runId)
  if (!latest) return { ok: false, error: 'write-failed' }
  return {
    ok: true,
    snapshot: latest,
    mergedCommits: commits,
    targetBranch,
    cleanup,
    pullRequest,
  }
}
