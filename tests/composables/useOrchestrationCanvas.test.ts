// tests/composables/useOrchestrationCanvas.test.ts
// 编排画布 composable 测试 — 小地图开关 + 任务节点 CRUD + 草稿 + 坐标 + localStorage 持久化。
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
