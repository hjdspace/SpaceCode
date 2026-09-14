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

  // ── 节点状态查询 ──

  function getNodeStatus(nodeId: string): NodeStatus | undefined {
    return engine?.getNodeStatus(nodeId)
  }

  // ── 启动运行 ──

  async function startRun(): Promise<void> {
    if (isRunning.value) return
    if (!canRun.value) return

    isRunning.value = true

    // 创建编排引擎实例，注入真实依赖
    engine = createOrchestrationEngine({
      sessionLauncher: {
        createSession: async (nodeId: string) => {
          const node = canvas.taskNodes.value.find(n => n.id === nodeId)
          // 为节点创建全新 session（复用已有 sessionId 或创建新的）
          if (node?.sessionId) {
            // 节点已有 session（画布创建时分配的），复用它
            return node.sessionId
          }
          const session = sessionStore.createSession('Task Node')
          if (node) node.sessionId = session.id
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
            runVersion.value++
          })
        },
      },
      sessionAborter: {
        abort: async (sessionId: string) => {
          // 按 sessionId 中止会话 — 编排引擎需要精确中止特定节点的 session
          await api.claudeCode?.abort(sessionId)
        },
      },
    })

    // 同步画布数据到引擎
    for (const node of canvas.taskNodes.value) {
      engine.addNode({ id: node.id, draft: node.draft })
    }
    for (const edge of canvas.edges.value) {
      engine.addEdge({ source: edge.source, target: edge.target })
    }

    // 启动引擎
    try {
      await engine.run()
    } finally {
      isRunning.value = false
    }
  }

  // ── 停止运行 ──

  async function stopRun(): Promise<void> {
    if (!engine) return
    await engine.stop()
    runVersion.value++
    isRunning.value = false
  }

  // ── 单节点停止 ──

  async function stopNode(nodeId: string): Promise<void> {
    if (!engine) return
    await engine.stopNode(nodeId)
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
    }
    isRunning.value = true
    try {
      await engine.retryNode(nodeId)
      runVersion.value++
    } finally {
      // retryNode 启动后引擎可能还在运行，不重置 isRunning
      // isRunning 在 run() promise resolve 时重置
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
    emptyDraftNodeIds,
    progress,
    getEmptyDraftNodeIds,
    getNodeStatus,
    startRun,
    stopRun,
    stopNode,
    retryNode,
    addNodeMessage,
    hasPendingPermissionForNode,
  }
}
