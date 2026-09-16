// src/composables/useOrchestrationRun.ts
// 编排运行链路 composable — 引擎接线、空草稿校验、运行中锁结构、进度追踪。
// 将画布数据同步到 createOrchestrationEngine，接线到真实 turn store / chatSession store。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。

import { ref, computed } from 'vue'
import { useOrchestrationCanvas } from './useOrchestrationCanvas'
import { createOrchestrationEngine } from '@/stores/orchestration'
import type { OrchestrationEngine, NodeStatus } from '@/stores/orchestration/types'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { api } from '@/services/electronAPI'
import { createUuid } from '@/utils/uuid'

export function useOrchestrationRun() {
  const canvas = useOrchestrationCanvas()
  const turnStore = useTurnStore()
  const sessionStore = useChatSessionStore()

  const isRunning = ref(false)
  /** 响应式版本号 — 每次 outcome 信号到达时递增，触发 computed 重新计算 */
  const runVersion = ref(0)
  let engine: OrchestrationEngine | null = null

  /** sessionId → nodeId 反查表（composable 层维护，供 outcome 回调快照用） */
  const sessionToNodeMap = new Map<string, string>()

  // ── 空草稿校验 ──

  const emptyDraftNodeIds = computed(() =>
    canvas.taskNodes.value
      .filter(n => !n.draft || n.draft.trim() === '')
      .map(n => n.id),
  )

  const canRun = computed(() => emptyDraftNodeIds.value.length === 0)

  function getEmptyDraftNodeIds(): string[] {
    return emptyDraftNodeIds.value
  }

  // ── 进度 ──

  const progress = computed(() => {
    // 依赖 runVersion 触发重新计算
    runVersion.value
    if (!engine) return { completed: 0, total: canvas.taskNodes.value.length }

    const runState = engine.getRunState()
    let completed = 0
    for (const state of runState.nodeStates.values()) {
      if (state.status === 'settled' || state.status === 'failed' || state.status === 'skipped') {
        completed++
      }
    }
    return { completed, total: canvas.taskNodes.value.length }
  })

  // ── 快照持久化 ──

  /** 将引擎运行时状态快照到画布节点（runStatus / runSessionId） */
  function snapshotRunStateToCanvas(): void {
    if (!engine) return
    const runState = engine.getRunState()
    for (const node of canvas.taskNodes.value) {
      const nodeState = runState.nodeStates.get(node.id)
      if (nodeState) {
        node.runStatus = nodeState.status
        node.runSessionId = nodeState.sessionId
      }
    }
  }

  /** 将单个节点状态快照到画布 */
  function snapshotNodeStatus(nodeId: string): void {
    if (!engine) return
    const runState = engine.getRunState()
    const nodeState = runState.nodeStates.get(nodeId)
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    if (nodeState && node) {
      node.runStatus = nodeState.status
      node.runSessionId = nodeState.sessionId
    }
  }

  // ── 恢复状态查询 ──

  /** 返回从 localStorage 恢复的节点状态（重启后展示用） */
  function getRestoredNodeStatus(nodeId: string): NodeStatus | undefined {
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    if (!node?.runStatus) return undefined
    // running / queued 在重启后标记为 interrupted（中断/未完成）
    if (node.runStatus === 'running' || node.runStatus === 'queued') {
      return 'interrupted'
    }
    return node.runStatus
  }

  /** 返回从 localStorage 恢复的节点上次运行绑定的 sessionId */
  function getRestoredNodeSessionId(nodeId: string): string | undefined {
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    return node?.runSessionId
  }

  // ── 节点状态查询（运行中优先引擎，否则恢复快照） ──

  function getNodeStatus(nodeId: string): NodeStatus | undefined {
    const status = engine?.getNodeStatus(nodeId)
    if (status) return status
    // 引擎无状态时尝试恢复快照
    return getRestoredNodeStatus(nodeId)
  }

  // ── 启动运行 ──

  /** 创建引擎实例并注入真实依赖（startRun / rerunAll 共享） */
  function createEngineWithWiring(): OrchestrationEngine {
    return createOrchestrationEngine({
      sessionLauncher: {
        createSession: async (nodeId: string) => {
          const node = canvas.taskNodes.value.find(n => n.id === nodeId)
          if (node?.sessionId) {
            sessionToNodeMap.set(node.sessionId, nodeId)
            // 快照 running 状态和 sessionId 到画布
            node.runStatus = 'running'
            node.runSessionId = node.sessionId
            return node.sessionId
          }
          const session = sessionStore.createSession('Task Node')
          if (node) {
            node.sessionId = session.id
            sessionToNodeMap.set(session.id, nodeId)
            node.runStatus = 'running'
            node.runSessionId = session.id
          }
          return session.id
        },
        sendDraft: async (sessionId: string, draft: string) => {
          await turnStore.sendMessage(draft, undefined, undefined, { sessionId })
        },
      },
      outcomeSource: {
        subscribe: (listener) => {
          return turnStore.onTurnOutcome((sessionId, outcome) => {
            listener(sessionId, outcome)
            const nid = sessionToNodeMap.get(sessionId)
            if (nid) snapshotNodeStatus(nid)
            runVersion.value++
          })
        },
      },
      sessionAborter: {
        abort: async (sessionId: string) => {
          await api.claudeCode?.abort(sessionId)
        },
      },
    })
  }

  /** 同步画布数据到引擎（startRun / rerunAll 共享） */
  function syncCanvasToEngine(eng: OrchestrationEngine): void {
    for (const node of canvas.taskNodes.value) {
      eng.addNode({ id: node.id, draft: node.draft })
    }
    for (const edge of canvas.edges.value) {
      eng.addEdge({ source: edge.source, target: edge.target })
    }
  }

  async function startRun(): Promise<void> {
    if (isRunning.value) return
    if (!canRun.value) return

    isRunning.value = true
    sessionToNodeMap.clear()

    engine = createEngineWithWiring()
    syncCanvasToEngine(engine)

    try {
      await engine.run()
      snapshotRunStateToCanvas()
    } finally {
      isRunning.value = false
    }
  }

  // ── 停止运行 ──

  async function stopRun(): Promise<void> {
    if (!engine) return
    await engine.stop()
    snapshotRunStateToCanvas()
    runVersion.value++
    isRunning.value = false
  }

  // ── 单节点停止 ──

  async function stopNode(nodeId: string): Promise<void> {
    if (!engine) return
    await engine.stopNode(nodeId)
    snapshotNodeStatus(nodeId)
    runVersion.value++
  }

  // ── 失败节点重试 ──

  async function retryNode(nodeId: string): Promise<void> {
    if (!engine) return
    // retry 时需要新 session — 通过 sessionLauncher 的 createSession 回调实现
    // 引擎的 retryNode 会调用 createSession，composable 的 createSession 复用已有 sessionId
    // 但 retry 需要新 session，所以先清除节点的旧 sessionId
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    if (node) {
      // 创建新 session 用于重试
      const newSession = sessionStore.createSession('Task Node (retry)')
      node.sessionId = newSession.id
      sessionToNodeMap.set(newSession.id, nodeId)
    }
    isRunning.value = true
    try {
      await engine.retryNode(nodeId)
      snapshotNodeStatus(nodeId)
      runVersion.value++
    } finally {
      // retryNode 启动后引擎可能还在运行，不重置 isRunning
      // isRunning 在 run() promise resolve 时重置
    }
  }

  // ── 整图重跑 ──

  /** 是否可以整图重跑 — 非运行中且节点有快照状态 */
  const canRerun = computed(() => {
    if (isRunning.value) return false
    return canvas.taskNodes.value.some(n => n.runStatus !== undefined)
  })

  /** 整图重跑 — 全部换新 session，清除快照 */
  async function rerunAll(): Promise<void> {
    if (isRunning.value) return

    // 为所有节点创建新 session
    sessionToNodeMap.clear()
    for (const node of canvas.taskNodes.value) {
      const newSession = sessionStore.createSession('Task Node (rerun)')
      node.sessionId = newSession.id
      node.runStatus = undefined
      node.runSessionId = undefined
      sessionToNodeMap.set(newSession.id, node.id)
    }

    engine = createEngineWithWiring()
    syncCanvasToEngine(engine)

    isRunning.value = true
    try {
      await engine.run()
      snapshotRunStateToCanvas()
    } finally {
      isRunning.value = false
    }
  }

  // ── 运行中节点追加消息 ──

  function addNodeMessage(nodeId: string, content: string): void {
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    if (!node?.sessionId) return
    turnStore.addPendingMessage(node.sessionId, {
      id: createUuid(),
      content,
      attachments: [],
      images: [],
      priority: 'later' as const,
      createdAt: Date.now(),
    })
    runVersion.value++
  }

  // ── 权限请求按 sessionId 路由 ──

  function hasPendingPermissionForNode(nodeId: string): boolean {
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    if (!node?.sessionId) return false
    // 检查该 sessionId 下是否有任意待处理权限
    // turnStore.pendingPermissions: Pinia store 属性自动解包 → Map<sessionId, Map<toolUseId, PermissionRequest>>
    const perms = turnStore.pendingPermissions as unknown as Map<string, Map<string, unknown>>
    if (!perms) return false
    // 兼容 Ref<Map> 和 Map 两种情况（mock 与真实 store）
    const map = (perms as any).value ?? perms
    if (!(map instanceof Map)) return false
    return map.has(node.sessionId)
  }

  return {
    isRunning,
    canRun,
    canRerun,
    emptyDraftNodeIds,
    progress,
    getEmptyDraftNodeIds,
    getNodeStatus,
    getRestoredNodeStatus,
    getRestoredNodeSessionId,
    startRun,
    stopRun,
    stopNode,
    retryNode,
    rerunAll,
    addNodeMessage,
    hasPendingPermissionForNode,
  }
}
