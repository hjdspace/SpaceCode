/**
 * Tests for git output parsers (pure functions from electron/gitParsers.ts).
 */
import { describe, it, expect } from 'vitest'
import {
  LOG_FIELD_SEP,
  LOG_FORMAT,
  parseLogLine,
  parseNumstatLine,
  parseNameStatusLine,
  splitNumstatPath,
  parseNumstatPath,
  parseTrackInfo,
} from '../gitParsers'

describe('parseLogLine', () => {
  const sep = LOG_FIELD_SEP

  it('parses a normal commit line', () => {
    const line = ['abc123', 'abc1234', 'feat: add thing', 'Alice', '2026-01-01T10:00:00+08:00', 'origin/main', 'def456'].join(sep)
    const entry = parseLogLine(line)
    expect(entry).not.toBeNull()
    expect(entry!.hash).toBe('abc123')
    expect(entry!.shortHash).toBe('abc1234')
    expect(entry!.subject).toBe('feat: add thing')
    expect(entry!.author).toBe('Alice')
    expect(entry!.parents).toEqual(['def456'])
    expect(entry!.refs).toBe('origin/main')
  })

  it('parses subject containing a pipe character', () => {
    const line = ['h1', 'h1s', 'feat: a | b', 'Bob', '2026-01-01T10:00:00+08:00', '', 'p1 p2'].join(sep)
    const entry = parseLogLine(line)!
    expect(entry.subject).toBe('feat: a | b')
    expect(entry.parents).toEqual(['p1', 'p2'])
  })

  it('returns empty parents for a root commit', () => {
    const line = ['h1', 'h1s', 'init', 'Bob', '2026-01-01T10:00:00+08:00', '', ''].join(sep)
    const entry = parseLogLine(line)!
    expect(entry.parents).toEqual([])
  })

  it('parses multiple parents for a merge commit', () => {
    const line = ['m1', 'm1s', 'merge', 'C', '2026-01-01T10:00:00+08:00', 'HEAD', 'a1 b2 c3'].join(sep)
    const entry = parseLogLine(line)!
    expect(entry.parents).toEqual(['a1', 'b2', 'c3'])
  })

  it('handles trailing \r (CRLF output)', () => {
    const line = ['h1', 'h1s', 's', 'A', 'd', 'r', 'p'].join(sep) + '\r'
    const entry = parseLogLine(line)!
    expect(entry.parents).toEqual(['p'])
  })

  it('returns null for empty or malformed lines', () => {
    expect(parseLogLine('')).toBeNull()
    expect(parseLogLine('only|two|fields')).toBeNull()
    expect(parseLogLine([sep, sep, sep, sep, sep, sep].join(''))).toBeNull()
  })

  it('falls back to hash prefix when shortHash is empty', () => {
    const line = ['abcdefgh', '', 's', 'A', 'd', '', ''].join(sep)
    const entry = parseLogLine(line)!
    expect(entry.shortHash).toBe('abcdefg')
  })

  it('LOG_FORMAT contains the expected placeholders', () => {
    expect(LOG_FORMAT).toBe('%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%D%x1f%P')
  })
})

describe('splitNumstatPath', () => {
  it('returns plain path unchanged', () => {
    expect(splitNumstatPath('src/a.ts')).toEqual({ path: 'src/a.ts' })
  })

  it('handles "old => new" rename form', () => {
    const r = splitNumstatPath('old.ts => new.ts')
    expect(r.path).toBe('new.ts')
    expect(r.originalPath).toBe('old.ts')
  })

  it('handles "{old => new}/suffix" rename form', () => {
    const r = splitNumstatPath('src/{old => new}/a.ts')
    expect(r.path).toBe('src/new/a.ts')
    expect(r.originalPath).toBe('src/old/a.ts')
  })
})

describe('parseNumstatLine', () => {
  it('parses a normal numstat line', () => {
    const r = parseNumstatLine('12\t3\tsrc/a.ts')
    expect(r).toEqual({
      additions: 12,
      deletions: 3,
      path: 'src/a.ts',
      originalPath: undefined,
      isBinary: false,
    })
  })

  it('parses a binary numstat line', () => {
    const r = parseNumstatLine('-\t-\timg.png')
    expect(r!.additions).toBeNull()
    expect(r!.deletions).toBeNull()
    expect(r!.isBinary).toBe(true)
    expect(r!.path).toBe('img.png')
  })

  it('resolves rename paths', () => {
    const r = parseNumstatLine('5\t2\tsrc/{old => new}/a.ts')
    expect(r!.path).toBe('src/new/a.ts')
    expect(r!.originalPath).toBe('src/old/a.ts')
  })

  it('handles path containing spaces', () => {
    const r = parseNumstatLine('1\t0\tmy folder/file name.ts')
    expect(r!.path).toBe('my folder/file name.ts')
  })

  it('returns null for malformed lines', () => {
    expect(parseNumstatLine('')).toBeNull()
    expect(parseNumstatLine('12\tsrc/a.ts')).toBeNull()
    expect(parseNumstatLine('12\t3\t')).toBeNull()
  })
})

describe('parseNameStatusLine', () => {
  it('parses a modified entry', () => {
    expect(parseNameStatusLine('M\tsrc/a.ts')).toEqual({
      statusCode: 'M',
      path: 'src/a.ts',
      originalPath: undefined,
    })
  })

  it('parses an added entry', () => {
    expect(parseNameStatusLine('A\tsrc/new.ts')!.statusCode).toBe('A')
  })

  it('parses a rename entry with similarity score', () => {
    const r = parseNameStatusLine('R093\told.ts\tnew.ts')
    expect(r!.statusCode).toBe('R')
    expect(r!.path).toBe('new.ts')
    expect(r!.originalPath).toBe('old.ts')
  })

  it('returns null for malformed lines', () => {
    expect(parseNameStatusLine('')).toBeNull()
    expect(parseNameStatusLine('M')).toBeNull()
  })
})

describe('parseNumstatPath', () => {
  it('returns plain path unchanged', () => {
    expect(parseNumstatPath('src/a.ts')).toBe('src/a.ts')
  })

  it('handles "old => new" rename form', () => {
    expect(parseNumstatPath('old.ts => new.ts')).toBe('new.ts')
  })

  it('handles "{old => new}/suffix" rename form', () => {
    expect(parseNumstatPath('src/{old => new}/a.ts')).toBe('src/new/a.ts')
  })

  it('handles path with no rename as-is', () => {
    expect(parseNumstatPath('plain/path.ts')).toBe('plain/path.ts')
  })
})

describe('parseTrackInfo', () => {
  it('returns empty object for undefined', () => {
    expect(parseTrackInfo(undefined)).toEqual({})
  })

  it('returns empty object for empty string', () => {
    expect(parseTrackInfo('')).toEqual({})
  })

  it('parses ahead only', () => {
    expect(parseTrackInfo('ahead 3')).toEqual({ ahead: 3, behind: undefined })
  })

  it('parses behind only', () => {
    expect(parseTrackInfo('behind 5')).toEqual({ behind: 5, ahead: undefined })
  })

  it('parses both ahead and behind', () => {
    expect(parseTrackInfo('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1 })
  })

  it('returns undefined for missing fields', () => {
    const result = parseTrackInfo('some other info')
    expect(result.ahead).toBeUndefined()
    expect(result.behind).toBeUndefined()
  })
})
