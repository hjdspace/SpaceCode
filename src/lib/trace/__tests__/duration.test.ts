import { describe, expect, it } from 'vitest'
import {
  readTraceEventDurationMs,
  traceEventTimeRange,
  unionTraceDurationMs,
  type TraceDurationEvent,
} from '../duration'

// 键名兼容的实测依据（~/.claude/debug/traces 真实文件）：renderer 的 assistant_turn 一律写
// metadata.duration，engine 的 result 一律写 metadata.durationMs，两者都是毫秒。
describe('readTraceEventDurationMs', () => {
  it('读规范键 durationMs', () => {
    expect(readTraceEventDurationMs({ durationMs: 15900 })).toBe(15900)
  })

  it('兼容历史键 duration（现网 491 个 assistant_turn 走这条路）', () => {
    expect(readTraceEventDurationMs({ duration: 15900 })).toBe(15900)
  })

  it('两个键同时存在时以 durationMs 为准', () => {
    expect(readTraceEventDurationMs({ durationMs: 15900, duration: 9999 })).toBe(15900)
  })

  it.each([undefined, {}, null])('缺失 metadata 或无耗时 → undefined: %o', (metadata) => {
    expect(readTraceEventDurationMs(metadata as Record<string, unknown> | undefined)).toBeUndefined()
  })

  it.each([-1, '15900', NaN, Infinity, null, undefined])('拒绝非法值 %p（不做单位猜测）', (bad) => {
    expect(readTraceEventDurationMs({ duration: bad })).toBeUndefined()
    expect(readTraceEventDurationMs({ durationMs: bad })).toBeUndefined()
  })

  it('接受 0 与小数（瞬时回合 / performance.now 类计时）', () => {
    expect(readTraceEventDurationMs({ durationMs: 0 })).toBe(0)
    expect(readTraceEventDurationMs({ duration: 1.5 })).toBe(1.5)
  })
})

const END = '2026-06-12T12:00:00.000Z'
const END_MS = Date.parse(END)
const at = (ms: number) => new Date(END_MS + ms).toISOString()

function event(timestamp: string | undefined, durationMs: number | undefined): TraceDurationEvent {
  return { timestamp, metadata: durationMs === undefined ? {} : { durationMs } }
}

describe('traceEventTimeRange', () => {
  it('把落盘时间戳当结束时间，用耗时反推开始时间', () => {
    const range = traceEventTimeRange(END, 15900)

    expect(range.completedAt).toBe(END)
    expect(new Date(range.startedAt ?? '').getTime()).toBe(END_MS - 15900)
  })

  it('无耗时时只有 startedAt，不编造 completedAt', () => {
    expect(traceEventTimeRange(END, undefined)).toEqual({ startedAt: END })
  })

  it('时间戳缺失或读不出时刻时返回空对象，不猜当前时间', () => {
    expect(traceEventTimeRange(undefined, 1000)).toEqual({})
    expect(traceEventTimeRange('not-a-date', 1000)).toEqual({})
  })
})

describe('unionTraceDurationMs', () => {
  it('同一回合的 turn 与 result 窗口重叠，只算一次（直加会把 164s 报成 279s）', () => {
    const events: TraceDurationEvent[] = [
      event(END, 141803),
      event(END, 102199),
      event(at(200_000), 22124),
      event(at(200_000), 13300),
    ]

    expect(unionTraceDurationMs(events)).toBe(141803 + 22124)
  })

  it('失败/中断回合没有耗时时，engine result 的区间仍然计入', () => {
    const events: TraceDurationEvent[] = [
      event(END, undefined),
      event(at(5_000), 400_000),
      event(at(500_000), 300_000),
    ]

    expect(unionTraceDurationMs(events)).toBe(700_000)
  })

  it('窗口被完全包含时不增加总量', () => {
    const events: TraceDurationEvent[] = [
      event(END, 60_000),
      event(at(-30_000), 1_000),
    ]

    expect(unionTraceDurationMs(events)).toBe(60_000)
  })

  it('乱序输入结果一致（并集与顺序无关）', () => {
    const ordered = [event(END, 1000), event(at(5000), 1000), event(at(2000), 1000)]

    expect(unionTraceDurationMs([...ordered].reverse())).toBe(unionTraceDurationMs(ordered))
  })

  it('相邻但不重叠的窗口分别计入', () => {
    expect(unionTraceDurationMs([event(END, 1000), event(at(1000), 1000)])).toBe(2000)
  })

  it('legacy duration 键同样参与并集', () => {
    expect(unionTraceDurationMs([{ timestamp: END, metadata: { duration: 15900 } }])).toBe(15900)
  })

  it('缺时间戳或非法耗时的事件被跳过，总量不会是 NaN', () => {
    const events: TraceDurationEvent[] = [
      { metadata: { durationMs: 1000 } },
      event(END, undefined),
      { timestamp: 'not-a-date', metadata: { durationMs: 1000 } },
      { timestamp: END, metadata: { durationMs: -5 } },
    ]

    expect(unionTraceDurationMs(events)).toBe(0)
  })

  it('空事件 → 0', () => {
    expect(unionTraceDurationMs([])).toBe(0)
  })
})
