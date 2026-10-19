/**
 * Trace API IPC handlers — list/get trace sessions and calls.
 *
 * Converts internal AgentTraceEvents to the trace session/call format
 * expected by the renderer's trace inspector UI.
 *
 * list 的 summary 来源优先级（见 traceSidecar.ts）：
 *   1. 内存侧车（写路径逐事件增量维护，stat 校验命中 → 零读取零解析）
 *   2. 磁盘侧车（跨重启冷启动，(size, mtime) 校验命中 → 零解析）
 *   3. 全量解析回填（worker 线程；读全量文件重建侧车，此后归 1）
 * detail（trace:getTrace）仍解析最新 5000 条事件供逐条渲染，summary 与
 * list 同源（traceAggregate），区别仅在长会话（>5000 条）的截断口径。
 */
import { ipcMain } from 'electron'
import {
  listTraceSessions,
  readTraceEvents,
  statTraceSession,
  getTraceDir,
} from '../infra/logger'
import {
  isLlmCallEvent,
  isToolCallEvent,
  summarizeEvents,
  type AgentTraceEventForTrace,
  type TraceSummary,
} from '../infra/traceAggregate'
import {
  getSidecarSummary,
  adoptSidecarFromDisk,
  backfillSidecar,
} from '../infra/traceSidecar'
import { readTraceEventDurationMs, traceEventTimeRange } from '@/lib/trace/duration'

function eventToCallRecord(e: AgentTraceEventForTrace): Record<string, unknown> {
  const usage = e.metadata?.usage as Record<string, unknown> | undefined
  const inputTokens = (usage?.inputTokens as number) || 0
  const outputTokens = (usage?.outputTokens as number) || 0
  const durationMs = readTraceEventDurationMs(e.metadata)
  const model = (e.metadata?.model as string) || e.metadata?.modelId as string | undefined
  // 耗时事件都在回合结束时落盘，所以 e.timestamp 是结束时间，开始时间用耗时反推。
  const { startedAt: derivedStart, completedAt } = traceEventTimeRange(e.timestamp, durationMs)
  const startedAt = derivedStart ?? e.timestamp ?? new Date().toISOString()
  const callStatus = e.status === 'failed' ? 'error' : e.status === 'running' || e.status === 'started' ? 'pending' : 'ok'
  const inputPreview = typeof e.input === 'string' ? e.input : JSON.stringify(e.input ?? '')
  const outputPreview = typeof e.output === 'string' ? e.output : JSON.stringify(e.output ?? '')
  return {
    id: e.id || `call-${e.type}-${e.timestamp}`,
    sessionId: e.sessionId,
    source: e.source === 'engine' ? 'proxy' : 'anthropic',
    model,
    status: callStatus,
    startedAt,
    completedAt,
    durationMs,
    usage: { inputTokens, outputTokens },
    metadata: e.metadata,
    request: {
      method: 'POST',
      url: '',
      headers: {},
      body: { contentType: 'json', bytes: inputPreview.length, sha256: '', preview: inputPreview.slice(0, 1024), truncated: inputPreview.length > 1024 },
    },
    response: e.output ? {
      status: 200,
      headers: {},
      body: { contentType: 'json', bytes: outputPreview.length, sha256: '', preview: outputPreview.slice(0, 1024), truncated: outputPreview.length > 1024 },
    } : undefined,
    error: e.error ? { name: 'TraceError', message: e.error.message, stack: e.error.stack } : undefined,
  }
}

function eventToEventRecord(e: AgentTraceEventForTrace): Record<string, unknown> {
  const severity: string = e.status === 'failed' ? 'error' : e.status === 'running' || e.status === 'started' ? 'info' : 'info'
  return {
    id: e.id || `event-${e.type}-${e.timestamp}`,
    sessionId: e.sessionId,
    timestamp: e.timestamp || new Date().toISOString(),
    phase: e.type,
    severity,
    callId: e.id,
    source: e.source === 'engine' ? 'proxy' : 'anthropic',
    model: (e.metadata?.model as string) || (e.metadata?.modelId as string),
    title: e.title || e.type,
    message: e.error?.message,
    metadata: e.metadata,
  }
}

type SessionStat = { size: number; modifiedAt: number }

/**
 * list 的侧车兜底：全量读（maxEvents=0，worker 线程）重建侧车。
 * 全量而非截断 5000，是因为侧车要作为后续增量累积的基底——
 * 从截断事件起步会让后续增量与基底口径不一致。
 */
async function backfillListSummary(sessionId: string, stat: SessionStat): Promise<TraceSummary> {
  const result = await readTraceEvents(sessionId, 0)
  const events = (result.success ? (result.events || []) : []) as unknown as AgentTraceEventForTrace[]
  return backfillSidecar(sessionId, stat, events)
}

export function registerTraceIPCHandlers(): void {
  ipcMain.handle('trace:list', async (_event, params?: { limit?: number; offset?: number; query?: string }) => {
    const sessions = await listTraceSessions()
    const query = params?.query?.toLowerCase() || ''
    let filtered = sessions
    if (query) {
      filtered = sessions.filter(s => s.sessionId.toLowerCase().includes(query))
    }
    const offset = params?.offset || 0
    const limit = params?.limit || 50
    const paged = filtered.slice(offset, offset + limit)
    return {
      traces: await Promise.all(paged.map(async s => {
        const summary = getSidecarSummary(s.sessionId, s)
          ?? adoptSidecarFromDisk(s.sessionId, s)
          ?? await backfillListSummary(s.sessionId, s)
        return {
          sessionId: s.sessionId,
          session: null,
          summary,
          fileSize: s.size,
          fileUpdatedAt: new Date(s.modifiedAt).toISOString(),
        }
      })),
      total: filtered.length,
      storageDir: getTraceDir() || '',
      settings: { enabled: true, storageDir: getTraceDir() || '' },
    }
  })

  // 轻量变更检测：只 stat 文件，供轮询方在 mtime/size 未变时跳过全量读取。
  ipcMain.handle('trace:statSession', async (_event, sessionId: string) => {
    return statTraceSession(sessionId)
  })

  ipcMain.handle('trace:getTrace', async (_event, sessionId: string) => {
    try {
      const result = await readTraceEvents(sessionId, 5000)
      if (!result.success) return { success: false, error: result.error }
      const events = (result.events || []) as unknown as AgentTraceEventForTrace[]
      const calls = events.filter(isLlmCallEvent).map(eventToCallRecord)
      const traceEvents = events.map(eventToEventRecord)
      const summary = summarizeEvents(events)
      return {
        success: true,
        data: {
          sessionId,
          session: null,
          summary,
          calls,
          events: traceEvents,
        },
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('trace:getTraceCall', async (_event, sessionId: string, callId: string) => {
    try {
      const result = await readTraceEvents(sessionId, 5000)
      if (!result.success) return null
      const events = (result.events || []) as unknown as AgentTraceEventForTrace[]
      const callEvent = events.find(e => (e.id && e.id === callId) || (isLlmCallEvent(e) && `call-${e.type}-${e.timestamp}` === callId))
        || events.find(e => isToolCallEvent(e) && (e.id === callId || `call-${e.type}-${e.timestamp}` === callId))
      if (!callEvent) return null
      const call = eventToCallRecord(callEvent)
      return { call }
    } catch {
      return null
    }
  })

  ipcMain.handle('trace:getSettings', async () => {
    return { enabled: true, storageDir: getTraceDir() || '' }
  })

  ipcMain.handle('trace:updateSettings', async (_event, _settings: { enabled: boolean }) => {
    return { success: true }
  })

  ipcMain.on('trace:openWindow', (_event, _sessionId: string) => {
    // TODO: 实现独立 BrowserWindow 打开 trace 详情
  })
}
