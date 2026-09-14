// tests/composables/useOrchestrationCanvas.test.ts
// 编排画布 composable 测试 — 小地图开关 + 任务节点 CRUD + 草稿 + 坐标 + localStorage 持久化 + Edge 连线 + 环预防。
// Seam: useOrchestrationCanvas 公共接口

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOrchestrationCanvas } from '@/composables/useOrchestrationCanvas'
import { useChatSessionStore } from '@/stores/chatSession'

describe('useOrchestrationCanvas — minimap toggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('minimap is visible by default', () => {
    const { showMinimap } = useOrchestrationCanvas()
    expect(showMinimap.value).toBe(true)
  })

  it('toggleMinimap flips the state', () => {
    const { showMinimap, toggleMinimap } = useOrchestrationCanvas()

    expect(showMinimap.value).toBe(true)

    toggleMinimap()
    expect(showMinimap.value).toBe(false)

    toggleMinimap()
    expect(showMinimap.value).toBe(true)
  })
})

// ── Task Node CRUD + Draft + Position + Persistence ──

describe('useOrchestrationCanvas — task node lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('starts with no nodes', () => {
    const { taskNodes } = useOrchestrationCanvas()
    expect(taskNodes.value).toEqual([])
  })

  it('createTaskNode adds a node with a unique id, empty draft, and default position', () => {
    const { taskNodes, createTaskNode } = useOrchestrationCanvas()

    const node = createTaskNode()

    expect(taskNodes.value).toHaveLength(1)
    expect(node.id).toBeTruthy()
    expect(node.draft).toBe('')
    expect(node.position).toEqual({ x: 0, y: 0 })
    expect(node.sessionId).toBeTruthy()
  })

  it('createTaskNode accepts a custom position', () => {
    const { createTaskNode } = useOrchestrationCanvas()

    const node = createTaskNode({ x: 100, y: 200 })

    expect(node.position).toEqual({ x: 100, y: 200 })
  })

  it('createTaskNode creates a real chat session via chatSession store', () => {
    const { createTaskNode } = useOrchestrationCanvas()

    const node = createTaskNode()

    expect(node.sessionId).toBeTruthy()
    expect(typeof node.sessionId).toBe('string')
  })

  it('removeTaskNode removes the node from the list', () => {
    const { taskNodes, createTaskNode, removeTaskNode } = useOrchestrationCanvas()

    const node = createTaskNode()
    expect(taskNodes.value).toHaveLength(1)

    removeTaskNode(node.id)
    expect(taskNodes.value).toHaveLength(0)
  })

  it('removeTaskNode does not delete the associated chat session', () => {
    const { createTaskNode, removeTaskNode } = useOrchestrationCanvas()
    const sessionStore = useChatSessionStore()

    const node = createTaskNode()
    const sessionId = node.sessionId
    expect(sessionStore.sessions.find(s => s.id === sessionId)).toBeDefined()

    removeTaskNode(node.id)

    // Session should still exist in the session store
    expect(sessionStore.sessions.find(s => s.id === sessionId)).toBeDefined()
  })

  it('removeTaskNode on a non-existent id is a no-op', () => {
    const { taskNodes, removeTaskNode } = useOrchestrationCanvas()

    removeTaskNode('nonexistent-id')
    expect(taskNodes.value).toHaveLength(0)
  })
})

describe('useOrchestrationCanvas — draft management', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('setDraft updates the draft text of a node', () => {
    const { createTaskNode, setDraft, taskNodes } = useOrchestrationCanvas()

    const node = createTaskNode()
    setDraft(node.id, 'Write a hello world program')

    expect(taskNodes.value[0].draft).toBe('Write a hello world program')
  })

  it('setDraft on a non-existent node is a no-op', () => {
    const { setDraft } = useOrchestrationCanvas()

    expect(() => setDraft('nonexistent', 'text')).not.toThrow()
  })
})

describe('useOrchestrationCanvas — node position', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('updateNodePosition updates the position of a node', () => {
    const { createTaskNode, updateNodePosition, taskNodes } = useOrchestrationCanvas()

    const node = createTaskNode({ x: 50, y: 50 })
    updateNodePosition(node.id, { x: 200, y: 300 })

    expect(taskNodes.value[0].position).toEqual({ x: 200, y: 300 })
  })
})

describe('useOrchestrationCanvas — localStorage persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('persists nodes to localStorage on creation', () => {
    const { createTaskNode } = useOrchestrationCanvas()

    createTaskNode({ x: 10, y: 20 })

    const stored = JSON.parse(localStorage.getItem('orchestration_nodes') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].position).toEqual({ x: 10, y: 20 })
  })

  it('persists draft changes to localStorage', () => {
    const { createTaskNode, setDraft } = useOrchestrationCanvas()

    const node = createTaskNode()
    setDraft(node.id, 'My task draft')

    const stored = JSON.parse(localStorage.getItem('orchestration_nodes') || '[]')
    expect(stored[0].draft).toBe('My task draft')
  })

  it('persists position changes to localStorage', () => {
    const { createTaskNode, updateNodePosition } = useOrchestrationCanvas()

    const node = createTaskNode({ x: 0, y: 0 })
    updateNodePosition(node.id, { x: 100, y: 200 })

    const stored = JSON.parse(localStorage.getItem('orchestration_nodes') || '[]')
    expect(stored[0].position).toEqual({ x: 100, y: 200 })
  })

  it('removes node from localStorage on delete', () => {
    const { createTaskNode, removeTaskNode } = useOrchestrationCanvas()

    const node = createTaskNode()
    removeTaskNode(node.id)

    const stored = JSON.parse(localStorage.getItem('orchestration_nodes') || '[]')
    expect(stored).toHaveLength(0)
  })

  it('restores nodes from localStorage via reloadFromStorage', () => {
    const { reloadFromStorage, taskNodes } = useOrchestrationCanvas()

    // Pre-populate localStorage after reset
    const nodeData = [
      {
        id: 'test-node-1',
        sessionId: 'test-session-1',
        draft: 'Test draft',
        position: { x: 42, y: 99 },
      },
    ]
    localStorage.setItem('orchestration_nodes', JSON.stringify(nodeData))

    // Trigger reload from localStorage
    reloadFromStorage()

    expect(taskNodes.value).toHaveLength(1)
    expect(taskNodes.value[0].id).toBe('test-node-1')
    expect(taskNodes.value[0].draft).toBe('Test draft')
    expect(taskNodes.value[0].position).toEqual({ x: 42, y: 99 })
  })
})

// ── Edge CRUD ──

describe('useOrchestrationCanvas — edge lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('starts with no edges', () => {
    const { edges } = useOrchestrationCanvas()
    expect(edges.value).toEqual([])
  })

  it('createEdge adds an edge with source and target', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const edge = createEdge(a.id, b.id)!

    expect(edges.value).toHaveLength(1)
    expect(edge.id).toBeTruthy()
    expect(edge.source).toBe(a.id)
    expect(edge.target).toBe(b.id)
  })

  it('createEdge supports one-to-many (parallel fork): A→B, A→C', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const c = createTaskNode()

    createEdge(a.id, b.id)
    createEdge(a.id, c.id)

    expect(edges.value).toHaveLength(2)
    expect(edges.value.some(e => e.source === a.id && e.target === b.id)).toBe(true)
    expect(edges.value.some(e => e.source === a.id && e.target === c.id)).toBe(true)
  })

  it('createEdge supports many-to-one (convergence): A→C, B→C', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const c = createTaskNode()

    createEdge(a.id, c.id)
    createEdge(b.id, c.id)

    expect(edges.value).toHaveLength(2)
    expect(edges.value.some(e => e.source === a.id && e.target === c.id)).toBe(true)
    expect(edges.value.some(e => e.source === b.id && e.target === c.id)).toBe(true)
  })

  it('removeEdge removes the edge from the list', () => {
    const { createTaskNode, createEdge, removeEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const edge = createEdge(a.id, b.id)!
    expect(edges.value).toHaveLength(1)

    removeEdge(edge.id)
    expect(edges.value).toHaveLength(0)
  })

  it('removeEdge on a non-existent id is a no-op', () => {
    const { removeEdge, edges } = useOrchestrationCanvas()

    removeEdge('nonexistent-id')
    expect(edges.value).toHaveLength(0)
  })

  it('removing a node also removes its connected edges', () => {
    const { createTaskNode, createEdge, removeTaskNode, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const c = createTaskNode()

    createEdge(a.id, b.id)
    createEdge(b.id, c.id)
    expect(edges.value).toHaveLength(2)

    removeTaskNode(b.id)
    expect(edges.value).toHaveLength(0)
  })
})

// ── Self-loop rejection ──

describe('useOrchestrationCanvas — self-loop rejection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('createEdge rejects self-loop (source === target)', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const result = createEdge(a.id, a.id)

    expect(result).toBeNull()
    expect(edges.value).toHaveLength(0)
  })
})

// ── Cycle prevention ──

describe('useOrchestrationCanvas — cycle prevention', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('rejects direct cycle: A→B then B→A', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()

    expect(createEdge(a.id, b.id)).not.toBeNull()
    expect(edges.value).toHaveLength(1)

    const result = createEdge(b.id, a.id)
    expect(result).toBeNull()
    expect(edges.value).toHaveLength(1)
  })

  it('rejects indirect cycle: A→B→C then C→A', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const c = createTaskNode()

    createEdge(a.id, b.id)
    createEdge(b.id, c.id)
    expect(edges.value).toHaveLength(2)

    const result = createEdge(c.id, a.id)
    expect(result).toBeNull()
    expect(edges.value).toHaveLength(2)
  })

  it('allows parallel branches that do not form a cycle: A→B, A→C, B→D, C→D', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const c = createTaskNode()
    const d = createTaskNode()

    createEdge(a.id, b.id)
    createEdge(a.id, c.id)
    createEdge(b.id, d.id)
    createEdge(c.id, d.id)

    expect(edges.value).toHaveLength(4)
  })

  it('rejects cycle in larger graph: A→B→C→D then D→B', () => {
    const { createTaskNode, createEdge, edges } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const c = createTaskNode()
    const d = createTaskNode()

    createEdge(a.id, b.id)
    createEdge(b.id, c.id)
    createEdge(c.id, d.id)

    // D→B would create cycle B→C→D→B
    const result = createEdge(d.id, b.id)
    expect(result).toBeNull()
    expect(edges.value).toHaveLength(3)
  })

  it('canCreateEdge returns true for valid edge', () => {
    const { createTaskNode, canCreateEdge } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()

    expect(canCreateEdge(a.id, b.id)).toBe(true)
  })

  it('canCreateEdge returns false for self-loop', () => {
    const { createTaskNode, canCreateEdge } = useOrchestrationCanvas()

    const a = createTaskNode()

    expect(canCreateEdge(a.id, a.id)).toBe(false)
  })

  it('canCreateEdge returns false for cycle-forming edge', () => {
    const { createTaskNode, createEdge, canCreateEdge } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()

    createEdge(a.id, b.id)

    expect(canCreateEdge(b.id, a.id)).toBe(false)
  })
})

// ── Edge localStorage persistence ──

describe('useOrchestrationCanvas — edge persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useOrchestrationCanvas()._resetState()
  })

  it('persists edges to localStorage on creation', () => {
    const { createTaskNode, createEdge } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    createEdge(a.id, b.id)

    const stored = JSON.parse(localStorage.getItem('orchestration_edges') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].source).toBe(a.id)
    expect(stored[0].target).toBe(b.id)
  })

  it('removes edge from localStorage on delete', () => {
    const { createTaskNode, createEdge, removeEdge } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    const edge = createEdge(a.id, b.id)!
    removeEdge(edge.id)

    const stored = JSON.parse(localStorage.getItem('orchestration_edges') || '[]')
    expect(stored).toHaveLength(0)
  })

  it('restores edges from localStorage via reloadFromStorage', () => {
    const { reloadFromStorage, edges, taskNodes } = useOrchestrationCanvas()

    // Pre-populate both nodes and edges in localStorage
    const nodeData = [
      { id: 'n1', sessionId: 's1', draft: '', position: { x: 0, y: 0 } },
      { id: 'n2', sessionId: 's2', draft: '', position: { x: 100, y: 0 } },
    ]
    const edgeData = [
      { id: 'e1', source: 'n1', target: 'n2' },
    ]
    localStorage.setItem('orchestration_nodes', JSON.stringify(nodeData))
    localStorage.setItem('orchestration_edges', JSON.stringify(edgeData))

    reloadFromStorage()

    expect(taskNodes.value).toHaveLength(2)
    expect(edges.value).toHaveLength(1)
    expect(edges.value[0].id).toBe('e1')
    expect(edges.value[0].source).toBe('n1')
    expect(edges.value[0].target).toBe('n2')
  })

  it('removes edges from localStorage when node is deleted', () => {
    const { createTaskNode, createEdge, removeTaskNode } = useOrchestrationCanvas()

    const a = createTaskNode()
    const b = createTaskNode()
    createEdge(a.id, b.id)

    removeTaskNode(a.id)

    const stored = JSON.parse(localStorage.getItem('orchestration_edges') || '[]')
    expect(stored).toHaveLength(0)
  })
})
