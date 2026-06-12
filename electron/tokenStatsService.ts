import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface TokenStatsDailyEntry {
  date: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  sessionCount: number
  messageCount: number
  tokensByModel: Record<string, number>
}

export interface TokenStatsSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  sessionCount: number
  messageCount: number
}

export interface TokenStatsResult {
  generatedAt: string
  sourceDir: string
  firstDate: string | null
  lastDate: string | null
  today: TokenStatsSummary
  yesterday: TokenStatsSummary
  last30Days: TokenStatsSummary
  allTime: TokenStatsSummary
  daily: TokenStatsDailyEntry[]
  modelUsage: Record<string, TokenStatsSummary>
}

type MutableDaily = TokenStatsDailyEntry & { sessionIds: Set<string> }
type MutableSummary = TokenStatsSummary

const EMPTY_SUMMARY: TokenStatsSummary = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  sessionCount: 0,
  messageCount: 0,
}

function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects')
}

function getStatsCachePath(): string {
  return join(homedir(), '.claude', 'stats-cache.json')
}

function dateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function addUsage(target: MutableSummary, usage: TokenStatsSummary): void {
  target.inputTokens += usage.inputTokens
  target.outputTokens += usage.outputTokens
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens
  target.cacheReadInputTokens += usage.cacheReadInputTokens
  target.totalTokens += usage.totalTokens
  target.messageCount += usage.messageCount
}

function getUsage(entry: any): TokenStatsSummary | null {
  const usage = entry?.message?.usage || entry?.usage
  if (!usage || typeof usage !== 'object') return null
  const inputTokens = Number(usage.input_tokens || 0)
  const outputTokens = Number(usage.output_tokens || 0)
  const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens || 0)
  const cacheReadInputTokens = Number(usage.cache_read_input_tokens || 0)
  const totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    sessionCount: 0,
    messageCount: 1,
  }
}

function getModel(entry: any): string {
  const model = entry?.message?.model || entry?.model
  return typeof model === 'string' && model.trim() ? model : 'unknown'
}

function getSessionId(filePath: string, entry: any): string {
  if (typeof entry?.sessionId === 'string') return entry.sessionId
  if (typeof entry?.session_id === 'string') return entry.session_id
  return filePath
}

function collectJsonlFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFiles(path, files)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path)
    }
  }
  return files
}

function createDaily(date: string): MutableDaily {
  return {
    date,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    sessionCount: 0,
    messageCount: 0,
    tokensByModel: {},
    sessionIds: new Set<string>(),
  }
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function offsetDate(base: Date, offsetDays: number): string {
  const date = new Date(base)
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function summarize(days: TokenStatsDailyEntry[]): TokenStatsSummary {
  const result = { ...EMPTY_SUMMARY }
  for (const day of days) {
    result.totalTokens += day.totalTokens
    result.inputTokens += day.inputTokens
    result.outputTokens += day.outputTokens
    result.cacheCreationInputTokens += day.cacheCreationInputTokens
    result.cacheReadInputTokens += day.cacheReadInputTokens
    result.sessionCount += day.sessionCount
    result.messageCount += day.messageCount
  }
  return result
}

export function aggregateLocalTokenStats(): TokenStatsResult {
  const sourceDir = getClaudeProjectsDir()
  const dailyMap = new Map<string, MutableDaily>()
  const modelUsage: Record<string, TokenStatsSummary> = {}

  for (const filePath of collectJsonlFiles(sourceDir)) {
    let content = ''
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue
      let entry: any
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      const usage = getUsage(entry)
      const date = dateKey(entry?.timestamp)
      if (!usage || !date) continue

      const model = getModel(entry)
      const sessionId = getSessionId(filePath, entry)
      const daily = dailyMap.get(date) || createDaily(date)
      addUsage(daily, usage)
      daily.tokensByModel[model] = (daily.tokensByModel[model] || 0) + usage.totalTokens
      daily.sessionIds.add(sessionId)
      daily.sessionCount = daily.sessionIds.size
      dailyMap.set(date, daily)

      if (!modelUsage[model]) modelUsage[model] = { ...EMPTY_SUMMARY }
      addUsage(modelUsage[model], usage)
    }
  }

  const daily = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ sessionIds, ...entry }) => entry)

  const todayKey = offsetDate(new Date(), 0)
  const yesterdayKey = offsetDate(new Date(), -1)
  const start30Key = offsetDate(new Date(), -29)
  const result: TokenStatsResult = {
    generatedAt: new Date().toISOString(),
    sourceDir,
    firstDate: daily[0]?.date || null,
    lastDate: daily.length > 0 ? daily[daily.length - 1].date : null,
    today: summarize(daily.filter(day => day.date === todayKey)),
    yesterday: summarize(daily.filter(day => day.date === yesterdayKey)),
    last30Days: summarize(daily.filter(day => inRange(day.date, start30Key, todayKey))),
    allTime: summarize(daily),
    daily,
    modelUsage,
  }

  try {
    const cachePath = getStatsCachePath()
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf-8')
  } catch {
  }

  try {
    statSync(sourceDir)
  } catch {
  }

  return result
}
