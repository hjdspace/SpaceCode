import type { Session } from '@/types'

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = 'chat_sessions_v2'
const PROJECTS_KEY = 'chat_projects_v2'
const STORAGE_VERSION = '2.1'

const STORAGE_QUOTA_LIMIT = 4 * 1024 * 1024
const STORAGE_WARNING_THRESHOLD = 0.8
/** Max serialized payload for chat_sessions key (UTF-16 ×2 in localStorage). */
const SESSION_PAYLOAD_LIMIT = Math.floor(STORAGE_QUOTA_LIMIT * 0.45)
const MESSAGE_CONTENT_PERSIST_LIMIT = 8_000
const TOOL_OUTPUT_PERSIST_LIMIT = 4_000
const REASONING_PERSIST_LIMIT = 2_000
const TIMELINE_CONTENT_PERSIST_LIMIT = 1_000

// ============================================================
// Types
// ============================================================

interface PersistTrimOptions {
  maxContent?: number
  maxToolOutput?: number
  maxReasoning?: number
  maxTimelineContent?: number
}

interface StorageStats {
  totalSize: number
  sessionCount: number
  oldestSessionDate: number
  compressionRatio: number
}

// ============================================================
// Logger (injectable)
// ============================================================

export interface PersistenceLogger {
  debug: (scope: string, message: string, data?: any) => void
  info: (scope: string, message: string, data?: any) => void
  warn: (scope: string, message: string, data?: any) => void
  error: (scope: string, message: string, data?: any) => void
}

const defaultLogger: PersistenceLogger = {
  debug: (scope, message, data?) => console.debug(`[${scope}] ${message}`, data ?? ''),
  info: (scope, message, data?) => console.log(`[${scope}] ${message}`, data ?? ''),
  warn: (scope, message, data?) => console.warn(`[${scope}] ${message}`, data ?? ''),
  error: (scope, message, data?) => console.error(`[${scope}] ${message}`, data ?? ''),
}

let _logger: PersistenceLogger = defaultLogger

/** Replace the logger used by session persistence (e.g. with the renderer logger that forwards to main). */
export function setPersistenceLogger(logger: PersistenceLogger) {
  _logger = logger
}

// ============================================================
// Storage maintenance logging (with cooldown)
// ============================================================

let _storageMaintenanceLoggedAt = 0
const STORAGE_LOG_COOLDOWN_MS = 120_000

function logStorageMaintenance(message: string, data?: unknown) {
  const now = Date.now()
  if (now - _storageMaintenanceLoggedAt < STORAGE_LOG_COOLDOWN_MS) return
  _storageMaintenanceLoggedAt = now
  _logger.debug('ChatStore', message, data)
}

// ============================================================
// Utility functions
// ============================================================

export function estimateUtf16Bytes(text: string): number {
  return text.length * 2
}

export function compressData(data: string): string {
  try {
    const compressed = data.replace(/([^\x00-\x7F]+|\\u[0-9a-fA-F]{4})+/g, (match) => {
      return '\x00' + match.length.toString(36) + '\x01' + match
    })
    return compressed.length < data.length ? 'C:' + compressed : 'R:' + data
  } catch {
    return 'R:' + data
  }
}

export function decompressData(data: string): string {
  if (data.startsWith('R:')) return data.slice(2)
  if (data.startsWith('C:')) {
    try {
      return data.slice(2).replace(/\x00\w+\x01/g, '')
    } catch {
      return data.slice(2)
    }
  }
  return data
}

// ============================================================
// Payload trimming / stripping
// ============================================================

export function stripPersistedPayload(
  sessions: Session[],
  options: PersistTrimOptions = {},
): Session[] {
  const maxContent = options.maxContent ?? MESSAGE_CONTENT_PERSIST_LIMIT
  const maxToolOutput = options.maxToolOutput ?? TOOL_OUTPUT_PERSIST_LIMIT
  const maxReasoning = options.maxReasoning ?? REASONING_PERSIST_LIMIT
  const maxTimelineContent = options.maxTimelineContent ?? TIMELINE_CONTENT_PERSIST_LIMIT

  const truncateText = (text: string, limit: number, suffix: string) =>
    text.length > limit ? text.slice(0, limit) + suffix : text

  return sessions.map(session => ({
    ...session,
    messages: session.messages.map(msg => {
      const next: any = { ...msg }

      if (next.content && next.content.length > maxContent) {
        next.content = truncateText(next.content, maxContent, '\n\n[Truncated for storage]')
      }

      if (next.reasoning?.content && next.reasoning.content.length > maxReasoning) {
        next.reasoning = {
          ...next.reasoning,
          content: truncateText(next.reasoning.content, maxReasoning, '…'),
        }
      }

      if (next.toolCalls?.length) {
        next.toolCalls = next.toolCalls.map((toolCall: any) => ({
          ...toolCall,
          output:
            toolCall.output && toolCall.output.length > maxToolOutput
              ? truncateText(toolCall.output, maxToolOutput, '\n[Truncated for storage]')
              : toolCall.output,
        }))
      }

      if (next.toolResults?.length) {
        next.toolResults = next.toolResults.map((toolResult: any) => ({
          ...toolResult,
          output:
            toolResult.output.length > maxToolOutput
              ? truncateText(toolResult.output, maxToolOutput, '\n[Truncated for storage]')
              : toolResult.output,
        }))
      }

      if (next.timelineEvents?.length) {
        next.timelineEvents = next.timelineEvents.map((event: any) => ({
          ...event,
          content:
            event.content && event.content.length > maxTimelineContent
              ? truncateText(event.content, maxTimelineContent, '…')
              : event.content,
        }))
      }

      return next
    }),
  }))
}

export function cleanupOldSessions(
  sessions: Session[],
  keepCount: number = 50,
  log = true,
): Session[] {
  if (sessions.length <= keepCount) return sessions
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept = sorted.slice(0, keepCount)
  if (log) {
    logStorageMaintenance(`Dropped ${sessions.length - keepCount} old sessions`, {
      kept: keepCount,
    })
  }
  return kept
}

export function truncateLongMessages(sessions: Session[], maxLength: number = 10000): Session[] {
  return sessions.map(session => ({
    ...session,
    messages: session.messages.map(msg => {
      if (msg.content && msg.content.length > maxLength) {
        return {
          ...msg,
          content: msg.content.slice(0, maxLength) + '\n\n[Content truncated due to length]',
          truncated: true,
          originalLength: msg.content.length
        }
      }
      return msg
    })
  }))
}

// 持久化前剥离图片附件中的超大 base64 字段（data / previewUrl）。
// 这些 dataURL 通常是几 MB 的字符串；流式回调里每条 chunk 都触发保存时，
// 重复序列化它们会导致 localStorage 配额溢出 → 触发清理 → 渲染进程卡死 → 黑屏。
// engine 已经在发送时通过 IPC 收到原始字节，无需再持久化到前端存储。
export function stripLargeAttachmentData(sessions: Session[]): Session[] {
  return sessions.map(session => ({
    ...session,
    messages: session.messages.map(msg => {
      const hasImages = !!msg.imageAttachments?.length
      const hasAttImages = Array.isArray(msg.attachments) && msg.attachments.some((a: any) => a?.type === 'image')
      if (!hasImages && !hasAttImages) return msg
      const next: any = { ...msg }
      if (hasImages) {
        next.imageAttachments = msg.imageAttachments!.map((img: any) => ({
          id: img.id,
          name: img.name,
          type: img.type,
          mimeType: img.mimeType,
          contentUrl: img.contentUrl,
          // 丢弃 data / previewUrl（base64），重新加载时显示占位
        }))
      }
      if (hasAttImages) {
        next.attachments = (msg.attachments as any[]).map(att =>
          att?.type === 'image'
            ? { id: att.id, name: att.name, type: att.type, mimeType: att.mimeType, contentUrl: att.contentUrl }
            : att
        )
      }
      return next
    })
  }))
}

// ============================================================
// Storage payload building
// ============================================================

export function buildStoragePayload(sessions: Session[]): { payload: string; compressed: boolean } {
  const jsonData = JSON.stringify(sessions)
  const compressed = compressData(jsonData)
  const payload = compressed.length < jsonData.length ? compressed : jsonData
  return { payload, compressed: payload !== jsonData }
}

/**
 * 单次遍历完成：剥离大附件 + 截断 payload。
 *
 * 原实现先调用 stripLargeAttachmentData 再调用 stripPersistedPayload，
 * 两次 .map() 各自创建完整的 sessions 深拷贝。长时间运行的任务中
 * sessions 可能包含数十 MB 的工具输出，两份深拷贝 + JSON.stringify
 * + compressData 同时驻留内存，峰值达 4× 原始数据大小，直接触发
 * V8 "Oilpan: Large allocation" OOM。
 *
 * 合并为单次遍历后，截断在拷贝时同步完成，拷贝产物从一开始就是小对象，
 * 峰值内存从 ~4× 降至 ~2×（原始 + 拷贝）。
 */
export function prepareSessionsForStorage(
  sessions: Session[],
  aggressive = false,
): Session[] {
  const maxContent = aggressive ? 3_000 : MESSAGE_CONTENT_PERSIST_LIMIT
  const maxToolOutput = aggressive ? 1_500 : TOOL_OUTPUT_PERSIST_LIMIT
  const maxReasoning = aggressive ? 800 : REASONING_PERSIST_LIMIT
  const maxTimelineContent = aggressive ? 400 : TIMELINE_CONTENT_PERSIST_LIMIT

  const truncateText = (text: string, limit: number, suffix: string) =>
    text.length > limit ? text.slice(0, limit) + suffix : text

  const prepared = sessions.map(session => ({
    ...session,
    messages: session.messages.map(msg => {
      const next: any = { ...msg }

      // ── 剥离大附件 base64（原 stripLargeAttachmentData 逻辑）──
      const hasImages = !!next.imageAttachments?.length
      const hasAttImages = Array.isArray(next.attachments) && next.attachments.some((a: any) => a?.type === 'image')
      if (hasImages) {
        next.imageAttachments = next.imageAttachments.map((img: any) => ({
          id: img.id, name: img.name, type: img.type, mimeType: img.mimeType, contentUrl: img.contentUrl,
        }))
      }
      if (hasAttImages) {
        next.attachments = next.attachments.map((att: any) =>
          att?.type === 'image'
            ? { id: att.id, name: att.name, type: att.type, mimeType: att.mimeType, contentUrl: att.contentUrl }
            : att
        )
      }

      // ── 截断 payload（原 stripPersistedPayload 逻辑）──
      if (next.content && next.content.length > maxContent) {
        next.content = truncateText(next.content, maxContent, '\n\n[Truncated for storage]')
      }
      if (next.reasoning?.content && next.reasoning.content.length > maxReasoning) {
        next.reasoning = { ...next.reasoning, content: truncateText(next.reasoning.content, maxReasoning, '…') }
      }
      if (next.toolCalls?.length) {
        next.toolCalls = next.toolCalls.map((toolCall: any) => ({
          ...toolCall,
          output: toolCall.output && toolCall.output.length > maxToolOutput
            ? truncateText(toolCall.output, maxToolOutput, '\n[Truncated for storage]')
            : toolCall.output,
        }))
      }
      if (next.toolResults?.length) {
        next.toolResults = next.toolResults.map((toolResult: any) => ({
          ...toolResult,
          output: toolResult.output.length > maxToolOutput
            ? truncateText(toolResult.output, maxToolOutput, '\n[Truncated for storage]')
            : toolResult.output,
        }))
      }
      if (next.timelineEvents?.length) {
        next.timelineEvents = next.timelineEvents.map((event: any) => ({
          ...event,
          content: event.content && event.content.length > maxTimelineContent
            ? truncateText(event.content, maxTimelineContent, '…')
            : event.content,
        }))
      }

      return next
    }),
  }))

  if (aggressive) {
    const cleaned = cleanupOldSessions(prepared, 20, false)
    return truncateLongMessages(cleaned, 3_000)
  }
  return prepared
}

// ============================================================
// Storage usage
// ============================================================

export function getStorageUsage(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      total += localStorage.getItem(key)?.length || 0
    }
  }
  return total * 2
}

export function checkStorageSpace(): { ok: boolean; usage: number; warning: boolean } {
  const usage = getStorageUsage()
  return {
    ok: usage < STORAGE_QUOTA_LIMIT,
    usage,
    warning: usage > STORAGE_QUOTA_LIMIT * STORAGE_WARNING_THRESHOLD
  }
}

// ============================================================
// Load / Save sessions
// ============================================================

export function loadSessionsFromStorage(): Session[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const data = saved.startsWith('C:') || saved.startsWith('R:')
        ? decompressData(saved)
        : saved
      const sessions = JSON.parse(data)
      return (sessions || []).map((s: any) => ({
        ...s,
        processStatus: s.processStatus || 'none',
        isTabOpen: s.isTabOpen ?? false,
        lastActivityAt: s.lastActivityAt || s.updatedAt || s.createdAt,
        expandedView: s.expandedView || 'none',
        viewingAgentTaskId: s.viewingAgentTaskId,
        teammateTranscripts: s.teammateTranscripts || {},
        teamContext: s.teamContext,
      }))
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load sessions from storage:', e)
  }
  return []
}

export function saveSessionsToStorage(sessions: Session[]): boolean {
  try {
    let prepared = prepareSessionsForStorage(sessions)
    let { payload, compressed } = buildStoragePayload(prepared)

    if (estimateUtf16Bytes(payload) > SESSION_PAYLOAD_LIMIT) {
      logStorageMaintenance('Session payload over limit, applying aggressive trim')
      prepared = prepareSessionsForStorage(sessions, true)
      ;({ payload, compressed } = buildStoragePayload(prepared))
    }

    if (estimateUtf16Bytes(payload) > SESSION_PAYLOAD_LIMIT) {
      logStorageMaintenance('Session payload still large after trim, keeping recent sessions only')
      prepared = cleanupOldSessions(prepared, 10, false)
      prepared = stripPersistedPayload(prepared, {
        maxContent: 2_000,
        maxToolOutput: 800,
        maxReasoning: 500,
        maxTimelineContent: 200,
      })
      const rebuilt = buildStoragePayload(prepared)
      payload = rebuilt.payload
      compressed = rebuilt.compressed
    }

    localStorage.setItem(STORAGE_KEY, payload)
    localStorage.setItem(
      `${STORAGE_KEY}_meta`,
      JSON.stringify({
        version: STORAGE_VERSION,
        savedAt: Date.now(),
        count: prepared.length,
        compressed,
      }),
    )
    return true
  } catch (e) {
    _logger.error('ChatStore', 'Failed to save sessions to storage', e)
    try {
      const emergencySessions = cleanupOldSessions(sessions, 10, false)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(stripPersistedPayload(stripLargeAttachmentData(emergencySessions))),
      )
      return true
    } catch (e2) {
      _logger.error('ChatStore', 'Emergency save also failed', e2)
      return false
    }
  }
}

// ============================================================
// Load / Save projects
// ============================================================

export function loadProjectsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(PROJECTS_KEY)
    if (saved) {
      return JSON.parse(saved) || []
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load projects from storage:', e)
  }
  return []
}

export function saveProjectsToStorage(projects: string[]): boolean {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
    return true
  } catch (e) {
    console.error('[ChatStore] Failed to save projects to storage:', e)
    return false
  }
}

// ============================================================
// Storage stats
// ============================================================

export function getStorageStats(): StorageStats {
  const sessions = loadSessionsFromStorage()
  const usage = getStorageUsage()
  const metaStr = localStorage.getItem(`${STORAGE_KEY}_meta`)
  const meta = metaStr ? JSON.parse(metaStr) : null
  return {
    totalSize: usage,
    sessionCount: sessions.length,
    oldestSessionDate: sessions.length > 0
      ? Math.min(...sessions.map(s => s.createdAt))
      : Date.now(),
    compressionRatio: meta?.compressed ? 0.7 : 1.0
  }
}

// ============================================================
// Re-exported constants
// ============================================================

export {
  STORAGE_KEY,
  PROJECTS_KEY,
  STORAGE_VERSION,
  STORAGE_QUOTA_LIMIT,
  SESSION_PAYLOAD_LIMIT,
}
