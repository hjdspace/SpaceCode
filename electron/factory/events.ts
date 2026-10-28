/**
 * 事件流与原始日志：事件只落「码 + 参数 + 级别」，原始输出另存滚动日志。
 *
 * - `runs/<runId>/events.jsonl`：序号单调，渲染层按 i18n 格式化，可跨语言重放。
 * - `logs/<taskId>.log`：脱敏后的 Agent 原始输出，按任务滚动保留。
 *
 * 凭据一律在落盘前替换成 `***`（§11 安全）。脱敏发生在写入口，而不是读取时，
 * 避免密钥先落到磁盘再被清洗。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import type { FactoryEvent, FactoryEventLevel, FactoryStageKey } from '@/shared/factory'

const DEFAULT_LOG_KEEP = 5
const MAX_PARAM_TEXT = 240

/** §11：三类常见密钥形态，替换到最后一个字符之后一律星号。 */
export function redactSecrets(text: string): string {
  return text
    .replace(/github_pat_[A-Za-z0-9_]{8,}/g, 'github_pat_***')
    .replace(/ghp_[A-Za-z0-9]{8,}/g, 'ghp_***')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
}

export interface FactoryEventInput {
  taskId: string | null
  stage?: FactoryStageKey
  code: string
  level: FactoryEventLevel
  params?: Record<string, string | number>
}

export interface FactoryEventSink {
  append(input: FactoryEventInput): FactoryEvent
  readonly path: string
}

export interface EventLogDeps {
  /** 写入每条事件的 runId；由 runner 打开日志时注入。 */
  runId?: string
  now?: () => Date
  readFile?: (path: string) => string | null
  appendFile?: (path: string, data: string) => void
  mkdirp?: (path: string) => void
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  } catch {
    return null
  }
}

function parseEvent(raw: unknown): FactoryEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.seq !== 'number' || typeof value.code !== 'string') return null
  if (typeof value.at !== 'string' || typeof value.runId !== 'string') return null
  const level = value.level
  if (level !== 'info' && level !== 'ok' && level !== 'warn' && level !== 'error') return null
  return {
    seq: value.seq,
    at: value.at,
    runId: value.runId,
    taskId: typeof value.taskId === 'string' ? value.taskId : null,
    ...(typeof value.stage === 'string' ? { stage: value.stage as FactoryStageKey } : {}),
    code: value.code,
    level,
    ...(typeof value.params === 'object' && value.params !== null && !Array.isArray(value.params)
      ? { params: value.params as Record<string, string | number> }
      : {}),
  }
}

function redactParams(params: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
  if (!params) return undefined
  const result: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(params)) {
    result[key] = typeof value === 'string' ? redactSecrets(value) : value
  }
  return result
}

/** 打开（或创建）一份运行事件日志，序号从已有内容的最后一条继续。 */
export function openEventLog(path: string, deps: EventLogDeps = {}): FactoryEventSink {
  const now = deps.now ?? (() => new Date())
  const runId = deps.runId ?? ''
  const read = deps.readFile ?? readText
  const append = deps.appendFile ?? ((file: string, data: string) => appendFileSync(file, data, 'utf-8'))
  const mkdirp = deps.mkdirp ?? ((dir: string) => mkdirSync(dir, { recursive: true }))

  const existing = read(path)
  let seq = 0
  if (existing) {
    for (const line of existing.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = parseEvent(JSON.parse(line))
        if (parsed && parsed.seq > seq) seq = parsed.seq
      } catch {
        // 坏行不阻断新事件
      }
    }
  }

  return {
    path,
    append(input: FactoryEventInput): FactoryEvent {
      const params = redactParams(input.params)
      const event: FactoryEvent = {
        seq: ++seq,
        at: now().toISOString(),
        runId,
        taskId: input.taskId,
        ...(input.stage ? { stage: input.stage } : {}),
        code: input.code,
        level: input.level,
        ...(params ? { params } : {}),
      }
      const line = JSON.stringify(event)
      mkdirp(dirname(path))
      append(path, `${line}\n`)
      return event
    },
  }
}

export function readEvents(path: string, filter: { taskId?: string | null } = {}): FactoryEvent[] {
  const text = readText(path)
  if (!text) return []
  const events: FactoryEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = parseEvent(JSON.parse(line))
      if (!parsed) continue
      if (filter.taskId !== undefined && parsed.taskId !== filter.taskId) continue
      events.push(parsed)
    } catch {
      // 跳过坏行
    }
  }
  return events.sort((a, b) => a.seq - b.seq)
}

export interface RawLogDeps {
  keep?: number
  appendFile?: (path: string, data: string) => void
  mkdirp?: (path: string) => void
  listDir?: (path: string) => string[]
  mtimeMs?: (path: string) => number
  remove?: (path: string) => void
}

/** 追加一条脱敏后的原始输出（Agent 输出不直接进事件流）。 */
export function appendRawLog(logsDir: string, taskId: string, text: string, deps: RawLogDeps = {}): string {
  const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(taskId) ? taskId : 'unknown'
  const mkdirp = deps.mkdirp ?? ((path: string) => mkdirSync(path, { recursive: true }))
  const append = deps.appendFile ?? ((path: string, data: string) => appendFileSync(path, data, 'utf-8'))
  mkdirp(logsDir)
  const path = join(logsDir, `${safeId}.log`)
  append(path, redactSecrets(text))
  pruneRawLogs(logsDir, deps.keep ?? DEFAULT_LOG_KEEP, deps)
  return path
}

/** 只保留最近 N 个任务的原始日志；新写入的任务因 mtime 最新自然保留。 */
export function pruneRawLogs(logsDir: string, keep: number, deps: RawLogDeps = {}): void {
  if (keep <= 0) return
  const list = deps.listDir ?? ((path: string) => {
    try {
      return readdirSync(path).filter((name) => name.endsWith('.log'))
    } catch {
      return []
    }
  })
  const mtimeMs = deps.mtimeMs ?? ((path: string) => {
    try {
      return statSync(path).mtimeMs
    } catch {
      return 0
    }
  })
  const remove = deps.remove ?? ((path: string) => unlinkSync(path))

  const files = list(logsDir).map((name) => ({ name, at: mtimeMs(join(logsDir, name)) }))
  if (files.length <= keep) return
  files.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
  for (const file of files.slice(0, files.length - keep)) remove(join(logsDir, file.name))
}

export interface ProjectedAgentEvent {
  code: string
  level: FactoryEventLevel
  params?: Record<string, string | number>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(value: unknown): string {
  const text = typeof value === 'string' ? value : ''
  return text.length > MAX_PARAM_TEXT ? `${text.slice(0, MAX_PARAM_TEXT)}…` : text
}

function usageParams(data: Record<string, unknown>): Record<string, number> {
  const usage = isRecord(data.usage) ? data.usage : {}
  const pick = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      if (typeof usage[key] === 'number') return usage[key] as number
    }
    return undefined
  }
  const inputTokens = pick('input_tokens', 'input', 'prompt_tokens')
  const outputTokens = pick('output_tokens', 'output', 'completion_tokens')
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  }
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'List', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Create'])

/**
 * 把引擎路由事件压成一条可读摘要。
 * `assistant`/`stream_event`/`tool_result`/`log` 一律返回 null —— 逐 token 或原始行
 * 属于日志文件，不属于事件流。
 */
export function projectAgentEvent(eventType: string, data: unknown): ProjectedAgentEvent | null {
  if (eventType === 'tool_use') {
    const record = isRecord(data) ? data : {}
    const toolUse = isRecord(record.tool_use) ? record.tool_use : {}
    const tool = typeof record.name === 'string' ? record.name : String(toolUse.name ?? '')
    const input = isRecord(record.input) ? record.input : isRecord(toolUse.input) ? toolUse.input : {}
    const target =
      typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.path === 'string'
          ? input.path
          : typeof input.pattern === 'string'
            ? input.pattern
            : ''
    if (READ_TOOLS.has(tool)) {
      return { code: 'agent.read', level: 'info', params: { target: truncate(target) } }
    }
    if (EDIT_TOOLS.has(tool)) {
      return { code: 'agent.edit', level: 'info', params: { target: truncate(target) } }
    }
    if (tool === 'Bash') {
      return { code: 'agent.exec', level: 'info', params: { command: truncate(input.command) } }
    }
    return { code: 'agent.tool', level: 'info', params: { tool: truncate(tool) } }
  }

  if (eventType === 'result') {
    const record = isRecord(data) ? data : {}
    return {
      code: 'agent.turn',
      level: record.is_error === true ? 'error' : 'ok',
      params: usageParams(record),
    }
  }
  if (eventType === 'error') {
    const record = isRecord(data) ? data : {}
    const message = record.message ?? record.detail ?? 'unknown'
    return {
      code: 'agent.error',
      level: 'error',
      params: { message: truncate(redactSecrets(String(message))) },
    }
  }
  if (eventType === 'exit') {
    const record = isRecord(data) ? data : {}
    return {
      code: 'agent.exit',
      level: 'warn',
      params: { code: typeof record.code === 'number' ? record.code : 1 },
    }
  }
  if (eventType === 'permission_request') {
    const record = isRecord(data) ? data : {}
    return {
      code: 'agent.permission',
      level: 'warn',
      params: { tool: truncate(record.tool_name ?? record.name ?? '') },
    }
  }
  return null
}
