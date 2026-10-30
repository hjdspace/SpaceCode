/**
 * 行级补丁解析：把 `git diff --unified` 的原始输出还原为结构化分块补丁，
 * 供任务快照持久化与检查器 Diff 页签渲染。
 *
 * 纯函数模块：只处理文本，不碰 Git；行/字节/总量上限在这里生效，保证快照
 * 体积有界（看板事件推送带全量快照，补丁过大会拖慢看板与检查器）。
 */
import {
  FACTORY_DIFF_MAX_BYTES_PER_FILE,
  FACTORY_DIFF_MAX_LINES_PER_FILE,
  FACTORY_DIFF_MAX_TOTAL_BYTES,
  FACTORY_DIFF_MAX_TOTAL_LINES,
  type FactoryDiffFile,
  type FactoryDiffFileKind,
  type FactoryDiffHunk,
  type FactoryDiffLine,
} from '@/shared/factory'

/** numstat 单条：行数是权威计数（补丁可能被截断），binary 来自 `-` 占位。 */
export interface NumstatEntry {
  path: string
  additions: number
  deletions: number
  binary: boolean
}

export interface ParsedDiffFile {
  path: string
  kind: FactoryDiffFileKind
  hunks: FactoryDiffHunk[]
  oldPath?: string
  truncated: boolean
}

export interface DiffPatchLimits {
  maxLinesPerFile?: number
  maxBytesPerFile?: number
  maxTotalLines?: number
  maxTotalBytes?: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** numstat 的 `src/{old.ts => new.ts}` / `a.md => b.md` 展开为真实路径。 */
export function expandNumstatPath(path: string): { path: string; oldPath?: string } {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path)
  if (braced) {
    const [, prefix, from, to, suffix] = braced
    return { path: `${prefix}${to}${suffix}`, oldPath: `${prefix}${from}${suffix}` }
  }
  if (path.includes(' => ')) {
    const [from, ...rest] = path.split(' => ')
    return { path: rest.join(' => '), oldPath: from }
  }
  return { path }
}

interface PendingFile {
  path: string
  oldPath?: string
  binary: boolean
  sawHunk: boolean
  hunks: FactoryDiffHunk[]
  lines: number
  bytes: number
  dropped: boolean
}

export function parsePatchOutput(raw: string, limits: DiffPatchLimits = {}): ParsedDiffFile[] {
  const maxLines = limits.maxLinesPerFile ?? FACTORY_DIFF_MAX_LINES_PER_FILE
  const maxBytes = limits.maxBytesPerFile ?? FACTORY_DIFF_MAX_BYTES_PER_FILE
  const maxTotal = limits.maxTotalLines ?? FACTORY_DIFF_MAX_TOTAL_LINES
  const maxTotalBytes = limits.maxTotalBytes ?? FACTORY_DIFF_MAX_TOTAL_BYTES

  const out: ParsedDiffFile[] = []
  let total = 0
  let totalBytes = 0
  let current: PendingFile | null = null
  let hunk: FactoryDiffHunk | null = null
  let oldCounter = 0
  let newCounter = 0

  const flush = (): void => {
    if (current) out.push(toParsed(current))
    current = null
    hunk = null
  }

  /** 收录一行补丁内容；预算不足只标记 dropped，不静默吞掉整块。 */
  const fits = (text: string): boolean =>
    current !== null &&
    current.lines < maxLines &&
    total < maxTotal &&
    current.bytes + text.length <= maxBytes &&
    totalBytes + text.length <= maxTotalBytes

  const startHunk = (header: string): FactoryDiffHunk => {
    const created: FactoryDiffHunk = { header, lines: [] }
    if (current) current.hunks.push(created)
    hunk = created
    return created
  }

  const consume = (text: string): void => {
    if (!current) return
    current.lines += 1
    current.bytes += text.length
    total += 1
    totalBytes += text.length
  }

  const advance = (marker: string): void => {
    if (marker === ' ') {
      oldCounter += 1
      newCounter += 1
    } else if (marker === '+') newCounter += 1
    else oldCounter += 1
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      flush()
      current = {
        path: pathFromGitHeader(rawLine),
        binary: false,
        sawHunk: false,
        hunks: [],
        lines: 0,
        bytes: 0,
        dropped: false,
      }
      continue
    }
    if (!current) continue

    const renameTo = /^rename to (.+)$/.exec(rawLine)
    if (renameTo) current.path = renameTo[1].trim()
    const renameFrom = /^rename from (.+)$/.exec(rawLine)
    if (renameFrom) current.oldPath = renameFrom[1].trim()

    if (rawLine.startsWith('Binary files ') || rawLine.startsWith('GIT binary patch')) {
      current.binary = true
      continue
    }

    const hunkMatch = HUNK_HEADER.exec(rawLine)
    if (hunkMatch) {
      current.sawHunk = true
      oldCounter = Number(hunkMatch[1])
      newCounter = Number(hunkMatch[3])
      hunk = null
      if (fits(rawLine)) {
        startHunk(rawLine)
        consume(rawLine)
      } else {
        current.dropped = true
      }
      continue
    }

    // hunk 之前 ---/+++ 是文件头；hunk 内部它们只是长得像头部的正文行。
    if (!current.sawHunk && (rawLine.startsWith('--- ') || rawLine.startsWith('+++ '))) {
      const plus = /^\+\+\+ b\/(.+)$/.exec(rawLine)
      if (plus) current.path = plus[1].trim()
      continue
    }

    // `\ No newline at end of file` 不是内容行。
    if (rawLine.startsWith('\\')) continue

    const marker = rawLine[0]
    if (marker !== ' ' && marker !== '+' && marker !== '-') continue

    const text = rawLine.slice(1)
    const line: FactoryDiffLine =
      marker === ' '
        ? { kind: 'ctx', oldLine: oldCounter, newLine: newCounter, text }
        : marker === '+'
          ? { kind: 'add', newLine: newCounter, text }
          : { kind: 'del', oldLine: oldCounter, text }

    if (fits(text)) {
      ;(hunk ?? startHunk('')).lines.push(line)
      consume(text)
    } else if (current) {
      current.dropped = true
    }
    advance(marker)
  }
  flush()

  return out
}

function pathFromGitHeader(line: string): string {
  const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
  return match ? match[2].trim() : line.slice('diff --git '.length).trim()
}

function toParsed(pending: PendingFile): ParsedDiffFile {
  // dropped 先于 renamed 判定：内容型重命名被预算截断时必须保留「已截断」，
  // 不能被误标成「内容无变化」。
  let kind: FactoryDiffFileKind
  if (pending.binary) kind = 'binary'
  else if (pending.hunks.length > 0 || pending.dropped) kind = 'patch'
  else if (pending.oldPath) kind = 'renamed'
  else kind = 'missing'

  return {
    path: pending.path,
    kind,
    hunks: pending.hunks,
    ...(pending.oldPath ? { oldPath: pending.oldPath } : {}),
    truncated: kind === 'patch' ? pending.dropped : false,
  }
}

/**
 * numstat 计数（权威）与补丁内容合并：numstat 顺序即文件列表顺序；
 * 补丁里读不到的文件按 missing（文本）或 binary（`-` 占位）处理。
 */
export function buildDiffFiles(
  numstat: readonly NumstatEntry[],
  patched: readonly ParsedDiffFile[],
): FactoryDiffFile[] {
  const byPath = new Map(patched.map((file) => [file.path, file]))
  return numstat.map((entry) => {
    const { path } = expandNumstatPath(entry.path)
    const match = byPath.get(path)
    if (!match) {
      return {
        path,
        additions: entry.additions,
        deletions: entry.deletions,
        kind: entry.binary ? ('binary' as const) : ('missing' as const),
      }
    }
    return {
      path,
      additions: entry.additions,
      deletions: entry.deletions,
      kind: match.kind,
      hunks: match.hunks,
      ...(match.oldPath ? { oldPath: match.oldPath } : {}),
      truncated: match.truncated,
    }
  })
}
