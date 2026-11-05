/**
 * Source 游标持久化（T15 #85）。
 *
 * 所有 Source 的游标落在同一份 JSON 文件中，每次推进都原子替换；
 * 重启后 load 回最近游标，续读不重复消费。文件损坏时按空游标处理——
 * 从头重读是安全的：事件键幂等保证不会重复建单。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonAtomic } from '../../factory/atomic'

export const SOURCE_CURSORS_FILE = 'sources-cursors.json'

const SCHEMA_VERSION = 1

interface SourceCursorEntry {
  cursor: string | null
  updatedAt: string
}

interface SourceCursorFile {
  schemaVersion: number
  cursors: Record<string, SourceCursorEntry>
}

export interface SourceCursorStore {
  load(sourceId: string): string | null
  save(sourceId: string, cursor: string | null): void
}

export interface SourceCursorStoreDeps {
  now?: () => Date
}

function readCursorFile(path: string): SourceCursorFile {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return { schemaVersion: SCHEMA_VERSION, cursors: {} }
  }
  try {
    const raw = JSON.parse(text) as unknown
    if (
      typeof raw === 'object' &&
      raw !== null &&
      !Array.isArray(raw) &&
      (raw as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION &&
      typeof (raw as { cursors?: unknown }).cursors === 'object'
    ) {
      return raw as SourceCursorFile
    }
  } catch {
    // 半写或损坏：视作空游标
  }
  return { schemaVersion: SCHEMA_VERSION, cursors: {} }
}

export function createSourceCursorStore(
  dir: string,
  deps: SourceCursorStoreDeps = {},
): SourceCursorStore {
  const now = deps.now ?? (() => new Date())
  const path = join(dir, SOURCE_CURSORS_FILE)
  let file = readCursorFile(path)

  return {
    load(sourceId) {
      return file.cursors[sourceId]?.cursor ?? null
    },
    save(sourceId, cursor) {
      file = {
        ...file,
        cursors: {
          ...file.cursors,
          [sourceId]: { cursor, updatedAt: now().toISOString() },
        },
      }
      writeJsonAtomic(path, file)
    },
  }
}
