// tests/stores/orchestration.test.ts
// 编排引擎 DAG 状态机测试 — 纯逻辑层，注入 fake 驱动全部语义。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOrchestrationEngine } from '@/stores/orchestration'
import type {
  OrchestrationEngine,
  OrchestrationEngineOptions,
  SessionLauncher,
  TurnOutcomeSource,
  SessionAborter,
} from '@/stores/orchestration/types'

// ── Fake 工具 ──

interface FakeOpts {
  maxConcurrency?: number
}

function makeFakes(opts: FakeOpts = {}) {
  const outcomeListeners = new Set<(sessionId: string, outcome: 'settled' | 'failed' | 'aborted') => void>()

  const launcher: SessionLauncher = {
    createSession: vi.fn().mockImplementation(async (nodeId: string) => {
      return `session-${nodeId}`
    }),
    sendDraft: vi.fn().mockResolvedValue(undefined),
  }

  const outcomeSource: TurnOutcomeSource = {
    subscribe(listener) {
      outcomeListeners.add(listener)
      return () => outcomeListeners.delete(listener)
    },
  }

  const aborter: SessionAborter = {
    abort: vi.fn().mockResolvedValue(undefined),
  }

  function signalOutcome(sessionId: string, outcome: 'settled' | 'failed' | 'aborted') {
    for (const l of outcomeListeners) l(sessionId, outcome)
  }

  const engineOpts: OrchestrationEngineOptions = {
    sessionLauncher: launcher,
    outcomeSource,
    sessionAborter: aborter,
    maxConcurrency: opts.maxConcurrency,
  }

  return { launcher, outcomeSource, aborter, signalOutcome, engineOpts }
}

/** 刷新微任务队列 — 足够让 async 链执行 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

// ── 串行链 ──

describe('编排引擎 — 串行链', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('A settle 后 B 才启动，B settle 后 C 才启动', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'B', target: 'C' })

    const runPromise = engine.run()
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('B')).toBe('pending')
    expect(engine.getNodeStatus('C')).toBe('pending')

    expect(fakes.launcher.createSession).toHaveBeenCalledWith('A')
    expect(fakes.launcher.sendDraft).toHaveBeenCalledWith('session-A', 'task A')

    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('settled')
    expect(engine.getNodeStatus('B')).toBe('running')
    expect(engine.getNodeStatus('C')).toBe('pending')

    fakes.signalOutcome('session-B', 'settled')
    await flushMicrotasks()

    expect(engine.getNodeStatus('B')).toBe('settled')
    expect(engine.getNodeStatus('C')).toBe('running')

    fakes.signalOutcome('session-C', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('C')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')
  })
})

// ── 并行分叉 ──

describe('编排引擎 — 并行分叉', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('A settle 后 B、C 同时进入就绪（并行启动）', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'A', target: 'C' })

    const runPromise = engine.run()
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('B')).toBe('pending')
    expect(engine.getNodeStatus('C')).toBe('pending')

    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('settled')
    expect(engine.getNodeStatus('B')).toBe('running')
    expect(engine.getNodeStatus('C')).toBe('running')

    fakes.signalOutcome('session-B', 'settled')
    await flushMicrotasks()

    expect(engine.getNodeStatus('B')).toBe('settled')
    expect(engine.getNodeStatus('C')).toBe('running')

    fakes.signalOutcome('session-C', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('C')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')
  })
})

// ── 汇合 ──

describe('编排引擎 — 汇合', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('所有上游 settle 才启动；任一上游 failed 则该节点 skipped', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'D', draft: 'task D' })
    engine.addEdge({ source: 'A', target: 'D' })
    engine.addEdge({ source: 'B', target: 'D' })

    const runPromise = engine.run()
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('B')).toBe('running')
    expect(engine.getNodeStatus('D')).toBe('pending')

    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()
    expect(engine.getNodeStatus('D')).toBe('pending')

    fakes.signalOutcome('session-B', 'settled')
    await flushMicrotasks()
    expect(engine.getNodeStatus('D')).toBe('running')

    fakes.signalOutcome('session-D', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('D')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')
  })

  it('任一上游 failed 则汇合节点 skipped', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'D', draft: 'task D' })
    engine.addEdge({ source: 'A', target: 'D' })
    engine.addEdge({ source: 'B', target: 'D' })

    const runPromise = engine.run()
    await flushMicrotasks()

    fakes.signalOutcome('session-A', 'failed')
    await flushMicrotasks()
    expect(engine.getNodeStatus('A')).toBe('failed')
    expect(engine.getNodeStatus('D')).toBe('pending')

    fakes.signalOutcome('session-B', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('D')).toBe('skipped')
    expect(engine.getRunState().status).toBe('idle')
  })
})

// ── 失败传播 ──

describe('编排引擎 — 失败传播', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('节点 failed → 下游传递闭包全部 skipped；无关旁支不受影响继续跑', async () => {
    // A → B → C（串行链），D 独立根节点（旁支）
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })
    engine.addNode({ id: 'D', draft: 'task D' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'B', target: 'C' })
    // D 无依赖 — 旁支

    const runPromise = engine.run()
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('D')).toBe('running')

    fakes.signalOutcome('session-A', 'failed')
    await flushMicrotasks()

    expect(engine.getNodeStatus('A')).toBe('failed')
    expect(engine.getNodeStatus('B')).toBe('skipped')
    expect(engine.getNodeStatus('C')).toBe('skipped')
    expect(engine.getNodeStatus('D')).toBe('running')

    fakes.signalOutcome('session-D', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('D')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')
  })
})

// ── 重试续跑 ──

describe('编排引擎 — 重试续跑', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('failed 节点重跑成功后自动续跑被 skip 的下游', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'B', target: 'C' })

    const runPromise = engine.run()
    await flushMicrotasks()

    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()
    expect(engine.getNodeStatus('B')).toBe('running')

    fakes.signalOutcome('session-B', 'failed')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('B')).toBe('failed')
    expect(engine.getNodeStatus('C')).toBe('skipped')

    // 重试 B — 新 session
    vi.mocked(fakes.launcher.createSession).mockResolvedValueOnce('session-B-retry')
    await engine.retryNode('B')
    await flushMicrotasks()

    expect(engine.getNodeStatus('B')).toBe('running')
    expect(fakes.launcher.createSession).toHaveBeenCalledWith('B')

    // B 重试成功 → C 自动续跑
    fakes.signalOutcome('session-B-retry', 'settled')
    await flushMicrotasks()

    expect(engine.getNodeStatus('B')).toBe('settled')
    expect(engine.getNodeStatus('C')).toBe('running')

    fakes.signalOutcome('session-C', 'settled')
    await flushMicrotasks()
  })
})

// ── 并发闸门 ──

describe('编排引擎 — 并发闸门', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes({ maxConcurrency: 2 })
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('同时 running 节点数不超过上限，超出的排队，空位释放自动启动', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })

    const runPromise = engine.run()
    await flushMicrotasks()

    // 只有 2 个 running，第 3 个 queued
    const runningNodes = ['A', 'B', 'C'].filter(n => engine.getNodeStatus(n) === 'running')
    expect(runningNodes.length).toBe(2)
    const queuedNode = ['A', 'B', 'C'].find(n => engine.getNodeStatus(n) === 'queued')
    expect(queuedNode).toBeTruthy()

    // 一个 settle → 排队的自动启动
    const runningSession = ['A', 'B', 'C']
      .filter(n => engine.getNodeStatus(n) === 'running')
      .map(n => `session-${n}`)[0]
    fakes.signalOutcome(runningSession, 'settled')
    await flushMicrotasks()

    // 排队的节点应该已经被补位启动
    const queuedAfter = ['A', 'B', 'C'].find(n => engine.getNodeStatus(n) === 'queued')
    expect(queuedAfter).toBeUndefined()

    // 完成剩余节点
    const remainingRunning = ['A', 'B', 'C']
      .filter(n => engine.getNodeStatus(n) === 'running')
      .map(n => `session-${n}`)
    for (const sid of remainingRunning) {
      fakes.signalOutcome(sid, 'settled')
      await flushMicrotasks()
    }
    await runPromise
  })
})

// ── 单节点停止 ──

describe('编排引擎 — 单节点停止', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('stopNode 中止指定节点 → failed，下游传递闭包 skipped，旁支继续', async () => {
    // A → (B, C) → D, E 独立旁支
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })
    engine.addNode({ id: 'D', draft: 'task D' })
    engine.addNode({ id: 'E', draft: 'task E' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'A', target: 'C' })
    engine.addEdge({ source: 'B', target: 'D' })
    engine.addEdge({ source: 'C', target: 'D' })

    const runPromise = engine.run()
    await flushMicrotasks()

    // A running, E running
    expect(engine.getNodeStatus('A')).toBe('running')
    expect(engine.getNodeStatus('E')).toBe('running')

    // A settle → B, C 启动
    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()
    expect(engine.getNodeStatus('B')).toBe('running')
    expect(engine.getNodeStatus('C')).toBe('running')

    // 停掉 B → failed，D 的上游 C 仍 running 所以 D 暂时 pending
    await engine.stopNode('B')
    await flushMicrotasks()

    expect(engine.getNodeStatus('B')).toBe('failed')
    expect(fakes.aborter.abort).toHaveBeenCalledWith('session-B')
    // C 旁支继续 running
    expect(engine.getNodeStatus('C')).toBe('running')
    // E 旁支继续 running
    expect(engine.getNodeStatus('E')).toBe('running')

    // C settle → D 上游有 failed(B) → D skipped
    fakes.signalOutcome('session-C', 'settled')
    await flushMicrotasks()
    expect(engine.getNodeStatus('D')).toBe('skipped')

    // E settle → run 完成
    fakes.signalOutcome('session-E', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(engine.getNodeStatus('E')).toBe('settled')
    expect(engine.getRunState().status).toBe('idle')
  })

  it('stopNode 对非 running 节点无操作', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addEdge({ source: 'A', target: 'B' })

    const runPromise = engine.run()
    await flushMicrotasks()

    // B 是 pending — stopNode 无效果
    await engine.stopNode('B')
    await flushMicrotasks()

    expect(engine.getNodeStatus('B')).toBe('pending')
    expect(fakes.aborter.abort).not.toHaveBeenCalled()

    // 清理
    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()
    fakes.signalOutcome('session-B', 'settled')
    await flushMicrotasks()
    await runPromise
  })
})

// ── 运行中锁结构 ──

describe('编排引擎 — 运行中锁结构', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('Run 进行中拒绝增删节点与连线', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })

    const runPromise = engine.run()
    await flushMicrotasks()

    // Run 进行中 — 拒绝增删
    expect(() => engine.addNode({ id: 'B', draft: 'task B' })).toThrow(/running/i)
    expect(() => engine.removeNode('A')).toThrow(/running/i)
    expect(() => engine.addEdge({ source: 'A', target: 'C' })).toThrow(/running/i)
    expect(() => engine.removeEdge('A', 'B')).toThrow(/running/i)

    // 清理
    fakes.signalOutcome('session-A', 'settled')
    await flushMicrotasks()
    await runPromise
  })
})

// ── 环检测 ──

describe('编排引擎 — 环检测', () => {
  let fakes: ReturnType<typeof makeFakes>
  let engine: OrchestrationEngine

  beforeEach(() => {
    fakes = makeFakes()
    engine = createOrchestrationEngine(fakes.engineOpts)
  })

  it('含环的图拒绝 Run 并报告环路上的节点', async () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addNode({ id: 'C', draft: 'task C' })
    engine.addEdge({ source: 'A', target: 'B' })
    engine.addEdge({ source: 'B', target: 'C' })
    engine.addEdge({ source: 'C', target: 'A' })

    const cycle = engine.detectCycle()
    expect(cycle.hasCycle).toBe(true)
    expect(cycle.cycleNodes.sort()).toEqual(['A', 'B', 'C'])

    await expect(engine.run()).rejects.toThrow(/cycle/i)
  })

  it('无环的图正常通过检测', () => {
    engine.addNode({ id: 'A', draft: 'task A' })
    engine.addNode({ id: 'B', draft: 'task B' })
    engine.addEdge({ source: 'A', target: 'B' })

    const cycle = engine.detectCycle()
    expect(cycle.hasCycle).toBe(false)
    expect(cycle.cycleNodes).toEqual([])
  })
})
