/**
 * formatters — trace 视图层的时长 / token / 时钟格式化。
 * 重点覆盖边界值（0、单位跨越、非法输入）与分支返回 '--' 的情况。
 */
import { describe, it, expect } from 'vitest'
import {
  formatDurationMs,
  formatTokenCount,
  formatUsageBrief,
  formatClockTime,
} from '@/lib/trace/formatters'

describe('formatDurationMs', () => {
  it('非有限值 / 负数 / 非数字 返回 --', () => {
    expect(formatDurationMs(undefined)).toBe('--')
    expect(formatDurationMs(NaN)).toBe('--')
    expect(formatDurationMs(Infinity)).toBe('--')
    expect(formatDurationMs(-1)).toBe('--')
    // @ts-expect-error 显式验证非 number 输入
    expect(formatDurationMs('1s')).toBe('--')
  })

  it('小于 1s 走毫秒分支', () => {
    expect(formatDurationMs(0)).toBe('0ms')
    expect(formatDurationMs(1)).toBe('1ms')
    expect(formatDurationMs(123.4)).toBe('123ms')
    expect(formatDurationMs(999)).toBe('999ms')
  })

  it('1s ~ 10s 走两位小数秒分支', () => {
    expect(formatDurationMs(1000)).toBe('1.00s')
    expect(formatDurationMs(1500)).toBe('1.50s')
    expect(formatDurationMs(9999)).toBe('10.00s')
  })

  it('10s ~ 60s 走整数秒分支', () => {
    expect(formatDurationMs(10_000)).toBe('10s')
    expect(formatDurationMs(10_500)).toBe('11s') // Math.round
    expect(formatDurationMs(59_999)).toBe('60s')
  })

  it('超过 1 分钟走 mm:ss 分支', () => {
    expect(formatDurationMs(60_000)).toBe('1m 00s')
    expect(formatDurationMs(61_000)).toBe('1m 01s')
    expect(formatDurationMs(125_000)).toBe('2m 05s')
    expect(formatDurationMs(3_599_000)).toBe('59m 59s')
    expect(formatDurationMs(3_600_000)).toBe('60m 00s')
  })
})

describe('formatTokenCount', () => {
  it('小于 1000 直接返回原值', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(1)).toBe('1')
    expect(formatTokenCount(999)).toBe('999')
  })

  it('千级走 k 分支（保留一位小数）', () => {
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(999_999)).toBe('1000.0k')
  })

  it('百万级走 M 分支', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(1_234_567)).toBe('1.2M')
  })
})

describe('formatUsageBrief', () => {
  it('undefined / null 返回 --', () => {
    expect(formatUsageBrief(undefined)).toBe('--')
    // @ts-expect-error 显式验证 null
    expect(formatUsageBrief(null)).toBe('--')
  })

  it('组合 input / output token 计数', () => {
    expect(formatUsageBrief({ inputTokens: 100, outputTokens: 200 })).toBe('100 → 200')
    expect(formatUsageBrief({ inputTokens: 1500, outputTokens: 2_000_000 })).toBe('1.5k → 2.0M')
  })
})

describe('formatClockTime', () => {
  it('非法 ISO 字符串原样返回', () => {
    expect(formatClockTime('not-a-date')).toBe('not-a-date')
    expect(formatClockTime('')).toBe('')
  })

  it('合法 ISO 字符串返回本地时:分:秒', () => {
    const result = formatClockTime('2024-01-01T10:11:12.000Z')
    // 不假定具体时区，只验证格式（HH:MM:SS 或 含 AM/PM 的本地化）
    expect(result).toMatch(/\d{1,2}:\d{2}/)
    expect(result).not.toBe('2024-01-01T10:11:12.000Z')
  })
})
