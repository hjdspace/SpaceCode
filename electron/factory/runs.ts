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
  type FactoryLane,
  type FactoryRun,
  type FactoryRunCreateInput,
  type FactoryRunCreateResult,
  type FactoryRunSnapshot,
  type FactoryRunStatus,
  type FactoryTask,
} from '@/shared/factory'
import { readBacklog } from './backlog'
import { readFactoryConfig } from './config'
import { writeJsonAtomic } from './atomic'

export interface FactoryRunDeps {
  now?: () => Date
  genId?: () => string
}

const LANES: readonly FactoryLane[] = ['queued', 'implementing', 'reviewing', 'mergeable', 'blocked', 'done']
const RUN_STATUSES: readonly FactoryRunStatus[] = ['pending', 'running', 'paused', 'stopped']

export function runDir(repoRoot: string, runId: string): string {
  return join(repoRoot, FACTORY_RUNS_PATH, runId)
}

function runFilePath(repoRoot: string, runId: string): string {
  return join(runDir(repoRoot, runId), 'run.json')
}

function tasksFilePath(repoRoot: string, runId: string): string {
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
    spendUsd: typeof raw.spendUsd === 'number' ? raw.spendUsd : 0,
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
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
    lane: raw.lane as FactoryLane,
    stageIdx: typeof raw.stageIdx === 'number' ? raw.stageIdx : 0,
    branch: typeof raw.branch === 'string' ? raw.branch : '',
    worktree: typeof raw.worktree === 'string' ? raw.worktree : null,
    model: typeof raw.model === 'string' ? raw.model : '',
    iteration: typeof raw.iteration === 'number' ? raw.iteration : 0,
    maxIterations: typeof raw.maxIterations === 'number' ? raw.maxIterations : 0,
    diff: isRecord(raw.diff)
      ? {
          additions: typeof raw.diff.additions === 'number' ? raw.diff.additions : 0,
          deletions: typeof raw.diff.deletions === 'number' ? raw.diff.deletions : 0,
        }
      : { additions: 0, deletions: 0 },
    ...(raw.cancelled === true ? { cancelled: true } : {}),
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

  const run: FactoryRun = {
    id: runId,
    status: 'pending',
    paused: false,
    createdAt,
    maxConcurrency,
    spendUsd: 0,
    elapsedMs: 0,
  }
  const tasks: FactoryTask[] = selected.map((item) => ({
    id: item.id,
    runId,
    source: 'local',
    title: item.title,
    goal: item.goal,
    lane: 'queued',
    stageIdx: 0,
    branch: `agent/task-${item.id}`,
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
