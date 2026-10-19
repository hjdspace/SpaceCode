// @vitest-environment node
/**
 * Trace 解析 worker（PR-6a）。
 *
 * 行为契约与旧的主线程实现逐条对齐：
 *  - maxEvents > 0 取最新 N 条；maxEvents === 0 全量（侧车冷启动回填依赖此语义）
 *  - 行级容错：坏行跳过，不整体报错
 *  - 文件不存在 → success:false + error
 * 解析发生在 worker 线程（eval 内联源码，随主进程 bundle 走），这里只验证契约本身。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseTraceFile, disposeTraceParseWorker } from '../traceParseWorker'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-worker-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  disposeTraceParseWorker()
})

function writeTrace(lines: string[]): string {
  const path = join(dir, 'session-x.jsonl')
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
  return path
}

const event = (n: number) => JSON.stringify({ sessionId: 'x', type: 'assistant_turn', n })

describe('parseTraceFile', () => {
  it('maxEvents=N 取最新 N 条有效事件', async () => {
    const path = writeTrace([event(1), event(2), event(3), event(4), event(5)])
    const result = await parseTraceFile(path, 2)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.totalLines).toBe(5)
      expect(result.events).toEqual([{ sessionId: 'x', type: 'assistant_turn', n: 4 }, { sessionId: 'x', type: 'assistant_turn', n: 5 }])
    }
  })

  it('maxEvents=0 返回全量（侧车回填语义）', async () => {
    const path = writeTrace([event(1), event(2), event(3)])
    const result = await parseTraceFile(path, 0)

    expect(result.success).toBe(true)
    if (result.success) expect(result.events).toHaveLength(3)
  })

  it('坏行跳过，不整体报错', async () => {
    const path = writeTrace([event(1), '{ broken json', '', event(3), 'undefined'])
    const result = await parseTraceFile(path, 0)

    expect(result.success).toBe(true)
    if (result.success) expect(result.events).toEqual([{ sessionId: 'x', type: 'assistant_turn', n: 1 }, { sessionId: 'x', type: 'assistant_turn', n: 3 }])
  })

  it('文件不存在 → success:false', async () => {
    const result = await parseTraceFile(join(dir, 'missing.jsonl'), 10)
    expect(result.success).toBe(false)
  })
})
