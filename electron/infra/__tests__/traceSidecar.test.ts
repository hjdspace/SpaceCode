// @vitest-environment node
/**
 * Trace summary 侧车（PR-6b）。
 *
 * 钉住的核心不变量：
 *  1. 增量口径 == 全量口径：逐事件 recordTraceEvent 的 summary 与 summarizeEvents(events) 完全一致
 *     （list 走侧车、detail 走全量聚合，两者必须同源 —— duration 语义见 src/lib/trace/duration.ts）
 *  2. (size, mtime) 校验：jsonl 变了侧车即失效，绝不返回陈旧 summary
 *  3. 磁盘侧车跨重启冷启动：flush → reset → adopt 恢复同一 summary；
 *     (size, mtime) 不匹配 / 文件损坏 / 版本不识别一律回退 null（调用方全量解析重建）
 *  4. 外部截断检测：stat.size 回退时内存态重建，不把陈旧增量带进新文件
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  initTraceSidecar,
  recordTraceEvent,
  getSidecarSummary,
  adoptSidecarFromDisk,
  backfillSidecar,
  flushTraceSidecars,
  resetTraceSidecar,
} from '../traceSidecar'
import { summarizeEvents, type AgentTraceEventForTrace } from '../traceAggregate'

const TS = '2026-06-12T20:44:57.259+08:00'
const at = (ms: number) => new Date(new Date(TS).getTime() + ms).toISOString()

function turnEvent(duration: number | undefined, timestamp = TS, status = 'completed'): AgentTraceEventForTrace {
  return {
    sessionId: 'sess-1',
    timestamp,
    source: 'renderer',
    actor: 'assistant',
    type: 'assistant_turn',
    status,
    metadata: duration !== undefined ? { model: 'test-model', duration } : { model: 'test-model' },
  }
}

function resultEvent(durationMs: number, timestamp = TS): AgentTraceEventForTrace {
  return {
    sessionId: 'sess-1',
    timestamp,
    source: 'electron',
    actor: 'assistant',
    type: 'result',
    status: 'completed',
    metadata: { durationMs, usage: { inputTokens: 10, outputTokens: 20 } },
  }
}

function toolEvent(timestamp = TS): AgentTraceEventForTrace {
  return { sessionId: 'sess-1', timestamp, source: 'engine', actor: 'tool', type: 'tool_call', status: 'completed' }
}

const EVENTS: AgentTraceEventForTrace[] = [
  turnEvent(141803),
  toolEvent(at(1000)),
  resultEvent(102199),
  turnEvent(22124, at(200_000)),
  { ...turnEvent(undefined, at(300_000)), status: 'failed' },
  resultEvent(13300, at(200_000)),
]

let dir: string

beforeEach(() => {
  resetTraceSidecar()
  dir = mkdtempSync(join(tmpdir(), 'trace-sidecar-'))
})

afterEach(() => {
  resetTraceSidecar()
  rmSync(dir, { recursive: true, force: true })
})

/** 模拟 logger 写路径：逐事件追加并以追加后的 stat 记账。 */
function recordAll(events: AgentTraceEventForTrace[], sid = 'sess-1'): { size: number; modifiedAt: number } {
  let size = 0
  let modifiedAt = 1
  for (const e of events) {
    size += JSON.stringify(e).length + 1
    modifiedAt += 1
    recordTraceEvent(sid, e, { size, modifiedAt })
  }
  return { size, modifiedAt }
}

describe('traceSidecar 增量聚合', () => {
  it('逐事件增量与 summarizeEvents 全量口径完全一致', () => {
    const stat = recordAll(EVENTS)

    const incremental = getSidecarSummary('sess-1', stat)
    const full = summarizeEvents(EVENTS)

    expect(incremental).not.toBeNull()
    expect(incremental).toEqual(full)
    expect(incremental!.totalDurationMs).toBeGreaterThan(0)
    // 6 个事件中 actor=assistant 的有 5 个（tool_call 不算），失败 turn 计入 failedCalls
    expect(incremental!.apiCalls).toBe(5)
    expect(incremental!.failedCalls).toBe(1)
    expect(incremental!.totalInputTokens).toBe(20) // 两个 result 各 10
    expect(incremental!.models).toEqual([{ model: 'test-model', calls: 3 }])
  })

  it('stat 变化（jsonl 被外部改动）即失效，返回 null', () => {
    const stat = recordAll(EVENTS)

    expect(getSidecarSummary('sess-1', stat)).not.toBeNull()
    expect(getSidecarSummary('sess-1', { size: stat.size + 1, modifiedAt: stat.modifiedAt })).toBeNull()
    expect(getSidecarSummary('sess-1', { size: stat.size, modifiedAt: stat.modifiedAt + 1 })).toBeNull()
  })

  it('外部截断（stat.size 回退）触发内存态重建', () => {
    const stat = recordAll(EVENTS)

    // 陈旧态还在，但新文件比它小 → record 必须丢弃旧增量重新累积
    recordTraceEvent('sess-1', turnEvent(5000), { size: 10, modifiedAt: stat.modifiedAt + 1 })

    const rebuilt = getSidecarSummary('sess-1', { size: 10, modifiedAt: stat.modifiedAt + 1 })
    expect(rebuilt).toEqual(summarizeEvents([turnEvent(5000)]))
  })

  it('backfillSidecar 与逐事件 record 等价', () => {
    const stat = recordAll(EVENTS)
    const incremental = getSidecarSummary('sess-1', stat)

    resetTraceSidecar()
    const fromBackfill = backfillSidecar('sess-1', stat, EVENTS)

    expect(fromBackfill).toEqual(incremental)
  })
})

describe('traceSidecar 磁盘持久化（冷启动）', () => {
  it('flush 后 reset，adopt 用匹配的 (size, mtime) 恢复同一 summary', () => {
    initTraceSidecar(dir)
    const stat = recordAll(EVENTS)
    flushTraceSidecars()

    expect(existsSync(join(dir, 'session-sess-1.summary.json'))).toBe(true)

    resetTraceSidecar()
    const adopted = adoptSidecarFromDisk('sess-1', stat)

    expect(adopted).toEqual(summarizeEvents(EVENTS))
    // adopt 之后内存态可用：getSummary 直接命中
    expect(getSidecarSummary('sess-1', stat)).toEqual(adopted)
  })

  it('(size, mtime) 不匹配时不采纳', () => {
    initTraceSidecar(dir)
    const stat = recordAll(EVENTS)
    flushTraceSidecars()
    resetTraceSidecar()

    expect(adoptSidecarFromDisk('sess-1', { size: stat.size + 5, modifiedAt: stat.modifiedAt })).toBeNull()
    expect(adoptSidecarFromDisk('sess-1', { size: stat.size, modifiedAt: stat.modifiedAt + 5 })).toBeNull()
  })

  it('损坏 / 版本不识别的侧车文件安全回退 null', () => {
    initTraceSidecar(dir)
    writeFileSync(join(dir, 'session-sess-1.summary.json'), '{ not json')
    expect(adoptSidecarFromDisk('sess-1', { size: 1, modifiedAt: 1 })).toBeNull()

    writeFileSync(join(dir, 'session-sess-1.summary.json'), JSON.stringify({ version: 999, apiCalls: 1, windows: [] }))
    expect(adoptSidecarFromDisk('sess-1', { size: 1, modifiedAt: 1 })).toBeNull()

    writeFileSync(join(dir, 'session-sess-1.summary.json'), JSON.stringify({ version: 1, apiCalls: 'bogus', windows: 'x' }))
    expect(adoptSidecarFromDisk('sess-1', { size: 1, modifiedAt: 1 })).toBeNull()
  })

  it('未 initTraceSidecar（单测/异常环境）时不读写磁盘', () => {
    initTraceSidecar(null)
    const stat = recordAll(EVENTS)
    flushTraceSidecars()
    expect(existsSync(join(dir, 'session-sess-1.summary.json'))).toBe(false)
    expect(getSidecarSummary('sess-1', stat)).not.toBeNull() // 内存态照常工作
  })
})
