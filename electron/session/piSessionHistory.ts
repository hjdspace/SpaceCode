import * as fs from 'fs'
import {
  findPiSessionRecord,
  isSameCwd,
  listPiSessionRecords,
  type PiSessionRecordEntry,
} from '../engine/engines/piSessionRegistry'
import { mapPiToolName } from '../engine/engines/piToolNames'

/**
 * pi 的历史恢复适配层。
 *
 * pi 的 JSONL 文件名是 `<时间戳>_<pi自己的UUID>.jsonl`，SpaceCode 的
 * sessionId 不在文件里；两张 id 的唯一连接是 pi-sessions.json。因此历史列表
 * 只能从注册表出发，不能直接扫描 ~/.pi/agent/sessions。
 *
 * 读出来的消息会归一化成 Claude Code JSONL 的形状，交给渲染层已有的
 * buildMessagesFromHistory 处理，保证重开后工具卡片/思考块与实时流一致。
 */

/** 只读文件两端：列表页不需要把几百 KB 的 transcript 全读进内存。 */
const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 128 * 1024

export interface PiHistorySessionLite {
  projectPath: string
  sessionId: string
  engineType: 'pi'
  engineSessionId?: string
  firstUserMessage?: string
  lastMessageTimestamp?: number
  createdAt?: number
}

export interface PiFullSession {
  messages: unknown[]
  projectPath: string
  sessionId: string
  engineType: 'pi'
  engineSessionId?: string
}

interface RawRecord {
  type?: string
  id?: string
  timestamp?: string | number
  cwd?: string
  message?: {
    role?: string
    content?: unknown
    timestamp?: number
    model?: string
    usage?: unknown
    toolCallId?: string
    toolName?: string
    isError?: boolean
  }
}

function readChunk(filePath: string, start: number, length: number): string {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, start)
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function parseLines(text: string, dropPartialFirst = false, dropPartialLast = false): RawRecord[] {
  const lines = text.split('\n')
  if (dropPartialFirst) lines.shift()
  if (dropPartialLast) lines.pop()
  const records: RawRecord[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') records.push(parsed as RawRecord)
    } catch {
      // 半行/损坏行跳过，不能因为一行坏数据丢掉整份历史
    }
  }
  return records
}

function readEdges(filePath: string): { whole: RawRecord[] | null; head: RawRecord[]; tail: RawRecord[] } {
  const size = fs.statSync(filePath).size
  if (size <= HEAD_BYTES + TAIL_BYTES) {
    return { whole: parseLines(fs.readFileSync(filePath, 'utf8')), head: [], tail: [] }
  }
  const headText = readChunk(filePath, 0, HEAD_BYTES)
  const tailStart = size - TAIL_BYTES
  const tailText = readChunk(filePath, tailStart, TAIL_BYTES)
  return {
    whole: null,
    head: parseLines(headText, false, !headText.endsWith('\n')),
    tail: parseLines(tailText, true, false),
  }
}

function recordTimestamp(record: RawRecord): number | null {
  const raw = record.timestamp ?? record.message?.timestamp
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function userMessageText(record: RawRecord): string {
  const content = record.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: string; text: string } =>
      !!block
      && typeof block === 'object'
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string',
    )
    .map(block => block.text)
    .join('')
    .trim()
}

function summarizeRecord(record: PiSessionRecordEntry): PiHistorySessionLite | null {
  let edges: ReturnType<typeof readEdges>
  try {
    edges = readEdges(record.sessionFile)
  } catch {
    return null
  }

  const head = edges.whole ?? edges.head
  const header = head.find(item => item.type === 'session')
  const firstUserMessage = head
    .filter(item => item.type === 'message' && item.message?.role === 'user')
    .map(userMessageText)
    .find(text => text.length > 0)

  const tailCandidates = edges.whole ? [...edges.whole].reverse() : [...edges.tail].reverse()
  let lastMessageTimestamp: number | null = null
  for (const item of tailCandidates) {
    const ts = recordTimestamp(item)
    if (ts !== null) {
      lastMessageTimestamp = ts
      break
    }
  }

  let createdAt = header ? recordTimestamp(header) : null
  if (createdAt === null) {
    try {
      const stat = fs.statSync(record.sessionFile)
      createdAt = stat.birthtimeMs || stat.mtimeMs
    } catch {
      createdAt = null
    }
  }
  // 空会话（刚创建还没发消息）也要有可排序的时间，否则恢复时会被当成
  // “现在创建”的会话挤到最前面。
  if (lastMessageTimestamp === null) lastMessageTimestamp = createdAt

  return {
    projectPath: record.cwd,
    sessionId: record.sessionId,
    engineType: 'pi',
    ...(typeof header?.id === 'string' && header.id ? { engineSessionId: header.id } : {}),
    ...(firstUserMessage ? { firstUserMessage } : {}),
    ...(lastMessageTimestamp !== null ? { lastMessageTimestamp } : {}),
    ...(createdAt !== null ? { createdAt } : {}),
  }
}

/** 列出可恢复到左栏的 pi 会话；ephemeral 的侧边任务不参与。 */
export function listPiSessions(cwd?: string): PiHistorySessionLite[] {
  const sessions: PiHistorySessionLite[] = []
  for (const record of listPiSessionRecords()) {
    if (record.ephemeral === true) continue
    if (cwd && !isSameCwd(record.cwd, cwd)) continue
    if (!fs.existsSync(record.sessionFile)) continue
    const summary = summarizeRecord(record)
    if (summary) sessions.push(summary)
  }
  return sessions.sort(
    (a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0),
  )
}

function normalizeUserContent(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content
  const blocks: unknown[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const typed = block as { type?: string; text?: string }
    if (typed.type === 'text' && typeof typed.text === 'string') {
      blocks.push({ type: 'text', text: typed.text })
    } else if (typed.type === 'image') {
      // 渲染层只展示占位；原始图片不重复塞进 Message
      blocks.push({ type: 'image' })
    }
  }
  return blocks
}

function normalizeAssistantBlocks(content: unknown): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  const blocks: unknown[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const typed = block as {
      type?: string
      thinking?: string
      text?: string
      id?: string
      name?: string
      arguments?: unknown
    }
    if (typed.type === 'thinking') {
      const thinking = typed.thinking || typed.text || ''
      if (thinking) blocks.push({ type: 'thinking', thinking })
    } else if (typed.type === 'text') {
      if (typeof typed.text === 'string' && typed.text) {
        blocks.push({ type: 'text', text: typed.text })
      }
    } else if (typed.type === 'toolCall' && typed.id) {
      blocks.push({
        type: 'tool_use',
        id: typed.id,
        name: mapPiToolName(typed.name) ?? typed.name ?? 'Unknown Tool',
        input: typed.arguments ?? {},
      })
    }
  }
  return blocks
}

function normalizeUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const source = usage as Record<string, unknown>
  const mapping: Array<[string, string[]]> = [
    ['input_tokens', ['input', 'inputTokens', 'input_tokens']],
    ['output_tokens', ['output', 'outputTokens', 'output_tokens']],
    ['cache_read_input_tokens', ['cacheRead', 'cacheReadInputTokens', 'cache_read_input_tokens']],
    ['cache_creation_input_tokens', ['cacheWrite', 'cacheWriteInputTokens', 'cache_creation_input_tokens']],
  ]
  const result: Record<string, number> = {}
  for (const [target, keys] of mapping) {
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[target] = value
        break
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** 把 pi JSONL 归一化成 buildMessagesFromHistory 认识的 Claude 形状。 */
function normalizePiRecords(records: RawRecord[]): unknown[] {
  const messages: unknown[] = []
  for (const record of records) {
    if (record.type === 'session') continue
    if (record.type !== 'message' || !record.message) continue
    const role = record.message.role
    const timestamp = record.timestamp ?? record.message.timestamp

    if (role === 'user') {
      messages.push({
        type: 'user',
        uuid: record.id,
        timestamp,
        message: { role: 'user', content: normalizeUserContent(record.message.content) },
      })
      continue
    }

    if (role === 'assistant') {
      const content = normalizeAssistantBlocks(record.message.content)
      if (content.length === 0) continue
      const usage = normalizeUsage(record.message.usage)
      messages.push({
        type: 'assistant',
        uuid: record.id,
        timestamp,
        message: {
          role: 'assistant',
          content,
          ...(record.message.model ? { model: record.message.model } : {}),
          ...(usage ? { usage } : {}),
        },
      })
      continue
    }

    if (role === 'toolResult' && record.message.toolCallId) {
      messages.push({
        type: 'user',
        uuid: record.id,
        timestamp,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: record.message.toolCallId,
            content: record.message.content,
            is_error: record.message.isError === true,
          }],
        },
      })
    }
    // system（preamble / toolsAdded）不是用户可见对话，跳过
  }
  return messages
}

export function getPiFullSession(
  sessionId: string,
  projectPath?: string,
): PiFullSession | null {
  const record = findPiSessionRecord(sessionId)
  if (!record) return null
  if (projectPath && !isSameCwd(record.cwd, projectPath)) return null
  if (!fs.existsSync(record.sessionFile)) return null

  let text: string
  try {
    text = fs.readFileSync(record.sessionFile, 'utf8')
  } catch {
    return null
  }
  const records = parseLines(text)
  const header = records.find(item => item.type === 'session')
  return {
    messages: normalizePiRecords(records),
    projectPath: record.cwd,
    sessionId,
    engineType: 'pi',
    ...(typeof header?.id === 'string' && header.id ? { engineSessionId: header.id } : {}),
  }
}
