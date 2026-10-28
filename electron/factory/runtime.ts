/**
 * 任务与运行状态迁移的唯一写入点（spec §4.5）。
 *
 * 任何阶段都只能通过这里改 `lane`；非法迁移直接拒绝且不落盘。任务补丁
 * （iteration/diff/commits/usage）也走同一份 tasks.json 原子写，避免多处
 * 读改写互相覆盖。
 */
import type {
  FactoryLane,
  FactoryRun,
  FactoryRunSnapshot,
  FactoryRunStatus,
  FactoryTask,
} from '@/shared/factory'
import { readRunSnapshot, runFilePath, tasksFilePath } from './runs'
import { writeJsonAtomic } from './atomic'

const STAGE_INDEX: Record<FactoryLane, number> = {
  queued: 0,
  implementing: 1,
  reviewing: 4,
  mergeable: 5,
  blocked: 0,
  done: 6,
}

const ALLOWED: Record<FactoryLane, FactoryLane[]> = {
  queued: ['implementing'],
  implementing: ['implementing', 'blocked', 'reviewing', 'done'],
  reviewing: ['reviewing', 'blocked', 'mergeable', 'implementing', 'done'],
  mergeable: ['mergeable', 'blocked', 'done'],
  blocked: ['implementing', 'queued', 'done'],
  done: [],
}

export interface RuntimeDeps {
  now?: () => Date
}

export function stageIndexFor(lane: FactoryLane): number {
  return STAGE_INDEX[lane]
}

export function canTransition(from: FactoryLane, to: FactoryLane): boolean {
  return ALLOWED[from].includes(to)
}

function attentionAction(reason: string): 'fix' | 'merge' | 'retry' {
  if (reason.startsWith('merge')) return 'merge'
  if (
    reason === 'stopped' ||
    reason === 'app.restarted' ||
    reason === 'iteration.limit' ||
    reason === 'tests.failed' ||
    reason === 'tests.timeout'
  ) {
    return 'retry'
  }
  return 'fix'
}

export interface TransitionTarget {
  lane: FactoryLane
  stageIdx?: number
}

export type TaskPatch = Partial<
  Pick<
    FactoryTask,
    | 'branch'
    | 'worktree'
    | 'model'
    | 'iteration'
    | 'maxIterations'
    | 'diff'
    | 'commits'
    | 'usage'
    | 'tests'
    | 'review'
    | 'cancelled'
    | 'mergedCommits'
    | 'targetBranch'
    | 'timestamps'
  >
>

export type TransitionResult =
  | { ok: true; snapshot: FactoryRunSnapshot }
  | { ok: false; error: 'task-not-found' | 'invalid-transition' }

export function transitionTask(
  repoRoot: string,
  runId: string,
  taskId: string,
  to: TransitionTarget,
  reason: string,
  patch: TaskPatch = {},
  deps: RuntimeDeps = {},
): TransitionResult {
  const snapshot = readRunSnapshot(repoRoot, runId)
  if (!snapshot) return { ok: false, error: 'task-not-found' }

  const index = snapshot.tasks.findIndex((task) => task.id === taskId)
  if (index < 0) return { ok: false, error: 'task-not-found' }
  const current = snapshot.tasks[index]
  if (!canTransition(current.lane, to.lane)) return { ok: false, error: 'invalid-transition' }

  const at = (deps.now ?? (() => new Date()))().toISOString()
  const next: FactoryTask = {
    ...current,
    ...patch,
    lane: to.lane,
    stageIdx: to.lane === 'blocked' ? current.stageIdx : (to.stageIdx ?? stageIndexFor(to.lane)),
  }

  const timestamps = { ...(patch.timestamps ?? current.timestamps) }
  if (to.lane === 'implementing' && !timestamps.startedAt) timestamps.startedAt = at
  if (to.lane === 'done' && !timestamps.endedAt) timestamps.endedAt = at
  next.timestamps = timestamps

  if (to.lane === 'blocked') {
    next.attention = { reason, action: attentionAction(reason) }
  } else {
    delete next.attention
  }

  const tasks = [...snapshot.tasks]
  tasks[index] = next
  writeJsonAtomic(tasksFilePath(repoRoot, runId), tasks)
  return { ok: true, snapshot: { run: snapshot.run, tasks } }
}

export type PatchResult = { ok: true; snapshot: FactoryRunSnapshot } | { ok: false; error: 'task-not-found' }

/** 只更新投影字段（不迁移 lane）；用于每轮迭代后的 diff/commits/usage 写回。 */
export function patchTask(
  repoRoot: string,
  runId: string,
  taskId: string,
  patch: TaskPatch,
  _deps: RuntimeDeps = {},
): PatchResult {
  const snapshot = readRunSnapshot(repoRoot, runId)
  if (!snapshot) return { ok: false, error: 'task-not-found' }
  const index = snapshot.tasks.findIndex((task) => task.id === taskId)
  if (index < 0) return { ok: false, error: 'task-not-found' }

  const tasks = [...snapshot.tasks]
  tasks[index] = { ...tasks[index], ...patch }
  writeJsonAtomic(tasksFilePath(repoRoot, runId), tasks)
  return { ok: true, snapshot: { run: snapshot.run, tasks } }
}

export type RunPatch = Partial<Pick<FactoryRun, 'status' | 'paused' | 'startedAt' | 'endedAt' | 'spendUsd' | 'maxConcurrency'>>

/** 写运行状态；elapsedMs 由 startedAt/endedAt/当前时间派生，页面不自己算。 */
export function updateRun(
  repoRoot: string,
  runId: string,
  patch: RunPatch,
  deps: RuntimeDeps = {},
): FactoryRun | null {
  const snapshot = readRunSnapshot(repoRoot, runId)
  if (!snapshot) return null

  const run: FactoryRun = { ...snapshot.run, ...patch }
  if (run.startedAt) {
    const end = run.endedAt ? Date.parse(run.endedAt) : (deps.now ?? (() => new Date()))().getTime()
    run.elapsedMs = Math.max(0, end - Date.parse(run.startedAt))
  }
  const status: FactoryRunStatus = run.status
  run.status = status

  writeJsonAtomic(runFilePath(repoRoot, runId), run)
  return run
}
