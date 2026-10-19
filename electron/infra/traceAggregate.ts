/**
 * Trace 事件聚合 —— traceIpc（list/detail）与 summary 侧车共用的唯一实现。
 *
 * 之前 `buildTraceSummary` 只在 traceIpc 里全量重算；侧车需要按事件**增量**维护同一批
 * 指标，两边各写一套必然漂移。这里把「单事件贡献」抽成 `accumulateEvent`：
 *  - 全量口径 = fold accumulateEvent over events（`summarizeEvents`）
 *  - 侧车口径 = 落盘时逐事件 accumulateEvent
 * 两者对同一批事件必然得到相同结果，list 与 detail 的 summary 永远同源。
 */
import { readTraceEventDurationMs, unionWindows } from '@/lib/trace/duration'

export type AgentTraceEventForTrace = {
  id?: string
  sessionId: string
  timestamp?: string
  source?: string
  actor?: string
  type: string
  status?: string
  title?: string
  input?: unknown
  output?: unknown
  error?: { message: string; stack?: string }
  metadata?: Record<string, unknown>
}

export type TraceSummary = {
  apiCalls: number
  failedCalls: number
  totalDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  models: Array<{ model: string; calls: number }>
  updatedAt: string | null
}

/** 聚合中间态：windows 是耗时窗口 [startMs, endMs]，读取时做并集（侧车持久化它）。 */
export type TraceAggregate = TraceSummary & {
  eventCount: number
  windows: Array<[number, number]>
  modelCounts: Map<string, number>
}

export function isLlmCallEvent(e: AgentTraceEventForTrace): boolean {
  return e.actor === 'assistant' || e.type === 'assistant_text' || e.type === 'assistant_turn' || e.type === 'assistant_reasoning'
}

export function isToolCallEvent(e: AgentTraceEventForTrace): boolean {
  return e.actor === 'tool' || e.type === 'tool_call'
}

export function emptyAggregate(): TraceAggregate {
  return {
    eventCount: 0,
    apiCalls: 0,
    failedCalls: 0,
    totalDurationMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    models: [],
    updatedAt: null,
    windows: [],
    modelCounts: new Map(),
  }
}

/** 单事件增量贡献。事件按落盘顺序喂入；无耗时/无时间戳的事件安全跳过窗口。 */
export function accumulateEvent(agg: TraceAggregate, e: AgentTraceEventForTrace): void {
  agg.eventCount++
  if (isLlmCallEvent(e)) {
    agg.apiCalls++
    if (e.status === 'failed') agg.failedCalls++
    const usage = e.metadata?.usage as Record<string, unknown> | undefined
    if (usage) {
      agg.totalInputTokens += (usage.inputTokens as number) || 0
      agg.totalOutputTokens += (usage.outputTokens as number) || 0
    }
    const model = (e.metadata?.model as string) || (e.metadata?.modelId as string | undefined)
    if (model) agg.modelCounts.set(model, (agg.modelCounts.get(model) || 0) + 1)
  }
  const durationMs = readTraceEventDurationMs(e.metadata)
  const end = e.timestamp ? new Date(e.timestamp).getTime() : NaN
  if (durationMs !== undefined && Number.isFinite(end)) {
    agg.windows.push([end - durationMs, end])
  }
  if (e.timestamp) agg.updatedAt = e.timestamp
}

export function finalizeSummary(agg: TraceAggregate): TraceSummary {
  const models = Array.from(agg.modelCounts.entries()).map(([model, calls]) => ({ model, calls }))
  return {
    apiCalls: agg.apiCalls,
    failedCalls: agg.failedCalls,
    totalDurationMs: unionWindows(agg.windows),
    totalInputTokens: agg.totalInputTokens,
    totalOutputTokens: agg.totalOutputTokens,
    models,
    updatedAt: agg.updatedAt,
  }
}

// unionWindows 从渲染端 duration 模块引入，避免第三份并集实现。

/** 全量口径：对一批事件做完整聚合（detail 页与侧车冷启动回填共用）。 */
export function summarizeEvents(events: AgentTraceEventForTrace[]): TraceSummary {
  const agg = emptyAggregate()
  for (const e of events) accumulateEvent(agg, e)
  return finalizeSummary(agg)
}
