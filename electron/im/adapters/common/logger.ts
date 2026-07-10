/**
 * Logger — Lightweight structured JSON logger for IM adapters
 *
 * Outputs single-line JSON to stderr, parseable by jq or log aggregation tools.
 * Zero external dependencies (no pino, etc.) — respects common layer principle.
 *
 * Format: { "ts": "...", "level": "...", "platform": "...", "event": "...", "msg": "...", "fields": {...} }
 * Controlled by LOG_LEVEL env var (default: info)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function getCurrentLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase()
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env
  }
  return 'info'
}

interface LogEntry {
  ts: string
  level: LogLevel
  platform: string
  chatId?: string
  sessionId?: string
  event: string
  msg: string
  fields?: Record<string, unknown>
}

export class ImLogger {
  private readonly platform: string
  private minLevel: LogLevel

  constructor(platform: string) {
    this.platform = platform
    this.minLevel = getCurrentLevel()
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level
  }

  debug(event: string, msg: string, opts?: { chatId?: string; sessionId?: string; fields?: Record<string, unknown> }): void {
    this.log('debug', event, msg, opts)
  }

  info(event: string, msg: string, opts?: { chatId?: string; sessionId?: string; fields?: Record<string, unknown> }): void {
    this.log('info', event, msg, opts)
  }

  warn(event: string, msg: string, opts?: { chatId?: string; sessionId?: string; fields?: Record<string, unknown> }): void {
    this.log('warn', event, msg, opts)
  }

  error(event: string, msg: string, opts?: { chatId?: string; sessionId?: string; fields?: Record<string, unknown> }): void {
    this.log('error', event, msg, opts)
  }

  private log(level: LogLevel, event: string, msg: string, opts?: { chatId?: string; sessionId?: string; fields?: Record<string, unknown> }): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      platform: this.platform,
      event,
      msg,
    }

    if (opts?.chatId) entry.chatId = opts.chatId
    if (opts?.sessionId) entry.sessionId = opts.sessionId
    if (opts?.fields) entry.fields = opts.fields

    const line = JSON.stringify(entry)
    process.stderr.write(line + '\n')
  }
}

/** Create a logger for a specific platform. */
export function createLogger(platform: string): ImLogger {
  return new ImLogger(platform)
}
