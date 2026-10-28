/**
 * 合并闸门与本地合并（spec §6.6）。
 *
 * 预检只读：分支/目标/提交/diff/验证/审查/冲突/基础分支/工作树九项事实，
 * 任意致命项都存在时禁用合并。冲突检测用 `git merge-tree --write-tree`
 * （不改任何工作区），旧版 Git 回退到旧式 `merge-tree` 并明确降级。
 *
 * 执行只允许 merge commit / squash / rebase 三种方式，禁止 force；目标分支
 * 被检出时在当前仓库合并，否则在临时 detached worktree 里合并后 CAS 更新
 * 目标引用，避免动用户工作区。成功后工作树干净才移除目录与分支；脏则保留。
 * 失败统一回滚或停在可恢复位置，并把任务转阻塞。
 */
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import {
  FACTORY_MERGE_MODES,
  FACTORY_RUNS_PATH,
  type FactoryLane,
  type FactoryMergeBlocker,
  type FactoryMergeError,
  type FactoryMergeExecuteInput,
  type FactoryMergeMode,
  type FactoryMergePreflight,
  type FactoryMergePreflightResult,
  type FactoryMergeResult,
  type FactoryReview,
  type FactoryRunSnapshot,
  type FactoryTask,
  type FactoryTestRun,
} from '@/shared/factory'
import { mergeEligibility } from '@/shared/factoryReview'
import { readFactoryConfig } from './config'
import { readRunSnapshot } from './runs'
import { patchTask, transitionTask } from './runtime'
import {
  defaultGitRunner,
  isValidTaskId,
  worktreeAbsolutePath,
  type GitRunner,
} from './worktree'
import { runVerification, type VerifyInput, type VerifyResult } from './verify'
import { openEventLog, type FactoryEventInput } from './events'

const DETAIL_MAX = 500
/** 工厂自己的目录不算用户脏改动（与启动校验保持一致）。 */
const FACTORY_DIRTY_PREFIXES = ['.spacecode/']

export interface MergeWriteBackPayload {
  repoRoot: string
  runId: string
  task: FactoryTask
  mode: FactoryMergeMode
  targetBranch: string
  mergedCommits: number
  mergedAt: string
}

export interface MergeDeps {
  git?: GitRunner
  runVerify?: (input: VerifyInput) => Promise<VerifyResult>
  now?: () => Date
  emit?: (input: FactoryEventInput) => void
  /** 06 接入 GitHub 评论/关闭的可替换回写钩子。 */
  writeBack?: (payload: MergeWriteBackPayload) => void | Promise<void>
  timeoutMs?: number
}

interface ConflictProbe {
  ok: boolean
  conflicts: boolean
  files: string[]
  detail?: string
}

interface GitContext {
  git: GitRunner
  repoRoot: string
}

function trimDetail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > DETAIL_MAX ? trimmed.slice(0, DETAIL_MAX) : trimmed
}

function userDirtyLines(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .filter((line) => {
      const path = line.slice(3).trim().replace(/^"|"$/g, '')
      return !FACTORY_DIRTY_PREFIXES.some((prefix) => path.startsWith(prefix))
    })
}

function isSafeRef(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.includes('..')
}

function dedupeBlockers(blockers: FactoryMergeBlocker[]): FactoryMergeBlocker[] {
  return [...new Set(blockers)]
}

function toTestRun(result: VerifyResult): FactoryTestRun {
  return {
    status: result.status,
    command: result.command,
    at: result.at,
    ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
  }
}

/**
 * `git merge-tree --write-tree --name-only` 在冲突时退出码非零，stdout 首行是
 * 树 oid，随后是冲突文件。旧版 Git 不认 --write-tree，回退到旧式输出并按
 * 冲突标记判断；两者都不修改任何工作区。
 */
async function detectConflicts(
  ctx: GitContext,
  base: string,
  branch: string,
  mergeBase: string,
): Promise<ConflictProbe> {
  const modern = await ctx.git(['merge-tree', '--write-tree', '--name-only', base, branch], ctx.repoRoot)
  const combined = `${modern.stdout}\n${modern.stderr}`
  if (modern.ok) return { ok: true, conflicts: false, files: [] }

  if (/unknown option|usage: git merge-tree/i.test(combined)) {
    // 旧式 merge-tree 需要三个参数（merge base + 两个分支），两参必然报错。
    const legacy = await ctx.git(['merge-tree', mergeBase, base, branch], ctx.repoRoot)
    if (!legacy.ok) {
      return { ok: false, conflicts: true, files: [], detail: trimDetail(legacy.stderr) }
    }
    const legacyText = `${legacy.stdout}\n${legacy.stderr}`
    const conflicts = /^<<<<<<< /m.test(legacyText) || /CONFLICT \(/.test(legacyText)
    return { ok: true, conflicts, files: [] }
  }

  if (/CONFLICT \(/.test(combined)) {
    const files = modern.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line !== '' &&
          !/^(Auto-merging|CONFLICT|Merge conflict)/.test(line),
      )
    return { ok: true, conflicts: true, files }
  }

  return { ok: false, conflicts: false, files: [], detail: trimDetail(combined) }
}

async function computePreflight(
  repoRoot: string,
  runId: string,
  taskId: string,
  deps: MergeDeps,
): Promise<FactoryMergePreflightResult> {
  const git = deps.git ?? defaultGitRunner
  const now = deps.now ?? (() => new Date())
  const config = readFactoryConfig(repoRoot)
  if (!config) return { ok: false, error: 'config-missing' }

  const snapshot = readRunSnapshot(repoRoot, runId)
  const task = snapshot?.tasks.find((item) => item.id === taskId) ?? null
  if (!task) return { ok: false, error: 'task-not-found' }

  const targetBranch = config.repo.baseBranch
  const blockers: FactoryMergeBlocker[] = []
  const details: string[] = []
  const ctx: GitContext = { git, repoRoot }

  if (task.lane !== 'mergeable') blockers.push('not-mergeable')
  const eligibility = mergeEligibility(task)
  if (!eligibility.ok) {
    for (const reason of eligibility.reasons) {
      if (reason === 'tests-missing') blockers.push('tests-missing')
      else if (reason === 'tests-failed') blockers.push('tests-failed')
      else if (reason === 'review-missing') blockers.push('review-missing')
      else if (reason === 'review-needs-changes') blockers.push('review-needs-changes')
      else if (reason === 'open-blockers') blockers.push('open-blockers')
    }
  }

  let commits = task.commits?.length ?? 0
  let baseAdvanced = false
  let conflicts = false
  let conflictFiles: string[] = []
  let worktreeClean = false
  let workspaceClean = true

  const worktreeAbsolute = isValidTaskId(taskId) ? worktreeAbsolutePath(repoRoot, taskId) : ''
  const worktreeExists = worktreeAbsolute !== '' && existsSync(worktreeAbsolute)
  if (!worktreeExists) blockers.push('worktree-missing')

  if (worktreeExists) {
    const status = await git(['status', '--porcelain'], worktreeAbsolute)
    if (!status.ok) {
      blockers.push('git-error')
      details.push(trimDetail(status.stderr))
    } else {
      worktreeClean = status.stdout.trim() === ''
      if (!worktreeClean) blockers.push('worktree-dirty')
    }
  }

  const baseRef = isSafeRef(targetBranch)
    ? await git(['rev-parse', '--verify', `refs/heads/${targetBranch}`], repoRoot)
    : { ok: false, stdout: '', stderr: `invalid base branch: ${targetBranch}` }
  const branchRef = isSafeRef(task.branch)
    ? await git(['rev-parse', '--verify', `refs/heads/${task.branch}`], repoRoot)
    : { ok: false, stdout: '', stderr: `invalid branch: ${task.branch}` }

  if (!baseRef.ok) {
    blockers.push('base-missing')
    details.push(trimDetail(baseRef.stderr))
  } else if (!branchRef.ok) {
    blockers.push('git-error')
    details.push(trimDetail(branchRef.stderr))
  } else {
    const baseTip = baseRef.stdout.trim()
    const mergeBase = await git(['merge-base', targetBranch, task.branch], repoRoot)
    if (!mergeBase.ok) {
      blockers.push('git-error')
      details.push(trimDetail(mergeBase.stderr))
    } else {
      baseAdvanced = mergeBase.stdout.trim() !== baseTip
      if (baseAdvanced) blockers.push('base-advanced')
    }

    const count = await git(['rev-list', '--count', `${targetBranch}..${task.branch}`], repoRoot)
    if (count.ok) {
      const parsed = Number(count.stdout.trim())
      if (Number.isFinite(parsed)) commits = parsed
    }

    const probe = await detectConflicts(ctx, targetBranch, task.branch, mergeBase.stdout.trim())
    if (!probe.ok) {
      blockers.push('git-error')
      if (probe.detail) details.push(probe.detail)
    } else {
      conflicts = probe.conflicts
      conflictFiles = probe.files
      if (conflicts) blockers.push('conflict')
    }
  }

  if (commits <= 0 && !blockers.includes('git-error')) blockers.push('no-commits')

  const head = await git(['symbolic-ref', '--short', 'HEAD'], repoRoot)
  if (head.ok && head.stdout.trim() === targetBranch) {
    const status = await git(['status', '--porcelain'], repoRoot)
    if (status.ok) {
      workspaceClean = userDirtyLines(status.stdout).length === 0
      if (!workspaceClean) blockers.push('workspace-dirty')
    }
  }

  let verify: FactoryTestRun | undefined
  if (worktreeExists) {
    const runVerify = deps.runVerify ?? ((input: VerifyInput) => runVerification(input))
    try {
      const result = await runVerify({
        command: config.commands.verify,
        cwd: worktreeAbsolute,
        timeoutMs: deps.timeoutMs ?? config.limits.taskTimeoutSec * 1000,
      })
      verify = toTestRun(result)
      if (result.status !== 'pass') blockers.push('verify-failed')
    } catch (error) {
      blockers.push('verify-failed')
      details.push(trimDetail(String((error as Error)?.message ?? error)))
    }
  }

  const preflight: FactoryMergePreflight = {
    taskId,
    branch: task.branch,
    targetBranch,
    commits,
    diff: task.diff,
    ...(task.tests ? { tests: task.tests } : {}),
    ...(task.review ? { review: task.review as FactoryReview } : {}),
    worktreeClean,
    workspaceClean,
    baseAdvanced,
    conflicts,
    conflictFiles,
    ...(verify ? { verify } : {}),
    blockers: dedupeBlockers(blockers),
    ...(details.length > 0 ? { detail: dedupeDetail(details) } : {}),
    checkedAt: now().toISOString(),
  }
  return { ok: true, preflight }
}

function dedupeDetail(details: string[]): string {
  return [...new Set(details.filter(Boolean))].join('\n')
}

/** 默认把合并事件写入该运行的 events.jsonl，与 runner 的格式保持一致。 */
function defaultEmitter(repoRoot: string, runId: string, now: () => Date) {
  const path = join(repoRoot, FACTORY_RUNS_PATH, runId, 'events.jsonl')
  let sink: ReturnType<typeof openEventLog> | null = null
  return (input: FactoryEventInput): void => {
    sink ??= openEventLog(path, { runId, now })
    sink.append(input)
  }
}

export async function runMergePreflight(
  repoRoot: string,
  runId: string,
  taskId: string,
  deps: MergeDeps = {},
): Promise<FactoryMergePreflightResult> {
  return computePreflight(repoRoot, runId, taskId, deps)
}

function blockerToError(blockers: FactoryMergeBlocker[]): FactoryMergeError {
  if (blockers.includes('conflict')) return 'conflict'
  if (blockers.includes('base-advanced')) return 'base-advanced'
  if (blockers.includes('verify-failed')) return 'verify-failed'
  if (blockers.includes('workspace-dirty')) return 'workspace-dirty'
  if (blockers.includes('worktree-dirty')) return 'dirty-worktree'
  if (blockers.includes('worktree-missing')) return 'no-worktree'
  if (blockers.includes('git-error')) return 'git-error'
  return 'not-eligible'
}

function gitFailureError(text: string): FactoryMergeError {
  return /CONFLICT|Automatic merge failed/i.test(text) ? 'conflict' : 'merge-failed'
}

async function mergeBranch(
  git: GitRunner,
  cwd: string,
  worktreeAbsolute: string,
  mode: FactoryMergeMode,
  branch: string,
  targetBranch: string,
  message: string,
): Promise<{ ok: true; tip: string } | { ok: false; detail: string }> {
  if (mode === 'merge') {
    const result = await git(['merge', '--no-ff', branch, '-m', message], cwd)
    if (!result.ok) return { ok: false, detail: trimDetail(`${result.stderr}\n${result.stdout}`) }
  } else if (mode === 'squash') {
    const squash = await git(['merge', '--squash', branch], cwd)
    if (!squash.ok) return { ok: false, detail: trimDetail(`${squash.stderr}\n${squash.stdout}`) }
    const commit = await git(['commit', '-m', message], cwd)
    if (!commit.ok) return { ok: false, detail: trimDetail(`${commit.stderr}\n${commit.stdout}`) }
  } else {
    const rebase = await git(['rebase', targetBranch], worktreeAbsolute)
    if (!rebase.ok) {
      await git(['rebase', '--abort'], worktreeAbsolute)
      return { ok: false, detail: trimDetail(`${rebase.stderr}\n${rebase.stdout}`) }
    }
    const fastForward = await git(['merge', '--ff-only', branch], cwd)
    if (!fastForward.ok) {
      return { ok: false, detail: trimDetail(`${fastForward.stderr}\n${fastForward.stdout}`) }
    }
  }

  const tip = await git(['rev-parse', 'HEAD'], cwd)
  if (!tip.ok) return { ok: false, detail: trimDetail(tip.stderr) }
  return { ok: true, tip: tip.stdout.trim() }
}

async function removeTempWorktree(git: GitRunner, repoRoot: string, path: string): Promise<void> {
  await git(['worktree', 'remove', '--force', path], repoRoot)
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // 清理失败不掩盖合并结果
    }
  }
}

interface ExecuteState {
  repoRoot: string
  runId: string
  taskId: string
  deps: Required<Pick<MergeDeps, 'git'>> & MergeDeps
  now: () => Date
  emit: (input: FactoryEventInput) => void
}

async function blockTask(
  state: ExecuteState,
  error: FactoryMergeError,
  preflight: FactoryMergePreflight,
  detail?: string,
): Promise<FactoryMergeResult> {
  const { repoRoot, runId, taskId } = state
  const snapshot = readRunSnapshot(repoRoot, runId)
  const task = snapshot?.tasks.find((item) => item.id === taskId) ?? null
  if (task?.lane === 'mergeable') {
    if (error === 'verify-failed' && preflight.verify) {
      patchTask(repoRoot, runId, taskId, { tests: preflight.verify })
    }
    transitionTask(repoRoot, runId, taskId, { lane: 'blocked' as FactoryLane }, `merge.${error}`, {}, { now: state.now })

    if (error === 'conflict') {
      state.emit({
        taskId,
        stage: 'merge',
        code: 'merge.conflict',
        level: 'warn',
        params: { files: preflight.conflictFiles.join(', ') },
      })
    } else if (error === 'base-advanced') {
      state.emit({ taskId, stage: 'merge', code: 'merge.base.advanced', level: 'warn' })
    } else if (error === 'verify-failed') {
      state.emit({
        taskId,
        stage: 'merge',
        code: 'merge.verify.failed',
        level: 'error',
        params: { command: preflight.verify?.command ?? '' },
      })
    } else {
      const code =
        error === 'workspace-dirty'
          ? 'merge.workspace.dirty'
          : error === 'dirty-worktree'
            ? 'merge.worktree.dirty'
            : error === 'no-worktree'
              ? 'merge.worktree.missing'
              : error === 'git-error'
                ? 'merge.git.error'
                : error === 'not-eligible'
                  ? 'merge.not.eligible'
                  : 'merge.failed'
      state.emit({ taskId, stage: 'merge', code, level: 'error' })
    }
  }
  return {
    ok: false,
    error,
    ...(detail ? { detail } : {}),
    preflight,
  }
}

export async function executeMerge(
  repoRoot: string,
  runId: string,
  taskId: string,
  input: FactoryMergeExecuteInput,
  deps: MergeDeps = {},
): Promise<FactoryMergeResult> {
  const git = deps.git ?? defaultGitRunner
  const now = deps.now ?? (() => new Date())
  const emit = deps.emit ?? defaultEmitter(repoRoot, runId, now)
  const state: ExecuteState = { repoRoot, runId, taskId, deps: { ...deps, git }, now, emit }

  if (input?.confirmed !== true) return { ok: false, error: 'confirm-required' }
  if (!input || !FACTORY_MERGE_MODES.includes(input.mode)) return { ok: false, error: 'invalid-mode' }

  const preflightResult = await computePreflight(repoRoot, runId, taskId, deps)
  if (!preflightResult.ok) {
    return {
      ok: false,
      error: preflightResult.error === 'config-missing' ? 'config-missing' : preflightResult.error,
      ...(preflightResult.detail ? { detail: preflightResult.detail } : {}),
    }
  }
  const preflight = preflightResult.preflight

  emit({
    taskId,
    stage: 'merge',
    code: 'merge.preflight',
    level: 'info',
    params: { commits: preflight.commits, target: preflight.targetBranch },
  })

  if (preflight.blockers.length > 0) {
    return blockTask(state, blockerToError(preflight.blockers), preflight, preflight.detail)
  }

  const task = readRunSnapshot(repoRoot, runId)?.tasks.find((item) => item.id === taskId) ?? null
  if (!task) return { ok: false, error: 'task-not-found' }
  if (task.lane !== 'mergeable') return { ok: false, error: 'not-eligible', preflight }

  const worktreeAbsolute = worktreeAbsolutePath(repoRoot, taskId)
  const branchTipBefore = (await git(['rev-parse', `refs/heads/${task.branch}`], repoRoot)).stdout.trim()
  const baseTip = (await git(['rev-parse', `refs/heads/${preflight.targetBranch}`], repoRoot)).stdout.trim()
  const head = await git(['symbolic-ref', '--short', 'HEAD'], repoRoot)
  const rootOnBase = head.ok && head.stdout.trim() === preflight.targetBranch
  const message = `Merge branch '${task.branch}' into ${preflight.targetBranch}`

  emit({
    taskId,
    stage: 'merge',
    code: 'merge.started',
    level: 'info',
    params: { mode: input.mode, target: preflight.targetBranch },
  })

  if (rootOnBase) {
    const outcome = await mergeBranch(
      git,
      repoRoot,
      worktreeAbsolute,
      input.mode,
      task.branch,
      preflight.targetBranch,
      message,
    )
    if (!outcome.ok) {
      await git(['merge', '--abort'], repoRoot)
      await git(['reset', '--hard', baseTip], repoRoot)
      // rebase 会移动任务分支；失败后把它放回原处，避免用户的分支被改写。
      if (input.mode === 'rebase') await git(['reset', '--hard', branchTipBefore], worktreeAbsolute)
      return blockTask(state, gitFailureError(outcome.detail), preflight, outcome.detail)
    }
  } else {
    const tempPath = join(repoRoot, '.spacecode', 'worktrees', `merge-${taskId}`)
    await removeTempWorktree(git, repoRoot, tempPath)
    const add = await git(['worktree', 'add', '--detach', tempPath, preflight.targetBranch], repoRoot)
    if (!add.ok) {
      return blockTask(state, 'merge-failed', preflight, trimDetail(add.stderr))
    }
    const outcome = await mergeBranch(
      git,
      tempPath,
      worktreeAbsolute,
      input.mode,
      task.branch,
      preflight.targetBranch,
      message,
    )
    if (!outcome.ok) {
      await removeTempWorktree(git, repoRoot, tempPath)
      if (input.mode === 'rebase') await git(['reset', '--hard', branchTipBefore], worktreeAbsolute)
      return blockTask(state, gitFailureError(outcome.detail), preflight, outcome.detail)
    }
    const update = await git(
      ['update-ref', `refs/heads/${preflight.targetBranch}`, outcome.tip, baseTip],
      repoRoot,
    )
    await removeTempWorktree(git, repoRoot, tempPath)
    if (!update.ok) {
      if (input.mode === 'rebase') await git(['reset', '--hard', branchTipBefore], worktreeAbsolute)
      return blockTask(state, 'merge-failed', preflight, trimDetail(update.stderr))
    }
  }

  // 合并成功 → 清理；只有工作树干净才删除目录与分支。
  const worktreeStatus = await git(['status', '--porcelain'], worktreeAbsolute)
  const worktreeClean = worktreeStatus.ok && worktreeStatus.stdout.trim() === ''
  let cleanup: 'removed' | 'kept' = 'kept'
  if (worktreeClean) {
    const remove = await git(['worktree', 'remove', worktreeAbsolute], repoRoot)
    if (remove.ok) {
      const deleted = await git(['branch', '-D', task.branch], repoRoot)
      if (deleted.ok) cleanup = 'removed'
      else {
        emit({
          taskId,
          stage: 'merge',
          code: 'merge.cleanup.branchFailed',
          level: 'warn',
        })
      }
    } else {
      emit({
        taskId,
        stage: 'merge',
        code: 'merge.cleanup.worktreeFailed',
        level: 'warn',
      })
    }
  } else {
    emit({
      taskId,
      stage: 'merge',
      code: 'merge.cleanup.worktreeDirty',
      level: 'warn',
    })
  }

  const mergedAt = now().toISOString()
  const moved = transitionTask(
    repoRoot,
    runId,
    taskId,
    { lane: 'done', stageIdx: 6 },
    'task.merged',
    {
      mergedCommits: preflight.commits,
      targetBranch: preflight.targetBranch,
      timestamps: { ...task.timestamps, mergedAt },
      worktree: cleanup === 'removed' ? null : task.worktree,
    },
    { now },
  )
  if (!moved.ok) {
    emit({ taskId, stage: 'merge', code: 'merge.write.failed', level: 'error' })
    return { ok: false, error: 'write-failed' }
  }

  if (cleanup === 'removed') {
    emit({
      taskId,
      stage: 'merge',
      code: 'merge.cleaned',
      level: 'ok',
      params: { path: task.worktree ?? '', target: preflight.targetBranch },
    })
  }

  emit({
    taskId,
    stage: 'merge',
    code: 'merge.completed',
    level: 'ok',
    params: { commits: preflight.commits, target: preflight.targetBranch },
  })

  const mergedTask = moved.snapshot.tasks.find((item) => item.id === taskId) ?? task
  if (deps.writeBack) {
    try {
      await deps.writeBack({
        repoRoot,
        runId,
        task: mergedTask,
        mode: input.mode,
        targetBranch: preflight.targetBranch,
        mergedCommits: preflight.commits,
        mergedAt,
      })
    } catch (error) {
      emit({
        taskId,
        stage: 'merge',
        code: 'merge.writeback.error',
        level: 'warn',
        params: { message: trimDetail(String((error as Error)?.message ?? error)) },
      })
    }
  }

  const latest: FactoryRunSnapshot | null = readRunSnapshot(repoRoot, runId)
  if (!latest) return { ok: false, error: 'write-failed' }
  return {
    ok: true,
    snapshot: latest,
    mergedCommits: preflight.commits,
    targetBranch: preflight.targetBranch,
    cleanup,
  }
}
