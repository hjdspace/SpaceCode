/**
 * 侧边任务上下文继承 —— 把主会话的 transcript 压成一份只读快照摘要。
 *
 * 侧边任务与主任务共享同一工作目录，但引擎层面是一个全新会话（--session-id /
 * 新 pi session file），模型看不到主会话在做什么。这里在侧边会话首次 spawn 时
 * 读取主会话的落盘 transcript（claude: ~/.claude/projects/.../<id>.jsonl，
 * pi: piSessionRegistry 记录的 session file），序列化为「角色提示 + 对话主线」
 * 的上下文块，由各引擎包进首条用户消息 —— 注入式而非 fork：主会话历史保持只读，
 * 侧边对话从第一条消息干净起步（对齐 Qoder Side Chat 的行为）。
 */

import * as fs from 'fs'
import { debug, warn } from '../infra/logger'
import { SessionHistoryManager } from './sessionHistoryManager'
import { findPiSessionFile } from '../engine/engines/piSessionRegistry'
import type { EngineType } from '../engine/engines/types'
import { removeTempFiles, writeSessionTempFile } from './tempArtifacts'

/** 摘要正文总预算（字符）。超长保尾 —— 近期上下文对"主会话在做什么"价值最高。 */
const DIGEST_MAX_CHARS = 24_000
/** 单条消息抽取上限；超长保留头尾并标注截断。 */
const PER_MESSAGE_MAX_CHARS = 4_000

export interface SideTaskContextSource {
  sideTaskSourceSessionId?: string
  sideTaskSourceEngine?: EngineType
  cwd?: string
}

interface DigestLine {
  role: 'user' | 'assistant'
  text: string
}

/** LLM 面向的角色提示：告知自身是侧聊、transcript 是主会话的只读快照、不得续做主任务。 */
function sideChatPreamble(snapshotAt: Date): string {
  return [
    '<SIDE_CHAT_CONTEXT>',
    "You are a side chat running in parallel with the user's main session in the same workspace.",
    "The transcript below is a snapshot of the main session's conversation, inherited for reference only.",
    "Use it to understand what the main session has been working on and answer the user's questions about it,",
    "but do NOT continue or act on the main session's work unless the user explicitly asks.",
    `Snapshot taken at: ${snapshotAt.toISOString()}`,
    '</SIDE_CHAT_CONTEXT>',
  ].join('\n')
}

function truncateBody(text: string): string {
  if (text.length <= PER_MESSAGE_MAX_CHARS) return text
  const head = text.slice(0, Math.floor(PER_MESSAGE_MAX_CHARS * 0.7))
  const tail = text.slice(-Math.floor(PER_MESSAGE_MAX_CHARS * 0.2))
  return `${head}\n…[truncated]…\n${tail}`
}

/** 工具调用压成一行：名称 + 最有定位价值的一个参数（文件路径/命令/模式）。 */
function toolCallLine(name: string, input: unknown): string {
  const args = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const key = args.file_path ?? args.filePath ?? args.command ?? args.pattern ?? args.url ?? args.query ?? args.skill
  const detail = typeof key === 'string' && key.trim() ? `: ${key.trim().slice(0, 120)}` : ''
  return `(tool: ${name}${detail})`
}

/** claude JSONL 条目 → 对话主线。跳过 sidechain/meta/纯 tool_result 轮与 thinking 块。 */
export function digestFromClaudeMessages(entries: unknown[]): DigestLine[] {
  const lines: DigestLine[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    if (rec.isSidechain === true || rec.isMeta === true) continue
    if (rec.type !== 'user' && rec.type !== 'assistant') continue
    const message = rec.message as Record<string, unknown> | undefined
    if (!message) continue
    const role = message.role === 'user' ? 'user' : 'assistant'
    const content = message.content
    const parts: string[] = []
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text)
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          parts.push(toolCallLine(b.name, b.input))
        }
        // tool_result / image / thinking 不进主线：结果正文噪声大，图不可文本化
      }
    }
    const text = parts.join('\n').trim()
    if (text) lines.push({ role, text })
  }
  return lines
}

/** pi 会话 JSONL 行 → 对话主线。只认 type:'message'；thinking 不进主线。 */
export function digestFromPiEntries(entries: unknown[]): DigestLine[] {
  const lines: DigestLine[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    if (rec.type !== 'message') continue
    const message = rec.message as Record<string, unknown> | undefined
    if (!message) continue
    const role = message.role === 'user' ? 'user' : 'assistant'
    const content = message.content
    const parts: string[] = []
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text)
        } else if (b.type === 'toolCall' && typeof b.name === 'string') {
          parts.push(toolCallLine(b.name, b.arguments))
        }
      }
    }
    const text = parts.join('\n').trim()
    if (text) lines.push({ role, text })
  }
  return lines
}

function renderTranscript(lines: DigestLine[]): string {
  const rendered = lines.map(l => `[${l.role}] ${truncateBody(l.text)}`)
  let joined = rendered.join('\n\n')
  if (joined.length > DIGEST_MAX_CHARS) {
    joined = `…[earlier turns omitted]…\n\n${joined.slice(-DIGEST_MAX_CHARS)}`
  }
  return joined
}

function readJsonlEntries(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const entries: unknown[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch { /* 半行写入等损坏行直接跳过 */ }
  }
  return entries
}

/**
 * 构建侧边任务上下文块（角色提示 + 主会话对话主线）。
 * 找不到 transcript 或解析为空时返回 null —— 侧边任务静默退化为普通新会话。
 */
export async function buildSideTaskContext(source: SideTaskContextSource): Promise<string | null> {
  const sourceSessionId = source.sideTaskSourceSessionId
  if (!sourceSessionId) return null
  const cwd = source.cwd || ''
  if (!cwd) return null

  try {
    let lines: DigestLine[] = []
    if (source.sideTaskSourceEngine === 'pi') {
      const sessionFile = findPiSessionFile(sourceSessionId, cwd)
      if (!sessionFile) {
        debug('TranscriptDigest', `no pi session file for source | sessionId=${sourceSessionId.slice(0, 8)}`)
        return null
      }
      lines = digestFromPiEntries(readJsonlEntries(sessionFile))
    } else {
      const full = await SessionHistoryManager.getFullSession(cwd, sourceSessionId)
      if (!full?.messages?.length) return null
      lines = digestFromClaudeMessages(full.messages)
    }

    const transcript = renderTranscript(lines)
    if (!transcript.trim()) return null
    return `${sideChatPreamble(new Date())}\n\n<main_session_transcript>\n${transcript}\n</main_session_transcript>`
  } catch (err) {
    warn('TranscriptDigest', `Failed to build side task context | source=${sourceSessionId.slice(0, 8)}`, err)
    return null
  }
}

/** 上下文块落盘为临时文件；返回路径供引擎首条消息包裹时读取。 */
export function writeSideTaskContextFile(sessionId: string, content: string): string {
  // 每次落盘独立命名；注入后 discard，异常路径由启动清扫兜底
  const filePath = writeSessionTempFile(sessionId, 'side-task-context', content)
  debug('TranscriptDigest', `side task context written | sessionId=${sessionId.slice(0, 8)} | len=${content.length}`)
  return filePath
}

/** 读取已落盘的上下文块；缺失/损坏返回 null。 */
export function readSideTaskContextFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim()
    return content || null
  } catch {
    return null
  }
}

/** 注入成功后清理快照临时文件；失败忽略（tmpdir 由系统回收）。 */
export function discardSideTaskContextFile(filePath: string): void {
  removeTempFiles([filePath])
}

/**
 * 引擎 startSession 的统一入口：有继承来源时构建快照文件并返回路径，
 * 失败一律降级为 undefined（侧边任务退化为普通新会话，不得阻塞启动）。
 */
export async function resolveSideTaskContextPath(sessionId: string, config: SideTaskContextSource): Promise<string | undefined> {
  if (!config.sideTaskSourceSessionId) return undefined
  const context = await buildSideTaskContext(config)
  if (!context) return undefined
  try {
    return writeSideTaskContextFile(sessionId, context)
  } catch (err) {
    warn('TranscriptDigest', `Failed to write side task context file | sessionId=${sessionId.slice(0, 8)}`, err)
    return undefined
  }
}
