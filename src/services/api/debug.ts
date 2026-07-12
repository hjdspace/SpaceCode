import { electronAPI } from './_context'
import type { DebugFileEntry, TraceSessionEntry, AgentTraceEvent } from '../electronAPI'

export const debug = {
  listFiles: (): Promise<DebugFileEntry[]> => electronAPI?.debug?.listFiles() || Promise.resolve([]),
  readFile: (filePath: string, maxBytes?: number): Promise<{ success: boolean; content?: string; error?: string }> =>
    electronAPI?.debug?.readFile(filePath, maxBytes) || Promise.resolve({ success: false, error: 'Debug API not available' }),
  listTraceSessions: (): Promise<TraceSessionEntry[]> => electronAPI?.debug?.listTraceSessions() || Promise.resolve([]),
  readTraceEvents: (sessionId: string, maxEvents?: number): Promise<{ success: boolean; events?: AgentTraceEvent[]; error?: string }> =>
    electronAPI?.debug?.readTraceEvents(sessionId, maxEvents) || Promise.resolve({ success: false, error: 'Debug API not available' }),
}
