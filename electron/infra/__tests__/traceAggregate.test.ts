// @vitest-environment node
/**
 * Trace 事件聚合 —— 全量（detail 页/侧车冷启动）与增量（侧车逐事件落盘）必须同源。
 *
 * 关键边界：
 *  - LLM 判定认 actor 一族和 type 一族两套键，工具事件不计入 apiCalls；
 *  - usage 缺失/字段缺失时 token 不累计，model 与 modelId 两个键名归一；
 *  - 耗时窗口要求「有 duration 且 timestamp 可解析」，缺一就跳过，不拿当前时间猜；
 *  - totalDurationMs 是窗口并集（重叠只算一遍），不是逐个相加。
 */
import { describe, it, expect } from 'vitest'
import {
  accumulateEvent,
  emptyAggregate,
  finalizeSummary,
  isLlmCallEvent,
  isToolCallEvent,
  summarizeEvents,
  type AgentTraceEventForTrace,
} from '../traceAggregate'

function llmEvent(overrides: Partial<AgentTraceEventForTrace> = {}): AgentTraceEventForTrace {
  return { sessionId: 's1', type: 'assistant_turn', ...overrides }
}

describe('isLlmCallEvent / isToolCallEvent', () => {
  it('assistant actor 与 assistant_* type 都算 LLM 调用', () => {
    expect(isLlmCallEvent(llmEvent({ actor: 'assistant', type: 'whatever' }))).toBe(true)
    for (const type of ['assistant_text', 'assistant_turn', 'assistant_reasoning']) {
      expect(isLlmCallEvent(llmEvent({ type }))).toBe(true)
    }
  })

  it('普通用户/工具事件不算 LLM 调用', () => {
    expect(isLlmCallEvent(llmEvent({ actor: 'user', type: 'user_text' }))).toBe(false)
    expect(isLlmCallEvent(llmEvent({ actor: 'tool', type: 'tool_call' }))).toBe(false)
  })

  it('工具事件认 actor 或 type', () => {
    expect(isToolCallEvent(llmEvent({ actor: 'tool', type: 'x' }))).toBe(true)
    expect(isToolCallEvent(llmEvent({ type: 'tool_call' }))).toBe(true)
    expect(isToolCallEvent(llmEvent({ actor: 'assistant', type: 'assistant_turn' }))).toBe(false)
  })
})

describe('accumulateEvent', () => {
  it('每个事件都推进 eventCount 与 updatedAt', () => {
    const agg = emptyAggregate()
    accumulateEvent(agg, { sessionId: 's1', type: 'user_text', timestamp: '2026-01-01T00:00:01Z' })
    accumulateEvent(agg, { sessionId: 's1', type: 'user_text' })
    expect(agg.eventCount).toBe(2)
    // 无 timestamp 的事件不覆盖已有的 updatedAt
    expect(agg.updatedAt).toBe('2026-01-01T00:00:01Z')
  })

  it('只有 LLM 事件计入 apiCalls，failed 状态单独累计', () => {
    const agg = emptyAggregate()
    accumulateEvent(agg, llmEvent({ status: 'ok' }))
    accumulateEvent(agg, llmEvent({ status: 'failed' }))
    accumulateEvent(agg, { sessionId: 's1', type: 'tool_call' })
    expect(agg.apiCalls).toBe(2)
    expect(agg.failedCalls).toBe(1)
  })

  it('usage 缺失或字段缺失时 token 不累计', () => {
    const agg = emptyAggregate()
    accumulateEvent(agg, llmEvent())
    accumulateEvent(agg, llmEvent({ metadata: {} }))
    accumulateEvent(agg, llmEvent({ metadata: { usage: { inputTokens: 10 } } }))
    expect(agg.totalInputTokens).toBe(10)
    expect(agg.totalOutputTokens).toBe(0)
  })

  it('model 与 modelId 两个键名归一到同一计数，无名事件跳过', () => {
    const agg = emptyAggregate()
    accumulateEvent(agg, llmEvent({ metadata: { model: 'm1' } }))
    accumulateEvent(agg, llmEvent({ metadata: { modelId: 'm1' } }))
    accumulateEvent(agg, llmEvent({ metadata: { model: 'm2' } }))
    accumulateEvent(agg, llmEvent())
    expect(agg.modelCounts.get('m1')).toBe(2)
    expect(agg.modelCounts.get('m2')).toBe(1)
    expect(agg.modelCounts.size).toBe(2)
  })

  it('耗时窗口要求 duration 与可解析 timestamp 同时具备', () => {
    const agg = emptyAggregate()
    // 缺 duration → 跳过
    accumulateEvent(agg, llmEvent({ timestamp: '2026-01-01T00:00:10Z' }))
    // 缺 timestamp → 跳过
    accumulateEvent(agg, llmEvent({ metadata: { durationMs: 100 } }))
    // timestamp 不可解析 → 跳过
    accumulateEvent(agg, llmEvent({ timestamp: 'not-a-date', metadata: { durationMs: 100 } }))
    expect(agg.windows).toEqual([])

    // 两者齐备 → 窗口为 [end - duration, end]（timestamp 是结束时刻）
    accumulateEvent(agg, llmEvent({ timestamp: '2026-01-01T00:00:10Z', metadata: { durationMs: 1000 } }))
    const end = new Date('2026-01-01T00:00:10Z').getTime()
    expect(agg.windows).toEqual([[end - 1000, end]])
  })

  it('兼容历史键 metadata.duration', () => {
    const agg = emptyAggregate()
    accumulateEvent(agg, llmEvent({ timestamp: '2026-01-01T00:00:10Z', metadata: { duration: 500 } }))
    expect(agg.windows.length).toBe(1)
  })
})

describe('finalizeSummary', () => {
  it('models 平铺为数组，totalDurationMs 取窗口并集', () => {
    const agg = emptyAggregate()
    const t0 = new Date('2026-01-01T00:00:10Z').getTime()
    // 两个重叠窗口 [t0-2000, t0] 与 [t0-1000, t0+500] → 并集 2500
    agg.windows.push([t0 - 2000, t0], [t0 - 1000, t0 + 500])
    agg.modelCounts.set('m1', 3)
    const summary = finalizeSummary(agg)
    expect(summary.totalDurationMs).toBe(2500)
    expect(summary.models).toEqual([{ model: 'm1', calls: 3 }])
    expect(summary.updatedAt).toBeNull()
  })
})

describe('summarizeEvents', () => {
  it('空事件流返回全零摘要', () => {
    expect(summarizeEvents([])).toEqual({
      apiCalls: 0,
      failedCalls: 0,
      totalDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      updatedAt: null,
    })
  })

  it('混合事件流的全量口径与逐事件增量一致', () => {
    const events: AgentTraceEventForTrace[] = [
      llmEvent({ timestamp: '2026-01-01T00:00:10Z', metadata: { durationMs: 1000, model: 'm1', usage: { inputTokens: 5, outputTokens: 7 } } }),
      llmEvent({ status: 'failed', timestamp: '2026-01-01T00:00:20Z', metadata: { durationMs: 2000, modelId: 'm1' } }),
      { sessionId: 's1', type: 'tool_call', timestamp: '2026-01-01T00:00:25Z' },
    ]
    // 全量口径
    const whole = summarizeEvents(events)
    // 侧车口径：逐事件 accumulateEvent 后 finalize
    const agg = emptyAggregate()
    for (const e of events) accumulateEvent(agg, e)
    expect(whole).toEqual(finalizeSummary(agg))

    expect(whole.apiCalls).toBe(2)
    expect(whole.failedCalls).toBe(1)
    expect(whole.totalInputTokens).toBe(5)
    expect(whole.totalOutputTokens).toBe(7)
    expect(whole.models).toEqual([{ model: 'm1', calls: 2 }])
    // 两个不重叠窗口各 1000/2000 → 3000
    expect(whole.totalDurationMs).toBe(3000)
    expect(whole.updatedAt).toBe('2026-01-01T00:00:25Z')
  })
})
