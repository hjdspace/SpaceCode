/**
 * Git output parsing — pure functions with no Electron/Node dependencies,
 * isolated for unit testing (electron/__tests__/gitParsers.test.ts).
 */

export interface ParsedLogEntry {
  hash: string
  shortHash: string
  subject: string
  message: string
  author: string
  date: string
  refs: string
  parents: string[]
  [key: string]: unknown
}

export interface ParsedNumstatLine {
  /** null when the entry is binary ("- - path") */
  additions: number | null
  deletions: number | null
  path: string
  originalPath?: string
  isBinary: boolean
}

export interface ParsedNameStatusLine {
  statusCode: string
  path: string
  originalPath?: string
}

/** Field separator for `git log --pretty=format:` output (unit separator, safe for subjects containing `|`). */
export const LOG_FIELD_SEP = '\x1f'

/** Format string consumed by parseLogLine: hash/short/subject/author/date/refs/parents. */
export const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%aI', '%D', '%P'].join('%x1f')

/**
 * Parse a single `git log --pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%D%x1f%P` line.
 * Returns null for empty/malformed lines.
 */
export function parseLogLine(line: string): ParsedLogEntry | null {
  const raw = line.replace(/\r$/, '')
  if (!raw) return null
  const parts = raw.split(LOG_FIELD_SEP)
  if (parts.length < 7) return null
  const hash = parts[0]!
  const subject = parts[2]!
  if (!hash || !subject) return null
  return {
    hash,
    shortHash: parts[1] || hash.slice(0, 7),
    subject,
    message: subject,
    author: parts[3] || '',
    date: parts[4] || '',
    refs: parts[5] || '',
    parents: parts[6] ? parts[6]!.split(' ').filter(Boolean) : [],
  }
}

/**
 * Split a numstat path field, resolving rename forms:
 * - "old => new"
 * - "{old-prefix => new-prefix}/suffix"
 */
export function splitNumstatPath(rawPath: string): { path: string; originalPath?: string } {
  const arrowIndex = rawPath.indexOf(' => ')
  if (arrowIndex === -1) return { path: rawPath }

  if (rawPath.includes('{') && rawPath.includes('}')) {
    const match = rawPath.match(/\{([^{}]*?) => ([^{}]*?)\}/)
    if (!match) return { path: rawPath }
    const oldPath = rawPath.replace(/\{[^{}]*? => [^{}]*?\}/, match[1])
    return { path: rawPath.replace(/\{[^{}]*? => [^{}]*?\}/, match[2]), originalPath: oldPath }
  }

  return { path: rawPath.slice(arrowIndex + 4), originalPath: rawPath.slice(0, arrowIndex) }
}

/**
 * Parse a `git diff --numstat` line: "additions\tdeletions\tpath".
 * Binary entries have "-" for both counts.
 */
export function parseNumstatLine(line: string): ParsedNumstatLine | null {
  const raw = line.replace(/\r$/, '')
  if (!raw) return null
  const tabIdx1 = raw.indexOf('\t')
  if (tabIdx1 < 0) return null
  const tabIdx2 = raw.indexOf('\t', tabIdx1 + 1)
  if (tabIdx2 < 0) return null

  const addStr = raw.slice(0, tabIdx1)
  const remStr = raw.slice(tabIdx1 + 1, tabIdx2)
  const rawPath = raw.slice(tabIdx2 + 1)
  if (!rawPath) return null

  const isBinary = addStr === '-' || remStr === '-'
  const { path, originalPath } = splitNumstatPath(rawPath)
  return {
    additions: isBinary ? null : parseInt(addStr, 10) || 0,
    deletions: isBinary ? null : parseInt(remStr, 10) || 0,
    path,
    originalPath,
    isBinary,
  }
}

/**
 * Parse a `git diff --name-status` line, e.g.:
 * - "M\tsrc/a.ts"
 * - "R100\told.ts\tnew.ts" (or "C100" for copies)
 */
export function parseNameStatusLine(line: string): ParsedNameStatusLine | null {
  const raw = line.replace(/\r$/, '')
  if (!raw) return null
  const parts = raw.split('\t')
  if (parts.length < 2) return null
  const statusCode = parts[0]!.replace(/[0-9]+$/, '').trim() || parts[0]!
  const path = parts[parts.length - 1]!
  if (!path) return null
  const originalPath = parts.length >= 3 ? parts[1] : undefined
  return { statusCode, path, originalPath }
}

/**
 * Resolve a numstat path field, handling rename forms:
 * - "old => new" → returns "new"
 * - "{old => new}/suffix" → returns "old/suffix" (wait — returns "new/suffix")
 *
 * This is the same logic as splitNumstatPath but returns only the resolved
 * path (used by getFullDiff in gitService.ts for numstat line aggregation).
 */
export function parseNumstatPath(rawPath: string): string {
  const arrowIndex = rawPath.indexOf(' => ')
  if (arrowIndex === -1) return rawPath

  if (rawPath.includes('{') && rawPath.includes('}')) {
    return rawPath.replace(/\{([^{}]*?) => ([^{}]*?)\}/g, '$2')
  }

  return rawPath.slice(arrowIndex + 4)
}

/**
 * Parse `git for-each-ref` upstream track info, e.g. "ahead 2, behind 1".
 * Returns an object with optional ahead/behind counts.
 */
export function parseTrackInfo(track: string | undefined): { ahead?: number; behind?: number } {
  if (!track) return {}
  const aheadMatch = track.match(/ahead (\d+)/)
  const behindMatch = track.match(/behind (\d+)/)
  return {
    ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : undefined,
    behind: behindMatch ? parseInt(behindMatch[1]!, 10) : undefined,
  }
}
