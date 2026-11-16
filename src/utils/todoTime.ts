/**
 * Todo 的时间口径 — 全部按本地时区算，因为「今天」是用户的今天而不是 UTC 的今天。
 *
 * 纯函数，store 与组件共用；不引入 i18n，文案由调用方按 bucket 取 key。
 */
import type { Todo } from '@/shared/channels/todo'

const DAY_MS = 24 * 60 * 60 * 1000

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** 到期时间落在今天（含已过期但仍是今天的）。 */
export function isDueToday(todo: Todo, now: number): boolean {
  if (todo.dueAt === undefined) return false
  return todo.dueAt >= startOfDay(now) && todo.dueAt <= endOfDay(now)
}

export function isOverdue(todo: Todo, now: number): boolean {
  return todo.status === 'open' && todo.dueAt !== undefined && todo.dueAt < now
}

/** 「即将到来」= 明天起 7 天内，不含今天（今天在 today 视图里）。 */
export function isUpcoming(todo: Todo, now: number): boolean {
  if (todo.dueAt === undefined) return false
  return todo.dueAt > endOfDay(now) && todo.dueAt <= endOfDay(now) + 7 * DAY_MS
}

export type TodoDueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

export function dueBucket(todo: Todo, now: number): TodoDueBucket {
  if (todo.dueAt === undefined) return 'none'
  if (isOverdue(todo, now)) return 'overdue'
  if (isDueToday(todo, now)) return 'today'
  if (todo.dueAt <= endOfDay(now) + DAY_MS) return 'tomorrow'
  if (todo.dueAt <= endOfDay(now) + 7 * DAY_MS) return 'week'
  return 'later'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 拆成 CalendarField / TimeWheelField 认的两个字符串。 */
export function splitDueAt(ms: number): { date: string; time: string } {
  const d = new Date(ms)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** 空日期视为「不设时间」；只给日期时按当天 09:00 落地，避免默认到 00:00 立刻过期。 */
export function combineDateAndTime(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  const hours = match ? Number(match[1]) : 9
  const minutes = match ? Number(match[2]) : 0
  if (hours > 23 || minutes > 59) return null
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** 列表里的紧凑时间：今天只显示时刻，今年显示月日，跨年带上 year。 */
export function formatDueShort(ms: number, now: number, locale: string): string {
  const d = new Date(ms)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (startOfDay(ms) === startOfDay(now)) return time
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const datePart = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d)
  return `${datePart} ${time}`
}

/** 相对时间，用于「Agent 刚刚动过」「上次同步」。 */
export function formatRelativeFromNow(ms: number, now: number, locale: string): string {
  const diffSeconds = Math.round((ms - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit)
    }
  }
  return formatter.format(0, 'minute')
}