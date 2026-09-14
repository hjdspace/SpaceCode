// tests/composables/useOrchestrationRun.test.ts
// 编排运行链路 composable 测试 — 验证引擎接线、空草稿校验、运行中锁结构、进度追踪。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── Mock 依赖 (vi.hoisted 保证 vi.mock 中可引用) ──

const hoisted = vi.hoisted(() => {
  // 使用一个可变容器保存 outcome callback
  const container = {
    cb: null as ((sessionId: string, outcome: 'settled' | 'failed' | 'aborted') => void) | null,
  }

  const mockTurnStore = {
    onTurnOutcome: vi.fn((cb: (sessionId: string, outcome: 'settled' | 'failed' | 'aborted') => void) => {
      container.cb = cb
      return () => { container.cb = null }
    }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  }

  const mockSessionStore = {
    createSession: vi.fn().mockImplementation((_title: string, _cwd?: string, id?: string) => ({
      id: id || `session-${Date.now()}`,
    })),
  }

  const mockClaudeCodeApi = {
    abort: vi.fn().mockResolvedValue(undefined),
  }

  return { mockTurnStore, mockSessionStore, mockClaudeCodeApi, container }
})

vi.mock('@/stores/turn', () => ({
  useTurnStore: () => hoisted.mockTurnStore,
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => hoisted.mockSessionStore,
}))

vi.mock('@/services/electronAPI', () => ({
  api: { claudeCode: hoisted.mockClaudeCodeApi },
}))

import { useOrchestrationRun } from '@/composables/useOrchestrationRun'
import { useOrchestrationCanvas } from '@/composables/useOrchestrationCanvas'
import type { CanvasTaskNode, CanvasEdge } from '@/composables/useOrchestrationCanvas'

// ── 辅助 ──

function makeNode(id: string, draft = '', position = { x: 0, y: 0 }): CanvasTaskNode {
  return { id, sessionId: `sess-${id}`, draft, position }
}

function makeEdge(source: string, target: string): CanvasEdge {
  return { id: `edge-${source}-${target}`, source, target }
}

function setupCanvas(nodes: CanvasTaskNode[], edges: CanvasEdge[]) {
  const canvas = useOrchestrationCanvas()
  canvas._resetState()
  for (const n of nodes) {
    canvas.taskNodes.value.push(n)
  }
  canvas.edges.value.push(...edges)
  return canvas
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

function signalOutcome(sessionId: string, outcome: 'settled' | 'failed' | 'aborted') {
  hoisted.container.cb?.(sessionId, outcome)
}

// ── 测试 ──

describe('useOrchestrationRun — 空草稿校验', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('空草稿节点被标记为标红候选', () => {
    setupCanvas([makeNode('A', ''), makeNode('B', 'has draft')], [])
    const run = useOrchestrationRun()

    expect(run.getEmptyDraftNodeIds()).toEqual(['A'])
  })

  it('canRun 返回 false 当存在空草稿节点', () => {
    setupCanvas([makeNode('A', ''), makeNode('B', 'has draft')], [])
    const run = useOrchestrationRun()

    expect(run.canRun.value).toBe(false)
  })

  it('canRun 返回 true 当所有节点都有草稿', () => {
    setupCanvas([makeNode('A', 'task A'), makeNode('B', 'task B')], [])
    const run = useOrchestrationRun()

    expect(run.canRun.value).toBe(true)
  })

  it('canRun 返回 true 当画布无节点', () => {
    setupCanvas([], [])
    const run = useOrchestrationRun()

    expect(run.canRun.value).toBe(true)
  })
})

describe('useOrchestrationRun — 运行中锁结构', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('isRunning 为 false 初始状态', () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    expect(run.isRunning.value).toBe(false)
  })

  it('运行中 isRunning 为 true，结束后回 false', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    expect(run.isRunning.value).toBe(true)

    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(run.isRunning.value).toBe(false)
  })
})

describe('useOrchestrationRun — 运行进度', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('progress 返回 { completed, total }', () => {
    setupCanvas([makeNode('A', 'task A'), makeNode('B', 'task B')], [])
    const run = useOrchestrationRun()

    expect(run.progress.value).toEqual({ completed: 0, total: 2 })
  })

  it('节点 settle 后 progress.completed 更新', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    expect(run.progress.value).toEqual({ completed: 0, total: 1 })

    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    await runPromise

    expect(run.progress.value).toEqual({ completed: 1, total: 1 })
  })
})

describe('useOrchestrationRun — 节点状态查询', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('getNodeStatus 返回 undefined 当未运行', () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    expect(run.getNodeStatus('A')).toBeUndefined()
  })

  it('getNodeStatus 返回 running 当运行中', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    expect(run.getNodeStatus('A')).toBe('running')

    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    await runPromise
  })
})

describe('useOrchestrationRun — 停止运行', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('stopRun 调用 abort 并将 running 节点标记为 failed', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    expect(run.isRunning.value).toBe(true)

    await run.stopRun()
    await runPromise

    expect(run.isRunning.value).toBe(false)
    expect(run.getNodeStatus('A')).toBe('failed')
    expect(hoisted.mockClaudeCodeApi.abort).toHaveBeenCalled()
  })
})
