// src/composables/useOrchestrationCanvas.ts
// 编排画布 composable — 管理画布 UI 状态（小地图开关等）+ 任务节点 CRUD + 草稿 + 坐标 + Edge 连线 + 环预防 + localStorage 持久化。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。

import { ref, watch } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'

// ── 类型 ──

/** 画布坐标 */
export interface XYPosition {
  x: number
  y: number
}

/** 画布上的 Task Node — 包含编排引擎所需数据和画布坐标 */
export interface CanvasTaskNode {
  id: string
  /** 关联的真实会话 ID — 节点的缩小版 ChatPanel 绑定此 ID */
  sessionId: string
  /** 节点草稿 — 用户在 Run 前输入的 prompt 文本 */
  draft: string
  /** 画布坐标 */
  position: XYPosition
}

/** 画布上的 Edge — 节点间的触发依赖连线（target 在 source 完成后启动） */
export interface CanvasEdge {
  id: string
  /** 源节点 ID（上游） */
  source: string
  /** 目标节点 ID（下游） */
  target: string
}

// ── 常量 ──

const STORAGE_KEY = 'orchestration_nodes'
const EDGES_STORAGE_KEY = 'orchestration_edges'

// ── 持久化 ──

function loadNodesFromStorage(): CanvasTaskNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n: unknown): n is CanvasTaskNode => {
      const node = n as Record<string, unknown>
      return (
        typeof node.id === 'string' &&
        typeof node.sessionId === 'string' &&
        typeof node.draft === 'string' &&
        typeof node.position === 'object' &&
        node.position !== null &&
        typeof (node.position as Record<string, unknown>).x === 'number' &&
        typeof (node.position as Record<string, unknown>).y === 'number'
      )
    })
  } catch {
    return []
  }
}

function saveNodesToStorage(nodes: CanvasTaskNode[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes))
  } catch {
    // ignore
  }
}

// ── Edge 持久化 ──

function loadEdgesFromStorage(): CanvasEdge[] {
  try {
    const raw = localStorage.getItem(EDGES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e: unknown): e is CanvasEdge => {
      const edge = e as Record<string, unknown>
      return (
        typeof edge.id === 'string' &&
        typeof edge.source === 'string' &&
        typeof edge.target === 'string'
      )
    })
  } catch {
    return []
  }
}

function saveEdgesToStorage(edges: CanvasEdge[]) {
  try {
    localStorage.setItem(EDGES_STORAGE_KEY, JSON.stringify(edges))
  } catch {
    // ignore
  }
}

// ── 单例状态 ──

/** 小地图开关 — 多个画布组件实例共享 */
const _showMinimap = ref(true)

/** 任务节点列表 — 全局单例，画布打开/关闭后保持 */
const _taskNodes = ref<CanvasTaskNode[]>(loadNodesFromStorage())

/** Edge 列表 — 全局单例 */
const _edges = ref<CanvasEdge[]>(loadEdgesFromStorage())

// 持久化 watch — 节点列表变化时自动保存（deep: 捕获 draft/position 变更）
watch(
  _taskNodes,
  (nodes) => saveNodesToStorage(nodes),
  { deep: true },
)

// 持久化 watch — Edge 列表变化时自动保存
watch(
  _edges,
  (edges) => saveEdgesToStorage(edges),
  { deep: true },
)

// ── UUID 工具 ──

function generateId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return 'node-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

// ── Composable ──

export function useOrchestrationCanvas() {
  const sessionStore = useChatSessionStore()

  const showMinimap = _showMinimap
  const taskNodes = _taskNodes

  function toggleMinimap() {
    _showMinimap.value = !_showMinimap.value
  }

  // ── Task Node CRUD ──

  function createTaskNode(position: XYPosition = { x: 0, y: 0 }): CanvasTaskNode {
    const id = generateId()
    // 创建真实会话 — 走 chatSession store 全链路（出现在侧边栏、localStorage 持久化、可恢复）
    const session = sessionStore.createSession('Task Node')
    const node: CanvasTaskNode = {
      id,
      sessionId: session.id,
      draft: '',
      position,
    }
    _taskNodes.value.push(node)
    // 显式同步保存 — 不依赖 watch 异步触发
    saveNodesToStorage(_taskNodes.value)
    return node
  }

  function removeTaskNode(nodeId: string): void {
    const idx = _taskNodes.value.findIndex(n => n.id === nodeId)
    if (idx === -1) return
    _taskNodes.value.splice(idx, 1)
    // 删除与该节点关联的所有 Edge
    _edges.value = _edges.value.filter(
      e => e.source !== nodeId && e.target !== nodeId,
    )
    // 不删除关联的 chat session — 侧边栏仍可找到
    saveNodesToStorage(_taskNodes.value)
    saveEdgesToStorage(_edges.value)
  }

  function setDraft(nodeId: string, draft: string): void {
    const node = _taskNodes.value.find(n => n.id === nodeId)
    if (!node) return
    node.draft = draft
    saveNodesToStorage(_taskNodes.value)
  }

  function updateNodePosition(nodeId: string, position: XYPosition): void {
    const node = _taskNodes.value.find(n => n.id === nodeId)
    if (!node) return
    node.position = position
    saveNodesToStorage(_taskNodes.value)
  }

  // ── Edge CRUD + 环预防 ──

  /**
   * 检查添加 source→target 边后是否会形成环（含自环）。
   * 策略：如果 target 已经能（直接或间接）到达 source，则新边会成环。
   */
  function canCreateEdge(source: string, target: string): boolean {
    // 自环拒绝
    if (source === target) return false
    // 如果 target 能到达 source，则 source→target 会成环
    return !canReach(target, source, _edges.value)
  }

  /**
   * BFS 判断从 start 是否能到达 goal（沿 Edge 方向）。
   */
  function canReach(start: string, goal: string, edges: CanvasEdge[]): boolean {
    if (start === goal) return true
    const visited = new Set<string>()
    const queue: string[] = [start]
    visited.add(start)
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const edge of edges) {
        if (edge.source === current && !visited.has(edge.target)) {
          if (edge.target === goal) return true
          visited.add(edge.target)
          queue.push(edge.target)
        }
      }
    }
    return false
  }

  function createEdge(source: string, target: string): CanvasEdge | null {
    if (!canCreateEdge(source, target)) return null
    const edge: CanvasEdge = {
      id: generateId(),
      source,
      target,
    }
    _edges.value.push(edge)
    saveEdgesToStorage(_edges.value)
    return edge
  }

  function removeEdge(edgeId: string): void {
    const idx = _edges.value.findIndex(e => e.id === edgeId)
    if (idx === -1) return
    _edges.value.splice(idx, 1)
    saveEdgesToStorage(_edges.value)
  }

  /** 从 localStorage 重新加载节点列表（供画布初始化恢复用） */
  function reloadFromStorage(): void {
    _taskNodes.value = loadNodesFromStorage()
    _edges.value = loadEdgesFromStorage()
  }

  /** 供测试重置单例状态 */
  function _resetState(): void {
    _taskNodes.value = []
    _edges.value = []
    _showMinimap.value = true
    saveNodesToStorage(_taskNodes.value)
    saveEdgesToStorage(_edges.value)
  }

  return {
    showMinimap,
    toggleMinimap,
    taskNodes,
    edges: _edges,
    createTaskNode,
    removeTaskNode,
    setDraft,
    updateNodePosition,
    createEdge,
    removeEdge,
    canCreateEdge,
    reloadFromStorage,
    _resetState,
  }
}
