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

  const mockPendingMessages = new Map<string, any[]>()

  const mockTurnStore = {
    onTurnOutcome: vi.fn((cb: (sessionId: string, outcome: 'settled' | 'failed' | 'aborted') => void) => {
      container.cb = cb
      return () => { container.cb = null }
    }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    addPendingMessage: vi.fn((sessionId: string, msg: any) => {
      const queue = mockPendingMessages.get(sessionId) || []
      queue.push(msg)
      mockPendingMessages.set(sessionId, queue)
    }),
    getPendingMessages: vi.fn((sessionId: string) => mockPendingMessages.get(sessionId) || []),
    clearPendingMessages: vi.fn((sessionId: string) => { mockPendingMessages.delete(sessionId) }),
    pendingPermissions: new Map() as any,
    allowPermission: vi.fn().mockResolvedValue(undefined),
    denyPermission: vi.fn().mockResolvedValue(undefined),
    hasPendingPermissionForToolUse: vi.fn().mockReturnValue(false),
  }

  const mockSessionStore = {
    createSession: vi.fn().mockImplementation((_title: string, _cwd?: string, id?: string) => ({
      id: id || `session-${Date.now()}`,
    })),
  }

  const mockClaudeCodeApi = {
    abort: vi.fn().mockResolvedValue(undefined),
  }

  return { mockTurnStore, mockSessionStore, mockClaudeCodeApi, container, mockPendingMessages }
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

// ── 单节点停止 ──

describe('useOrchestrationRun — 单节点停止', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
    hoisted.mockClaudeCodeApi.abort.mockClear()
  })

  it('stopNode 中止指定节点 → failed，下游 skipped，旁支继续', async () => {
    // A → B → C, D 独立旁支
    setupCanvas([
      makeNode('A', 'task A'),
      makeNode('B', 'task B'),
      makeNode('C', 'task C'),
      makeNode('D', 'task D'),
    ], [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
    ])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    // A running, D running
    expect(run.getNodeStatus('A')).toBe('running')
    expect(run.getNodeStatus('D')).toBe('running')

    // A settle → B running
    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    expect(run.getNodeStatus('B')).toBe('running')

    // 停掉 B
    await run.stopNode('B')
    await flushMicrotasks()

    expect(run.getNodeStatus('B')).toBe('failed')
    expect(run.getNodeStatus('C')).toBe('skipped')
    // D 旁支继续
    expect(run.getNodeStatus('D')).toBe('running')
    expect(run.isRunning.value).toBe(true)

    // 清理
    signalOutcome('sess-D', 'settled')
    await flushMicrotasks()
    await runPromise
  })
})

// ── 失败节点重试 ──

describe('useOrchestrationRun — 失败节点重试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('retryNode 对 failed 节点重跑，成功后下游续跑', async () => {
    setupCanvas([
      makeNode('A', 'task A'),
      makeNode('B', 'task B'),
      makeNode('C', 'task C'),
    ], [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
    ])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    // A settle → B running
    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()

    // B failed → C skipped, run 结束
    signalOutcome('sess-B', 'failed')
    await flushMicrotasks()
    await runPromise

    expect(run.getNodeStatus('B')).toBe('failed')
    expect(run.getNodeStatus('C')).toBe('skipped')

    // 重试 B — 新 session
    hoisted.mockSessionStore.createSession.mockImplementationOnce(() => ({ id: 'sess-B-retry' }))
    const retryPromise = run.retryNode('B')
    await retryPromise
    await flushMicrotasks()

    expect(run.getNodeStatus('B')).toBe('running')

    // B 重试成功 → C 续跑
    signalOutcome('sess-B-retry', 'settled')
    await flushMicrotasks()
    await flushMicrotasks()

    expect(run.getNodeStatus('B')).toBe('settled')
    expect(run.getNodeStatus('C')).toBe('running')

    // 清理
    signalOutcome('sess-C', 'settled')
    await flushMicrotasks()
  })

  it('retry 的续跑闭包全部结束后 isRunning 复位（不留下悬空锁）', async () => {
    setupCanvas([
      makeNode('A', 'task A'),
      makeNode('B', 'task B'),
      makeNode('C', 'task C'),
    ], [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
    ])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()
    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    signalOutcome('sess-B', 'failed')
    await flushMicrotasks()
    await runPromise

    expect(run.isRunning.value).toBe(false)

    // 重试 B — 引擎把 Run 切回 running，锁随之重新生效
    hoisted.mockSessionStore.createSession.mockImplementationOnce(() => ({ id: 'sess-B-retry' }))
    await run.retryNode('B')
    await flushMicrotasks()

    expect(run.isRunning.value).toBe(true)

    // B 续跑成功 → C 接力
    signalOutcome('sess-B-retry', 'settled')
    await flushMicrotasks()
    expect(run.isRunning.value).toBe(true)

    // C 结束 → 整个续跑闭包跑完，锁必须释放
    signalOutcome('sess-C', 'settled')
    await flushMicrotasks()

    expect(run.isRunning.value).toBe(false)
  })
})

// ── 运行中节点追加消息 ──

describe('useOrchestrationRun — 运行中节点追加消息', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
    hoisted.mockPendingMessages.clear()
    hoisted.mockTurnStore.addPendingMessage.mockClear()
  })

  it('addNodeMessage 调用 turnStore.addPendingMessage 传入正确 sessionId', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    run.addNodeMessage('A', 'extra context')

    expect(hoisted.mockTurnStore.addPendingMessage).toHaveBeenCalledWith('sess-A', expect.objectContaining({
      content: 'extra context',
    }))

    // 清理
    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    await runPromise
  })
})

// ── 权限请求按 sessionId 路由 ──

describe('useOrchestrationRun — 权限请求路由', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
    // 重置权限 Map
    hoisted.mockTurnStore.pendingPermissions = new Map() as any
  })

  it('hasPendingPermissionForNode 返回节点是否有待处理权限', async () => {
    setupCanvas([makeNode('A', 'task A'), makeNode('B', 'task B')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    // 初始无权限
    expect(run.hasPendingPermissionForNode('A')).toBe(false)

    // 模拟 A 有权限请求 — 在 pendingPermissions Map 中添加 sessionId
    const perms = hoisted.mockTurnStore.pendingPermissions as any
    perms.set('sess-A', new Map([['tu1', { toolUseId: 'tu1' }]]))
    expect(run.hasPendingPermissionForNode('A')).toBe(true)

    // B 无权限请求
    expect(run.hasPendingPermissionForNode('B')).toBe(false)

    // 清理
    signalOutcome('sess-A', 'settled')
    signalOutcome('sess-B', 'settled')
    await flushMicrotasks()
    await runPromise
  })
})

// ── Run 状态快照持久化 ──

describe('useOrchestrationRun — 运行状态快照持久化', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('节点 settle 后快照写入 canvasTaskNode.runStatus 和 runSessionId', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    // A running — 快照应记录 running 状态和 sessionId
    const canvas = useOrchestrationCanvas()
    const nodeBefore = canvas.taskNodes.value.find(n => n.id === 'A')!
    expect(nodeBefore.runStatus).toBe('running')
    expect(nodeBefore.runSessionId).toBe('sess-A')

    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    await runPromise

    // A settled — 快照应更新为 settled
    const nodeAfter = canvas.taskNodes.value.find(n => n.id === 'A')!
    expect(nodeAfter.runStatus).toBe('settled')
    expect(nodeAfter.runSessionId).toBe('sess-A')
  })

  it('节点 failed 后快照记录 failed 状态', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    signalOutcome('sess-A', 'failed')
    await flushMicrotasks()
    await runPromise

    const canvas = useOrchestrationCanvas()
    const node = canvas.taskNodes.value.find(n => n.id === 'A')!
    expect(node.runStatus).toBe('failed')
    expect(node.runSessionId).toBe('sess-A')
  })

  it('快照持久化到 localStorage', async () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    const runPromise = run.startRun()
    await flushMicrotasks()

    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    await runPromise

    const stored = JSON.parse(localStorage.getItem('orchestration_nodes') || '[]')
    expect(stored[0].runStatus).toBe('settled')
    expect(stored[0].runSessionId).toBe('sess-A')
  })
})

// ── 重启后状态恢复 ──

describe('useOrchestrationRun — 重启后状态恢复', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('从 localStorage 恢复节点后 getRestoredNodeStatus 返回上次运行状态', () => {
    // 模拟上次运行后持久化的数据
    const nodeData = [
      {
        id: 'n1',
        sessionId: 'old-session-1',
        draft: 'task 1',
        position: { x: 0, y: 0 },
        runStatus: 'settled',
        runSessionId: 'run-session-1',
      },
      {
        id: 'n2',
        sessionId: 'old-session-2',
        draft: 'task 2',
        position: { x: 100, y: 0 },
        runStatus: 'failed',
        runSessionId: 'run-session-2',
      },
      {
        id: 'n3',
        sessionId: 'old-session-3',
        draft: 'task 3',
        position: { x: 200, y: 0 },
        runStatus: 'running',
        runSessionId: 'run-session-3',
      },
    ]
    localStorage.setItem('orchestration_nodes', JSON.stringify(nodeData))

    const canvas = useOrchestrationCanvas()
    canvas.reloadFromStorage()
    const run = useOrchestrationRun()

    expect(run.getRestoredNodeStatus('n1')).toBe('settled')
    expect(run.getRestoredNodeStatus('n2')).toBe('failed')
    // running 在重启后标记为 interrupted
    expect(run.getRestoredNodeStatus('n3')).toBe('interrupted')
  })

  it('getRestoredNodeStatus 返回 undefined 当节点无快照', () => {
    const nodeData = [
      {
        id: 'n1',
        sessionId: 's1',
        draft: 'task 1',
        position: { x: 0, y: 0 },
      },
    ]
    localStorage.setItem('orchestration_nodes', JSON.stringify(nodeData))

    const canvas = useOrchestrationCanvas()
    canvas.reloadFromStorage()
    const run = useOrchestrationRun()

    expect(run.getRestoredNodeStatus('n1')).toBeUndefined()
  })

  it('getRestoredNodeSessionId 返回上次运行绑定的 sessionId', () => {
    const nodeData = [
      {
        id: 'n1',
        sessionId: 'canvas-session-1',
        draft: 'task 1',
        position: { x: 0, y: 0 },
        runStatus: 'settled',
        runSessionId: 'run-session-1',
      },
    ]
    localStorage.setItem('orchestration_nodes', JSON.stringify(nodeData))

    const canvas = useOrchestrationCanvas()
    canvas.reloadFromStorage()
    const run = useOrchestrationRun()

    expect(run.getRestoredNodeSessionId('n1')).toBe('run-session-1')
  })
})

// ── 整图重跑 ──

describe('useOrchestrationRun — 整图重跑', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const canvas = useOrchestrationCanvas()
    canvas._resetState()
  })

  it('rerunAll 清除所有节点的快照状态并重新开始运行', async () => {
    setupCanvas([
      makeNode('A', 'task A'),
      makeNode('B', 'task B'),
    ], [
      makeEdge('A', 'B'),
    ])
    const run = useOrchestrationRun()

    // 第一次运行
    const runPromise = run.startRun()
    await flushMicrotasks()

    signalOutcome('sess-A', 'settled')
    await flushMicrotasks()
    signalOutcome('sess-B', 'settled')
    await flushMicrotasks()
    await runPromise

    // 确认快照已写入
    const canvas = useOrchestrationCanvas()
    expect(canvas.taskNodes.value[0].runStatus).toBe('settled')

    // 整图重跑
    hoisted.mockSessionStore.createSession
      .mockImplementationOnce(() => ({ id: 'sess-A-rerun' }))
      .mockImplementationOnce(() => ({ id: 'sess-B-rerun' }))

    const rerunPromise = run.rerunAll()
    await flushMicrotasks()

    expect(run.getNodeStatus('A')).toBe('running')
    expect(run.getNodeStatus('B')).toBe('pending')

    // 重跑使用新 session
    expect(canvas.taskNodes.value.find(n => n.id === 'A')!.sessionId).toBe('sess-A-rerun')

    signalOutcome('sess-A-rerun', 'settled')
    await flushMicrotasks()
    signalOutcome('sess-B-rerun', 'settled')
    await flushMicrotasks()
    await rerunPromise

    expect(run.getNodeStatus('A')).toBe('settled')
    expect(run.getNodeStatus('B')).toBe('settled')
  })

  it('rerunAll 按钮仅在非运行时可用', () => {
    setupCanvas([makeNode('A', 'task A')], [])
    const run = useOrchestrationRun()

    expect(run.canRerun.value).toBe(false) // 未运行过，无法重跑

    // 运行一次
    const runPromise = run.startRun()
    flushMicrotasks().then(() => {
      signalOutcome('sess-A', 'settled')
    })

    return runPromise.then(() => {
      expect(run.canRerun.value).toBe(true) // 运行过后可以重跑
    })
  })
})
