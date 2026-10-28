/**
 * 启动恢复与清理（spec §6.7 / §10）。
 *
 * 应用重开后只恢复「可信的磁盘状态」，绝不重放 Agent：
 * - 实现中/审查中一律降级为 blocked（reason `app.restarted`），接管标记清空；
 * - 运行从 running 转为 paused，等用户确认后再继续派发；
 * - 损坏的 run.json/tasks.json/events.jsonl 隔离到 `factory/corrupt/`，
 *   单个运行损坏不影响其他运行与应用启动；
 * - 只清理已完成且无工作树的旧运行，保留数量来自配置。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { FACTORY_RUNS_PATH, type FactoryLane } from '@/shared/factory'
import { writeJsonAtomic } from './atomic'

const LANES: readonly FactoryLane[] = ['queued', 'implementing', 'reviewing', 'mergeable', 'blocked', 'done']
const RUN_STATUSES = ['pending', 'running', 'paused', 'stopped'] as const

export interface RecoveryOptions {
  /** false 时只扫描损坏，不写任何文件（第二个只读进程）。 */
  writable?: boolean
  /** 保留的已完成运行数量；默认 20。 */
  keepDoneRuns?: number
  /** 旁路目录；默认 `<repo>/.spacecode/factory/corrupt`。 */
  sidecarDir?: string
  now?: () => Date
}

export interface RecoveryResult {
  /** 被降级处理（含任务或运行状态变更）的运行。 */
  recovered: string[]
  /** 被隔离的损坏文件（运行 id 或 `runId/events.jsonl`）。 */
  corrupt: string[]
  /** 被清理的运行 id。 */
  removed: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function stamp(now: () => Date): string {
  return now().toISOString().replace(/[:.]/g, '-')
}

function isValidRun(
  raw: unknown,
): raw is Record<string, unknown> & { id: string; createdAt: string; status: (typeof RUN_STATUSES)[number] } {
  return (
    isRecord(raw) &&
    typeof raw.id === 'string' &&
    raw.id !== '' &&
    typeof raw.createdAt === 'string' &&
    RUN_STATUSES.includes(raw.status as (typeof RUN_STATUSES)[number])
  )
}

function isValidTasks(raw: unknown): raw is Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return false
  return raw.every(
    (item) => isRecord(item) && typeof item.id === 'string' && LANES.includes(item.lane as FactoryLane),
  )
}

/** 把整个运行目录挪到旁路目录；失败时至少保留提示。 */
function quarantineRun(runsRoot: string, runId: string, sidecar: string, now: () => Date): void {
  mkdirSync(sidecar, { recursive: true })
  const source = join(runsRoot, runId)
  const target = join(sidecar, `${runId}-${stamp(now)}`)
  try {
    renameSync(source, target)
  } catch {
    try {
      rmSync(source, { recursive: true, force: true })
    } catch {
      // 无法移动也保留原目录，至少不会让后续解析崩掉。
    }
  }
}

/** 损坏的 JSONL 行被剔除，原文件复制到旁路目录供排查。 */
function repairEventLog(
  runDir: string,
  runId: string,
  sidecar: string,
  now: () => Date,
  writable: boolean,
): boolean {
  const path = join(runDir, 'events.jsonl')
  if (!existsSync(path)) return false
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return false
  }
  const valid: string[] = []
  let corrupt = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!isRecord(parseJson(line))) {
      corrupt = true
      continue
    }
    valid.push(line)
  }
  if (!corrupt) return false
  // 只读进程只报告，不改写也不复制。
  if (!writable) return true

  mkdirSync(sidecar, { recursive: true })
  try {
    copyFileSync(path, join(sidecar, `${runId}-events-${stamp(now)}.jsonl`))
  } catch {
    // 复制失败不影响剔除坏行。
  }
  writeFileSync(path, valid.length > 0 ? `${valid.join('\n')}\n` : '', 'utf-8')
  return true
}

function pruneFinished(runsRoot: string, keep: number): string[] {
  if (keep < 0) return []
  const entries: Array<{ id: string; createdAt: string; finished: boolean; hasWorktree: boolean }> = []
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'corrupt') continue
    const runDir = join(runsRoot, entry.name)
    const run = parseJson(readFileSync(join(runDir, 'run.json'), 'utf-8'))
    const tasks = parseJson(readFileSync(join(runDir, 'tasks.json'), 'utf-8'))
    if (!isValidRun(run) || !isValidTasks(tasks)) continue
    const finished =
      run.status === 'stopped' || (tasks.length > 0 && tasks.every((task) => task.lane === 'done'))
    const hasWorktree = tasks.some((task) => typeof task.worktree === 'string' && task.worktree !== '')
    entries.push({
      id: entry.name,
      createdAt: String(run.createdAt),
      finished,
      hasWorktree,
    })
  }

  const removable = entries
    .filter((item) => item.finished && !item.hasWorktree)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const removed = removable.slice(Math.max(0, keep))
  for (const item of removed) {
    try {
      rmSync(join(runsRoot, item.id), { recursive: true, force: true })
    } catch {
      // 删除失败下次再试。
    }
  }
  return removed.map((item) => item.id)
}

export function recoverRuns(repoRoot: string, options: RecoveryOptions = {}): RecoveryResult {
  const writable = options.writable !== false
  const keep = options.keepDoneRuns ?? 20
  const now = options.now ?? (() => new Date())
  const runsRoot = join(repoRoot, FACTORY_RUNS_PATH)
  const sidecar = options.sidecarDir ?? join(repoRoot, '.spacecode', 'factory', 'corrupt')

  const result: RecoveryResult = { recovered: [], corrupt: [], removed: [] }
  if (!existsSync(runsRoot)) return result

  const runIds = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'corrupt')
    .map((entry) => entry.name)

  for (const runId of runIds) {
    const runDir = join(runsRoot, runId)
    let runRaw: unknown
    let tasksRaw: unknown
    try {
      runRaw = parseJson(readFileSync(join(runDir, 'run.json'), 'utf-8'))
      tasksRaw = parseJson(readFileSync(join(runDir, 'tasks.json'), 'utf-8'))
    } catch {
      runRaw = null
      tasksRaw = null
    }

    if (!isValidRun(runRaw) || !isValidTasks(tasksRaw)) {
      result.corrupt.push(runId)
      if (writable) quarantineRun(runsRoot, runId, sidecar, now)
      continue
    }

    if (repairEventLog(runDir, runId, sidecar, now, writable)) {
      result.corrupt.push(`${runId}/events.jsonl`)
    }
    if (!writable) continue

    let changed = false
    const tasks = tasksRaw.map((task) => {
      const next = { ...task }
      if (next.takeover !== undefined) {
        delete next.takeover
        changed = true
      }
      if (next.lane === 'implementing' || next.lane === 'reviewing') {
        next.lane = 'blocked'
        next.attention = { reason: 'app.restarted', action: 'retry' }
        changed = true
      }
      return next
    })

    if (changed) {
      writeJsonAtomic(join(runDir, 'tasks.json'), tasks)
      result.recovered.push(runId)
    }

    if (runRaw.status === 'running') {
      writeJsonAtomic(join(runDir, 'run.json'), { ...runRaw, status: 'paused', paused: true })
      if (!result.recovered.includes(runId)) result.recovered.push(runId)
    }
  }

  if (writable) result.removed = pruneFinished(runsRoot, keep)
  return result
}
