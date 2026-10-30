/**
 * GitHub Issues 任务源编排（spec §8）。
 *
 * 把「凭据解析 → 列表 → 领取 → 创建运行 → 合并回写」串起来：
 * - 鉴权优先 gh，未登录/不可用时回退到主进程内存里的加密 token；
 * - 领取先写含运行标识的幂等评论，只有评论成功的 issue 才进入运行；
 * - 合并回写失败只把任务标记为待重试，绝不回滚已完成的合并。
 */
import { randomUUID } from 'crypto'
import { join } from 'path'
import {
  FACTORY_RUNS_PATH,
  type FactoryConfig,
  type FactoryGithubAuthResult,
  type FactoryGithubClaimFailure,
  type FactoryGithubClaimInput,
  type FactoryGithubClaimResult,
  type FactoryGithubFailureReason,
  type FactoryGithubListInput,
  type FactoryGithubListResult,
  type FactoryGithubWritebackRetryResult,
  type FactoryPrReadyResult,
  type FactoryTaskWriteback,
} from '@/shared/factory'
import { readFactoryConfig } from './config'
import {
  claimedGithubIssues,
  createGithubRun,
  githubTaskId,
  readRunSnapshot,
  type FactoryGithubTaskInput,
} from './runs'
import { patchTask } from './runtime'
import { openEventLog, type FactoryEventInput } from './events'
import {
  MAX_ISSUES,
  createGhApi,
  createRestApi,
  type GhRunner,
  type GithubApi,
  type GithubFetch,
} from './githubClient'
import { buildMergeComment, createGithubTracker, type GithubTracker } from './githubTracker'
import { checkGhAuth as defaultCheckGhAuth, checkGhWriteAccess, defaultGhRunner, verifyGithubToken } from './github'
import type { MergeWriteBackPayload } from './merge'
import type { FactorySecretStore } from './secrets'

export type GithubTrackerResolveResult =
  | { ok: true; tracker: GithubTracker }
  | { ok: false; reason: FactoryGithubFailureReason }

export interface GithubTrackerServiceDeps {
  secrets: FactorySecretStore
  /** gh 优先；未登录或不可用时回退 REST。 */
  checkGh?: () => Promise<FactoryGithubAuthResult>
  runGh?: GhRunner
  fetchImpl?: GithubFetch
  now?: () => Date
  genId?: () => string
  /** 测试与自定义实现用：直接给出 tracker，跳过凭据解析。 */
  resolveTracker?: (
    repoRoot: string,
    config: FactoryConfig,
    locallyClaimed: number[],
    holdsClaim: (issueNumber: number, runId: string) => boolean,
  ) => Promise<GithubTrackerResolveResult>
  /** 事件出口；默认写入 runs/<runId>/events.jsonl。 */
  emit?: (repoRoot: string, runId: string, input: FactoryEventInput) => void
}

export interface GithubTrackerService {
  listIssues(repoRoot: string, input?: FactoryGithubListInput): Promise<FactoryGithubListResult>
  claimIssues(repoRoot: string, input: FactoryGithubClaimInput): Promise<FactoryGithubClaimResult>
  /** 作为 merge 的 writeBack 钩子；失败时抛出，由 merge 记录事件且不推翻合并。 */
  writeBackMerge(payload: MergeWriteBackPayload): Promise<void>
  /** PR 模式：当前凭据能否推送任务分支并创建 PR。 */
  checkPrReady(repoRoot: string): Promise<FactoryPrReadyResult>
  retryWriteback(
    repoRoot: string,
    runId: string,
    taskId: string,
  ): Promise<FactoryGithubWritebackRetryResult>
}

interface AttemptResult {
  ok: boolean
  reason?: FactoryGithubFailureReason
  commented: boolean
  closed: boolean
}

function eventsPath(repoRoot: string, runId: string): string {
  return join(repoRoot, FACTORY_RUNS_PATH, runId, 'events.jsonl')
}

function defaultGenId(): string {
  return `run-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`
}

export function createGithubTrackerService(deps: GithubTrackerServiceDeps): GithubTrackerService {
  const now = deps.now ?? (() => new Date())
  const genId = deps.genId ?? defaultGenId

  function emitEvent(repoRoot: string, runId: string, input: FactoryEventInput): void {
    if (deps.emit) {
      deps.emit(repoRoot, runId, input)
      return
    }
    openEventLog(eventsPath(repoRoot, runId), { runId, now }).append(input)
  }

  function trackerFor(
    repoRoot: string,
    config: FactoryConfig,
    locallyClaimed: number[],
    holdsClaim: (issueNumber: number, runId: string) => boolean,
  ): Promise<GithubTrackerResolveResult> {
    if (deps.resolveTracker) return deps.resolveTracker(repoRoot, config, locallyClaimed, holdsClaim)
    return defaultResolve(repoRoot, config, locallyClaimed, holdsClaim)
  }

  async function defaultResolve(
    repoRoot: string,
    config: FactoryConfig,
    locallyClaimed: number[],
    holdsClaim: (issueNumber: number, runId: string) => boolean,
  ): Promise<GithubTrackerResolveResult> {
    if (config.tracker.type !== 'github-issues') {
      return { ok: false, reason: 'unsupported' }
    }
    const trackerConfig = config.tracker
    const ghStatus = await (deps.checkGh ?? defaultCheckGhAuth)()
    const gh = (): GithubTracker =>
      createGithubTracker({
        api: createGhApi({ repo: trackerConfig.repo, run: deps.runGh ?? defaultGhRunner }),
        label: trackerConfig.label,
        locallyClaimed,
        holdsClaim,
      })
    const rest = (token: string): GithubTracker =>
      createGithubTracker({
        api: createRestApi({
          repo: trackerConfig.repo,
          token,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        }),
        label: trackerConfig.label,
        locallyClaimed,
        holdsClaim,
      })

    if (trackerConfig.auth === 'gh') {
      if (ghStatus.ok) return { ok: true, tracker: gh() }
      const token = deps.secrets.readGithubToken()
      if (token) return { ok: true, tracker: rest(token) }
      return { ok: false, reason: 'not-logged-in' }
    }

    const token = deps.secrets.readGithubToken()
    if (token) return { ok: true, tracker: rest(token) }
    if (ghStatus.ok) return { ok: true, tracker: gh() }
    return { ok: false, reason: 'invalid-token' }
  }

  /** token 路径的写权限来自仓库 permissions.push；gh 路径直接问 API。 */
  async function tokenReady(token: string, repo: string): Promise<FactoryPrReadyResult> {
    const result = await verifyGithubToken(token, repo)
    if (!result.ok) {
      if (result.reason === 'gh-not-logged-in') return { ok: false, reason: 'not-logged-in' }
      return { ok: false, reason: result.reason === 'ok' ? 'unknown' : result.reason }
    }
    return result.canPush === true ? { ok: true } : { ok: false, reason: 'repo-permission' }
  }

  async function checkPrReady(repoRoot: string): Promise<FactoryPrReadyResult> {
    const config = readFactoryConfig(repoRoot)
    if (!config || config.tracker.type !== 'github-issues') {
      return { ok: false, reason: 'unsupported' }
    }
    const trackerConfig = config.tracker
    const ghStatus = await (deps.checkGh ?? defaultCheckGhAuth)()
    const ghCheck = (): Promise<FactoryPrReadyResult> =>
      checkGhWriteAccess(trackerConfig.repo, deps.runGh ?? defaultGhRunner)

    if (trackerConfig.auth === 'gh') {
      if (ghStatus.ok) return ghCheck()
      const token = deps.secrets.readGithubToken()
      if (token) return tokenReady(token, trackerConfig.repo)
      return { ok: false, reason: 'not-logged-in' }
    }

    const token = deps.secrets.readGithubToken()
    if (token) return tokenReady(token, trackerConfig.repo)
    if (ghStatus.ok) return ghCheck()
    return { ok: false, reason: 'invalid-token' }
  }

  async function listIssues(
    repoRoot: string,
    input: FactoryGithubListInput = {},
  ): Promise<FactoryGithubListResult> {
    const config = readFactoryConfig(repoRoot)
    if (!config || config.tracker.type !== 'github-issues') {
      return { ok: false, reason: 'unsupported' }
    }
    const claimed = claimedGithubIssues(repoRoot)
    const resolved = await trackerFor(
      repoRoot,
      config,
      [...claimed.keys()],
      (issueNumber, runId) => claimed.get(issueNumber)?.runId === runId,
    )
    if (!resolved.ok) return { ok: false, reason: resolved.reason }

    return resolved.tracker.list({
      label: input.label ?? config.tracker.label,
      limit: input.limit ?? 20,
    })
  }

  async function claimIssues(
    repoRoot: string,
    input: FactoryGithubClaimInput,
  ): Promise<FactoryGithubClaimResult> {
    const config = readFactoryConfig(repoRoot)
    if (!config || config.tracker.type !== 'github-issues') {
      return { ok: false, reason: 'config-missing' }
    }

    const numbers = [
      ...new Set((input.issueNumbers ?? []).filter((number) => Number.isInteger(number) && number > 0)),
    ]
    if (numbers.length === 0) return { ok: false, reason: 'no-selection' }

    const localClaimed = claimedGithubIssues(repoRoot)
    const duplicates = numbers.filter((number) => localClaimed.has(number))
    if (duplicates.length > 0) {
      return {
        ok: false,
        reason: 'duplicate-issues',
        failed: duplicates.map((number) => ({ number, reason: 'already-claimed' })),
      }
    }

    const resolved = await trackerFor(
      repoRoot,
      config,
      [...localClaimed.keys()],
      (issueNumber, runId) => localClaimed.get(issueNumber)?.runId === runId,
    )
    if (!resolved.ok) return { ok: false, reason: resolved.reason }

    const listed = await resolved.tracker.list({ label: config.tracker.label, limit: MAX_ISSUES })
    if (!listed.ok) {
      return { ok: false, reason: listed.reason, ...(listed.detail ? { detail: listed.detail } : {}) }
    }
    const byNumber = new Map(listed.issues.map((item) => [item.number, item]))

    const runId = genId()
    const claimed: number[] = []
    const failed: FactoryGithubClaimFailure[] = []
    const tasks: FactoryGithubTaskInput[] = []

    for (const number of numbers) {
      const issue = byNumber.get(number)
      if (!issue) {
        failed.push({ number, reason: 'unknown' })
        continue
      }
      if (issue.claimed) {
        failed.push({ number, reason: 'already-claimed' })
        continue
      }
      const outcome = await resolved.tracker.claim({
        issueNumber: number,
        runId,
        taskId: githubTaskId(number),
      })
      if (!outcome.ok) {
        failed.push({ number, reason: outcome.reason })
        continue
      }
      claimed.push(number)
      tasks.push({ issueNumber: number, title: issue.title, goal: issue.body })
    }

    if (claimed.length === 0) {
      return { ok: false, reason: 'all-failed', failed }
    }

    const created = createGithubRun(
      repoRoot,
      {
        runId,
        tasks,
        ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
        ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
      },
      { now },
    )
    if (!created.ok) {
      if (created.error === 'duplicate-tasks') {
        return {
          ok: false,
          reason: 'duplicate-issues',
          failed: (created.duplicates ?? []).map((number) => ({
            number: Number(number),
            reason: 'already-claimed',
          })),
        }
      }
      return { ok: false, reason: 'all-failed', failed, detail: created.error }
    }

    emitEvent(repoRoot, runId, {
      taskId: null,
      code: 'github.imported',
      level: 'ok',
      params: { count: claimed.length },
    })
    for (const number of claimed) {
      emitEvent(repoRoot, runId, {
        taskId: githubTaskId(number),
        code: 'github.claimed',
        level: 'info',
        params: { number },
      })
    }
    for (const failure of failed) {
      emitEvent(repoRoot, runId, {
        taskId: githubTaskId(failure.number),
        code: 'github.claim.failed',
        level: 'warn',
        params: { number: failure.number, reason: failure.reason },
      })
    }

    return { ok: true, snapshot: created.snapshot, claimed, failed }
  }

  function markWriteback(
    repoRoot: string,
    runId: string,
    taskId: string,
    writeback: FactoryTaskWriteback,
  ): void {
    patchTask(repoRoot, runId, taskId, { writeback })
  }

  async function attemptWriteBack(payload: MergeWriteBackPayload): Promise<AttemptResult> {
    const task = payload.task
    if (task.source !== 'github-issues' || typeof task.issueNumber !== 'number') {
      return { ok: true, commented: false, closed: false }
    }

    const number = task.issueNumber
    const attempts = (task.writeback?.attempts ?? 0) + 1
    const at = now().toISOString()
    const alreadyCommented = task.writeback?.commented === true
    const alreadyClosed = task.writeback?.closed === true
    const fail = (reason: FactoryGithubFailureReason): AttemptResult => {
      markWriteback(payload.repoRoot, payload.runId, task.id, {
        status: 'failed',
        at,
        attempts,
        ...(alreadyCommented ? { commented: true } : {}),
        ...(alreadyClosed ? { closed: true } : {}),
        error: reason,
      })
      emitEvent(payload.repoRoot, payload.runId, {
        taskId: task.id,
        code: 'github.writeback.failed',
        level: 'warn',
        params: { number, reason },
      })
      return { ok: false, reason, commented: alreadyCommented, closed: alreadyClosed }
    }

    const config = readFactoryConfig(payload.repoRoot)
    if (!config || config.tracker.type !== 'github-issues') {
      return fail('unsupported')
    }

    const comment = config.tracker.commentIssue && !alreadyCommented
    const close = config.tracker.closeIssue && !alreadyClosed
    if (!comment && !close) {
      markWriteback(payload.repoRoot, payload.runId, task.id, {
        status: 'done',
        at,
        attempts,
        ...(alreadyCommented ? { commented: true } : {}),
        ...(alreadyClosed ? { closed: true } : {}),
      })
      emitEvent(payload.repoRoot, payload.runId, {
        taskId: task.id,
        code: 'github.writeback.done',
        level: 'ok',
        params: { number },
      })
      return { ok: true, commented: alreadyCommented, closed: alreadyClosed }
    }

    const resolved = await trackerFor(payload.repoRoot, config, [], () => false)
    if (!resolved.ok) return fail(resolved.reason)

    const body = buildMergeComment({
      branch: task.branch,
      targetBranch: payload.targetBranch,
      mergedCommits: payload.mergedCommits,
      mergedAt: payload.mergedAt,
      mode: payload.mode,
      ...(task.tests ? { tests: task.tests } : {}),
      ...(task.review ? { review: task.review } : {}),
    })
    const outcome = await resolved.tracker.writeBack({
      issueNumber: number,
      body,
      comment,
      close,
    })

    const commented = alreadyCommented || outcome.commented
    const closed = alreadyClosed || outcome.closed
    if (!outcome.ok) {
      const reason = outcome.reason ?? 'unknown'
      markWriteback(payload.repoRoot, payload.runId, task.id, {
        status: 'failed',
        at,
        attempts,
        ...(commented ? { commented: true } : {}),
        ...(closed ? { closed: true } : {}),
        error: reason,
      })
      emitEvent(payload.repoRoot, payload.runId, {
        taskId: task.id,
        code: 'github.writeback.failed',
        level: 'warn',
        params: { number, reason },
      })
      return { ok: false, reason, commented, closed }
    }

    markWriteback(payload.repoRoot, payload.runId, task.id, {
      status: 'done',
      at,
      attempts,
      ...(commented ? { commented: true } : {}),
      ...(closed ? { closed: true } : {}),
    })
    emitEvent(payload.repoRoot, payload.runId, {
      taskId: task.id,
      code: 'github.writeback.done',
      level: 'ok',
      params: { number },
    })
    return { ok: true, commented, closed }
  }

  async function retryWriteback(
    repoRoot: string,
    runId: string,
    taskId: string,
  ): Promise<FactoryGithubWritebackRetryResult> {
    const snapshot = readRunSnapshot(repoRoot, runId)
    const task = snapshot?.tasks.find((item) => item.id === taskId) ?? null
    if (!task) return { ok: false, reason: 'task-not-found' }
    if (task.source !== 'github-issues' || typeof task.issueNumber !== 'number') {
      return { ok: false, reason: 'not-github' }
    }
    if (task.lane !== 'done' || !task.timestamps.mergedAt) {
      return { ok: false, reason: 'not-merged' }
    }
    if (task.writeback?.status !== 'failed') {
      return { ok: false, reason: 'not-applicable' }
    }

    const config = readFactoryConfig(repoRoot)
    if (!config || config.tracker.type !== 'github-issues') {
      return { ok: false, reason: 'config-missing' }
    }

    const result = await attemptWriteBack({
      repoRoot,
      runId,
      task,
      mode: 'merge',
      targetBranch: task.targetBranch ?? config.repo.baseBranch,
      mergedCommits: task.mergedCommits ?? task.commits?.length ?? 0,
      mergedAt: task.timestamps.mergedAt,
    })
    if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' }

    const latest = readRunSnapshot(repoRoot, runId)
    return latest ? { ok: true, snapshot: latest } : { ok: false, reason: 'task-not-found' }
  }

  return {
    listIssues,
    claimIssues,
    checkPrReady,
    async writeBackMerge(payload) {
      const result = await attemptWriteBack(payload)
      if (!result.ok) throw new Error(result.reason ?? 'unknown')
    },
    retryWriteback,
  }
}
