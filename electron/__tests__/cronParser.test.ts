import { describe, it, expect } from 'vitest'
import { parseCronExpression, isValidCron, cronMatches, computeNextCronRun, cronToHuman, frequencyToCron } from '../cronParser'

describe('parseCronExpression', () => {
  it('parses standard 5-field cron', () => {
    const result = parseCronExpression('0 9 * * *')
    expect(result.minute).toEqual([0])
    expect(result.hour).toEqual([9])
    expect(result.dayOfMonth).toEqual('*')
    expect(result.month).toEqual('*')
    expect(result.dayOfWeek).toEqual('*')
  })

  it('parses step values', () => {
    const result = parseCronExpression('*/15 * * * *')
    expect(result.minute).toEqual('*/15')
  })

  it('parses ranges', () => {
    const result = parseCronExpression('0 9 * * 1-5')
    expect(result.dayOfWeek).toEqual('1-5')
  })

  it('parses lists', () => {
    const result = parseCronExpression('0 9 * * 1,3,5')
    expect(result.dayOfWeek).toEqual('1,3,5')
  })

  it('rejects invalid cron with wrong field count', () => {
    expect(() => parseCronExpression('0 9 * *')).toThrow()
  })

  it('treats dayOfWeek 7 as 0 (Sunday)', () => {
    const result = parseCronExpression('0 9 * * 7')
    expect(result.dayOfWeek).toEqual([0])
  })
})

describe('isValidCron', () => {
  it('returns true for valid expressions', () => {
    expect(isValidCron('0 9 * * *')).toBe(true)
    expect(isValidCron('*/15 * * * *')).toBe(true)
    expect(isValidCron('0 9 15 6 *')).toBe(true)
  })

  it('returns false for invalid expressions', () => {
    expect(isValidCron('')).toBe(false)
    expect(isValidCron('0 9 * *')).toBe(false)
    expect(isValidCron('60 9 * * *')).toBe(false)
    expect(isValidCron('0 25 * * *')).toBe(false)
  })
})

describe('cronMatches', () => {
  it('matches a simple daily cron', () => {
    const date = new Date(2026, 5, 10, 9, 0, 0)
    expect(cronMatches('0 9 * * *', date)).toBe(true)
  })

  it('does not match when minute differs', () => {
    const date = new Date(2026, 5, 10, 9, 30, 0)
    expect(cronMatches('0 9 * * *', date)).toBe(false)
  })

  it('matches weekday cron on Monday', () => {
    const date = new Date(2026, 5, 8, 10, 0, 0)
    expect(cronMatches('0 10 * * 1-5', date)).toBe(true)
  })

  it('does not match weekday cron on Saturday', () => {
    const date = new Date(2026, 5, 13, 10, 0, 0)
    expect(cronMatches('0 10 * * 1-5', date)).toBe(false)
  })

  it('matches when both dom and dow are constrained (OR semantics)', () => {
    // 0 9 15 * 5 = 每月15日或每周五 09:00
    // 2026-06-15 is Monday, date=15 matches dom
    const date1 = new Date(2026, 5, 15, 9, 0, 0)
    expect(cronMatches('0 9 15 * 5', date1)).toBe(true)
    // 2026-06-12 is Friday (not 15th), day=5 matches dow
    const date2 = new Date(2026, 5, 12, 9, 0, 0)
    expect(cronMatches('0 9 15 * 5', date2)).toBe(true)
    // 2026-06-16 is Tuesday (not 15th, not Friday), no match
    const date3 = new Date(2026, 5, 16, 9, 0, 0)
    expect(cronMatches('0 9 15 * 5', date3)).toBe(false)
  })
})

describe('computeNextCronRun', () => {
  it('computes next daily run', () => {
    const from = new Date(2026, 5, 10, 10, 0, 0)
    const next = computeNextCronRun('0 9 * * *', from)
    expect(next.getDate()).toBe(11)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  it('computes next hourly run', () => {
    const from = new Date(2026, 5, 10, 9, 30, 0)
    const next = computeNextCronRun('0 * * * *', from)
    expect(next.getHours()).toBe(10)
    expect(next.getMinutes()).toBe(0)
  })

  it('computes next run with OR semantics for dom+dow', () => {
    const from = new Date(2026, 5, 10, 10, 0, 0) // June 10
    const next = computeNextCronRun('0 9 15 * 5', from)
    // Next should be June 12 (Friday) or June 15 (Monday, 15th)
    expect(next.getMonth()).toBe(5) // June
    expect(next.getHours()).toBe(9)
  })

  it('returns max date when no match within 366 days', () => {
    const from = new Date(2026, 0, 1, 0, 0, 0)
    // 0 0 31 2 * = Feb 31st (impossible date)
    // This should never match, so it returns the max date
    const next = computeNextCronRun('0 0 31 2 *', from)
    // Should be close to 366 days from now
    const diffDays = (next.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeLessThanOrEqual(366)
  })
})

describe('cronToHuman', () => {
  it('describes daily cron', () => {
    expect(cronToHuman('0 9 * * *')).toBe('每天 09:00')
  })

  it('describes hourly cron', () => {
    expect(cronToHuman('0 * * * *')).toBe('每小时')
  })

  it('describes weekday cron', () => {
    expect(cronToHuman('0 10 * * 1-5')).toBe('工作日 10:00')
  })

  it('describes weekly cron', () => {
    expect(cronToHuman('0 17 * * 5')).toBe('每周五 17:00')
  })

  it('describes monthly cron', () => {
    expect(cronToHuman('0 8 15 * *')).toBe('每月15日 08:00')
  })

  it('describes step minute cron', () => {
    expect(cronToHuman('*/15 * * * *')).toBe('每15分钟')
  })

  it('describes step hour cron', () => {
    expect(cronToHuman('0 */2 * * *')).toBe('每2小时')
  })
})

describe('frequencyToCron', () => {
  it('converts hourly', () => {
    expect(frequencyToCron('hourly')).toBe('0 * * * *')
  })

  it('converts daily with time', () => {
    expect(frequencyToCron('daily', '09:00')).toBe('0 9 * * *')
  })

  it('converts weekdays with time', () => {
    expect(frequencyToCron('weekdays', '10:00')).toBe('0 10 * * 1-5')
  })

  it('converts weekly with time', () => {
    expect(frequencyToCron('weekly', '17:00')).toBe('0 17 * * 1')
  })

  it('converts monthly with time', () => {
    expect(frequencyToCron('monthly', '08:00')).toBe('0 8 1 * *')
  })
})
