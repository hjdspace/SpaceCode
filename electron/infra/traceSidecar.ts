/**
 * Trace summary 侧车 —— 让 trace:list 彻底不碰事件文件。
 *
 * 写侧：logger.traceEvent 每落一条事件，就把该事件的增量贡献累进内存态
 * （`recordTraceEvent`），并防抖持久化到 `session-<sid>.summary.json`。
 * 读侧：traceIpc 用 (size, mtime) 校验内存态是否与 jsonl 一致，命中则零读取零解析。
 *
 * 磁盘侧车只服务跨重启的冷启动：内存态才是运行时真相源，所以侧车文件损坏、
 * 版本不识别、(size, mtime) 对不上统统可以安全忽略 —— 回退全量解析重建即可。
 *
 * `initTraceSidecar` 未调用（单测环境）时完全不读写磁盘，`adoptSidecarFromDisk`
 * 恒为 null，读路径退化为「每次全量解析回填」，与 PR-2 缓存时代价相同。
 */
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import {
  accumulateEvent,
  emptyAggregate,
  finalizeSummary,
  type AgentTraceEventForTrace,
  type TraceAggregate,
  type TraceSummary,
} from './traceAggregate'

const SIDECAR_VERSION = 1
const FLUSH_DEBOUNCE_MS = 1500

/** 侧车内存态：聚合态 + 校验信息（对应哪一版 jsonl）。 */
type SidecarState = TraceAggregate & {
  version: number
  srcSize: number
  srcModifiedAt: number
}

/** 磁盘形态：modelCounts 是 Map，JSON 序列化会丢 —— 落盘前换算成 models 数组。 */
type PersistedSidecar = Omit<SidecarState, 'modelCounts'>

let sidecarDir: string | null = null
const states = new Map<string, SidecarState>()
const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** 由 initLogger 调用；传入后侧车才具备持久化能力。传 null 显式去初始化（单测隔离用）。 */
export function initTraceSidecar(dir: string | null): void {
  sidecarDir = dir
}

/** 单测隔离用：清空内存态与脏标记（不影响磁盘）。 */
export function resetTraceSidecar(): void {
  states.clear()
  dirty.clear()
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
}

function sidecarPath(safeSessionId: string): string {
  return join(sidecarDir!, `session-${safeSessionId}.summary.json`)
}

function toSidecarFile(state: SidecarState): PersistedSidecar {
  const { modelCounts: _counts, ...rest } = state
  return {
    ...rest,
    models: Array.from(state.modelCounts.entries()).map(([model, calls]) => ({ model, calls })),
  }
}

/**
 * 写侧入口：logger.traceEvent 在成功追加 jsonl 之后调用。
 * `stat` 必须是追加后的 jsonl stat —— 它就是下次 getSummary 的校验凭据。
 *
 * 外部改写检测：jsonl 只应被追加；stat.size 回退（被截断/替换）说明内存态已失真，重建。
 */
export function recordTraceEvent(
  safeSessionId: string,
  event: AgentTraceEventForTrace,
  stat: { size: number; modifiedAt: number },
): void {
  let state = states.get(safeSessionId)
  if (!state || stat.size < state.srcSize) {
    state = { ...emptyAggregate(), version: SIDECAR_VERSION, srcSize: 0, srcModifiedAt: 0 }
    states.set(safeSessionId, state)
  }
  accumulateEvent(state, event)
  state.srcSize = stat.size
  state.srcModifiedAt = stat.modifiedAt
  markDirty(safeSessionId)
}

/** 读侧首选：内存态存在且 (size, mtime) 与 jsonl 完全一致 → 零成本返回。 */
export function getSidecarSummary(
  safeSessionId: string,
  stat: { size: number; modifiedAt: number },
): TraceSummary | null {
  const state = states.get(safeSessionId)
  if (state && state.srcSize === stat.size && state.srcModifiedAt === stat.modifiedAt) {
    return finalizeSummary(state)
  }
  return null
}

/** 读侧次选：跨重启冷启动，从磁盘加载侧车并校验 (size, mtime)。任何不一致都返回 null。 */
export function adoptSidecarFromDisk(
  safeSessionId: string,
  stat: { size: number; modifiedAt: number },
): TraceSummary | null {
  if (!sidecarDir) return null
  try {
    const path = sidecarPath(safeSessionId)
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, 'utf8')) as PersistedSidecar
    if (data?.version !== SIDECAR_VERSION) return null
    if (data.srcSize !== stat.size || data.srcModifiedAt !== stat.modifiedAt) return null
    if (typeof data.apiCalls !== 'number' || !Array.isArray(data.windows)) return null
    const state: SidecarState = {
      ...data,
      modelCounts: new Map((data.models || []).map(m => [m.model, m.calls])),
    }
    states.set(safeSessionId, state)
    return finalizeSummary(state)
  } catch {
    return null
  }
}

/** 读侧兜底：全量解析（worker）之后重建侧车态并持久化，下次零解析。 */
export function backfillSidecar(
  safeSessionId: string,
  stat: { size: number; modifiedAt: number },
  events: AgentTraceEventForTrace[],
): TraceSummary {
  const state = { ...emptyAggregate(), version: SIDECAR_VERSION, srcSize: stat.size, srcModifiedAt: stat.modifiedAt }
  for (const e of events) accumulateEvent(state, e)
  states.set(safeSessionId, state)
  markDirty(safeSessionId)
  return finalizeSummary(state)
}

function markDirty(safeSessionId: string): void {
  if (!sidecarDir) return
  dirty.add(safeSessionId)
  if (flushTimer) return
  flushTimer = setTimeout(flushTraceSidecars, FLUSH_DEBOUNCE_MS)
  flushTimer.unref?.()
}

/** 把脏侧车落盘。防抖定时器与退出前调用共用；无脏数据时空操作。 */
export function flushTraceSidecars(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!sidecarDir || dirty.size === 0) return
  try {
    if (!existsSync(sidecarDir)) mkdirSync(sidecarDir, { recursive: true })
    for (const sid of dirty) {
      const state = states.get(sid)
      if (!state) continue
      try {
        writeFileSync(sidecarPath(sid), JSON.stringify(toSidecarFile(state)), { mode: 0o600 })
      } catch {}
    }
  } catch {}
  dirty.clear()
}
