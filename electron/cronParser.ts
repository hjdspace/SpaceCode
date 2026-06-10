export interface CronFields {
  minute: number[] | string
  hour: number[] | string
  dayOfMonth: number[] | string
  month: number[] | string
  dayOfWeek: number[] | string
}

type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

const FIELD_RANGES: Record<FieldName, { min: number; max: number }> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 },
}

function expandField(field: string, name: FieldName): number[] {
  const range = FIELD_RANGES[name]
  const values: number[] = []

  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [base, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step in ${name}: ${part}`)
      const start = base === '*' ? range.min : parseInt(base, 10)
      for (let i = start; i <= range.max; i += step) {
        values.push(i)
      }
    } else if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range in ${name}: ${part}`)
      for (let i = start; i <= end; i++) {
        values.push(i)
      }
    } else {
      const val = parseInt(part, 10)
      if (isNaN(val)) throw new Error(`Invalid value in ${name}: ${part}`)
      values.push(val)
    }
  }

  // dayOfWeek: 7 → 0 (Sunday alias)
  if (name === 'dayOfWeek') {
    for (let i = 0; i < values.length; i++) {
      if (values[i] === 7) values[i] = 0
    }
  }

  // Validate ranges
  for (const v of values) {
    if (v < range.min || v > (name === 'dayOfWeek' ? 7 : range.max)) {
      throw new Error(`Value ${v} out of range for ${name} (${range.min}-${name === 'dayOfWeek' ? 7 : range.max})`)
    }
  }

  return values
}

function parseField(field: string, name: FieldName): number[] | string {
  if (field === '*') return '*'

  // Single pure number: return as number array (e.g. "0" → [0], "9" → [9])
  if (/^\d+$/.test(field)) {
    return expandField(field, name)
  }

  // Step/range/list expressions: validate then return as string
  expandField(field, name)
  return field
}

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expected 5 fields, got ${parts.length}`)

  return {
    minute: parseField(parts[0], 'minute'),
    hour: parseField(parts[1], 'hour'),
    dayOfMonth: parseField(parts[2], 'dayOfMonth'),
    month: parseField(parts[3], 'month'),
    dayOfWeek: parseField(parts[4], 'dayOfWeek'),
  }
}

export function isValidCron(expr: string): boolean {
  try {
    parseCronExpression(expr)
    return true
  } catch {
    return false
  }
}

function getExpandedValues(field: number[] | string, name: FieldName): number[] {
  if (field === '*') {
    const range = FIELD_RANGES[name]
    const values: number[] = []
    for (let i = range.min; i <= range.max; i++) {
      values.push(i)
    }
    return values
  }
  if (Array.isArray(field)) return field
  // field is a string like "*/15", "1-5", "1,3,5"
  return expandField(field, name)
}

function fieldMatches(field: number[] | string, value: number, name: FieldName): boolean {
  const expanded = getExpandedValues(field, name)
  return expanded.includes(value)
}

export function cronMatches(cronExpr: string, date: Date): boolean {
  try {
    const fields = parseCronExpression(cronExpr)
    const minMatch = fieldMatches(fields.minute, date.getMinutes(), 'minute')
    const hourMatch = fieldMatches(fields.hour, date.getHours(), 'hour')
    const monthMatch = fieldMatches(fields.month, date.getMonth() + 1, 'month')

    const domMatch = fieldMatches(fields.dayOfMonth, date.getDate(), 'dayOfMonth')
    const dowMatch = fieldMatches(fields.dayOfWeek, date.getDay(), 'dayOfWeek')

    // Standard cron: if both dom and dow are constrained, OR semantics
    const domConstrained = fields.dayOfMonth !== '*'
    const dowConstrained = fields.dayOfWeek !== '*'
    const dayMatch = (domConstrained && dowConstrained)
      ? (domMatch || dowMatch)
      : (domMatch && dowMatch)

    return minMatch && hourMatch && monthMatch && dayMatch
  } catch {
    return false
  }
}

export function computeNextCronRun(cronExpr: string, from: Date): Date {
  const fields = parseCronExpression(cronExpr)
  const next = new Date(from.getTime())
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  const maxDate = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000)

  while (next <= maxDate) {
    if (
      fieldMatches(fields.minute, next.getMinutes(), 'minute') &&
      fieldMatches(fields.hour, next.getHours(), 'hour') &&
      fieldMatches(fields.month, next.getMonth() + 1, 'month')
    ) {
      const domMatch = fieldMatches(fields.dayOfMonth, next.getDate(), 'dayOfMonth')
      const dowMatch = fieldMatches(fields.dayOfWeek, next.getDay(), 'dayOfWeek')
      const domConstrained = fields.dayOfMonth !== '*'
      const dowConstrained = fields.dayOfWeek !== '*'
      const dayMatch = (domConstrained && dowConstrained)
        ? (domMatch || dowMatch)
        : (domMatch && dowMatch)

      if (dayMatch) return next
    }
    next.setMinutes(next.getMinutes() + 1)
  }

  return maxDate
}

export function cronToHuman(cronExpr: string): string {
  try {
    const fields = parseCronExpression(cronExpr)

    const isAll = (f: number[] | string) => f === '*'
    const isStepField = (f: number[] | string) => typeof f === 'string' && f.includes('/')
    const getStepValue = (f: string) => {
      const match = f.match(/\/(\d+)$/)
      return match ? parseInt(match[1], 10) : null
    }

    // Step minute: */N → "每N分钟"
    if (isStepField(fields.minute) && isAll(fields.hour) && isAll(fields.dayOfMonth) && isAll(fields.month) && isAll(fields.dayOfWeek)) {
      const step = getStepValue(fields.minute as string)
      if (step) return `每${step}分钟`
    }

    // Step hour: */N → "每N小时"
    if (isStepField(fields.hour) && isAll(fields.dayOfMonth) && isAll(fields.month) && isAll(fields.dayOfWeek)) {
      const step = getStepValue(fields.hour as string)
      if (step) return `每${step}小时`
    }

    // For string fields (step/range/list), skip time extraction and fall through
    if (typeof fields.minute !== 'number' && !Array.isArray(fields.minute) && fields.minute !== '*') {
      return cronExpr
    }
    if (typeof fields.hour !== 'number' && !Array.isArray(fields.hour) && fields.hour !== '*') {
      return cronExpr
    }

    const minuteArr = Array.isArray(fields.minute) ? fields.minute[0] : 0
    const hourArr = Array.isArray(fields.hour) ? fields.hour[0] : 0
    const time = `${String(hourArr).padStart(2, '0')}:${String(minuteArr).padStart(2, '0')}`

    const isWeekdays = (fields.dayOfWeek === '1-5') ||
      (Array.isArray(fields.dayOfWeek) &&
        fields.dayOfWeek.length === 5 &&
        [1, 2, 3, 4, 5].every(d => fields.dayOfWeek.includes(d)))

    if (isAll(fields.dayOfMonth) && isAll(fields.month) && isAll(fields.dayOfWeek) &&
        isAll(fields.hour) && Array.isArray(fields.minute)) {
      return '每小时'
    }
    if (isAll(fields.dayOfMonth) && isAll(fields.month) && isAll(fields.dayOfWeek)) {
      return `每天 ${time}`
    }
    if (isWeekdays && isAll(fields.dayOfMonth) && isAll(fields.month)) {
      return `工作日 ${time}`
    }
    if ((Array.isArray(fields.dayOfWeek) && fields.dayOfWeek.length === 1 || typeof fields.dayOfWeek === 'string' && /^\d+$/.test(fields.dayOfWeek)) && isAll(fields.dayOfMonth) && isAll(fields.month)) {
      const dowValue = typeof fields.dayOfWeek === 'string' ? parseInt(fields.dayOfWeek, 10) : fields.dayOfWeek[0]
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      return `每${days[dowValue]} ${time}`
    }
    if (Array.isArray(fields.dayOfMonth) && fields.dayOfMonth.length === 1 && isAll(fields.month) && isAll(fields.dayOfWeek)) {
      return `每月${fields.dayOfMonth[0]}日 ${time}`
    }
    return cronExpr
  } catch {
    return cronExpr
  }
}

export function frequencyToCron(frequency: string, time?: string): string {
  const [h, m] = (time || '00:00').split(':').map(Number)
  const hh = isNaN(h) ? 0 : h
  const mm = isNaN(m) ? 0 : m

  switch (frequency) {
    case 'hourly': return `${mm} * * * *`
    case 'daily': return `${mm} ${hh} * * *`
    case 'weekdays': return `${mm} ${hh} * * 1-5`
    case 'weekly': return `${mm} ${hh} * * 1`
    case 'monthly': return `${mm} ${hh} 1 * *`
    default: return `${mm} ${hh} * * *`
  }
}
