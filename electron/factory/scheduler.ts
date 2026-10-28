/**
 * 调度决策：并发闸门与领取顺序的唯一纯逻辑。
 *
 * 调度器自己持有闸门，不依赖引擎池的挂起/驱逐（见 ADR-0010）。一个任务
 * 在实现与审查期间始终占用同一个槽位，因此这里只按「任务」计数。
 */
import type { FactoryRunSnapshot, FactoryTask } from '@/shared/factory'

export const FACTORY_MAX_CONCURRENCY = 20

export function clampConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(FACTORY_MAX_CONCURRENCY, Math.max(1, Math.floor(value)))
}

export interface DispatchDecision {
  /** 下一个可领取的任务；没有则为 null。 */
  taskId: string | null
  /** 已在跑（含审查）的任务数。 */
  active: number
  /** 本次运行生效的并发上限。 */
  max: number
  /** 槽位已满时，仍可领取但等待槽位的任务数。 */
  waitingForSlot: number
  /** 因依赖未完成而暂不领取的任务数。 */
  blockedByDependency: number
}

function isDone(task: FactoryTask | undefined): boolean {
  return task !== undefined && task.lane === 'done' && task.cancelled !== true
}

/** 依赖是否全部完成；未完成（或任务不存在）时返回 false。 */
export function dependenciesMet(task: FactoryTask, byId: Map<string, FactoryTask>): boolean {
  for (const dependency of task.dependsOn ?? []) {
    if (!isDone(byId.get(dependency))) return false
  }
  return true
}

/**
 * 按 tasks.json 的数组顺序（即领取顺序）扫描：跳过不可领取的任务，
 * 但不跳过可领取的，避免后置任务永远排在不可领取任务之后。
 */
export function dispatchDecision(
  snapshot: FactoryRunSnapshot,
  activeTaskIds: readonly string[],
): DispatchDecision {
  const max = clampConcurrency(snapshot.run.maxConcurrency)
  const active = new Set(activeTaskIds).size
  const base = { active, max, waitingForSlot: 0, blockedByDependency: 0 }
  if (snapshot.run.status !== 'running' || snapshot.run.paused) {
    return { ...base, taskId: null }
  }

  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const candidates: string[] = []
  let blockedByDependency = 0
  for (const task of snapshot.tasks) {
    if (task.lane !== 'queued' || task.cancelled === true) continue
    if (!dependenciesMet(task, byId)) {
      blockedByDependency += 1
      continue
    }
    candidates.push(task.id)
  }

  if (active >= max) {
    return { ...base, taskId: null, waitingForSlot: candidates.length, blockedByDependency }
  }
  return {
    ...base,
    taskId: candidates[0] ?? null,
    waitingForSlot: Math.max(0, candidates.length - 1),
    blockedByDependency,
  }
}
