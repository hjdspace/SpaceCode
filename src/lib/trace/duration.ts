/**
 * Trace 事件耗时的唯一读法 —— 两个读取方（主进程 traceIpc、渲染进程 traceViewModel）共用，
 * 免得再各自认一个键名。
 *
 * 同一个 trace JSONL 里历史上有两套键：renderer 的 `assistant_turn` 写 `metadata.duration`，
 * electron 的 `result` 写 `metadata.durationMs`，两者都是毫秒。写入侧已统一成
 * `TRACE_DURATION_KEY`，这里的 `duration` 回落专供磁盘上的历史文件。
 *
 * 另一个坑：耗时事件都在回合结束时才发出，`timestamp` 是**结束**时刻而不是开始时刻，
 * 所以窗口取 `[timestamp - durationMs, timestamp]`。用 `timestamp + durationMs` 造结束时间
 * 会指向未来。
 */

/** 写入 trace 事件 metadata 时用的规范键名。 */
export const TRACE_DURATION_KEY = 'durationMs'
const LEGACY_DURATION_KEY = 'duration'

/** 只用到 timestamp 与 metadata 的最小事件形状，AgentTraceEvent 结构上即可满足。 */
export type TraceDurationEvent = {
  timestamp?: string
  metadata?: Record<string, unknown>
}

export type TraceTimeRange = {
  startedAt?: string
  completedAt?: string
}

export function readTraceEventDurationMs(metadata?: Record<string, unknown>): number | undefined {
  for (const key of [TRACE_DURATION_KEY, LEGACY_DURATION_KEY]) {
    const value = metadata?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

/**
 * 事件真实起止：时间戳按结束时刻解读，开始时间用耗时反推。
 * 时间戳读不出有效时刻时返回空对象，和 `unionTraceDurationMs` 一样跳过它，不猜当前时间。
 */
export function traceEventTimeRange(
  timestamp: string | undefined,
  durationMs: number | undefined,
): TraceTimeRange {
  const end = timestamp ? new Date(timestamp).getTime() : NaN
  if (!Number.isFinite(end)) return {}
  if (durationMs === undefined) return { startedAt: timestamp }
  return { startedAt: new Date(end - durationMs).toISOString(), completedAt: timestamp }
}

/**
 * 会话执行总时长 = 所有带耗时事件的 `[结束 - 耗时, 结束]` 窗口并集长度。
 *
 * 直接相加会把同一段工作算两遍（一个回合既写 assistant_turn 又写 result，两者的窗口重叠），
 * 只取 turn 一族又会丢掉失败/中断的回合 —— 那些回合在旧版本里根本没写 metadata，
 * 只有 engine 的 result 留下时长。并集两头都对上：重叠自动合并，不重叠的都算。
 */
/**
 * 时间窗并集长度。供 `unionTraceDurationMs` 与主进程 summary 侧车共用：
 * 侧车按事件增量记录窗口，读取时用同一算法算总时长，保证与全量聚合口径一致。
 * 不修改传入数组（调用方可能持有持久化的窗口列表）。
 */
export function unionWindows(windows: Array<[number, number]>): number {
  if (windows.length === 0) return 0

  const sorted = [...windows].sort((a, b) => a[0] - b[0])
  let total = 0
  let [openStart, openEnd] = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i]
    if (start <= openEnd) openEnd = Math.max(openEnd, end)
    else { total += openEnd - openStart; openStart = start; openEnd = end }
  }
  return total + (openEnd - openStart)
}

export function unionTraceDurationMs(events: TraceDurationEvent[]): number {
  const windows: Array<[number, number]> = []
  for (const event of events) {
    const durationMs = readTraceEventDurationMs(event.metadata)
    const end = event.timestamp ? new Date(event.timestamp).getTime() : NaN
    if (durationMs === undefined || !Number.isFinite(end)) continue
    windows.push([end - durationMs, end])
  }
  return unionWindows(windows)
}
