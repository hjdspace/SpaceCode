import { electronAPI } from './_context'
import type { AgentTraceEvent, TraceSessionEntry } from '../electronAPI'
import type {
  TraceSessionList,
  TraceSession,
  TraceCallRecord,
  TraceCaptureSettings,
} from '@/types/trace'

export const trace = {
  event: (event: AgentTraceEvent) => electronAPI?.trace?.event(event),
  list: (params?: { limit?: number; offset?: number; query?: string }): Promise<TraceSessionList> => {
    if (electronAPI?.trace?.list) return electronAPI.trace.list(params)
    return (async () => {
      const sessions = await (electronAPI?.debug?.listTraceSessions() || Promise.resolve([]))
      return {
        traces: sessions.map((s: TraceSessionEntry) => ({
          sessionId: s.sessionId,
          session: null,
          summary: { apiCalls: 0, failedCalls: 0, totalDurationMs: 0, totalInputTokens: 0, totalOutputTokens: 0, models: [], updatedAt: null },
          fileSize: s.size,
          fileUpdatedAt: new Date(s.modifiedAt).toISOString(),
        })),
        total: sessions.length,
        storageDir: '',
        settings: { enabled: true, storageDir: '' },
      }
    })()
  },
  getTrace: (sessionId: string): Promise<{ success: boolean; data?: TraceSession; error?: string }> => {
    if (electronAPI?.trace?.getTrace) return electronAPI.trace.getTrace(sessionId)
    return Promise.resolve({ success: false, error: 'Not available' })
  },
  getTraceCall: (sessionId: string, callId: string): Promise<{ call?: TraceCallRecord } | null> => {
    if (electronAPI?.trace?.getTraceCall) return electronAPI.trace.getTraceCall(sessionId, callId)
    return Promise.resolve(null)
  },
  getSettings: (): Promise<TraceCaptureSettings | null> => {
    if (electronAPI?.trace?.getSettings) return electronAPI.trace.getSettings()
    return Promise.resolve(null)
  },
  updateSettings: (settings: { enabled: boolean }): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.trace?.updateSettings) return electronAPI.trace.updateSettings(settings)
    return Promise.resolve({ success: false, error: 'Not available' })
  },
  openWindow: (sessionId: string): void => {
    if (electronAPI?.trace?.openWindow) electronAPI.trace.openWindow(sessionId)
  },
}
