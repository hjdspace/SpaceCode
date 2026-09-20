import { describe, it, expect } from 'vitest'
import { computeNextCronRun, formatDuration } from '@/lib/cronHelper'

describe('cronHelper — computeNextCronRun', () => {
  it('空表达式返回 null', () => {
    expect(computeNextCronRun('')).toBeNull()
  })

  it('字段数不是 5 时返回 null', () => {
    expect(computeNextCronRun('* * * *')).toBeNull()
    expect(computeNextCronRun('* * * * * *')).toBeNull()
  })

  it('每分钟：下一分钟触发（秒归零）', () => {
    const from = new Date(2026, 0, 1, 10, 30, 45) // 10:30:45
    const next = computeNextCronRun('* * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getSeconds()).toBe(0)
    expect(next!.getMinutes()).toBe(31)
    expect(next!.getHours()).toBe(10)
  })

  it('指定时分：当天未来时间命中当天', () => {
    const from = new Date(2026, 0, 1, 8, 0, 0) // 08:00
    const next = computeNextCronRun('30 9 * * *', from) // 每天 09:30
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(30)
    expect(next!.getDate()).toBe(1)
  })

  it('指定时分已过：推到次日', () => {
    const from = new Date(2026, 0, 1, 10, 0, 0) // 10:00
    const next = computeNextCronRun('30 9 * * *', from) // 每天 09:30（已过）
    expect(next!.getDate()).toBe(2)
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(30)
  })

  it('步长 */N：命中最近的步长分钟', () => {
    const from = new Date(2026, 0, 1, 10, 1, 0) // 10:01
    const next = computeNextCronRun('*/15 * * * *', from)
    expect(next!.getMinutes()).toBe(15)
  })

  it('列表字段：命中列表中最近的一个值', () => {
    const from = new Date(2026, 0, 1, 10, 5, 0) // 10:05
    const next = computeNextCronRun('10,20,30 * * * *', from)
    expect(next!.getMinutes()).toBe(10)
  })

  it('范围字段：范围外推进到范围内', () => {
    // 周一到周五 09:00；2026-01-03 是周六
    const from = new Date(2026, 0, 3, 10, 0, 0) // 周六
    const next = computeNextCronRun('0 9 * * 1-5', from)
    expect(next!.getDay()).toBe(1) // 周一
    expect(next!.getHours()).toBe(9)
  })

  it('月份字段限制：跨月推进', () => {
    const from = new Date(2026, 0, 15, 0, 0, 0) // 1 月
    const next = computeNextCronRun('0 0 1 6 *', from) // 6 月 1 日 00:00
    expect(next!.getMonth()).toBe(5) // 6 月（0-based）
    expect(next!.getDate()).toBe(1)
  })

  it('永不可能的组合在迭代上限后返回 null', () => {
    // 2 月 31 日不存在
    const from = new Date(2026, 0, 1, 0, 0, 0)
    expect(computeNextCronRun('0 0 31 2 *', from)).toBeNull()
  })

  it('带步范围 N-M/S', () => {
    const from = new Date(2026, 0, 1, 10, 0, 0)
    const next = computeNextCronRun('0-30/10 * * * *', from)
    expect([0, 10, 20, 30]).toContain(next!.getMinutes())
  })
})

describe('cronHelper — formatDuration', () => {
  it('undefined / 0 / 负数返回空字符串', () => {
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(-5)).toBe('')
  })

  it('不足 1 分钟显示秒', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(999)).toBe('0s')
  })

  it('分钟级显示 "Xm Ys"', () => {
    expect(formatDuration(75_000)).toBe('1m 15s')
    expect(formatDuration(3_599_000)).toBe('59m 59s')
  })

  it('小时级显示 "Xh Ym"', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m')
    expect(formatDuration(3_660_000)).toBe('1h 1m')
  })
})
