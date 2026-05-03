import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from 'fs'
import { app } from 'electron'
import * as os from 'os'

// ============================================================
// Structured Debug Logger — writes to ~/.claude/debug/
// ============================================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const MAX_LOG_FILES = 7         // 保留最近 7 天的日志
const MAX_LINE_LENGTH = 4000    // 单行日志最大长度
const MAX_DATA_PREVIEW = 800    // data 字段预览最大长度

let logDir: string
let logFilePath: string
let sessionLogFile: string | null = null
let _debugMode = false

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

  // 确保目录存在
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }

  // 按本地日期命名主日志文件
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  logFilePath = join(logDir, `app-${dateStr}.log`)

  // 清理旧日志
  cleanOldLogs()

  // 检测 --debug 启动参数
  _debugMode = app.commandLine.hasSwitch('debug') || process.argv.includes('--debug')

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
  sessionLogFile = join(logDir, `session-${shortId}-${dateStr}-${timeStr}.log`)
  debug('Logger', `Session log file created: ${sessionLogFile}`)
}

/**
 * 获取当前 debug 模式状态
 */
export function isDebugMode(): boolean {
  return _debugMode
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

  if (sessionLogFile) {
    const sessionLine = formatLine(level, 'PROCESS', `${stream} | ${preview}`)
    try { appendFileSync(sessionLogFile, sessionLine) } catch {}
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
  switch (level) {
    case 'ERROR': console.error(line); break
    case 'WARN':  console.warn(line); break
    default:      console.log(line); break
  }

  // 按需写文件
  if (writeFile) {
    writeLine(line, true)
  }
}

function formatLine(level: LogLevel, scope: string, content: string): string {
  const ts = toLocalISOString()
  const line = `[${ts}] [${level}] [${scope}] ${content}`
  return truncate(line, MAX_LINE_LENGTH) + '\n'
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
