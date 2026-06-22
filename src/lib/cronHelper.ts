/**
 * Lightweight cron expression utilities for frontend display.
 * These are simplified parsers — the backend handles the authoritative scheduling.
 */

import { i18n } from '@/i18n'

const t = i18n.global.t.bind(i18n.global)

/**
 * Convert a 5-field cron expression to a human-readable description.
 * Supports common patterns: every minute, hourly, daily, weekly, monthly, specific times.
 */
export function cronToHuman(cron: string): string {
  if (!cron) return ''
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Every minute: * * * * *
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return t('cronHelper.everyMinute')
  }

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = minute.slice(2)
    return t('cronHelper.everyNMinutes', { n })
  }

  // Every hour at minute M: M * * * *
  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return t('cronHelper.hourlyAt', { minute: minute.padStart(2, '0') })
  }

  // Every day at HH:MM: M H * * *
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return t('cronHelper.dailyAt', { hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') })
  }

  // Weekdays at HH:MM: M H * * 1-5
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return t('cronHelper.weekdayAt', { hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') })
  }

  // Specific day of week at HH:MM: M H * * N
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const dayNum = parseInt(dayOfWeek, 10)
    const weekdays = t('cronHelper.weekdays') as unknown as string[]
    if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) {
      return t('cronHelper.everyWeekday', { weekday: weekdays[dayNum], hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') })
    }
    // Range like 1-5 already handled above, fallback
    return t('cronHelper.weeklyOn', { weekday: dayOfWeek, hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') })
  }

  // Monthly on day D at HH:MM: M H D * *
  if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return t('cronHelper.monthlyOn', { day: dayOfMonth, hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') })
  }

  // Specific date: M H D M * (one-shot like)
  if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month !== '*' && dayOfWeek === '*') {
    return t('cronHelper.yearlyOn', { month, day: dayOfMonth, hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') })
  }

  // Fallback: return the raw expression
  return cron
}

/**
 * Compute the next fire time for a 5-field cron expression.
 * This is a simplified forward-search algorithm — iterates minute-by-minute
 * up to 366 days ahead. Good enough for UI display.
 */
export function computeNextCronRun(cron: string, from?: Date): Date | null {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minuteField, hourField, domField, monthField, dowField] = parts

  const now = from || new Date()
  // Start from the next minute
  const start = new Date(now.getTime())
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)

  const maxIterations = 525960 // 366 days * 24 * 60 minutes
  const cursor = new Date(start.getTime())

  for (let i = 0; i < maxIterations; i++) {
    if (matchesField(minuteField, cursor.getMinutes(), 0, 59) &&
        matchesField(hourField, cursor.getHours(), 0, 23) &&
        matchesField(domField, cursor.getDate(), 1, 31) &&
        matchesField(monthField, cursor.getMonth() + 1, 1, 12) &&
        matchesField(dowField, cursor.getDay(), 0, 6)) {
      return cursor
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  return null
}

function matchesField(field: string, value: number, min: number, max: number): boolean {
  // *
  if (field === '*') return true

  // */N
  const stepMatch = field.match(/^\*\/(\d+)$/)
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10)
    return step > 0 && value % step === 0
  }

  // Range: N-M
  const rangeMatch = field.match(/^(\d+)-(\d+)$/)
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10)
    const hi = parseInt(rangeMatch[2], 10)
    return value >= lo && value <= hi
  }

  // Range with step: N-M/S
  const rangeStepMatch = field.match(/^(\d+)-(\d+)\/(\d+)$/)
  if (rangeStepMatch) {
    const lo = parseInt(rangeStepMatch[1], 10)
    const hi = parseInt(rangeStepMatch[2], 10)
    const step = parseInt(rangeStepMatch[3], 10)
    return value >= lo && value <= hi && (value - lo) % step === 0
  }

  // List: N,M,K
  if (field.includes(',')) {
    return field.split(',').some(part => {
      const n = parseInt(part, 10)
      return !isNaN(n) && n === value
    })
  }

  // Single value
  const n = parseInt(field, 10)
  return !isNaN(n) && n === value
}

/**
 * Format a Date as a relative or absolute "next fire" string.
 */
export function formatNextFire(date: Date | null): string {
  if (!date) return ''

  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)

  if (diffMin < 1) return t('cronHelper.upcoming')
  if (diffMin < 60) return t('cronHelper.inNMinutes', { count: diffMin })

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth()
    if (isToday) {
      return t('cronHelper.todayAt', { time: `${pad(date.getHours())}:${pad(date.getMinutes())}` })
    }
    return t('cronHelper.inNHours', { count: diffHours })
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) {
    return t('cronHelper.tomorrowAt', { time: `${pad(date.getHours())}:${pad(date.getMinutes())}` })
  }

  if (diffDays < 7) {
    const weekdays = t('cronHelper.weekdays') as unknown as string[]
    return `${weekdays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  // Same year
  if (date.getFullYear() === now.getFullYear()) {
    return t('cronHelper.dateAt', { month: date.getMonth() + 1, day: date.getDate(), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` })
  }

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Format duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms == null || ms <= 0) return ''
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}
