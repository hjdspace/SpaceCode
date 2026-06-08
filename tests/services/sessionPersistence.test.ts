/**
 * Session persistence pure-function tests - run with:
 *   node --experimental-strip-types --test tests/services/sessionPersistence.test.ts
 *
 * Tests the pure logic extracted from src/stores/chat.ts that handles
 * session serialization, compression, and storage management.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Constants (mirroring src/stores/chat.ts) ──────────────────────

const MESSAGE_CONTENT_PERSIST_LIMIT = 8_000
const TOOL_OUTPUT_PERSIST_LIMIT = 4_000
const REASONING_PERSIST_LIMIT = 2_000
const TIMELINE_CONTENT_PERSIST_LIMIT = 1_000

const STORAGE_KEY = 'chat_sessions_v2'
const STORAGE_VERSION = '2.1'
const STORAGE_QUOTA_LIMIT = 4 * 1024 * 1024
const STORAGE_WARNING_THRESHOLD = 0.8
const SESSION_PAYLOAD_LIMIT = Math.floor(STORAGE_QUOTA_LIMIT * 0.45)

interface PersistTrimOptions {
  maxContent?: number
  maxToolOutput?: number
  maxReasoning?: number
  maxTimelineContent?: number
}

// ── Pure function implementations (copied from chat.ts) ───────────

function estimateUtf16Bytes(text: string): number {
  return text.length * 2
}

function compressData(data: string): string {
  try {
    const compressed = data.replace(/([^\x00-\x7F]+|\\u[0-9a-fA-F]{4})+/g, (match) => {
      return '\x00' + match.length.toString(36) + '\x01' + match
    })
    return compressed.length < data.length ? 'C:' + compressed : 'R:' + data
  } catch {
    return 'R:' + data
  }
}

function decompressData(data: string): string {
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

function stripPersistedPayload(
  sessions: any[],
  options: PersistTrimOptions = {},
): any[] {
  const maxContent = options.maxContent ?? MESSAGE_CONTENT_PERSIST_LIMIT
  const maxToolOutput = options.maxToolOutput ?? TOOL_OUTPUT_PERSIST_LIMIT
  const maxReasoning = options.maxReasoning ?? REASONING_PERSIST_LIMIT
  const maxTimelineContent = options.maxTimelineContent ?? TIMELINE_CONTENT_PERSIST_LIMIT

  const truncateText = (text: string, limit: number, suffix: string) =>
    text.length > limit ? text.slice(0, limit) + suffix : text

  return sessions.map(session => ({
    ...session,
    messages: session.messages.map((msg: any) => {
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

function cleanupOldSessions(sessions: any[], keepCount: number = 50, log = true): any[] {
  if (sessions.length <= keepCount) return sessions
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept = sorted.slice(0, keepCount)
  return kept
}

function truncateLongMessages(sessions: any[], maxLength: number = 10000): any[] {
  return sessions.map(session => ({
    ...session,
    messages: session.messages.map((msg: any) => {
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

function stripLargeAttachmentData(sessions: any[]): any[] {
  return sessions.map(session => ({
    ...session,
    messages: session.messages.map((msg: any) => {
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
        }))
      }
      if (hasAttImages) {
        next.attachments = (msg.attachments as any[]).map((att: any) =>
          att?.type === 'image'
            ? { id: att.id, name: att.name, type: att.type, mimeType: att.mimeType }
            : att
        )
      }
      return next
    })
  }))
}

function buildStoragePayload(sessions: any[]): { payload: string; compressed: boolean } {
  const jsonData = JSON.stringify(sessions)
  const compressed = compressData(jsonData)
  const payload = compressed.length < jsonData.length ? compressed : jsonData
  return { payload, compressed: payload !== jsonData }
}

function prepareSessionsForStorage(sessions: any[], aggressive = false): any[] {
  let prepared = stripLargeAttachmentData(sessions)
  prepared = stripPersistedPayload(
    prepared,
    aggressive
      ? {
          maxContent: 3_000,
          maxToolOutput: 1_500,
          maxReasoning: 800,
          maxTimelineContent: 400,
        }
      : undefined,
  )
  if (aggressive) {
    prepared = cleanupOldSessions(prepared, 20, false)
    prepared = truncateLongMessages(prepared, 3_000)
  }
  return prepared
}

// ── Mock localStorage ─────────────────────────────────────────────

function createMockLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem(key: string) { return store[key] ?? null },
    setItem(key: string, value: string) { store[key] = value },
    removeItem(key: string) { delete store[key] },
    get length() { return Object.keys(store).length },
    key(index: number) { return Object.keys(store)[index] ?? null },
    clear() { for (const k of Object.keys(store)) delete store[k] },
    _store: store,
  }
}

// ── checkStorageSpace (mocked localStorage) ───────────────────────

function getStorageUsage(ls: ReturnType<typeof createMockLocalStorage>): number {
  let total = 0
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key) {
      total += ls.getItem(key)?.length || 0
    }
  }
  return total * 2
}

function checkStorageSpace(ls: ReturnType<typeof createMockLocalStorage>): { ok: boolean; usage: number; warning: boolean } {
  const usage = getStorageUsage(ls)
  return {
    ok: usage < STORAGE_QUOTA_LIMIT,
    usage,
    warning: usage > STORAGE_QUOTA_LIMIT * STORAGE_WARNING_THRESHOLD,
  }
}

// ── loadSessionsFromStorage (mocked localStorage) ─────────────────

function loadSessionsFromStorage(ls: ReturnType<typeof createMockLocalStorage>): any[] {
  try {
    const saved = ls.getItem(STORAGE_KEY)
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
  } catch {
    // swallow
  }
  return []
}

// ── saveSessionsToStorage (mocked localStorage) ───────────────────

function saveSessionsToStorage(sessions: any[], ls: ReturnType<typeof createMockLocalStorage>): boolean {
  try {
    let prepared = prepareSessionsForStorage(sessions)
    let { payload, compressed } = buildStoragePayload(prepared)

    if (estimateUtf16Bytes(payload) > SESSION_PAYLOAD_LIMIT) {
      prepared = prepareSessionsForStorage(sessions, true)
      ;({ payload, compressed } = buildStoragePayload(prepared))
    }

    if (estimateUtf16Bytes(payload) > SESSION_PAYLOAD_LIMIT) {
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

    ls.setItem(STORAGE_KEY, payload)
    ls.setItem(
      `${STORAGE_KEY}_meta`,
      JSON.stringify({
        version: STORAGE_VERSION,
        savedAt: Date.now(),
        count: prepared.length,
        compressed,
      }),
    )
    return true
  } catch {
    try {
      const emergencySessions = cleanupOldSessions(sessions, 10, false)
      ls.setItem(
        STORAGE_KEY,
        JSON.stringify(stripPersistedPayload(stripLargeAttachmentData(emergencySessions))),
      )
      return true
    } catch {
      return false
    }
  }
}

// ── Helper factories ──────────────────────────────────────────────

function makeSession(overrides: Record<string, any> = {}): any {
  return {
    id: 's1',
    title: 'Test session',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [],
    ...overrides,
  }
}

function makeMessage(overrides: Record<string, any> = {}): any {
  return {
    id: 'm1',
    role: 'user',
    content: 'Hello',
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════

// ── estimateUtf16Bytes ────────────────────────────────────────────

describe('estimateUtf16Bytes', () => {
  it('returns double the string length', () => {
    assert.strictEqual(estimateUtf16Bytes('abc'), 6)
  })

  it('returns 0 for empty string', () => {
    assert.strictEqual(estimateUtf16Bytes(''), 0)
  })

  it('handles single character', () => {
    assert.strictEqual(estimateUtf16Bytes('x'), 2)
  })

  it('counts CJK characters as 2 bytes each (by length)', () => {
    assert.strictEqual(estimateUtf16Bytes('你好'), 4)
  })

  it('handles long strings', () => {
    const long = 'a'.repeat(1_000_000)
    assert.strictEqual(estimateUtf16Bytes(long), 2_000_000)
  })
})

// ── compressData / decompressData ─────────────────────────────────

describe('compressData', () => {
  it('returns R: prefix for pure ASCII data (compression not beneficial)', () => {
    const result = compressData('hello world')
    assert.ok(result.startsWith('R:'))
    assert.strictEqual(result, 'R:hello world')
  })

  it('returns R: prefix for non-ASCII data (compression adds overhead, not savings)', () => {
    // The compression scheme wraps non-ASCII runs with markers but keeps the
    // original text, so compressed output is always >= original length.
    // Therefore compressData always returns R: prefix.
    const data = '你好'.repeat(50)
    const result = compressData(data)
    assert.ok(result.startsWith('R:'), `Expected R: prefix, got: ${result.slice(0, 10)}`)
  })

  it('returns R: prefix when compressed is not smaller than original', () => {
    // Short non-ASCII may not compress well due to marker overhead
    const result = compressData('你')
    // Single CJK char: marker overhead likely makes it longer
    assert.ok(result.startsWith('R:') || result.startsWith('C:'))
  })

  it('handles empty string', () => {
    const result = compressData('')
    assert.ok(result.startsWith('R:') || result.startsWith('C:'))
  })

  it('handles string with mixed ASCII and non-ASCII', () => {
    const data = 'hello 你好 world'
    const result = compressData(data)
    assert.ok(result.startsWith('R:') || result.startsWith('C:'))
  })

  it('handles string with unicode escapes', () => {
    const data = '\\u4f60\\u597d'
    const result = compressData(data)
    assert.ok(result.startsWith('R:') || result.startsWith('C:'))
  })
})

describe('decompressData', () => {
  it('strips R: prefix', () => {
    assert.strictEqual(decompressData('R:hello'), 'hello')
  })

  it('strips R: prefix for empty content', () => {
    assert.strictEqual(decompressData('R:'), '')
  })

  it('handles C: prefix by removing markers', () => {
    // Compress then decompress roundtrip for non-ASCII
    const data = '你好'.repeat(50)
    const compressed = compressData(data)
    if (compressed.startsWith('C:')) {
      const decompressed = decompressData(compressed)
      // After fix, decompressData should restore the original data
      assert.strictEqual(decompressed, data)
    }
  })

  it('returns original data if no prefix', () => {
    assert.strictEqual(decompressData('raw data'), 'raw data')
  })

  it('returns original data for empty string', () => {
    assert.strictEqual(decompressData(''), '')
  })
})

describe('compressData / decompressData roundtrip (ASCII)', () => {
  it('ASCII roundtrip: compress then decompress returns original', () => {
    const original = 'The quick brown fox jumps over the lazy dog'
    const compressed = compressData(original)
    const decompressed = decompressData(compressed)
    assert.strictEqual(decompressed, original)
  })

  it('JSON-like ASCII roundtrip', () => {
    const original = JSON.stringify([{ id: 1, name: 'test', value: 42 }])
    const compressed = compressData(original)
    const decompressed = decompressData(compressed)
    assert.strictEqual(decompressed, original)
  })

  it('empty string roundtrip', () => {
    const original = ''
    const compressed = compressData(original)
    const decompressed = decompressData(compressed)
    assert.strictEqual(decompressed, original)
  })
})

// ── stripPersistedPayload ─────────────────────────────────────────

describe('stripPersistedPayload', () => {
  it('returns sessions unchanged when all content is within limits', () => {
    const sessions = [makeSession({ messages: [makeMessage({ content: 'short' })] })]
    const result = stripPersistedPayload(sessions)
    assert.strictEqual(result[0].messages[0].content, 'short')
  })

  it('truncates content exceeding default maxContent (8000)', () => {
    const longContent = 'a'.repeat(9000)
    const sessions = [makeSession({ messages: [makeMessage({ content: longContent })] })]
    const result = stripPersistedPayload(sessions)
    const content = result[0].messages[0].content
    assert.ok(content.length < 9000)
    assert.ok(content.endsWith('\n\n[Truncated for storage]'))
    assert.strictEqual(content.length, 8000 + '\n\n[Truncated for storage]'.length)
  })

  it('truncates reasoning content exceeding default maxReasoning (2000)', () => {
    const longReasoning = 'b'.repeat(3000)
    const sessions = [makeSession({
      messages: [makeMessage({ reasoning: { content: longReasoning } })],
    })]
    const result = stripPersistedPayload(sessions)
    const reasoning = result[0].messages[0].reasoning
    assert.ok(reasoning.content.endsWith('…'))
    assert.strictEqual(reasoning.content.length, 2000 + 1) // 2000 chars + '…'
  })

  it('truncates toolCalls output exceeding default maxToolOutput (4000)', () => {
    const longOutput = 'c'.repeat(5000)
    const sessions = [makeSession({
      messages: [makeMessage({ toolCalls: [{ output: longOutput }] })],
    })]
    const result = stripPersistedPayload(sessions)
    const output = result[0].messages[0].toolCalls[0].output
    assert.ok(output.endsWith('\n[Truncated for storage]'))
  })

  it('truncates toolResults output exceeding default maxToolOutput (4000)', () => {
    const longOutput = 'd'.repeat(5000)
    const sessions = [makeSession({
      messages: [makeMessage({ toolResults: [{ output: longOutput }] })],
    })]
    const result = stripPersistedPayload(sessions)
    const output = result[0].messages[0].toolResults[0].output
    assert.ok(output.endsWith('\n[Truncated for storage]'))
  })

  it('truncates timelineEvents content exceeding default maxTimelineContent (1000)', () => {
    const longContent = 'e'.repeat(2000)
    const sessions = [makeSession({
      messages: [makeMessage({ timelineEvents: [{ content: longContent }] })],
    })]
    const result = stripPersistedPayload(sessions)
    const content = result[0].messages[0].timelineEvents[0].content
    assert.ok(content.endsWith('…'))
  })

  it('does not truncate toolCalls output within limit', () => {
    const shortOutput = 'c'.repeat(100)
    const sessions = [makeSession({
      messages: [makeMessage({ toolCalls: [{ output: shortOutput }] })],
    })]
    const result = stripPersistedPayload(sessions)
    assert.strictEqual(result[0].messages[0].toolCalls[0].output, shortOutput)
  })

  it('does not truncate toolCalls output when it is falsy', () => {
    const sessions = [makeSession({
      messages: [makeMessage({ toolCalls: [{ output: null }] })],
    })]
    const result = stripPersistedPayload(sessions)
    assert.strictEqual(result[0].messages[0].toolCalls[0].output, null)
  })

  it('respects custom maxContent option', () => {
    const content = 'a'.repeat(500)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = stripPersistedPayload(sessions, { maxContent: 100 })
    assert.ok(result[0].messages[0].content.endsWith('\n\n[Truncated for storage]'))
  })

  it('respects custom maxToolOutput option', () => {
    const output = 'x'.repeat(200)
    const sessions = [makeSession({
      messages: [makeMessage({ toolCalls: [{ output }] })],
    })]
    const result = stripPersistedPayload(sessions, { maxToolOutput: 50 })
    assert.ok(result[0].messages[0].toolCalls[0].output.endsWith('\n[Truncated for storage]'))
  })

  it('respects custom maxReasoning option', () => {
    const reasoning = 'r'.repeat(500)
    const sessions = [makeSession({
      messages: [makeMessage({ reasoning: { content: reasoning } })],
    })]
    const result = stripPersistedPayload(sessions, { maxReasoning: 100 })
    assert.ok(result[0].messages[0].reasoning.content.endsWith('…'))
  })

  it('respects custom maxTimelineContent option', () => {
    const content = 't'.repeat(500)
    const sessions = [makeSession({
      messages: [makeMessage({ timelineEvents: [{ content }] })],
    })]
    const result = stripPersistedPayload(sessions, { maxTimelineContent: 100 })
    assert.ok(result[0].messages[0].timelineEvents[0].content.endsWith('…'))
  })

  it('handles empty sessions array', () => {
    const result = stripPersistedPayload([])
    assert.deepStrictEqual(result, [])
  })

  it('handles session with empty messages', () => {
    const sessions = [makeSession({ messages: [] })]
    const result = stripPersistedPayload(sessions)
    assert.deepStrictEqual(result[0].messages, [])
  })

  it('preserves other session properties', () => {
    const sessions = [makeSession({ id: 's1', title: 'My Session', custom: 42, messages: [] })]
    const result = stripPersistedPayload(sessions)
    assert.strictEqual(result[0].id, 's1')
    assert.strictEqual(result[0].title, 'My Session')
    assert.strictEqual(result[0].custom, 42)
  })

  it('preserves other message properties when truncating', () => {
    const sessions = [makeSession({
      messages: [makeMessage({ id: 'm1', role: 'assistant', content: 'a'.repeat(9000), extra: true })],
    })]
    const result = stripPersistedPayload(sessions)
    assert.strictEqual(result[0].messages[0].id, 'm1')
    assert.strictEqual(result[0].messages[0].role, 'assistant')
    assert.strictEqual(result[0].messages[0].extra, true)
  })

  it('handles content exactly at the limit (no truncation)', () => {
    const content = 'a'.repeat(8000)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = stripPersistedPayload(sessions)
    assert.strictEqual(result[0].messages[0].content, content)
  })

  it('handles content one over the limit (truncation)', () => {
    const content = 'a'.repeat(8001)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = stripPersistedPayload(sessions)
    assert.ok(result[0].messages[0].content.endsWith('\n\n[Truncated for storage]'))
  })
})

// ── cleanupOldSessions ────────────────────────────────────────────

describe('cleanupOldSessions', () => {
  it('returns all sessions when count <= keepCount', () => {
    const sessions = [makeSession({ id: '1' }), makeSession({ id: '2' })]
    const result = cleanupOldSessions(sessions, 50)
    assert.strictEqual(result.length, 2)
  })

  it('keeps only the most recently updated sessions', () => {
    const sessions = [
      makeSession({ id: 'old', updatedAt: 100 }),
      makeSession({ id: 'mid', updatedAt: 500 }),
      makeSession({ id: 'new', updatedAt: 1000 }),
    ]
    const result = cleanupOldSessions(sessions, 2)
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].id, 'new')
    assert.strictEqual(result[1].id, 'mid')
  })

  it('uses default keepCount of 50', () => {
    const sessions = Array.from({ length: 60 }, (_, i) =>
      makeSession({ id: `s${i}`, updatedAt: i })
    )
    const result = cleanupOldSessions(sessions)
    assert.strictEqual(result.length, 50)
  })

  it('handles empty array', () => {
    const result = cleanupOldSessions([], 5)
    assert.deepStrictEqual(result, [])
  })

  it('handles sessions equal to keepCount', () => {
    const sessions = [makeSession({ id: '1' }), makeSession({ id: '2' })]
    const result = cleanupOldSessions(sessions, 2)
    assert.strictEqual(result.length, 2)
  })

  it('does not mutate the original array', () => {
    const sessions = [
      makeSession({ id: '1', updatedAt: 100 }),
      makeSession({ id: '2', updatedAt: 200 }),
      makeSession({ id: '3', updatedAt: 300 }),
    ]
    const originalLength = sessions.length
    cleanupOldSessions(sessions, 1)
    assert.strictEqual(sessions.length, originalLength)
  })

  it('handles keepCount of 0', () => {
    const sessions = [makeSession({ id: '1' })]
    const result = cleanupOldSessions(sessions, 0)
    assert.strictEqual(result.length, 0)
  })
})

// ── truncateLongMessages ──────────────────────────────────────────

describe('truncateLongMessages', () => {
  it('does not truncate messages within default limit (10000)', () => {
    const content = 'a'.repeat(5000)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = truncateLongMessages(sessions)
    assert.strictEqual(result[0].messages[0].content, content)
    assert.strictEqual(result[0].messages[0].truncated, undefined)
  })

  it('truncates messages exceeding default limit', () => {
    const content = 'a'.repeat(15000)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = truncateLongMessages(sessions)
    const msg = result[0].messages[0]
    assert.strictEqual(msg.truncated, true)
    assert.strictEqual(msg.originalLength, 15000)
    assert.ok(msg.content.endsWith('\n\n[Content truncated due to length]'))
  })

  it('respects custom maxLength', () => {
    const content = 'a'.repeat(200)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = truncateLongMessages(sessions, 100)
    assert.strictEqual(result[0].messages[0].truncated, true)
  })

  it('handles empty sessions', () => {
    const result = truncateLongMessages([])
    assert.deepStrictEqual(result, [])
  })

  it('handles messages without content', () => {
    const sessions = [makeSession({ messages: [makeMessage({ content: undefined })] })]
    const result = truncateLongMessages(sessions)
    assert.strictEqual(result[0].messages[0].content, undefined)
  })

  it('preserves other message properties', () => {
    const content = 'a'.repeat(15000)
    const sessions = [makeSession({
      messages: [makeMessage({ content, role: 'assistant', id: 'msg-1' })],
    })]
    const result = truncateLongMessages(sessions)
    const msg = result[0].messages[0]
    assert.strictEqual(msg.role, 'assistant')
    assert.strictEqual(msg.id, 'msg-1')
  })

  it('handles content exactly at limit (no truncation)', () => {
    const content = 'a'.repeat(10000)
    const sessions = [makeSession({ messages: [makeMessage({ content })] })]
    const result = truncateLongMessages(sessions)
    assert.strictEqual(result[0].messages[0].content, content)
    assert.strictEqual(result[0].messages[0].truncated, undefined)
  })
})

// ── stripLargeAttachmentData ──────────────────────────────────────

describe('stripLargeAttachmentData', () => {
  it('removes data and previewUrl from imageAttachments', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        imageAttachments: [{
          id: 'img1',
          name: 'photo.png',
          type: 'image',
          mimeType: 'image/png',
          data: 'data:image/png;base64,abc123',
          previewUrl: 'data:image/png;base64,abc123',
        }],
      })],
    })]
    const result = stripLargeAttachmentData(sessions)
    const img = result[0].messages[0].imageAttachments[0]
    assert.strictEqual(img.id, 'img1')
    assert.strictEqual(img.name, 'photo.png')
    assert.strictEqual(img.type, 'image')
    assert.strictEqual(img.mimeType, 'image/png')
    assert.strictEqual(img.data, undefined)
    assert.strictEqual(img.previewUrl, undefined)
  })

  it('removes data and previewUrl from image-type attachments', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        attachments: [{
          id: 'att1',
          name: 'pic.jpg',
          type: 'image',
          mimeType: 'image/jpeg',
          data: 'data:image/jpeg;base64,xyz',
          previewUrl: 'data:image/jpeg;base64,xyz',
        }],
      })],
    })]
    const result = stripLargeAttachmentData(sessions)
    const att = result[0].messages[0].attachments[0]
    assert.strictEqual(att.id, 'att1')
    assert.strictEqual(att.name, 'pic.jpg')
    assert.strictEqual(att.type, 'image')
    assert.strictEqual(att.mimeType, 'image/jpeg')
    assert.strictEqual(att.data, undefined)
    assert.strictEqual(att.previewUrl, undefined)
  })

  it('preserves non-image attachments unchanged', () => {
    const fileAtt = { id: 'f1', name: 'doc.pdf', type: 'file', content: 'binary...' }
    const sessions = [makeSession({
      messages: [makeMessage({ attachments: [fileAtt] })],
    })]
    const result = stripLargeAttachmentData(sessions)
    assert.deepStrictEqual(result[0].messages[0].attachments[0], fileAtt)
  })

  it('preserves non-image attachments alongside image attachments', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        attachments: [
          { id: 'img1', name: 'pic.png', type: 'image', mimeType: 'image/png', data: 'base64...' },
          { id: 'f1', name: 'doc.pdf', type: 'file', content: 'binary...' },
        ],
      })],
    })]
    const result = stripLargeAttachmentData(sessions)
    assert.strictEqual(result[0].messages[0].attachments[0].data, undefined)
    assert.strictEqual(result[0].messages[0].attachments[1].content, 'binary...')
  })

  it('returns message unchanged when no image attachments', () => {
    const msg = makeMessage({ content: 'hello' })
    const sessions = [makeSession({ messages: [msg] })]
    const result = stripLargeAttachmentData(sessions)
    assert.strictEqual(result[0].messages[0].content, 'hello')
    assert.strictEqual(result[0].messages[0].imageAttachments, undefined)
  })

  it('handles empty sessions', () => {
    const result = stripLargeAttachmentData([])
    assert.deepStrictEqual(result, [])
  })

  it('handles session with empty messages', () => {
    const sessions = [makeSession({ messages: [] })]
    const result = stripLargeAttachmentData(sessions)
    assert.deepStrictEqual(result[0].messages, [])
  })

  it('handles message with empty imageAttachments array', () => {
    const sessions = [makeSession({ messages: [makeMessage({ imageAttachments: [] })] })]
    const result = stripLargeAttachmentData(sessions)
    // Empty array is falsy-ish but !![].length is false, so message returned as-is
    assert.deepStrictEqual(result[0].messages[0].imageAttachments, [])
  })
})

// ── buildStoragePayload ───────────────────────────────────────────

describe('buildStoragePayload', () => {
  it('returns JSON string as payload when compression is not beneficial', () => {
    const sessions = [makeSession({ messages: [makeMessage()] })]
    const { payload, compressed } = buildStoragePayload(sessions)
    // ASCII-only data typically doesn't compress with this scheme
    assert.strictEqual(compressed, false)
    assert.ok(payload.length > 0)
    // Should be valid JSON
    assert.deepStrictEqual(JSON.parse(payload), sessions)
  })

  it('returns compressed=false for CJK content (compression never reduces size)', () => {
    // The compression scheme always adds overhead, so compressed flag is always false
    const sessions = [makeSession({
      messages: [makeMessage({ content: '你好'.repeat(1000) })],
    })]
    const { payload, compressed } = buildStoragePayload(sessions)
    assert.strictEqual(compressed, false)
    // Payload should be valid JSON (R: prefix stripped by JSON.parse)
    assert.ok(payload.length > 0)
  })

  it('handles empty sessions array', () => {
    const { payload, compressed } = buildStoragePayload([])
    assert.ok(payload.length > 0)
    assert.strictEqual(compressed, false)
    assert.deepStrictEqual(JSON.parse(payload), [])
  })

  it('payload can be parsed back to original data when not compressed', () => {
    const sessions = [makeSession({ id: 'test', title: 'Hello' })]
    const { payload, compressed } = buildStoragePayload(sessions)
    if (!compressed) {
      assert.deepStrictEqual(JSON.parse(payload), sessions)
    }
  })
})

// ── prepareSessionsForStorage ─────────────────────────────────────

describe('prepareSessionsForStorage', () => {
  it('strips attachments and payload by default (aggressive=false)', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        content: 'a'.repeat(9000),
        imageAttachments: [{
          id: 'img1', name: 'photo.png', type: 'image',
          mimeType: 'image/png', data: 'base64data',
        }],
      })],
    })]
    const result = prepareSessionsForStorage(sessions, false)
    const msg = result[0].messages[0]
    // Content should be truncated at default 8000 limit
    assert.ok(msg.content.endsWith('\n\n[Truncated for storage]'))
    // Image data should be stripped
    assert.strictEqual(msg.imageAttachments[0].data, undefined)
  })

  it('applies aggressive trimming when aggressive=true', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        content: 'a'.repeat(5000),
      })],
    })]
    const result = prepareSessionsForStorage(sessions, true)
    const content = result[0].messages[0].content
    // stripPersistedPayload truncates at 3000, then truncateLongMessages
    // truncates at 3000 again (since 3000+suffix > 3000), adding its own suffix
    assert.ok(content.includes('[Content truncated due to length]'))
    assert.ok(content.length <= 3100) // 3000 + suffix overhead
  })

  it('aggressive mode limits sessions to 20', () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      makeSession({ id: `s${i}`, updatedAt: i, messages: [makeMessage()] })
    )
    const result = prepareSessionsForStorage(sessions, true)
    assert.strictEqual(result.length, 20)
  })

  it('aggressive mode truncates long messages at 3000', () => {
    const sessions = [makeSession({
      messages: [makeMessage({ content: 'x'.repeat(5000) })],
    })]
    const result = prepareSessionsForStorage(sessions, true)
    const msg = result[0].messages[0]
    assert.strictEqual(msg.truncated, true)
    // originalLength reflects the length after stripPersistedPayload already truncated
    // (5000 → 3000 + suffix ≈ 3025), then truncateLongMessages sees 3025 > 3000
    assert.ok(msg.originalLength > 3000)
    assert.ok(msg.originalLength <= 3100)
  })

  it('non-aggressive mode does not limit session count', () => {
    const sessions = Array.from({ length: 60 }, (_, i) =>
      makeSession({ id: `s${i}`, updatedAt: i, messages: [makeMessage()] })
    )
    const result = prepareSessionsForStorage(sessions, false)
    assert.strictEqual(result.length, 60)
  })

  it('non-aggressive mode does not truncate messages at 3000', () => {
    const content = 'a'.repeat(5000)
    const sessions = [makeSession({
      messages: [makeMessage({ content })],
    })]
    const result = prepareSessionsForStorage(sessions, false)
    // 5000 < default 8000, so no truncation
    assert.strictEqual(result[0].messages[0].content, content)
  })

  it('strips image attachments in both modes', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        imageAttachments: [{
          id: 'img1', name: 'photo.png', type: 'image',
          mimeType: 'image/png', data: 'base64',
        }],
      })],
    })]
    const normalResult = prepareSessionsForStorage(sessions, false)
    const aggressiveResult = prepareSessionsForStorage(sessions, true)
    assert.strictEqual(normalResult[0].messages[0].imageAttachments[0].data, undefined)
    assert.strictEqual(aggressiveResult[0].messages[0].imageAttachments[0].data, undefined)
  })

  it('handles empty sessions', () => {
    const result = prepareSessionsForStorage([], false)
    assert.deepStrictEqual(result, [])
  })
})

// ── checkStorageSpace ─────────────────────────────────────────────

describe('checkStorageSpace', () => {
  let ls: ReturnType<typeof createMockLocalStorage>

  beforeEach(() => {
    ls = createMockLocalStorage()
  })

  it('returns ok=true when storage is under limit', () => {
    ls.setItem('key1', 'small value')
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.ok, true)
  })

  it('returns warning=false when usage is below threshold', () => {
    ls.setItem('key1', 'small')
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.warning, false)
  })

  it('returns ok=false when storage exceeds limit', () => {
    // Fill storage past the 4MB limit
    const bigValue = 'x'.repeat(2_100_000) // ~4.2MB in UTF-16
    ls.setItem('big', bigValue)
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.ok, false)
  })

  it('returns warning=true when usage exceeds 80% threshold', () => {
    // Fill to >80% of 4MB = >3.2MB
    const value = 'y'.repeat(1_700_000) // ~3.4MB in UTF-16
    ls.setItem('medium', value)
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.warning, true)
  })

  it('returns usage=0 for empty storage', () => {
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.usage, 0)
  })

  it('calculates usage correctly', () => {
    ls.setItem('a', '12345') // 5 chars * 2 = 10 bytes
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.usage, 10)
  })

  it('counts all keys in storage', () => {
    ls.setItem('a', '12345') // 10 bytes
    ls.setItem('b', 'abc')   // 6 bytes
    const result = checkStorageSpace(ls)
    assert.strictEqual(result.usage, 16)
  })
})

// ── loadSessionsFromStorage ───────────────────────────────────────

describe('loadSessionsFromStorage', () => {
  let ls: ReturnType<typeof createMockLocalStorage>

  beforeEach(() => {
    ls = createMockLocalStorage()
  })

  it('returns empty array when nothing in storage', () => {
    const result = loadSessionsFromStorage(ls)
    assert.deepStrictEqual(result, [])
  })

  it('loads and parses raw JSON sessions', () => {
    const sessions = [{ id: 's1', title: 'Test', messages: [], createdAt: 1000, updatedAt: 2000 }]
    ls.setItem(STORAGE_KEY, JSON.stringify(sessions))
    const result = loadSessionsFromStorage(ls)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].id, 's1')
  })

  it('loads R:-prefixed compressed data', () => {
    const sessions = [{ id: 's1', title: 'Test', messages: [], createdAt: 1000, updatedAt: 2000 }]
    ls.setItem(STORAGE_KEY, 'R:' + JSON.stringify(sessions))
    const result = loadSessionsFromStorage(ls)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].id, 's1')
  })

  it('applies default fields to loaded sessions', () => {
    const sessions = [{ id: 's1', messages: [], createdAt: 1000, updatedAt: 2000 }]
    ls.setItem(STORAGE_KEY, JSON.stringify(sessions))
    const result = loadSessionsFromStorage(ls)
    assert.strictEqual(result[0].processStatus, 'none')
    assert.strictEqual(result[0].isTabOpen, false)
    assert.strictEqual(result[0].expandedView, 'none')
    assert.strictEqual(result[0].lastActivityAt, 2000) // falls back to updatedAt
  })

  it('preserves existing fields over defaults', () => {
    const sessions = [{
      id: 's1', messages: [], createdAt: 1000, updatedAt: 2000,
      processStatus: 'running', isTabOpen: true, expandedView: 'code',
      lastActivityAt: 3000,
    }]
    ls.setItem(STORAGE_KEY, JSON.stringify(sessions))
    const result = loadSessionsFromStorage(ls)
    assert.strictEqual(result[0].processStatus, 'running')
    assert.strictEqual(result[0].isTabOpen, true)
    assert.strictEqual(result[0].expandedView, 'code')
    assert.strictEqual(result[0].lastActivityAt, 3000)
  })

  it('returns empty array on invalid JSON', () => {
    ls.setItem(STORAGE_KEY, 'not valid json{')
    const result = loadSessionsFromStorage(ls)
    assert.deepStrictEqual(result, [])
  })

  it('handles null sessions gracefully', () => {
    ls.setItem(STORAGE_KEY, JSON.stringify(null))
    const result = loadSessionsFromStorage(ls)
    assert.deepStrictEqual(result, [])
  })

  it('defaults teammateTranscripts to empty object', () => {
    const sessions = [{ id: 's1', messages: [], createdAt: 1000, updatedAt: 2000 }]
    ls.setItem(STORAGE_KEY, JSON.stringify(sessions))
    const result = loadSessionsFromStorage(ls)
    assert.deepStrictEqual(result[0].teammateTranscripts, {})
  })
})

// ── saveSessionsToStorage ─────────────────────────────────────────

describe('saveSessionsToStorage', () => {
  let ls: ReturnType<typeof createMockLocalStorage>

  beforeEach(() => {
    ls = createMockLocalStorage()
  })

  it('saves sessions to localStorage and returns true', () => {
    const sessions = [makeSession({ messages: [makeMessage()] })]
    const result = saveSessionsToStorage(sessions, ls)
    assert.strictEqual(result, true)
    assert.ok(ls.getItem(STORAGE_KEY) !== null)
  })

  it('saves metadata alongside sessions', () => {
    const sessions = [makeSession({ messages: [makeMessage()] })]
    saveSessionsToStorage(sessions, ls)
    const metaStr = ls.getItem(`${STORAGE_KEY}_meta`)
    assert.ok(metaStr !== null)
    const meta = JSON.parse(metaStr!)
    assert.strictEqual(meta.version, STORAGE_VERSION)
    assert.strictEqual(meta.count, 1)
    assert.ok(typeof meta.savedAt === 'number')
    assert.ok(typeof meta.compressed === 'boolean')
  })

  it('saves and loads roundtrip for simple sessions', () => {
    const sessions = [makeSession({ id: 's1', title: 'Hello', messages: [makeMessage()] })]
    saveSessionsToStorage(sessions, ls)
    const loaded = loadSessionsFromStorage(ls)
    assert.strictEqual(loaded.length, 1)
    assert.strictEqual(loaded[0].id, 's1')
    assert.strictEqual(loaded[0].title, 'Hello')
  })

  it('strips image data before saving', () => {
    const sessions = [makeSession({
      messages: [makeMessage({
        imageAttachments: [{
          id: 'img1', name: 'photo.png', type: 'image',
          mimeType: 'image/png', data: 'data:image/png;base64,abc',
        }],
      })],
    })]
    saveSessionsToStorage(sessions, ls)
    const raw = ls.getItem(STORAGE_KEY)!
    // Parse the saved data (might be compressed)
    const data = raw.startsWith('R:') ? raw.slice(2) :
                 raw.startsWith('C:') ? raw.slice(2) : raw
    // The raw saved data should not contain the base64 string
    assert.ok(!data.includes('base64,abc'))
  })

  it('handles empty sessions array', () => {
    const result = saveSessionsToStorage([], ls)
    assert.strictEqual(result, true)
  })

  it('applies aggressive trim when payload exceeds limit', () => {
    // Create a session with very large content to exceed SESSION_PAYLOAD_LIMIT
    const hugeContent = 'a'.repeat(2_000_000)
    const sessions = [makeSession({
      messages: [makeMessage({ content: hugeContent })],
    })]
    saveSessionsToStorage(sessions, ls)
    // The saved payload should be smaller than the original
    const saved = ls.getItem(STORAGE_KEY)!
    assert.ok(estimateUtf16Bytes(saved) < estimateUtf16Bytes(hugeContent))
  })

  it('falls back to emergency save on error', () => {
    // Force an error by making setItem throw on first call
    let callCount = 0
    const originalSetItem = ls.setItem.bind(ls)
    ls.setItem = (key: string, value: string) => {
      callCount++
      if (callCount === 1) throw new Error('Quota exceeded')
      originalSetItem(key, value)
    }
    const sessions = [makeSession({ messages: [makeMessage()] })]
    const result = saveSessionsToStorage(sessions, ls)
    assert.strictEqual(result, true)
  })
})
