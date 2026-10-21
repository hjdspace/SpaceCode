import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync, readFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { app } from 'electron'
import * as os from 'os'
import { initTraceSidecar, recordTraceEvent } from './traceSidecar'
import { parseTraceFile } from './traceParseWorker'
import type { AgentTraceEventForTrace } from './traceAggregate'

// ============================================================
// Structured Debug Logger — writes to ~/.claude/debug/
// ============================================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const MAX_LOG_FILES = 7         // 保留最近 7 天的日志
const MAX_LINE_LENGTH = 4000    // 单行日志最大长度
const MAX_DATA_PREVIEW = 800    // data 字段预览最大长度

let logDir: string
let logFilePath: string
let traceDir: string
const sessionLogFiles = new Map<string, string>()
let _debugMode = false
/** stdio 写坏过一次就永久停用 console 镜像，只留文件日志（见 safeConsoleWrite） */
let consoleMirrorBroken = false

export type AgentTraceEvent = {
  id?: string
  sessionId: string
  engineSessionId?: string
  turnId?: string
  messageId?: string
  timestamp?: string
  source?: 'renderer' | 'electron' | 'engine'
  actor?: 'user' | 'assistant' | 'tool' | 'system'
  type: string
  status?: 'started' | 'running' | 'completed' | 'failed'
  title?: string
  input?: unknown
  output?: unknown
  artifacts?: Array<{ kind: string; path?: string; content?: string }>
  evidence?: Array<{ kind: string; result?: string; detail: string }>
  error?: { message: string; stack?: string }
  metadata?: Record<string, unknown>
}

/**
 * 返回本地时间的 ISO 格式字符串（带时区偏移），如 2026-05-03T18:37:51.123+08:00
 */
function toLocalISOString(date: Date = new Date()): string {
  const off = date.getTimezoneOffset()
  const sign = off <= 0 ? '+' : '-'
  const absOff = Math.abs(off)
  const hh = String(Math.floor(absOff / 60)).padStart(2, '0')
  const mm = String(absOff % 60).padStart(2, '0')
  const y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const H = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${y}-${M}-${d}T${H}:${m}:${s}.${ms}${sign}${hh}:${mm}`
}

/**
 * 初始化日志系统，必须在 app.ready 之后调用
 */
export function initLogger(): void {
  const homeDir = app.getPath('home') || os.homedir()
  logDir = join(homeDir, '.claude', 'debug')
  traceDir = join(logDir, 'traces')

  // 确保目录存在
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
  if (!existsSync(traceDir)) {
    mkdirSync(traceDir, { recursive: true })
  }

  // 按本地日期命名主日志文件
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  logFilePath = join(logDir, `app-${dateStr}.log`)

  // 清理旧日志
  cleanOldLogs()

  // stdio 管道可能已经坏掉（macOS 从 Finder 启动、或退出阶段管道先于进程关闭）。
  // 'error' 事件没人接就会变成 uncaughtException，把 before-quit 的清理链打断 ——
  // 这里接住它，之后由 consoleMirrorBroken 停止写 console。
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', () => { consoleMirrorBroken = true })
  }

  // 检测 --debug 启动参数
  _debugMode = app.commandLine.hasSwitch('debug') || process.argv.includes('--debug')

  // 侧车目录与 trace 目录一致；此后 traceEvent 逐事件增量维护 summary，
  // trace:list 零解析（见 traceSidecar.ts）。
  initTraceSidecar(traceDir)

  debug('Logger', `Log system initialized | dir=${logDir} | debugMode=${_debugMode} | platform=${process.platform} | arch=${process.arch} | electron=${process.versions.electron} | node=${process.versions.node}`)
}

/**
 * 设置会话级日志文件（每个 Claude Code 会话单独一个文件）
 */
export function setSessionLogPath(sessionId: string): void {
  if (!logDir) return
  const shortId = sessionId.slice(0, 8)
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
  const sessionLogFile = join(logDir, `session-${shortId}-${dateStr}-${timeStr}.log`)
  sessionLogFiles.set(sessionId, sessionLogFile)
  debug('Logger', `Session log file created: ${sessionLogFile}`)
}

/**
 * 获取当前 debug 模式状态
 */
export function isDebugMode(): boolean {
  return _debugMode
}

/**
 * 获取 trace 目录路径
 */
export function getTraceDir(): string {
  return traceDir || ''
}

/**
 * DEBUG 级别日志 — 仅 debug 模式下写文件，始终输出到 console
 */
export function debug(scope: string, message: string, data?: any): void {
  writeLog('DEBUG', scope, message, data, _debugMode)
}

/**
 * INFO 级别日志 — 始终写文件
 */
export function info(scope: string, message: string, data?: any): void {
  writeLog('INFO', scope, message, data, true)
}

/**
 * WARN 级别日志 — 始终写文件
 */
export function warn(scope: string, message: string, data?: any): void {
  writeLog('WARN', scope, message, data, true)
}

/**
 * ERROR 级别日志 — 始终写文件
 */
export function error(scope: string, message: string, data?: any): void {
  writeLog('ERROR', scope, message, data, true)
}

/**
 * 记录 SDK 消息（来自子进程的 NDJSON 消息），始终写文件
 */
export function sdkMessage(sessionId: string, msgType: string, msg: any): void {
  const shortSid = sessionId.slice(0, 8)
  const preview = truncate(safeStringify(msg), MAX_DATA_PREVIEW)
  const line = formatLine('INFO', 'SDK', `[${shortSid}] ${msgType} | ${preview}`)
  writeLine(line, true)

  // 如果有会话日志文件，也写入
  const sessionLogFile = sessionLogFiles.get(sessionId)
  if (sessionLogFile) {
    const sessionLine = formatLine('INFO', 'SDK', `${msgType} | ${preview}`)
    try { appendFileSync(sessionLogFile, sessionLine) } catch {}
  }
}

/**
 * 记录子进程原始输出（stdout/stderr），始终写文件
 */
export function processRaw(sessionId: string, stream: 'stdout' | 'stderr', data: string): void {
  const shortSid = sessionId.slice(0, 8)
  const preview = truncate(data.replace(/\n/g, '\\n'), MAX_DATA_PREVIEW)
  const level: LogLevel = stream === 'stdout' ? 'INFO' : 'DEBUG'
  const line = formatLine(level, 'PROCESS', `[${shortSid}] ${stream} | ${preview}`)
  writeLine(line, stream === 'stdout' ? true : _debugMode)

  const sessionLogFile = sessionLogFiles.get(sessionId)
  if (sessionLogFile) {
    const sessionLine = formatLine(level, 'PROCESS', `${stream} | ${preview}`)
    try { appendFileSync(sessionLogFile, sessionLine) } catch {}
  }
}

export function traceEvent(event: AgentTraceEvent): void {
  if (!event?.sessionId || !event.type) return
  ensureTraceDir()
  const safeSessionId = sanitizeFilePart(event.sessionId)
  const fullEvent = {
    id: event.id || randomId(),
    timestamp: event.timestamp || toLocalISOString(),
    source: event.source || 'electron',
    ...redactSensitive(event),
  }
  const line = safeStringify(fullEvent) + '\n'
  const filePath = join(traceDir, `session-${safeSessionId}.jsonl`)
  try {
    appendFileSync(filePath, line, { mode: 0o600 })
  } catch {
    try {
      ensureTraceDir()
      appendFileSync(filePath, line, { mode: 0o600 })
    } catch {}
    return
  }
  // 追加成功后增量更新 summary 侧车（stat 结果即校验凭据，见 traceSidecar.ts）。
  // statSync 是微秒级系统调用，相对 appendFileSync 可忽略。
  try {
    const st = statSync(filePath)
    recordTraceEvent(safeSessionId, fullEvent as AgentTraceEventForTrace, {
      size: st.size,
      modifiedAt: st.mtime.getTime(),
    })
  } catch {}
}

export function listDebugFiles(): Array<{ name: string; path: string; size: number; modifiedAt: number; kind: 'app' | 'session' | 'trace' }> {
  if (!logDir) return []
  const files: Array<{ name: string; path: string; size: number; modifiedAt: number; kind: 'app' | 'session' | 'trace' }> = []
  try {
    for (const name of readdirSync(logDir)) {
      const path = join(logDir, name)
      const stat = statSync(path)
      if (!stat.isFile()) continue
      if (!name.endsWith('.log')) continue
      files.push({
        name,
        path,
        size: stat.size,
        modifiedAt: stat.mtime.getTime(),
        kind: name.startsWith('session-') ? 'session' : 'app',
      })
    }
  } catch {}
  try {
    ensureTraceDir()
    for (const name of readdirSync(traceDir)) {
      const path = join(traceDir, name)
      const stat = statSync(path)
      if (!stat.isFile() || !name.endsWith('.jsonl')) continue
      files.push({ name, path, size: stat.size, modifiedAt: stat.mtime.getTime(), kind: 'trace' })
    }
  } catch {}
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function readDebugFile(filePath: string, maxBytes = 1024 * 1024): { success: boolean; content?: string; error?: string } {
  try {
    if (!isAllowedDebugPath(filePath)) {
      return { success: false, error: 'Path is outside debug directory' }
    }
    const stat = statSync(filePath)
    const start = Math.max(0, stat.size - maxBytes)
    const content = readFileSync(filePath).subarray(start).toString('utf8')
    return { success: true, content }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function listTraceSessions(): Promise<Array<{ sessionId: string; path: string; size: number; modifiedAt: number }>> {
  ensureTraceDir()
  const sessions: Array<{ sessionId: string; path: string; size: number; modifiedAt: number }> = []
  try {
    const names = await readdir(traceDir)
    for (const name of names) {
      if (!name.startsWith('session-') || !name.endsWith('.jsonl')) continue
      const path = join(traceDir, name)
      const statResult = await stat(path)
      sessions.push({
        sessionId: name.slice('session-'.length, -'.jsonl'.length),
        path,
        size: statResult.size,
        modifiedAt: statResult.mtime.getTime(),
      })
    }
  } catch {}
  return sessions.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/**
 * 轻量 stat 一个 trace 会话文件，用于轮询前的变更检测：
 * size/mtime 未变化时调用方可跳过全量读取与解析。
 */
export async function statTraceSession(sessionId: string): Promise<{ size: number; modifiedAt: number } | null> {
  try {
    ensureTraceDir()
    const filePath = join(traceDir, `session-${sanitizeFilePart(sessionId)}.jsonl`)
    if (!isAllowedDebugPath(filePath)) return null
    const statResult = await stat(filePath)
    return { size: statResult.size, modifiedAt: statResult.mtime.getTime() }
  } catch {
    return null
  }
}

export async function readTraceEvents(sessionId: string, maxEvents = 1000): Promise<{ success: boolean; events?: AgentTraceEvent[]; error?: string }> {
  try {
    ensureTraceDir()
    const filePath = join(traceDir, `session-${sanitizeFilePart(sessionId)}.jsonl`)
    if (!isAllowedDebugPath(filePath) || !existsSync(filePath)) {
      return { success: false, error: 'Trace session not found' }
    }
    // 解析在 worker 线程执行（maxEvents=0 表示全量，供侧车冷启动回填）；
    // 大文件的 split + JSON.parse 不再阻塞主进程事件循环。
    const result = await parseTraceFile(filePath, maxEvents)
    if (!result.success) return { success: false, error: result.error }
    return { success: true, events: result.events as AgentTraceEvent[] }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/**
 * 记录 IPC 通信
 */
export function ipc(direction: '→' | '←' | '✗', channel: string, data?: any, durationMs?: number): void {
  const preview = data !== undefined ? truncate(safeStringify(data), MAX_DATA_PREVIEW) : ''
  const duration = durationMs !== undefined ? ` (${durationMs}ms)` : ''
  const line = formatLine('INFO', 'IPC', `${direction} ${channel}${duration} | ${preview}`)
  writeLine(line, true)
}

/**
 * 记录渲染进程日志（通过 IPC 转发）
 */
export function rendererLog(level: LogLevel, scope: string, message: string, data?: any): void {
  writeLog(level, `RENDERER:${scope}`, message, data, true)
}

// ============================================================
// Internal
// ============================================================

function writeLog(level: LogLevel, scope: string, message: string, data: any, writeFile: boolean): void {
  const dataStr = data !== undefined ? ` | ${truncate(safeStringify(data), MAX_DATA_PREVIEW)}` : ''
  const line = formatLine(level, scope, `${message}${dataStr}`)

  // 始终输出到 console
  safeConsoleWrite(level, line)

  // 按需写文件
  if (writeFile) {
    writeLine(line, true)
  }
}

/**
 * console 输出绝不能抛：日志器在 before-quit 的清理链上被调用，而 stdio 管道那时
 * 可能已经关闭，`console.log` 会抛 `write EIO`。没有 uncaughtException 兜底的话
 * Electron 会弹原生异常框并把退出流程卡住（Dock 图标残留 = 进程还活着）。
 */
function safeConsoleWrite(level: LogLevel, line: string): void {
  if (consoleMirrorBroken) return
  try {
    switch (level) {
      case 'ERROR': console.error(line); break
      case 'WARN':  console.warn(line); break
      default:      console.log(line); break
    }
  } catch {
    consoleMirrorBroken = true
  }
}

// ============================================================
// argv 脱敏兜底 —— 启动日志把 spawn 的 argv join 成一行（redactArgsForLog
// 负责逐旗标打码，见 infra/redactArgs.ts）；这里再拦一层：无论哪条日志路径，
// 行内 --api-key 的值都不回显（覆盖漏接的调用点与连写形式）。
// ============================================================

const API_KEY_IN_LINE_RE = /--api-key[ =]\S+/g

function redactCommandLine(line: string): string {
  return line.replace(API_KEY_IN_LINE_RE, (matched) => {
    // redactArgsForLog 已打码成 `prob****cret` 的形态要保留 —— 首尾 4 位是留给对账的
    if (matched.includes('****')) return matched
    return matched.includes('=') ? '--api-key=****' : '--api-key ****'
  })
}

function formatLine(level: LogLevel, scope: string, content: string): string {
  const ts = toLocalISOString()
  const line = `[${ts}] [${level}] [${scope}] ${content}`
  return truncate(redactCommandLine(line), MAX_LINE_LENGTH) + '\n'
}

function writeLine(line: string, always: boolean): void {
  if (!always && !_debugMode) return
  if (!logFilePath) return
  try {
    appendFileSync(logFilePath, line)
  } catch {}
}

function cleanOldLogs(): void {
  if (!logDir) return
  try {
    const files = readdirSync(logDir)
      .filter(f => f.startsWith('app-') || f.startsWith('session-'))
      .map(f => ({ name: f, path: join(logDir, f), mtime: statSync(join(logDir, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)

    // 保留最新的 MAX_LOG_FILES * 3 个文件（每天可能有主日志 + 多个会话日志）
    const maxKeep = MAX_LOG_FILES * 5
    for (let i = maxKeep; i < files.length; i++) {
      try { unlinkSync(files[i].path) } catch {}
    }
  } catch {}
}

function ensureTraceDir(): void {
  if (!traceDir && logDir) {
    traceDir = join(logDir, 'traces')
  }
  if (traceDir && !existsSync(traceDir)) {
    mkdirSync(traceDir, { recursive: true })
  }
}

function safeStringify(obj: any): string {
  if (obj === undefined) return 'undefined'
  if (obj === null) return 'null'
  if (typeof obj === 'string') return obj
  if (obj instanceof Error) return `Error: ${obj.message} | stack=${obj.stack?.slice(0, 300)}`
  try {
    // 对含敏感信息的字段做脱敏
    const redacted = redactSensitive(obj)
    return JSON.stringify(redacted)
  } catch {
    return String(obj).slice(0, MAX_DATA_PREVIEW)
  }
}

function redactSensitive(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  const SENSITIVE_KEYS = new Set(['apiKey', 'api_key', 'password', 'secret', 'token', 'authorization', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'])
  if (Array.isArray(obj)) return obj.map(redactSensitive)
  const result: any = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) {
      result[k] = typeof v === 'string' ? `${(v as string).slice(0, 4)}****${(v as string).slice(-4)}` : '****'
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactSensitive(v)
    } else {
      result[k] = v
    }
  }
  return result
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 3) + '...'
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isAllowedDebugPath(filePath: string): boolean {
  if (!logDir) return false
  const normalized = filePath.replace(/\\/g, '/')
  const normalizedLogDir = logDir.replace(/\\/g, '/')
  return normalized.startsWith(normalizedLogDir + '/')
}
