// @vitest-environment node
/**
 * formatDurationMs 的分档与进位边界。存在的理由：回合耗时此前一律渲染成秒，
 * 57 分钟的任务显示成 `3431.6s`，用户读不出量级。
 */
import { describe, it, expect } from 'vitest'
import { formatDurationMs } from '@/utils/formatDuration'

describe('formatDurationMs', () => {
  it('非正数与坏数值收成 0s', () => {
    expect(formatDurationMs(0)).toBe('0s')
    expect(formatDurationMs(-500)).toBe('0s')
    expect(formatDurationMs(Number.NaN)).toBe('0s')
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBe('0s')
  })

  it('亚秒级用毫秒整数', () => {
    expect(formatDurationMs(40)).toBe('40ms')
    expect(formatDurationMs(999.4)).toBe('999ms')
  })

  it('亚分钟保留一位小数（工具耗时靠它区分快慢）', () => {
    expect(formatDurationMs(5_000)).toBe('5.0s')
    expect(formatDurationMs(6_000)).toBe('6.0s')
    expect(formatDurationMs(12_345)).toBe('12.3s')
    expect(formatDurationMs(59_400)).toBe('59.4s')
  })

  it('整秒进位到 60 就换分钟档，不会渲染出 60.0s', () => {
    expect(formatDurationMs(59_500)).toBe('1m 00s')
    expect(formatDurationMs(59_940)).toBe('1m 00s')
    expect(formatDurationMs(60_000)).toBe('1m 00s')
  })

  it('分钟档补零对齐，小时不出现', () => {
    expect(formatDurationMs(65_000)).toBe('1m 05s')
    // 截图里那个 3431.6s
    expect(formatDurationMs(3_431_600)).toBe('57m 12s')
    expect(formatDurationMs(3_599_400)).toBe('59m 59s')
  })

  it('满小时换成 h m，分钟取整不显示秒', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h 00m')
    expect(formatDurationMs(7_560_000)).toBe('2h 06m')
    expect(formatDurationMs(7320_000)).toBe('2h 02m')
  })
})
