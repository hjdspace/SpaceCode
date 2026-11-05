/**
 * Source 坏事件隔离（T15 #85）。
 *
 * 坏事件不静默丢弃：按 JSONL 追加到隔离文件，并在内存保留最近
 * reportCap 条供报告。重启后从隔离文件恢复历史，报告不丢。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

export const SOURCE_QUARANTINE_FILE = 'sources-quarantine.jsonl'

export const DEFAULT_QUARANTINE_REPORT_CAP = 100

export interface SourceQuarantineEntry {
  at: string
  sourceId: string
  reason: string
  raw: string
}

export interface SourceQuarantine {
  record(sourceId: string, reason: string, raw: string): void
  report(): SourceQuarantineEntry[]
}

export interface SourceQuarantineDeps {
  now?: () => Date
  appendFile?: (path: string, data: string) => void
  reportCap?: number
}

function parseLine(line: string): SourceQuarantineEntry | null {
  try {
    const raw = JSON.parse(line) as unknown
    if (
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as SourceQuarantineEntry).at === 'string' &&
      typeof (raw as SourceQuarantineEntry).sourceId === 'string' &&
      typeof (raw as SourceQuarantineEntry).reason === 'string' &&
      typeof (raw as SourceQuarantineEntry).raw === 'string'
    ) {
      return raw as SourceQuarantineEntry
    }
  } catch {
    // 隔离文件里的坏行直接跳过：它本身就是隔离产物
  }
  return null
}

export function createSourceQuarantine(
  dir: string,
  deps: SourceQuarantineDeps = {},
): SourceQuarantine {
  const now = deps.now ?? (() => new Date())
  const appendFile = deps.appendFile ?? appendFileSync
  const reportCap = deps.reportCap ?? DEFAULT_QUARANTINE_REPORT_CAP
  const path = join(dir, SOURCE_QUARANTINE_FILE)
  mkdirSync(dir, { recursive: true })

  const entries: SourceQuarantineEntry[] = []
  try {
    const text = readFileSync(path, 'utf-8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const entry = parseLine(line)
      if (entry) entries.push(entry)
    }
  } catch {
    // 隔离文件不存在：从空开始
  }

  return {
    record(sourceId, reason, raw) {
      const entry: SourceQuarantineEntry = {
        at: now().toISOString(),
        sourceId,
        reason,
        raw,
      }
      entries.push(entry)
      if (entries.length > reportCap) entries.splice(0, entries.length - reportCap)
      appendFile(path, `${JSON.stringify(entry)}\n`)
    },
    report() {
      return [...entries]
    },
  }
}
