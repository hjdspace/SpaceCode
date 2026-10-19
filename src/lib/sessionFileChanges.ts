import type { Message } from '@/types'
import { FILE_TOOLS } from '@/stores/turn/types'
import { normalizeAbsolutePath } from '@/utils/normalizePath'

/**
 * FILE_TOOLS 不含 NotebookEdit —— 后者用 notebook_path 而非 file_path 定位文件，
 * 但它确实改写磁盘内容，属于会话改动。
 */
const WRITE_TOOLS = new Set([...FILE_TOOLS, 'NotebookEdit'])

export interface SessionFileChange {
  /** 相对 projectRoot 的路径（正斜杠）；文件不在仓库内时退回归一后的绝对路径 */
  path: string
  /** 按首次出现顺序记录的写文件工具名，同一工具多次调用会重复 */
  tools: string[]
  /** 归属轮次序号（会话内 assistant 消息序号，1 基），升序去重 */
  turns: number[]
  lastAt: number
  /**
   * direct = 有 Write/Edit 之类的事件直接点名该文件；
   * command = 只在回合窗口内观察到文件被改（Bash、格式化、子代理），置信度较低。
   */
  origin: 'direct' | 'command'
}

export interface CollectOptions {
  projectRoot?: string
  /** 会话工作目录：引擎偶尔给相对 file_path 时按它补全 */
  workingDirectory?: string
}

const PATH_FIELDS = ['file_path', 'path', 'notebook_path']

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isAbsolute(input: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(input) || input.startsWith('\\\\') || input.startsWith('/')
}

function hasDriveLetter(input: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(input)
}

function toForwardSlashes(input: string): string {
  return input.replace(/\\/g, '/')
}

/**
 * 剥出相对 projectRoot 的路径；不在仓库内返回 null。
 *
 * 盘符路径大小写不敏感 —— git/引擎两边给的 casing 常不一致（`d:\repo` vs `D:\repo`），
 * 按原样比较会让同一个文件分裂成两条记录。POSIX 保持大小写敏感。
 */
function toRepoRelative(absolutePath: string, root: string): string | null {
  const file = toForwardSlashes(absolutePath)
  const dir = toForwardSlashes(root).replace(/\/+$/, '')
  if (!dir) return null

  const caseInsensitive = hasDriveLetter(dir) || hasDriveLetter(file)
  const left = caseInsensitive ? file.toLowerCase() : file
  const base = caseInsensitive ? dir.toLowerCase() : dir
  if (!left.startsWith(`${base}/`)) return null

  // 用原串切片，保留引擎给的真实大小写；两者长度一致因为只改了 casing
  return file.slice(dir.length + 1)
}

/**
 * 一次工具调用可能涉及多个文件：顶层 file_path/path/notebook_path，
 * 以及批量形态（MultiEdit 的 edits[]、部分引擎的 files[]）。
 * 同一调用里 file_path 与 path 常同时出现且指向同一文件，这里去重。
 */
export function extractToolFilePaths(input: Record<string, any> | undefined): string[] {
  if (!input) return []
  const found = new Set<string>()
  const push = (value: unknown) => {
    const raw = nonEmptyString(value)
    if (raw) found.add(raw)
  }

  for (const field of PATH_FIELDS) push(input[field])

  for (const key of ['edits', 'files']) {
    const list = input[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      for (const field of PATH_FIELDS) push((item as Record<string, any>)[field])
    }
  }

  return Array.from(found)
}

function absolutize(raw: string, options: CollectOptions): string | null {
  if (isAbsolute(raw)) return normalizeAbsolutePath(raw)
  const base = options.workingDirectory || options.projectRoot
  if (!base) return null
  return normalizeAbsolutePath(`${base}/${toForwardSlashes(raw).replace(/^\.\/+/, '')}`)
}

/**
 * 工具入参路径 → 列表用的键：仓库内为相对 projectRoot 的正斜杠路径，仓库外保留
 * 归一后的绝对路径。聚合与写入账本必须共用这个口径，否则同一个文件会出现两份键。
 */
export function resolveToolPathKey(raw: string, options: CollectOptions): string | null {
  const absolutePath = absolutize(raw, options)
  if (!absolutePath) return null
  const relative = options.projectRoot ? toRepoRelative(absolutePath, options.projectRoot) : null
  return relative ?? toForwardSlashes(absolutePath)
}

/**
 * 从会话消息历史里聚合"本会话写过/编辑过的文件"。
 *
 * 归属来自消息本身（写文件工具事件 + 回合窗口观测到的 commandFiles），不看 git 的
 * 未提交集合 —— 后者是仓库级的，会把并行会话与用户手改混进来。
 * 从历史推导（而非增量记账）让切会话/重启/回退都自然得到正确结果，代价是每次
 * 消息变化重算，因此实现为无副作用纯函数，调用方按会话粒度节流。
 */
export function collectSessionFileChanges(
  messages: Message[],
  options: CollectOptions = {},
): SessionFileChange[] {
  const byPath = new Map<string, SessionFileChange>()
  let turnIndex = 0

  const record = (raw: string, tool: string, at: number, turn: number, origin: 'direct' | 'command') => {
    const path = resolveToolPathKey(raw, options)
    if (!path) return

    const existing = byPath.get(path)
    if (existing) {
      // 同一文件的 command 观测不覆盖 direct 归属，也不重复记工具名
      if (origin === 'direct') {
        existing.tools.push(tool)
        // 早先的回合只在窗口里观测到它，后来有工具事件点名 → 升级到 high confidence
        existing.origin = 'direct'
      }
      if (!existing.turns.includes(turn)) existing.turns.push(turn)
      if (at > existing.lastAt) existing.lastAt = at
    } else {
      byPath.set(path, {
        path,
        tools: origin === 'direct' ? [tool] : [],
        turns: [turn],
        lastAt: at,
        origin,
      })
    }
  }

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    turnIndex++

    for (const tc of msg.toolCalls || []) {
      if (!WRITE_TOOLS.has(tc.name)) continue
      // 报错的调用没有落到盘上的把握，但仍算"本会话尝试改过"；由调用方按 git 实况降级
      if (tc.status === 'pending') continue

      const at = tc.endTime || tc.startTime || msg.timestamp || Date.now()
      for (const raw of extractToolFilePaths(tc.input)) record(raw, tc.name, at, turnIndex, 'direct')
    }

    for (const file of msg.metadata?.commandFiles || []) {
      if (typeof file?.path !== 'string' || !file.path.trim()) continue
      record(file.path, 'command', file.at || msg.timestamp || Date.now(), turnIndex, 'command')
    }
  }

  return Array.from(byPath.values())
}

/**
 * 已知目标路径的写文件调用数。作为"要不要重算会话改动列表"的签名输入 ——
 * 直接 deep watch 消息数组会在每个流式 token 上重算，而文件路径只随工具调用出现。
 */
export function countKnownWritePaths(messages: Message[]): number {
  let hits = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const tc of msg.toolCalls || []) {
      if (!WRITE_TOOLS.has(tc.name)) continue
      if (extractToolFilePaths(tc.input).length > 0) hits++
    }
  }
  return hits
}

/**
 * 会话里写过文件的最后一个轮次序号（无则 0）。悬浮条用它算"本轮"计数。
 */
export function lastChangeTurn(files: SessionFileChange[]): number {
  let latest = 0
  for (const file of files) {
    const last = file.turns[file.turns.length - 1]
    if (last > latest) latest = last
  }
  return latest
}

/** 属于某一轮次的文件。悬浮条与 review 面板用它做"本轮 / 更早"分组。 */
export function filesOfTurn(files: SessionFileChange[], turn: number): SessionFileChange[] {
  return files.filter(f => f.turns.includes(turn))
}
