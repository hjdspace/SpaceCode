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

  // Every N hours at :MM: M */N * * *
  if (minute !== '*' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = hour.slice(2)
    return t('cronHelper.everyNHours', { n })
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
 * 逐日推进，只在日期命中的那天扫时分取值表 —— 逐分钟暴力搜在「明年同一分钟」
 * 这类表达式上要迭代 52 万次，时间滚轮每动一格都会同步卡一下。
 */
export function computeNextCronRun(cron: string, from?: Date): Date | null {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minuteField, hourField, domField, monthField, dowField] = parts
  const minutes = expandField(minuteField, 0, 59)
  const hours = expandField(hourField, 0, 23)
  const doms = expandField(domField, 1, 31)
  const months = expandField(monthField, 1, 12)
  const dows = expandField(dowField, 0, 6)
  if (!minutes || !hours || !doms || !months || !dows) return null

  const monthSet = new Set(months)
  const domSet = new Set(doms)
  const dowSet = new Set(dows)
  // 标准 cron：dom 与 dow 同时限定时取并集，否则取交集
  const bothDaysConstrained = domField !== '*' && dowField !== '*'

  const cursor = new Date((from || new Date()).getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = cursor.getTime() + 366 * 24 * 60 * 60 * 1000

  while (cursor.getTime() <= limit) {
    const domOk = domSet.has(cursor.getDate())
    const dowOk = dowSet.has(cursor.getDay())
    const dayOk = bothDaysConstrained ? domOk || dowOk : domOk && dowOk
    if (monthSet.has(cursor.getMonth() + 1) && dayOk) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const candidate = new Date(
            cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hour, minute,
          )
          if (candidate.getTime() >= cursor.getTime()) return candidate
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
  }

  return null
}

/** 把单值、区间、步长、列表这几类 cron 字段展开成升序取值表；无法解析返回 null */
function expandField(field: string, min: number, max: number): number[] | null {
  const values: number[] = []
  for (const part of field.split(',')) {
    const [spec, stepSpec] = part.split('/')
    if (!spec) return null
    const step = stepSpec === undefined ? 1 : Number(stepSpec)
    if (!Number.isInteger(step) || step < 1) return null

    let lo = min
    let hi = max
    if (spec !== '*') {
      const bounds = spec.split('-')
      lo = Number(bounds[0])
      hi = bounds.length > 1 ? Number(bounds[1]) : lo
      if (stepSpec !== undefined && bounds.length === 1) return null
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) return null

    for (let value = lo; value <= hi; value += step) values.push(value)
  }
  return values.length ? [...new Set(values)].sort((a, b) => a - b) : null
}

export interface CronScheduleWindow {
  cron: string
  startsAt?: number
  endsAt?: number
  recurring?: boolean
  createdAt?: number
}

/**
 * 窗口内的下次执行时间，与主进程 cronScheduler 的 startsAt/endsAt 门控保持一致。
 * cron 没有年份语义，单次任务的真实触发时刻只能来自 startsAt。
 */
export function nextRunAt(task: CronScheduleWindow, from?: Date): Date | null {
  const now = from ?? new Date()
  if (task.endsAt !== undefined && now.getTime() > task.endsAt) return null

  if (task.recurring === false) {
    // 窗口字段上线前的单次任务没有 startsAt，它唯一的一次机会就是创建后的首个命中
    const at = task.startsAt ?? computeNextCronRun(task.cron, new Date(task.createdAt ?? now))?.getTime()
    if (at === undefined || at < now.getTime()) return null
    return new Date(at)
  }

  // computeNextCronRun 从 from+1 分钟开始搜，回退一分钟才可能命中正好等于 startsAt 的那分钟
  const anchor =
    task.startsAt !== undefined && task.startsAt > now.getTime()
      ? new Date(task.startsAt - 60_000)
      : now

  const next = computeNextCronRun(task.cron, anchor)
  if (!next) return null
  if (task.endsAt !== undefined && next.getTime() > task.endsAt) return null
  return next
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
