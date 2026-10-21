import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { warn } from '../../infra/logger'

/**
 * SpaceCode 会话 id → pi 自己落盘的会话文件。
 *
 * pi 的历史不在 SpaceCode 手里：每次 spawn 一个新 RPC 进程，pi 都会新建一份
 * `~/.pi/agent/sessions/<项目>/<时间戳>_<uuid>.jsonl`，只有把路径用 `--session`
 * 带回去才接得上历史。而这份路径此前只活在 PiSessionProcess 实例的内存里，
 * 换进程（重启应用、驱逐后重建、stop 后再发消息、换模型重启）就等于失忆。
 */
export interface PiSessionRecord {
  sessionFile: string
  cwd: string
  /** 侧边任务：只在当前应用生命周期内存在，历史恢复列表必须忽略它。 */
  ephemeral?: boolean
}

export interface PiSessionRecordEntry extends PiSessionRecord {
  sessionId: string
}

const STORE_FILE = 'pi-sessions.json'

let cache: Record<string, PiSessionRecord> | null = null

function storePath(): string | null {
  // 非 Electron 环境（单元测试直接 import 本模块）下 app 可能不存在。
  const appRef = app as unknown as { getPath?: (name: string) => string } | undefined
  if (!appRef || typeof appRef.getPath !== 'function') return null
  return path.join(appRef.getPath('userData'), STORE_FILE)
}

/** Windows 盘符大小写与两种分隔符混用是常态，按同一目录判定 */
export function isSameCwd(a: string, b: string): boolean {
  const key = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  return key(a) === key(b)
}

function load(): Record<string, PiSessionRecord> {
  if (cache) return cache
  cache = {}
  const file = storePath()
  if (!file) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (raw && typeof raw === 'object') {
      for (const [sessionId, record] of Object.entries(raw)) {
        const item = record as Partial<PiSessionRecord>
        if (typeof item?.sessionFile === 'string' && typeof item?.cwd === 'string') {
          cache[sessionId] = {
            sessionFile: item.sessionFile,
            cwd: item.cwd,
            ...(item.ephemeral === true ? { ephemeral: true } : {}),
          }
        }
      }
    }
  } catch {
    // 首次运行或文件损坏：从空表开始，下一次捕获会重写
  }
  return cache
}

export function rememberPiSessionFile(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  options?: { ephemeral?: boolean },
): void {
  const records = load()
  const current = records[sessionId]
  // 首次启动带 sideTaskSourceSessionId 时打标；后续恢复/重启不再带该字段，
  // 所以只能单向升级，不能被覆盖回普通会话。
  const ephemeral = current?.ephemeral === true || options?.ephemeral === true
  if (
    current?.sessionFile === sessionFile
    && current.cwd === cwd
    && (current.ephemeral === true) === ephemeral
  ) return
  records[sessionId] = { sessionFile, cwd, ...(ephemeral ? { ephemeral: true } : {}) }
  const file = storePath()
  if (!file) return
  try {
    fs.writeFileSync(file, JSON.stringify(records, null, 2), 'utf-8')
  } catch (err) {
    warn('PiSessionRegistry', `Failed to persist session file | sessionId=${sessionId.slice(0, 8)}`, err)
  }
}

export function findPiSessionRecord(sessionId: string): PiSessionRecord | null {
  return load()[sessionId] ?? null
}

/** 历史恢复的唯一来源：SpaceCode sessionId → pi 自己的会话文件。 */
export function listPiSessionRecords(): PiSessionRecordEntry[] {
  return Object.entries(load()).map(([sessionId, record]) => ({ sessionId, ...record }))
}

/** 只有文件还在、且会话没换过项目目录时才接续 —— pi 会把 --session 文件头里的 cwd 当成运行时 cwd。 */
export function findPiSessionFile(sessionId: string, cwd: string): string | null {
  const record = findPiSessionRecord(sessionId)
  if (!record) return null
  if (!isSameCwd(record.cwd, cwd)) return null
  if (!fs.existsSync(record.sessionFile)) return null
  return record.sessionFile
}
