/**
 * 运行（`.spacecode/factory/runs/<runId>`）：从本地待办领取任务并生成看板投影。
 *
 * 本票只做「领取 + 展示」：不创建分支、不启动 Agent。任务统一落在
 * `lane=queued`、`stageIdx=0`（领取），并记录 runId 与领取时间。
 * 写入分为 run.json 与 tasks.json 两份原子文件，渲染层只读取投影。
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import {
  FACTORY_RUNS_PATH,
  FACTORY_SANDBOX_WORKTREE_ROOT,
  type FactoryLane,
  type FactoryPermissionMode,
  type FactoryReviewComment,
  type FactoryRun,
  type FactoryRunCreateInput,
  type FactoryRunCreateResult,
  type FactoryRunSnapshot,
  type FactoryRunStatus,
  type FactorySandboxConfig,
  type FactoryStageConfig,
  type FactoryStageKey,
  type FactoryTask,
  type FactoryTaskConfigSnapshot,
  type FactoryTaskWriteback,
} from '@/shared/factory'
import { readBacklog } from './backlog'
import { DEFAULT_STAGES, readFactoryConfig, STAGE_KEYS } from './config'
import { writeJsonAtomic } from './atomic'
import { buildBranchName } from './worktree'

export interface FactoryRunDeps {
  now?: () => Date
  genId?: () => string
}

const LANES: readonly FactoryLane[] = ['queued', 'implementing', 'reviewing', 'mergeable', 'blocked', 'done']
const RUN_STATUSES: readonly FactoryRunStatus[] = ['pending', 'running', 'paused', 'stopped']

export function runDir(repoRoot: string, runId: string): string {
  return join(repoRoot, FACTORY_RUNS_PATH, runId)
}

export function runFilePath(repoRoot: string, runId: string): string {
  return join(runDir(repoRoot, runId), 'run.json')
}

export function tasksFilePath(repoRoot: string, runId: string): string {
  return join(runDir(repoRoot, runId), 'tasks.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRun(raw: unknown): FactoryRun | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (!RUN_STATUSES.includes(raw.status as FactoryRunStatus)) return null
  if (typeof raw.createdAt !== 'string' || !raw.createdAt) return null
  if (typeof raw.maxConcurrency !== 'number' || !Number.isFinite(raw.maxConcurrency)) return null
  return {
    id: raw.id,
    status: raw.status as FactoryRunStatus,
    paused: raw.paused === true,
    createdAt: raw.createdAt,
    ...(typeof raw.startedAt === 'string' ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.endedAt === 'string' ? { endedAt: raw.endedAt } : {}),
    maxConcurrency: raw.maxConcurrency,
    ...(typeof raw.configRevision === 'number' && raw.configRevision > 0
      ? { configRevision: raw.configRevision }
      : {}),
    spendUsd: typeof raw.spendUsd === 'number' ? raw.spendUsd : 0,
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
  }
}

function isPermissionMode(value: unknown): value is FactoryPermissionMode {
  return value === 'default' || value === 'plan' || value === 'acceptEdits'
}

function parseStages(raw: unknown): Record<FactoryStageKey, FactoryStageConfig> {
  const source = isRecord(raw) ? raw : {}
  const stages = {} as FactoryTaskConfigSnapshot['stages']
  for (const key of STAGE_KEYS) {
    const item = isRecord(source[key]) ? source[key] : {}
    const fallback = DEFAULT_STAGES[key]
    stages[key] = {
      enabled: item.enabled !== false,
      ...(typeof item.model === 'string' && item.model.trim() ? { model: item.model.trim() } : {}),
      permissionMode: isPermissionMode(item.permissionMode) ? item.permissionMode : fallback.permissionMode,
      humanGate: item.humanGate === true || (item.humanGate === undefined && fallback.humanGate),
      ...(typeof item.maxIterations === 'number' ? { maxIterations: item.maxIterations } : {}),
    }
  }
  return stages
}

function parseSandbox(raw: unknown): FactorySandboxConfig | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.type === 'worktree') return { type: 'worktree', root: FACTORY_SANDBOX_WORKTREE_ROOT }
  if (raw.type === 'docker' && typeof raw.imageName === 'string' && raw.imageName.trim()) {
    return {
      type: 'docker',
      imageName: raw.imageName.trim(),
      worktreeRoot: FACTORY_SANDBOX_WORKTREE_ROOT,
    }
  }
  if (raw.type === 'podman' && typeof raw.imageName === 'string' && raw.imageName.trim()) {
    return {
      type: 'podman',
      imageName: raw.imageName.trim(),
      worktreeRoot: FACTORY_SANDBOX_WORKTREE_ROOT,
    }
  }
  return undefined
}

function parseConfigSnapshot(raw: unknown): FactoryTaskConfigSnapshot | undefined {
  if (!isRecord(raw)) return undefined
  const engineType = raw.engineType === 'pi' ? 'pi' : 'claude-code'
  const revision = typeof raw.revision === 'number' && raw.revision > 0 ? raw.revision : 1
  if (typeof raw.verifyCommand !== 'string' || !raw.verifyCommand.trim()) return undefined
  const sandbox = parseSandbox(raw.sandbox)
  return {
    revision,
    engineType,
    ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    maxIterations: typeof raw.maxIterations === 'number' && raw.maxIterations > 0 ? raw.maxIterations : 5,
    stages: parseStages(raw.stages),
    verifyCommand: raw.verifyCommand.trim(),
    ...(typeof raw.installCommand === 'string' && raw.installCommand.trim()
      ? { installCommand: raw.installCommand.trim() }
      : {}),
    taskTimeoutSec: typeof raw.taskTimeoutSec === 'number' && raw.taskTimeoutSec > 0 ? raw.taskTimeoutSec : 3600,
    ...(sandbox ? { sandbox } : {}),
  }
}

function parseDiff(raw: unknown): FactoryTask['diff'] {
  if (!isRecord(raw)) return { additions: 0, deletions: 0 }
  const files = Array.isArray(raw.files)
    ? raw.files
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .filter((item) => typeof item.path === 'string')
        .map((item) => ({
          path: String(item.path),
          additions: typeof item.additions === 'number' ? item.additions : 0,
          deletions: typeof item.deletions === 'number' ? item.deletions : 0,
        }))
    : undefined
  return {
    additions: typeof raw.additions === 'number' ? raw.additions : 0,
    deletions: typeof raw.deletions === 'number' ? raw.deletions : 0,
    ...(files && files.length > 0 ? { files } : {}),
  }
}

function parseTests(raw: unknown): FactoryTask['tests'] {
  if (!isRecord(raw)) return undefined
  const status = raw.status
  if (status !== 'pass' && status !== 'fail' && status !== 'timeout' && status !== 'stopped') return undefined
  if (typeof raw.command !== 'string' || typeof raw.at !== 'string') return undefined
  return {
    status,
    command: raw.command,
    at: raw.at,
    ...(typeof raw.exitCode === 'number' ? { exitCode: raw.exitCode } : {}),
    ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
  }
}

function parseReviewComment(raw: unknown, index: number): FactoryReviewComment | null {
  if (!isRecord(raw)) return null
  if (typeof raw.body !== 'string' || !raw.body.trim()) return null
  const status = raw.status
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `c${index + 1}`,
    ...(typeof raw.file === 'string' ? { file: raw.file } : {}),
    ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
    body: raw.body,
    severity: raw.severity === 'blocker' ? 'blocker' : 'suggestion',
    status:
      status === 'accepted' || status === 'ignored' || status === 'resolved' ? status : 'open',
  }
}

function parseReview(raw: unknown): FactoryTask['review'] {
  if (!isRecord(raw)) return undefined
  if (raw.verdict !== 'approved' && raw.verdict !== 'needs_changes') return undefined
  if (typeof raw.at !== 'string') return undefined
  const comments = Array.isArray(raw.comments)
    ? raw.comments
        .map((item, index) => parseReviewComment(item, index))
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : []
  return {
    verdict: raw.verdict,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    comments,
    at: raw.at,
    ...(typeof raw.raw === 'string' ? { raw: raw.raw } : {}),
  }
}

function parseWriteback(raw: unknown): FactoryTaskWriteback | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.status !== 'done' && raw.status !== 'failed') return undefined
  if (typeof raw.at !== 'string' || !raw.at) return undefined
  return {
    status: raw.status,
    at: raw.at,
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 1,
    ...(raw.commented === true ? { commented: true } : {}),
    ...(raw.closed === true ? { closed: true } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  }
}

function parsePullRequest(raw: unknown): FactoryTask['pullRequest'] {
  if (!isRecord(raw)) return undefined
  if (typeof raw.number !== 'number' || !Number.isFinite(raw.number)) return undefined
  if (typeof raw.url !== 'string' || !raw.url) return undefined
  return {
    number: raw.number,
    url: raw.url,
    ...(raw.reused === true ? { reused: true } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  }
}

function parseTask(raw: unknown): FactoryTask | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.runId !== 'string' || !raw.runId) return null
  if (!LANES.includes(raw.lane as FactoryLane)) return null
  const timestamps = isRecord(raw.timestamps) ? raw.timestamps : {}
  return {
    id: raw.id,
    runId: raw.runId,
    source: raw.source === 'github-issues' ? 'github-issues' : 'local',
    ...(typeof raw.issueNumber === 'number' ? { issueNumber: raw.issueNumber } : {}),
    title: typeof raw.title === 'string' ? raw.title : '',
    goal: typeof raw.goal === 'string' ? raw.goal : '',
    ...(Array.isArray(raw.dependsOn)
      ? {
          dependsOn: [
            ...new Set(
              raw.dependsOn.filter(
                (id): id is string =>
                  typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== raw.id,
              ),
            ),
          ],
        }
      : {}),
    lane: raw.lane as FactoryLane,
    stageIdx: typeof raw.stageIdx === 'number' ? raw.stageIdx : 0,
    branch: typeof raw.branch === 'string' ? raw.branch : '',
    worktree: typeof raw.worktree === 'string' ? raw.worktree : null,
    model: typeof raw.model === 'string' ? raw.model : '',
    ...(parseConfigSnapshot(raw.configSnapshot)
      ? { configSnapshot: parseConfigSnapshot(raw.configSnapshot) }
      : {}),
    iteration: typeof raw.iteration === 'number' ? raw.iteration : 0,
    maxIterations: typeof raw.maxIterations === 'number' ? raw.maxIterations : 0,
    diff: parseDiff(raw.diff),
    ...(Array.isArray(raw.commits)
      ? {
          commits: raw.commits
            .filter((item): item is Record<string, unknown> => isRecord(item))
            .filter((item) => typeof item.sha === 'string')
            .map((item) => ({
              sha: String(item.sha),
              message: typeof item.message === 'string' ? item.message : '',
            })),
        }
      : {}),
    ...(isRecord(raw.usage) &&
    typeof raw.usage.inputTokens === 'number' &&
    typeof raw.usage.outputTokens === 'number'
      ? {
          usage: {
            inputTokens: raw.usage.inputTokens,
            outputTokens: raw.usage.outputTokens,
            ...(typeof raw.usage.costUsd === 'number' ? { costUsd: raw.usage.costUsd } : {}),
          },
        }
      : {}),
    ...(raw.cancelled === true ? { cancelled: true } : {}),
    ...(isRecord(raw.takeover) &&
    typeof raw.takeover.at === 'string' &&
    typeof raw.takeover.sessionId === 'string' &&
    raw.takeover.sessionId
      ? { takeover: { at: raw.takeover.at, sessionId: raw.takeover.sessionId } }
      : {}),
    ...(typeof raw.mergedCommits === 'number' && Number.isFinite(raw.mergedCommits)
      ? { mergedCommits: raw.mergedCommits }
      : {}),
    ...(typeof raw.targetBranch === 'string' && raw.targetBranch ? { targetBranch: raw.targetBranch } : {}),
    ...(parseWriteback(raw.writeback) ? { writeback: parseWriteback(raw.writeback) } : {}),
    ...(parsePullRequest(raw.pullRequest) ? { pullRequest: parsePullRequest(raw.pullRequest) } : {}),
    ...(parseTests(raw.tests) ? { tests: parseTests(raw.tests) } : {}),
    ...(parseReview(raw.review) ? { review: parseReview(raw.review) } : {}),
    ...(isRecord(raw.attention) && typeof raw.attention.reason === 'string'
      ? {
          attention: {
            reason: raw.attention.reason,
            action:
              raw.attention.action === 'merge' || raw.attention.action === 'retry'
                ? raw.attention.action
                : ('fix' as const),
          },
        }
      : {}),
    timestamps: {
      ...(typeof timestamps.claimedAt === 'string' ? { claimedAt: timestamps.claimedAt } : {}),
      ...(typeof timestamps.startedAt === 'string' ? { startedAt: timestamps.startedAt } : {}),
      ...(typeof timestamps.endedAt === 'string' ? { endedAt: timestamps.endedAt } : {}),
      ...(typeof timestamps.mergedAt === 'string' ? { mergedAt: timestamps.mergedAt } : {}),
    },
  }
}

function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown
  } catch {
    return null
  }
}

function readRunFile(repoRoot: string, runId: string): FactoryRun | null {
  return parseRun(readJson(runFilePath(repoRoot, runId)))
}

function readTasks(repoRoot: string, runId: string): FactoryTask[] {
  const parsed = readJson(tasksFilePath(repoRoot, runId))
  if (!Array.isArray(parsed)) return []
  return parsed.map(parseTask).filter((task): task is FactoryTask => task !== null)
}

function withElapsed(run: FactoryRun): FactoryRun {
  if (!run.startedAt) return run
  const end = run.endedAt ? Date.parse(run.endedAt) : Date.now()
  return { ...run, elapsedMs: Math.max(0, end - Date.parse(run.startedAt)) }
}

function defaultDeps(): Required<FactoryRunDeps> {
  return {
    now: () => new Date(),
    genId: () => `run-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`,
  }
}

/** 已结束（stopped）的运行不再占用待办；pending/running/paused 都算未结束。 */
function isUnfinished(run: FactoryRun): boolean {
  return run.status !== 'stopped'
}

function listRunIds(repoRoot: string): string[] {
  const root = join(repoRoot, FACTORY_RUNS_PATH)
  if (!existsSync(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function listRuns(repoRoot: string): FactoryRun[] {
  return listRunIds(repoRoot)
    .map((runId) => readRunFile(repoRoot, runId))
    .filter((run): run is FactoryRun => run !== null)
}

export function readRunSnapshot(repoRoot: string, runId: string): FactoryRunSnapshot | null {
  const run = readRunFile(repoRoot, runId)
  if (!run) return null
  return { run: withElapsed(run), tasks: readTasks(repoRoot, runId) }
}

/** 窗口刷新后重新挂上看板：取创建时间最新的运行。 */
export function readLatestRun(repoRoot: string): FactoryRunSnapshot | null {
  const runs = listRuns(repoRoot).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )
  const latest = runs[0]
  return latest ? { run: withElapsed(latest), tasks: readTasks(repoRoot, latest.id) } : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function sanitizeDependencies(
  raw: unknown,
  taskIds: readonly string[],
): Record<string, string[]> {
  const allowed = new Set(taskIds)
  const result: Record<string, string[]> = {}
  if (!isRecord(raw)) return result
  for (const id of taskIds) {
    const value = raw[id]
    if (!Array.isArray(value)) continue
    const dependsOn = [
      ...new Set(
        value.filter(
          (dependency): dependency is string =>
            typeof dependency === 'string' && allowed.has(dependency) && dependency !== id,
        ),
      ),
    ]
    if (dependsOn.length > 0) result[id] = dependsOn
  }
  return result
}

export function createFactoryRun(
  repoRoot: string,
  input: FactoryRunCreateInput,
  deps: FactoryRunDeps = {},
): FactoryRunCreateResult {
  const taskIds = [...new Set((input.taskIds ?? []).filter((id): id is string => typeof id === 'string' && id !== ''))]
  if (taskIds.length === 0) return { ok: false, error: 'empty-tasks' }

  const backlog = readBacklog(repoRoot)
  const byId = new Map(backlog.map((item) => [item.id, item]))
  const missing = taskIds.filter((id) => !byId.has(id))
  if (missing.length > 0) return { ok: false, error: 'missing-tasks', missing }

  // 以 backlog 的 order 领取，保证看板与待办的顺序一致。
  const selected = backlog.filter((item) => taskIds.includes(item.id))

  const claimed = new Map<string, string>()
  for (const run of listRuns(repoRoot)) {
    if (!isUnfinished(run)) continue
    for (const task of readTasks(repoRoot, run.id)) claimed.set(task.id, run.id)
  }
  const duplicates = selected.filter((item) => claimed.has(item.id)).map((item) => item.id)
  if (duplicates.length > 0) return { ok: false, error: 'duplicate-tasks', duplicates }

  const config = readFactoryConfig(repoRoot)
  const resolved = { ...defaultDeps(), ...deps }
  const createdAt = resolved.now().toISOString()
  const runId = resolved.genId()
  const maxConcurrency = clamp(input.concurrency ?? config?.agent.maxConcurrency ?? 4, 1, 20)
  const maxIterations = config?.agent.maxIterations ?? 5
  const model = config?.agent.model ?? ''
  const dependencies = sanitizeDependencies(input.dependencies, taskIds)

  const run: FactoryRun = {
    id: runId,
    status: 'pending',
    paused: false,
    createdAt,
    maxConcurrency,
    ...(config ? { configRevision: config.revision } : {}),
    spendUsd: 0,
    elapsedMs: 0,
  }
  const tasks: FactoryTask[] = selected.map((item) => ({
    id: item.id,
    runId,
    source: 'local',
    title: item.title,
    goal: item.goal,
    ...(dependencies[item.id] ? { dependsOn: dependencies[item.id] } : {}),
    lane: 'queued',
    stageIdx: 0,
    branch: buildBranchName({ taskId: item.id }),
    worktree: null,
    model,
    iteration: 0,
    maxIterations,
    diff: { additions: 0, deletions: 0 },
    timestamps: { claimedAt: createdAt },
  }))

  writeJsonAtomic(runFilePath(repoRoot, runId), run)
  writeJsonAtomic(tasksFilePath(repoRoot, runId), tasks)

  return { ok: true, snapshot: { run, tasks } }
}

// ── GitHub Issues 任务源创建运行 ─────────────────────────────────

export interface FactoryGithubTaskInput {
  issueNumber: number
  title: string
  goal: string
}

export interface FactoryGithubRunInput {
  /** 领取评论需要先有运行标识，因此由调用方先生成再传入。 */
  runId: string
  tasks: FactoryGithubTaskInput[]
  concurrency?: number
  dependencies?: Record<string, string[]>
}

export interface ClaimedIssue {
  runId: string
  taskId: string
}

/** 未结束运行已领取的 GitHub issue；用于导入列表去重与重复领取拦截。 */
export function claimedGithubIssues(repoRoot: string): Map<number, ClaimedIssue> {
  const claimed = new Map<number, ClaimedIssue>()
  for (const run of listRuns(repoRoot)) {
    if (!isUnfinished(run)) continue
    for (const task of readTasks(repoRoot, run.id)) {
      if (task.source === 'github-issues' && typeof task.issueNumber === 'number') {
        claimed.set(task.issueNumber, { runId: run.id, taskId: task.id })
      }
    }
  }
  return claimed
}

export function githubTaskId(issueNumber: number): string {
  return `issue-${issueNumber}`
}

/** 只把领取成功的 issue 落成运行；失败的 issue 由调用方单独报告。 */
export function createGithubRun(
  repoRoot: string,
  input: FactoryGithubRunInput,
  deps: FactoryRunDeps = {},
): FactoryRunCreateResult {
  const runId = input.runId.trim()
  if (!runId) return { ok: false, error: 'missing-tasks' }

  const seen = new Set<number>()
  const tasks = (input.tasks ?? []).filter((item) => {
    if (!Number.isInteger(item.issueNumber) || item.issueNumber <= 0) return false
    if (seen.has(item.issueNumber)) return false
    seen.add(item.issueNumber)
    return true
  })
  if (tasks.length === 0) return { ok: false, error: 'empty-tasks' }

  const claimed = claimedGithubIssues(repoRoot)
  const duplicates = tasks.map((item) => item.issueNumber).filter((number) => claimed.has(number))
  if (duplicates.length > 0) {
    return { ok: false, error: 'duplicate-tasks', duplicates: duplicates.map(String) }
  }

  const config = readFactoryConfig(repoRoot)
  const resolved = { ...defaultDeps(), ...deps }
  const createdAt = resolved.now().toISOString()
  const maxConcurrency = clamp(input.concurrency ?? config?.agent.maxConcurrency ?? 4, 1, 20)
  const maxIterations = config?.agent.maxIterations ?? 5
  const model = config?.agent.model ?? ''
  const taskIds = tasks.map((item) => githubTaskId(item.issueNumber))
  const dependencies = sanitizeDependencies(input.dependencies, taskIds)

  const run: FactoryRun = {
    id: runId,
    status: 'pending',
    paused: false,
    createdAt,
    maxConcurrency,
    ...(config ? { configRevision: config.revision } : {}),
    spendUsd: 0,
    elapsedMs: 0,
  }

  const projections: FactoryTask[] = tasks.map((item) => {
    const taskId = githubTaskId(item.issueNumber)
    return {
      id: taskId,
      runId,
      source: 'github-issues' as const,
      issueNumber: item.issueNumber,
      title: item.title,
      goal: item.goal,
      ...(dependencies[taskId] ? { dependsOn: dependencies[taskId] } : {}),
      lane: 'queued' as const,
      stageIdx: 0,
      branch: buildBranchName({ taskId, issueNumber: item.issueNumber, title: item.title }),
      worktree: null,
      model,
      iteration: 0,
      maxIterations,
      diff: { additions: 0, deletions: 0 },
      timestamps: { claimedAt: createdAt },
    }
  })

  writeJsonAtomic(runFilePath(repoRoot, runId), run)
  writeJsonAtomic(tasksFilePath(repoRoot, runId), projections)

  return { ok: true, snapshot: { run, tasks: projections } }
}
