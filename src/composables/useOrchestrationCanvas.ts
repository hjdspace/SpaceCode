// src/composables/useOrchestrationCanvas.ts
// 编排画布 composable — 管理画布 UI 状态（小地图开关等）+ 任务节点 CRUD + 草稿 + 坐标 + localStorage 持久化。
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

// ── 常量 ──

const STORAGE_KEY = 'orchestration_nodes'

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

// ── 单例状态 ──

/** 小地图开关 — 多个画布组件实例共享 */
const _showMinimap = ref(true)

/** 任务节点列表 — 全局单例，画布打开/关闭后保持 */
const _taskNodes = ref<CanvasTaskNode[]>(loadNodesFromStorage())

// 持久化 watch — 节点列表变化时自动保存（deep: 捕获 draft/position 变更）
watch(
  _taskNodes,
  (nodes) => saveNodesToStorage(nodes),
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
    // 不删除关联的 chat session — 侧边栏仍可找到
    saveNodesToStorage(_taskNodes.value)
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

  /** 从 localStorage 重新加载节点列表（供画布初始化恢复用） */
  function reloadFromStorage(): void {
    _taskNodes.value = loadNodesFromStorage()
  }

  /** 供测试重置单例状态 */
  function _resetState(): void {
    _taskNodes.value = []
    _showMinimap.value = true
    saveNodesToStorage(_taskNodes.value)
  }

  return {
    showMinimap,
    toggleMinimap,
    taskNodes,
    createTaskNode,
    removeTaskNode,
    setDraft,
    updateNodePosition,
    reloadFromStorage,
    _resetState,
  }
}
