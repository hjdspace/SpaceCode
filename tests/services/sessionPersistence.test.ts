/**
 * Storage-encoding and session-persistence tests.
 *
 * These exercise `src/services/sessionPersistence.ts` through its exported
 * interface — the same seam the app crosses. They assert observable outcomes
 * (what comes back out), not internal state, so they survive refactors of the
 * trimming and encoding internals.
 *
 * Replaces a 1183-line "transcript" test that defined nine local copies of
 * these functions and asserted against the copies. See docs/adr/0011.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  PROJECTS_KEY,
  STORAGE_KEY,
  buildStoragePayload,
  checkStorageSpace,
  cleanupOldSessions,
  compressData,
  decompressData,
  estimateUtf16Bytes,
  getStorageStats,
  getStorageUsage,
  loadProjectsFromStorage,
  loadSessionsFromStorage,
  prepareSessionsForStorage,
  saveProjectsToStorage,
  saveSessionsToStorage,
  setPersistenceLogger,
  stripLargeAttachmentData,
  stripPersistedPayload,
  truncateLongMessages,
} from '@/services/sessionPersistence'
import type { ImageAttachment, Message, Session } from '@/types'

// Silence the module logger so maintenance logs don't pollute test output.
beforeEach(() => {
  localStorage.clear()
  setPersistenceLogger({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  })
})

function message(overrides: Partial<Message> = {}): Message {
  return { id: 'm1', role: 'user', content: 'hello', timestamp: 1, ...overrides }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Session',
    messages: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    workingDirectory: 'D:/repo',
    processStatus: 'none',
    isTabOpen: false,
    lastActivityAt: 1_000,
    mode: 'code',
    ...overrides,
  }
}

function imageAttachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    id: 'img1',
    name: 'shot.png',
    type: 'image',
    mimeType: 'image/png',
    previewUrl: 'data:image/png;base64,PREVIEW'.repeat(20),
    data: 'BASE64PAYLOAD'.repeat(200),
    ...overrides,
  }
}

describe('estimateUtf16Bytes', () => {
  it('counts two bytes per UTF-16 code unit', () => {
    expect(estimateUtf16Bytes('')).toBe(0)
    expect(estimateUtf16Bytes('abc')).toBe(6)
    expect(estimateUtf16Bytes('中文')).toBe(4)
  })

  it('counts an astral character as a surrogate pair', () => {
    // '😀' is one code point but two UTF-16 code units.
    expect('😀'.length).toBe(2)
    expect(estimateUtf16Bytes('😀')).toBe(4)
  })
})

describe('compressData / decompressData', () => {
  const samples: Array<[string, string]> = [
    ['ascii', 'plain ascii payload'],
    ['cjk', '中文内容'.repeat(50)],
    ['mixed', 'abc中文def日本語ghi'],
    ['escaped unicode', 'value=\\u4e2d\\u6587'],
    ['emoji', '😀🎉'.repeat(20)],
    ['json-ish', JSON.stringify([{ id: 'a', title: '标题' }])],
  ]

  it.each(samples)('round-trips %s losslessly', (_label, text) => {
    expect(decompressData(compressData(text))).toBe(text)
  })

  it('tags the encoded payload with a recognisable marker', () => {
    const encoded = compressData('中文内容')
    expect(encoded.startsWith('C:') || encoded.startsWith('R:')).toBe(true)
  })

  it('is idempotent under repeated decode of an untagged payload', () => {
    expect(decompressData('no marker here')).toBe('no marker here')
  })
})

describe('buildStoragePayload', () => {
  it('encodes a payload that decodes back to the original sessions', () => {
    const sessions = [session({ messages: [message({ content: '中文与 ascii 混合' })] })]

    const { payload } = buildStoragePayload(sessions)

    expect(JSON.parse(decompressData(payload))).toEqual(sessions)
  })

  it('reports compressed=true only when the payload actually pays for itself', () => {
    const sessions = [session({ messages: [message({ content: '中'.repeat(5_000) })] })]

    const { payload, compressed } = buildStoragePayload(sessions)

    // Invariant rather than a pinned value: if the encoder ever engages, the
    // payload must be smaller than the raw JSON it replaces. Today the encoder
    // never wins, so this passes with compressed === false.
    if (compressed) {
      expect(payload.length).toBeLessThan(JSON.stringify(sessions).length)
    } else {
      expect(payload).toBe(JSON.stringify(sessions))
    }
  })
})

describe('stripPersistedPayload', () => {
  it('truncates oversized message content with the storage marker', () => {
    const long = 'x'.repeat(9_000)
    const [out] = stripPersistedPayload([session({ messages: [message({ content: long })] })])

    expect(out.messages[0].content).toHaveLength(8_000 + '\n\n[Truncated for storage]'.length)
    expect(out.messages[0].content.endsWith('\n\n[Truncated for storage]')).toBe(true)
    expect(out.messages[0].content.startsWith('xxx')).toBe(true)
  })

  it('leaves content within the limit untouched', () => {
    const content = 'y'.repeat(8_000)
    const [out] = stripPersistedPayload([session({ messages: [message({ content })] })])

    expect(out.messages[0].content).toBe(content)
  })

  it('honours a custom content limit', () => {
    const [out] = stripPersistedPayload(
      [session({ messages: [message({ content: 'z'.repeat(100) })] })],
      { maxContent: 10 },
    )

    expect(out.messages[0].content).toBe('z'.repeat(10) + '\n\n[Truncated for storage]')
  })

  it('truncates tool output, tool results, reasoning and timeline content', () => {
    const [out] = stripPersistedPayload([
      session({
        messages: [
          message({
            content: 'short',
            reasoning: { content: 'r'.repeat(3_000), startTime: 0 },
            toolCalls: [
              { id: 'tc1', name: 'Read', input: {}, status: 'completed', output: 'o'.repeat(5_000) },
            ],
            toolResults: [{ id: 'tr1', output: 'p'.repeat(5_000) }],
            timelineEvents: [
              { id: 'te1', type: 'text', timestamp: 1, status: 'completed', content: 'e'.repeat(2_000) },
            ],
          }),
        ],
      }),
    ])

    const msg = out.messages[0]
    expect(msg.reasoning?.content).toHaveLength(2_000 + '…'.length)
    expect(msg.reasoning?.content.endsWith('…')).toBe(true)
    expect(msg.toolCalls?.[0].output).toHaveLength(4_000 + '\n[Truncated for storage]'.length)
    expect(msg.toolResults?.[0].output.endsWith('\n[Truncated for storage]')).toBe(true)
    expect(msg.timelineEvents?.[0].content).toHaveLength(1_000 + '…'.length)
    expect(msg.content).toBe('short')
  })

  it('does not mutate the sessions passed in', () => {
    const content = 'x'.repeat(9_000)
    const input = [session({ messages: [message({ content })] })]

    stripPersistedPayload(input)

    expect(input[0].messages[0].content).toBe(content)
    expect(input[0].messages[0].content).toHaveLength(9_000)
  })
})

describe('stripLargeAttachmentData', () => {
  it('drops the base64 fields from imageAttachments but keeps identity', () => {
    const image = imageAttachment()
    const [out] = stripLargeAttachmentData([
      session({ messages: [message({ imageAttachments: [image] })] }),
    ])

    const stripped = out.messages[0].imageAttachments?.[0] as Record<string, unknown>
    expect(stripped['data']).toBeUndefined()
    expect(stripped['previewUrl']).toBeUndefined()
    expect(stripped['id']).toBe(image.id)
    expect(stripped['name']).toBe(image.name)
    expect(stripped['mimeType']).toBe(image.mimeType)
  })

  it('strips image-type entries in attachments and leaves other attachments alone', () => {
    const image = imageAttachment()
    const file = { name: 'a.ts', path: 'D:/repo/a.ts', isFolder: false }
    const [out] = stripLargeAttachmentData([
      session({ messages: [message({ attachments: [image, file] })] }),
    ])

    const attachments = out.messages[0].attachments ?? []
    expect(attachments).toHaveLength(2)
    expect(attachments[0]).not.toHaveProperty('data')
    expect(attachments[1]).toEqual(file)
  })

  it('returns messages without images unchanged', () => {
    const msg = message({ content: 'no images' })
    const [out] = stripLargeAttachmentData([session({ messages: [msg] })])

    expect(out.messages[0]).toBe(msg)
  })
})

describe('prepareSessionsForStorage', () => {
  const fixture = (): Session[] => [
    session({
      id: 'big',
      updatedAt: 2_000,
      messages: [
        message({
          id: 'm-big',
          content: 'c'.repeat(9_000),
          imageAttachments: [imageAttachment()],
          toolCalls: [
            { id: 'tc1', name: 'Bash', input: {}, status: 'completed', output: 'o'.repeat(5_000) },
          ],
        }),
      ],
    }),
  ]

  it('matches stripping attachments then trimming the payload', () => {
    const expected = stripPersistedPayload(stripLargeAttachmentData(fixture()))

    expect(prepareSessionsForStorage(fixture())).toEqual(expected)
  })

  it('keeps every session when not aggressive', () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      session({ id: `s${i}`, updatedAt: i, messages: [] }),
    )

    expect(prepareSessionsForStorage(sessions)).toHaveLength(30)
  })

  it('caps to the 20 most recent sessions when aggressive', () => {
    const sessions = Array.from({ length: 25 }, (_, i) =>
      session({ id: `s${i}`, updatedAt: i, messages: [] }),
    )

    const out = prepareSessionsForStorage(sessions, true)

    expect(out).toHaveLength(20)
    expect(out.map(s => s.id)).toContain('s24')
    expect(out.map(s => s.id)).not.toContain('s0')
  })

  it('flags long messages as truncated in aggressive mode', () => {
    const [out] = prepareSessionsForStorage(
      [session({ messages: [message({ content: 'c'.repeat(9_000) })] })],
      true,
    )

    expect(out.messages[0].truncated ?? (out.messages[0] as Record<string, unknown>)['truncated']).toBe(true)
  })
})

describe('cleanupOldSessions', () => {
  const sessions = (n: number): Session[] =>
    Array.from({ length: n }, (_, i) => session({ id: `s${i}`, updatedAt: i }))

  it('returns the input untouched when at or under the keep count', () => {
    const input = sessions(3)

    expect(cleanupOldSessions(input, 3)).toBe(input)
  })

  it('keeps the most recently updated sessions', () => {
    const out = cleanupOldSessions(sessions(10), 3)

    expect(out.map(s => s.id)).toEqual(['s9', 's8', 's7'])
  })

  it('does not reorder the caller\'s array', () => {
    const input = sessions(5)

    cleanupOldSessions(input, 2)

    expect(input.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4'])
  })

  it('defaults to keeping 50', () => {
    expect(cleanupOldSessions(sessions(60))).toHaveLength(50)
  })
})

describe('truncateLongMessages', () => {
  it('appends the truncation marker and records the original length', () => {
    const original = 'a'.repeat(12_000)
    const [out] = truncateLongMessages([session({ messages: [message({ content: original })] })])

    const msg = out.messages[0]
    expect(msg.content).toBe('a'.repeat(10_000) + '\n\n[Content truncated due to length]')
    expect((msg as Record<string, unknown>)['truncated']).toBe(true)
    expect((msg as Record<string, unknown>)['originalLength']).toBe(12_000)
  })

  it('leaves shorter messages alone', () => {
    const msg = message({ content: 'short' })
    const [out] = truncateLongMessages([session({ messages: [msg] })])

    expect(out.messages[0]).toBe(msg)
  })

  it('honours a custom max length', () => {
    const [out] = truncateLongMessages(
      [session({ messages: [message({ content: 'b'.repeat(50) })] })],
      5,
    )

    expect(out.messages[0].content).toBe('bbbbb\n\n[Content truncated due to length]')
  })
})

describe('storage usage', () => {
  it('counts the UTF-16 bytes of every stored value', () => {
    localStorage.setItem('k1', 'abcde')
    localStorage.setItem('k2', 'xy')

    expect(getStorageUsage()).toBe((5 + 2) * 2)
  })

  it('reports ok when the payload is small', () => {
    localStorage.setItem('k1', 'abc')

    const { ok, warning, usage } = checkStorageSpace()

    expect(ok).toBe(true)
    expect(warning).toBe(false)
    expect(usage).toBe(6)
  })
})

describe('loadSessionsFromStorage', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadSessionsFromStorage()).toEqual([])
  })

  it('returns an empty list when the stored value is not valid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')

    expect(loadSessionsFromStorage()).toEqual([])
  })

  it('fills in the defaults older payloads are missing', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'legacy', title: 'Old', messages: [], createdAt: 5, updatedAt: 7 }]),
    )

    const [out] = loadSessionsFromStorage()

    expect(out.processStatus).toBe('none')
    expect(out.isTabOpen).toBe(false)
    expect(out.expandedView).toBe('none')
    expect(out.teammateTranscripts).toEqual({})
    expect(out.lastActivityAt).toBe(7)
  })

  it('normalizes a legacy working directory with stray separators', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([session({ id: 'legacy', workingDirectory: 'D:/AI//SpaceCode' })]),
    )

    expect(loadSessionsFromStorage()[0].workingDirectory).toBe('D:\\AI\\SpaceCode')
  })

  it('keeps a POSIX working directory in POSIX form', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([session({ id: 'posix', workingDirectory: '/work//project' })]),
    )

    expect(loadSessionsFromStorage()[0].workingDirectory).toBe('/work/project')
  })

  it('leaves an absent working directory absent', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([session({ id: 'nw', workingDirectory: undefined })]))

    expect(loadSessionsFromStorage()[0].workingDirectory).toBeUndefined()
  })
})

describe('saveSessionsToStorage', () => {
  it('round-trips sessions through save and load', () => {
    const sessions = [
      session({ id: 'a', title: 'A', updatedAt: 20, messages: [message({ content: 'hi' })] }),
      session({ id: 'b', title: 'B', updatedAt: 10 }),
    ]

    expect(saveSessionsToStorage(sessions)).toBe(true)

    const loaded = loadSessionsFromStorage()
    expect(loaded.map(s => s.id)).toEqual(['a', 'b'])
    expect(loaded[0].title).toBe('A')
    expect(loaded[0].messages[0].content).toBe('hi')
  })

  it('writes a metadata record alongside the payload', () => {
    saveSessionsToStorage([session({ id: 'a' })])

    const meta = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_meta`) ?? 'null')
    expect(meta).toMatchObject({ version: '2.1', count: 1 })
    expect(typeof meta.savedAt).toBe('number')
  })

  it('leaves large base64 image payloads out of storage', () => {
    saveSessionsToStorage([
      session({ id: 'img', messages: [message({ imageAttachments: [imageAttachment()] })] }),
    ])

    const raw = localStorage.getItem(STORAGE_KEY) ?? ''
    expect(raw).not.toContain('BASE64PAYLOAD')
    expect(loadSessionsFromStorage()[0].messages[0].imageAttachments?.[0].data).toBeUndefined()
  })
})

describe('projects persistence', () => {
  it('round-trips a project list', () => {
    const projects = ['D:/repo', '/work/project']

    expect(saveProjectsToStorage(projects)).toBe(true)

    expect(loadProjectsFromStorage()).toEqual(['D:\\repo', '/work/project'])
  })

  it('normalizes and de-duplicates case-insensitively', () => {
    localStorage.setItem(
      PROJECTS_KEY,
      JSON.stringify(['D:/Repo', 'd:/repo', 'D:/repo//', '/work/project', '/work//project']),
    )

    expect(loadProjectsFromStorage()).toEqual(['D:\\Repo', '/work/project'])
  })

  it('skips entries that are not non-empty strings', () => {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(['', null, 42, '/ok', {}, ['/nested']]))

    expect(loadProjectsFromStorage()).toEqual(['/ok'])
  })

  it('returns an empty list when the stored value is not an array', () => {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify({ nope: true }))

    expect(loadProjectsFromStorage()).toEqual([])
  })

  it('returns an empty list when nothing is stored', () => {
    expect(loadProjectsFromStorage()).toEqual([])
  })
})

describe('getStorageStats', () => {
  it('counts stored sessions and reports the oldest creation date', () => {
    saveSessionsToStorage([
      session({ id: 'a', createdAt: 300, updatedAt: 300 }),
      session({ id: 'b', createdAt: 100, updatedAt: 100 }),
    ])

    const stats = getStorageStats()

    expect(stats.sessionCount).toBe(2)
    expect(stats.oldestSessionDate).toBe(100)
    expect(stats.totalSize).toBe(getStorageUsage())
  })

  it('falls back to the current time when there are no sessions', () => {
    const before = Date.now()

    expect(getStorageStats().oldestSessionDate).toBeGreaterThanOrEqual(before)
  })

  it('reports the compression ratio implied by the metadata record', () => {
    localStorage.setItem(`${STORAGE_KEY}_meta`, JSON.stringify({ compressed: true }))
    expect(getStorageStats().compressionRatio).toBe(0.7)

    localStorage.setItem(`${STORAGE_KEY}_meta`, JSON.stringify({ compressed: false }))
    expect(getStorageStats().compressionRatio).toBe(1.0)
  })
})
