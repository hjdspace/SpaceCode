/**
 * TraceViewModel — 核心构建函数，将后端 AgentTraceEvent[] 转换为 TraceViewModel
 * Fully replicated from cc-haha, adapted for SpaceCode's AgentTraceEvent model
 */
import type { TraceCallUsage, TraceEventRecord } from '@/types/trace'
import type { AgentTraceEvent } from '@/services/electronAPI'

export type TraceSpanKind = 'session' | 'turn' | 'message' | 'llm' | 'tool' | 'tool_result' | 'event'
export type TraceSpanStatus = 'ok' | 'error' | 'pending'

export type TraceSpan = {
  id: string
  parentId: string | null
  childIds: string[]
  kind: TraceSpanKind
  status: TraceSpanStatus
  title: string
  subtitle: string
  timestamp: string
  completedAt?: string
  durationMs?: number
  turnIndex?: number
  message?: AgentTraceEvent
  call?: unknown
  event?: TraceEventRecord
  toolUseId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  isSidechain?: boolean
  tokenUsage?: TraceCallUsage
  isLifecycleNoise?: boolean
  raw: unknown
}

export type TraceDiagnosisReason =
  | 'empty'
  | 'model_error'
  | 'tool_error'
  | 'event_error'
  | 'pending_model'
  | 'pending_tool'
  | 'waiting_for_agent'
  | 'healthy'

export type TraceDiagnosis = {
  status: 'empty' | 'healthy' | 'attention' | 'blocked'
  reason: TraceDiagnosisReason
  focusSpanId?: string
  evidenceSpanIds: string[]
  lastActivityAt: string
  errorCount: number
  pendingModelCalls: number
  pendingToolCalls: number
  modelCalls: number
  toolCalls: number
}

export type TraceTurn = {
  id: string
  index: number
  title: string
  timestamp: string
  spanIds: string[]
  userSpanId?: string
}

export type TraceViewModel = {
  rootId: string
  spans: TraceSpan[]
  spansById: Map<string, TraceSpan>
  turns: TraceTurn[]
  orderedSpanIds: string[]
  diagnosis: TraceDiagnosis
}

export type TraceViewModelOptions = {
  now?: string | number | Date
}

type MutableSpan = Omit<TraceSpan, 'childIds'> & { childIds: string[] }

/**
 * 从 AgentTraceEvent[] 数组构建 TraceViewModel
 * 将现有的事件流式数据转换为 cc-haha 的 Span 树结构
 */
export function buildTraceViewModel(
  events: AgentTraceEvent[],
  options: TraceViewModelOptions = {},
): TraceViewModel {
  const spans = new Map<string, MutableSpan>()
  const turns: TraceTurn[] = []
  const rootId = 'session:root'
  const nowTimestamp = normalizeNowTimestamp(options.now)
  const fallbackTimestamp = events[0]?.timestamp || new Date().toISOString()

  const hasErrors = events.some(e => e.status === 'failed' || e.error)
  const hasPending = events.some(e => e.status === 'running' || e.status === 'started')

  // 1. 创建根 span
  addSpan(spans, {
    id: rootId,
    parentId: null,
    kind: 'session',
    status: hasErrors ? 'error' : hasPending ? 'pending' : 'ok',
    title: events[0]?.sessionId?.slice(0, 16) || 'Trace Session',
    subtitle: `${events.length} events`,
    timestamp: fallbackTimestamp,
    completedAt: events[events.length - 1]?.timestamp,
    raw: { eventCount: events.length },
  })

  // 2. 按 Turn 分组
  const turnMap = new Map<string, AgentTraceEvent[]>()
  let currentTurnIndex = 0
  let currentTurnKey = 'turn:0'

  for (const event of events) {
    // 用户消息开始新的 Turn
    if (event.actor === 'user' && event.type === 'user_message') {
      currentTurnKey = `turn:${currentTurnIndex}`
      currentTurnIndex++
    } else if (turnMap.size === 0) {
      currentTurnKey = 'turn:0'
      currentTurnIndex = 1
    }

    if (!turnMap.has(currentTurnKey)) {
      turnMap.set(currentTurnKey, [])
    }
    turnMap.get(currentTurnKey)!.push(event)
  }

  if (turnMap.size === 0) {
    turnMap.set('turn:0', [...events])
  }

  // 3. 创建 Turn spans 和事件 spans
  let turnIndex = 0
  for (const [turnId, turnEvents] of turnMap) {
    const firstEvent = turnEvents[0]
    const title = turnEvents.find(e => e.actor === 'user' && e.title)?.title
      || turnEvents.find(e => e.type === 'user_message')?.title
      || `Turn ${turnIndex + 1}`

    const turn: TraceTurn = {
      id: turnId,
      index: turnIndex,
      title,
      timestamp: firstEvent?.timestamp || fallbackTimestamp,
      spanIds: [],
    }
    turns.push(turn)

    addSpan(spans, {
      id: turnId,
      parentId: rootId,
      kind: 'turn',
      status: 'ok',
      title,
      subtitle: `Turn ${turnIndex + 1}`,
      timestamp: turn.timestamp,
      turnIndex,
      raw: { index: turnIndex, timestamp: turn.timestamp, title },
    })

    // 为每个事件创建 span
    for (const event of turnEvents) {
      const spanId = buildEventSpanId(event, turnIndex)
      const { kind, status } = classifyEvent(event)
      const isNoise = isLifecycleNoiseEvent(event)

      addSpan(spans, {
        id: spanId,
        parentId: turnId,
        kind,
        status,
        title: event.title || formatEventType(event.type, event.actor),
        subtitle: buildEventSubtitle(event),
        timestamp: event.timestamp || fallbackTimestamp,
        turnIndex,
        message: event,
        toolName: event.actor === 'tool' ? event.type : undefined,
        input: event.input,
        output: event.output,
        tokenUsage: (event.metadata?.usage as TraceCallUsage | undefined),
        isLifecycleNoise: isNoise,
        raw: event,
      })
      turn.spanIds.push(spanId)
    }

    turnIndex++
  }

  // 4. 状态冒泡
  for (const turn of turns) {
    const childStatuses = turn.spanIds
      .map((spanId) => spans.get(spanId)?.status)
      .filter(Boolean)
    const turnSpan = spans.get(turn.id)
    if (turnSpan) {
      turnSpan.status = childStatuses.includes('error')
        ? 'error'
        : childStatuses.includes('pending')
          ? 'pending'
          : 'ok'
      turnSpan.subtitle = `${turn.spanIds.length} spans`
      applyAggregateTiming(turnSpan, turn.spanIds.map((spanId) => spans.get(spanId)).filter(Boolean) as MutableSpan[])
    }
  }

  const rootSpan = spans.get(rootId)
  if (rootSpan) {
    const childStatuses = rootSpan.childIds
      .map((spanId) => spans.get(spanId)?.status)
      .filter(Boolean)
    rootSpan.status = childStatuses.includes('error')
      ? 'error'
      : childStatuses.includes('pending')
        ? 'pending'
        : rootSpan.status
    applyAggregateTiming(rootSpan, rootSpan.childIds.map((spanId) => spans.get(spanId)).filter(Boolean) as MutableSpan[])
  }

  const orderedSpanIds = orderSpans(spans, rootId)
  const spanList = orderedSpanIds.map((id) => spans.get(id)).filter(Boolean) as TraceSpan[]
  return {
    rootId,
    spans: spanList,
    spansById: new Map(spanList.map((span) => [span.id, span])),
    turns,
    orderedSpanIds,
    diagnosis: buildDiagnosis(spanList, turns, rootId, fallbackTimestamp),
  }
}

// ======== Helper Functions ========

let _spanIdCounter = 0
function buildEventSpanId(event: AgentTraceEvent, turnIndex: number): string {
  if (event.id) return `event:${event.id}`
  _spanIdCounter++
  const { kind } = classifyEvent(event)
  const suffix = `${turnIndex}-${_spanIdCounter}`
  if (kind === 'llm') return `llm:synth-${suffix}`
  if (kind === 'tool' || kind === 'tool_result') return `tool:synth-${suffix}`
  if (kind === 'message') return `message:synth-${suffix}`
  return `event:synth-${suffix}`
}

function classifyEvent(event: AgentTraceEvent): { kind: TraceSpanKind; status: TraceSpanStatus } {
  if (event.actor === 'assistant' || event.type === 'assistant_text' || event.type === 'assistant_turn' || event.type === 'assistant_reasoning') {
    return { kind: 'llm', status: eventStatusToSpanStatus(event.status) }
  }
  if (event.actor === 'tool' || event.type === 'tool_call') {
    return { kind: 'tool', status: eventStatusToSpanStatus(event.status) }
  }
  if (event.type === 'tool_result') {
    return { kind: 'tool_result', status: eventStatusToSpanStatus(event.status) }
  }
  if (event.actor === 'user' || event.type === 'user_message') {
    return { kind: 'message', status: 'ok' }
  }
  if (event.type === 'error') {
    return { kind: 'event', status: 'error' }
  }
  return { kind: 'event', status: eventStatusToSpanStatus(event.status) }
}

function eventStatusToSpanStatus(status?: string): TraceSpanStatus {
  if (status === 'failed') return 'error'
  if (status === 'running' || status === 'started') return 'pending'
  if (status === 'completed') return 'ok'
  return 'ok'
}

function buildEventSubtitle(event: AgentTraceEvent): string {
  if (event.type === 'tool_call' && event.input) return summarizeToolInput(event.input)
  if (event.type === 'tool_result' && event.output) return previewTraceValue(event.output, 100)
  if ((event.type === 'assistant_text' || event.type === 'assistant_reasoning') && event.output) return previewTraceValue(event.output, 100)
  if (event.error) return event.error.message
  return event.type
}

function formatEventType(type: string, actor?: string): string {
  const TYPE_LABELS: Record<string, string> = {
    user_message: 'User message',
    assistant_text: 'Assistant response',
    assistant_reasoning: 'Thinking',
    assistant_turn: 'Assistant turn',
    tool_call: 'Tool call',
    tool_result: 'Tool result',
    file_change: 'File change',
    command_run: 'Command',
    verification: 'Verification',
    error: 'Error',
    final_summary: 'Summary',
    session_created: 'Session created',
    engine_session_start: 'Engine start',
    plan: 'Plan',
  }
  return TYPE_LABELS[type] || `${actor || 'Event'} · ${type}`
}

function summarizeToolInput(input: unknown): string {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>
    const primary = record.command ?? record.file_path ?? record.path ?? record.query ?? record.description
    if (typeof primary === 'string' && primary.trim()) return primary.trim()
  }
  return previewTraceValue(input, 140)
}

export function previewTraceValue(value: unknown, maxChars = 180): string {
  const text = extractTextContent(value).replace(/\s+/g, ' ').trim()
  if (!text) return 'empty'
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text
}

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return formatUnknown(content)
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as { text?: string; content?: string }
      if (typeof record.text === 'string') return [record.text]
      if (typeof record.content === 'string') return [record.content]
      return []
    })
    .join('\n')
}

export function formatTraceJson(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    return parsed === null ? value : JSON.stringify(parsed, null, 2)
  }
  return formatUnknown(value)
}

const LIFECYCLE_NOISE_TYPES = new Set([
  'session_created',
  'engine_session_start',
])

function isLifecycleNoiseEvent(event: AgentTraceEvent): boolean {
  return LIFECYCLE_NOISE_TYPES.has(event.type)
}

function buildDiagnosis(
  spans: TraceSpan[],
  turns: TraceTurn[],
  rootId: string,
  fallbackTimestamp: string,
): TraceDiagnosis {
  const meaningfulSpans = spans.filter((span) => span.id !== rootId)
  const errorSpans = meaningfulSpans.filter((span) => span.status === 'error')
  const pendingModels = meaningfulSpans.filter((span) => span.kind === 'llm' && span.status === 'pending')
  const pendingTools = meaningfulSpans.filter((span) => span.kind === 'tool' && span.status === 'pending')
  const toolErrors = errorSpans.filter((span) => span.kind === 'tool' || span.kind === 'tool_result')
  const modelErrors = errorSpans.filter((span) => span.kind === 'llm')
  const eventErrors = errorSpans.filter((span) => span.kind === 'event')
  const lastSpan = meaningfulSpans.slice().sort((a, b) => compareSpanActivityTime(a, b))
  const lastSpanItem = lastSpan[lastSpan.length - 1]
  const lastTurn = turns[turns.length - 1]
  const lastTurnSpans = lastTurn
    ? lastTurn.spanIds.map((spanId: string) => spans.find((span) => span.id === spanId)).filter(Boolean) as TraceSpan[]
    : []
  const lastTurnHasUser = lastTurnSpans.some((span) => span.kind === 'message' && span.message?.actor === 'user')
  const lastTurnHasAgentWork = lastTurnSpans.some((span) =>
    span.kind === 'llm' || span.kind === 'tool' || span.kind === 'tool_result' || span.message?.actor === 'assistant'
  )

  if (meaningfulSpans.length === 0) {
    return { status: 'empty', reason: 'empty', evidenceSpanIds: [], lastActivityAt: fallbackTimestamp, errorCount: 0, pendingModelCalls: 0, pendingToolCalls: 0, modelCalls: 0, toolCalls: 0 }
  }
  if (modelErrors.length > 0) return createDiagnosis('blocked', 'model_error', modelErrors, spans, fallbackTimestamp)
  if (toolErrors.length > 0) return createDiagnosis('blocked', 'tool_error', toolErrors, spans, fallbackTimestamp)
  if (eventErrors.length > 0) return createDiagnosis('blocked', 'event_error', eventErrors, spans, fallbackTimestamp)
  if (pendingModels.length > 0) return createDiagnosis('attention', 'pending_model', pendingModels, spans, fallbackTimestamp)
  if (pendingTools.length > 0) return createDiagnosis('attention', 'pending_tool', pendingTools, spans, fallbackTimestamp)
  if (lastTurnHasUser && !lastTurnHasAgentWork) {
    const evidence = lastTurnSpans.length > 0 ? lastTurnSpans : lastSpanItem ? [lastSpanItem] : []
    return createDiagnosis('attention', 'waiting_for_agent', evidence, spans, fallbackTimestamp)
  }
  return createDiagnosis('healthy', 'healthy', lastSpanItem ? [lastSpanItem] : [], spans, fallbackTimestamp)
}

function createDiagnosis(
  status: TraceDiagnosis['status'],
  reason: TraceDiagnosisReason,
  evidence: TraceSpan[],
  spans: TraceSpan[],
  fallbackTimestamp: string,
): TraceDiagnosis {
  const errors = spans.filter((span) => span.status === 'error')
  const pendingModels = spans.filter((span) => span.kind === 'llm' && span.status === 'pending')
  const pendingTools = spans.filter((span) => span.kind === 'tool' && span.status === 'pending')
  const sortedSpans = spans.slice().sort((a, b) => compareSpanActivityTime(a, b))
  const lastActivityAt = sortedSpans[sortedSpans.length - 1]
  const lastActivityTimestamp = lastActivityAt ? spanActivityTimestamp(lastActivityAt) : undefined
  return {
    status, reason,
    focusSpanId: evidence[0]?.id,
    evidenceSpanIds: evidence.map((span) => span.id),
    lastActivityAt: lastActivityTimestamp ?? fallbackTimestamp,
    errorCount: errors.length,
    pendingModelCalls: pendingModels.length,
    pendingToolCalls: pendingTools.length,
    modelCalls: spans.filter((span) => span.kind === 'llm').length,
    toolCalls: spans.filter((span) => span.kind === 'tool').length,
  }
}

function applyAggregateTiming(parent: MutableSpan, children: MutableSpan[]) {
  const startTime = new Date(parent.timestamp).getTime()
  if (!Number.isFinite(startTime)) return
  let endTime = startTime
  let completedAt: string | undefined
  for (const child of children) {
    const activity = spanActivity(child)
    if (!activity) continue
    if (activity.time >= endTime) { endTime = activity.time; completedAt = activity.timestamp }
  }
  if (endTime < startTime) return
  parent.durationMs = endTime - startTime
  if (parent.status !== 'pending' && completedAt) parent.completedAt = completedAt
  else if (parent.status === 'pending') delete parent.completedAt
}

function addSpan(spans: Map<string, MutableSpan>, span: Omit<TraceSpan, 'childIds'>) {
  if (spans.has(span.id)) return
  spans.set(span.id, { ...span, childIds: [] })
  if (span.parentId) {
    const parent = spans.get(span.parentId)
    if (parent && !parent.childIds.includes(span.id)) parent.childIds.push(span.id)
  }
}

function orderSpans(spans: Map<string, MutableSpan>, rootId: string): string[] {
  const result: string[] = []
  const visit = (id: string) => {
    const span = spans.get(id)
    if (!span) return
    result.push(id)
    span.childIds.sort((a, b) => compareSpanTime(spans.get(a), spans.get(b)))
    for (const childId of span.childIds) visit(childId)
  }
  visit(rootId)
  return result
}

function compareSpanTime(a?: MutableSpan, b?: MutableSpan): number {
  if (!a || !b) return 0
  const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  if (Number.isFinite(diff) && diff !== 0) return diff
  return a.id.localeCompare(b.id)
}

function compareSpanActivityTime(a?: TraceSpan, b?: TraceSpan): number {
  if (!a || !b) return 0
  const aActivity = spanActivity(a)
  const bActivity = spanActivity(b)
  if (aActivity && bActivity && aActivity.time !== bActivity.time) return aActivity.time - bActivity.time
  if (aActivity && !bActivity) return 1
  if (!aActivity && bActivity) return -1
  return compareSpanTime(a as MutableSpan, b as MutableSpan)
}

function spanActivityTimestamp(span: TraceSpan): string | undefined {
  return spanActivity(span)?.timestamp
}

function spanActivity(span: TraceSpan): { timestamp: string; time: number } | undefined {
  const startTime = new Date(span.timestamp).getTime()
  if (!Number.isFinite(startTime)) return undefined
  if (span.completedAt) {
    const completedTime = new Date(span.completedAt).getTime()
    if (Number.isFinite(completedTime)) return { timestamp: span.completedAt, time: completedTime }
  }
  if (span.durationMs !== undefined && Number.isFinite(span.durationMs) && span.durationMs >= 0) {
    const endTime = startTime + span.durationMs
    return { timestamp: new Date(endTime).toISOString(), time: endTime }
  }
  return { timestamp: span.timestamp, time: startTime }
}

function normalizeNowTimestamp(value: TraceViewModelOptions['now']): string | undefined {
  if (value === undefined) return new Date().toISOString()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatUnknown(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}

function parseJson(value: string): unknown | null {
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null
  try { return JSON.parse(trimmed) } catch { return null }
}
