import { describe, it, expect } from 'vitest'
import { computeNextCronRun, cronToHuman, formatDuration, nextRunAt } from '@/lib/cronHelper'

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

  it('命中时刻在明年也照样给出，且不做逐分钟暴力搜索', () => {
    // 2026-10-07 21:55 之后找 2027-10-05 09:00：暴力逐分钟要迭代 52 万次
    const from = new Date(2026, 9, 7, 21, 55, 0)
    const next = computeNextCronRun('0 9 5 10 *', from)
    expect(next!.getFullYear()).toBe(2027)
    expect(next!.getMonth()).toBe(9)
    expect(next!.getDate()).toBe(5)
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(0)
  })

  it('dom 与 dow 同时受限时取并集（标准 cron 语义）', () => {
    // 每月 15 日 或 周一，09:00。2026-01-01 是周四 → 下一个命中是周一 1/5
    const from = new Date(2026, 0, 1, 0, 0, 0)
    const next = computeNextCronRun('0 9 15 * 1', from)
    expect(next!.getDate()).toBe(5)
    expect(next!.getDay()).toBe(1)
  })

  it('列表小时：跳到列表里的下一个小时', () => {
    const from = new Date(2026, 0, 1, 10, 30, 0)
    const next = computeNextCronRun('0 8,12,18 * * *', from)
    expect(next!.getHours()).toBe(12)
    expect(next!.getMinutes()).toBe(0)
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

describe('cronHelper — nextRunAt', () => {
  it('无窗口字段时与 computeNextCronRun 一致', () => {
    const from = new Date(2026, 0, 1, 10, 0, 0)
    const next = nextRunAt({ cron: '30 9 * * *' }, from)
    expect(next!.getDate()).toBe(2) // 当天 09:30 已过 → 次日
    expect(next!.getHours()).toBe(9)
  })

  it('startsAt 在未来时不早于它触发：cron 无年份语义，单次任务不能每年重复', () => {
    const startsAt = new Date(2027, 9, 5, 9, 0, 0).getTime()
    const from = new Date(2026, 9, 1, 0, 0, 0) // 同一表达式在 2026-10-05 也匹配
    const next = nextRunAt({ cron: '0 9 5 10 *', startsAt }, from)
    expect(next!.getFullYear()).toBe(2027)
    expect(next!.getMonth()).toBe(9)
    expect(next!.getDate()).toBe(5)
    expect(next!.getHours()).toBe(9)
  })

  it('startsAt 正好落在匹配分钟时命中该分钟', () => {
    const startsAt = new Date(2026, 9, 5, 9, 0, 0).getTime()
    const from = new Date(2026, 9, 5, 8, 0, 0)
    expect(nextRunAt({ cron: '0 9 5 10 *', startsAt }, from)!.getTime()).toBe(startsAt)
  })

  it('窗口已关闭返回 null', () => {
    const endsAt = new Date(2026, 9, 1, 0, 0, 0).getTime()
    expect(nextRunAt({ cron: '0 9 * * *', endsAt }, new Date(2026, 9, 5, 9, 0, 0))).toBeNull()
  })

  it('下一次匹配越过 endsAt 也返回 null', () => {
    const endsAt = new Date(2026, 9, 5, 23, 59, 59).getTime()
    expect(nextRunAt({ cron: '0 9 * * *', endsAt }, new Date(2026, 9, 5, 10, 0, 0))).toBeNull()
  })

  it('单次任务的下次就是 startsAt 本身', () => {
    const startsAt = new Date(2026, 9, 7, 21, 55, 0).getTime()
    const next = nextRunAt(
      { cron: '55 21 7 10 *', startsAt, recurring: false },
      new Date(2026, 9, 7, 21, 40, 0),
    )
    expect(next!.getTime()).toBe(startsAt)
  })

  it('单次任务时刻已过不再报明年', () => {
    const startsAt = new Date(2026, 9, 7, 21, 55, 0).getTime()
    expect(
      nextRunAt(
        { cron: '55 21 7 10 *', startsAt, recurring: false },
        new Date(2026, 9, 7, 22, 0, 0),
      ),
    ).toBeNull()
  })

  it('窗口字段上线前的单次任务用创建后的首个命中定位', () => {
    const createdAt = new Date(2026, 9, 7, 21, 40, 0).getTime()
    const task = { cron: '55 21 7 10 *', recurring: false, createdAt }
    expect(nextRunAt(task, new Date(2026, 9, 7, 21, 45, 0))?.getTime())
      .toBe(new Date(2026, 9, 7, 21, 55, 0).getTime())
    expect(nextRunAt(task, new Date(2026, 9, 8, 9, 0, 0))).toBeNull()
  })
})

describe('cronHelper — cronToHuman', () => {
  it('小时步长不再回落成裸表达式', () => {
    const text = cronToHuman('0 */6 * * *')
    expect(text).not.toBe('0 */6 * * *')
    expect(text).not.toContain('*/')
  })
})
