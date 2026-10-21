/**
 * 子进程启动参数的外置载体（system prompt / MCP 配置 / settings / pi persona）。
 *
 * 这些东西只能走盘：命令行有长度上限，子进程也读不到 asar。写入方在 spawn 前
 * 完成，子进程启动时一次性读完；进程退出后原件就没有保留价值，下一次 spawn 会重写。
 * 所以清理跟着进程生命周期走，启动时再扫一遍崩溃遗留。
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export type TempArtifactKind =
  | 'system-prompt'
  | 'pi-agent'
  | 'side-task-context'
  | 'settings'
  | 'mcp'

/** 崩溃/强杀遗留的最长保留时间；正常退出的产物会立即删除。 */
export const STALE_TEMP_ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000

const FIXED_ARTIFACT_KINDS = ['system-prompt', 'pi-agent', 'side-task-context'] as const

const ARTIFACT_PREFIXES = [
  'system-prompt-',
  'pi-agent-',
  'side-task-context-',
  'settings-',
  'mcp-',
] as const

export interface SweepResult {
  removed: number
  failed: number
}

export function sessionTempDir(): string {
  return path.join(os.tmpdir(), 'SpaceCode')
}

/** 会话 id 会拼进文件名，必须先挡掉路径分隔符与 `..`。 */
function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown'
}

/** 每次 spawn 唯一：同一会话重启用新文件，旧进程回收自己的那份，互不误删。 */
function spawnSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8) || '0'}`
}

function artifactName(sessionId: string, kind: TempArtifactKind): string {
  const sid = safeSessionId(sessionId)
  switch (kind) {
    case 'system-prompt':
      return `system-prompt-${sid}-${spawnSuffix()}.txt`
    case 'pi-agent':
      return `pi-agent-${sid}-${spawnSuffix()}.md`
    case 'side-task-context':
      return `side-task-context-${sid}-${spawnSuffix()}.md`
    case 'settings':
      return `settings-${spawnSuffix()}.json`
    case 'mcp':
      return `mcp-${sid.slice(0, 8)}-${spawnSuffix()}.json`
  }
}

export function writeSessionTempFile(
  sessionId: string,
  kind: TempArtifactKind,
  content: string,
  rootDir: string = sessionTempDir(),
): string {
  fs.mkdirSync(rootDir, { recursive: true })
  const filePath = path.join(rootDir, artifactName(sessionId, kind))
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

/**
 * 只删仍属于本次 spawn 的产物；进程退出、会话删除都走这里。
 */
export function removeTempFiles(paths: readonly string[]): void {
  for (const filePath of paths) {
    try {
      fs.rmSync(filePath, { force: true })
    } catch { /* 下次启动清扫兜底 */ }
  }
}

/** 删除某会话所有代的固定类产物；会话删除时兜底，正常退出已由进程自己回收。 */
export function removeSessionArtifacts(
  sessionId: string,
  rootDir: string = sessionTempDir(),
): void {
  const sid = safeSessionId(sessionId)
  const prefixes = FIXED_ARTIFACT_KINDS.map(kind => `${kind}-${sid}-`)
  // 旧版本按 sessionId 固定命名，没有 spawn 后缀；升级后仍要能被会话删除带走。
  const legacyNames = [
    `system-prompt-${sid}.txt`,
    `pi-agent-${sid}.md`,
    `side-task-context-${sid}.md`,
  ]

  let entries: string[]
  try {
    entries = fs.readdirSync(rootDir)
  } catch {
    return
  }

  removeTempFiles(
    entries
      .filter(name => legacyNames.includes(name) || prefixes.some(prefix => name.startsWith(prefix)))
      .map(name => path.join(rootDir, name)),
  )
}

/** 只清扫本模块写过的文件；不碰目录和用户的其它临时文件。 */
export function sweepStaleTempArtifacts(
  maxAgeMs: number = STALE_TEMP_ARTIFACT_MAX_AGE_MS,
  rootDir: string = sessionTempDir(),
): SweepResult {
  const result: SweepResult = { removed: 0, failed: 0 }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return result
  }

  const cutoff = Date.now() - maxAgeMs
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!ARTIFACT_PREFIXES.some(prefix => entry.name.startsWith(prefix))) continue

    const filePath = path.join(rootDir, entry.name)
    try {
      if (fs.statSync(filePath).mtimeMs > cutoff) continue
      fs.rmSync(filePath, { force: true })
      result.removed++
    } catch {
      result.failed++
    }
  }
  return result
}
