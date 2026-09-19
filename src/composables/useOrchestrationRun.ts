// src/composables/useOrchestrationRun.ts
// 编排运行链路 composable — 引擎接线、空草稿校验、运行中锁结构、进度追踪。
// 将画布数据同步到 createOrchestrationEngine，接线到真实 turn store / chatSession store。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。
//
// 锁结构语义（PRD 用户故事 31）：一次 Run 进行中禁止增删节点与连线，
// 但节点位置/布局不在锁的范围内 —— 拖拽排布随时可用。
// isRunning 由引擎真实运行态推导（见下），保证 retry / rerun 等二次启动路径不会留下悬空锁。

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

  /** 响应式版本号 — 引擎是普通对象（非 Pinia/非响应式），靠版本号触发 computed 重新计算 */
  const statusVersion = ref(0)
  let engine: OrchestrationEngine | null = null

  /** sessionId → nodeId 反查表（composable 层维护，供 outcome 回调快照用） */
  const sessionToNodeMap = new Map<string, string>()

  /** 读取版本号以建立响应式依赖（引擎状态不响应式，需显式 track） */
  function trackRunState(): void {
    void statusVersion.value
  }

  /** 引擎里是否还有未达终态的节点（pending / running / queued） */
  function hasUnfinishedNodes(): boolean {
    if (!engine) return false
    const runState = engine.getRunState()
    if (runState.status !== 'running') return false
    for (const nodeState of runState.nodeStates.values()) {
      if (
        nodeState.status === 'pending' ||
        nodeState.status === 'running' ||
        nodeState.status === 'queued'
      ) {
        return true
      }
    }
    return false
  }

  /**
   * 是否正在进行一次 Run。
   *
   * 由引擎真实运行态推导，而不是手工维护的布尔量 —— 手工维护时 retry 这类
   * "二次启动"路径容易漏掉复位，把画布永久锁在运行中（拖不动、删不掉）。
   */
  const isRunning = computed(() => {
    trackRunState()
    return hasUnfinishedNodes()
  })

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
    // 依赖版本号触发重新计算
    trackRunState()
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
            statusVersion.value++
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

    sessionToNodeMap.clear()

    engine = createEngineWithWiring()
    syncCanvasToEngine(engine)

    // 引擎 run() 同步完成图初始化并置 runState=running（首个 await 之前），
    // 因此这里先 bump 版本号，让"运行中"锁立刻生效
    const runPromise = engine.run()
    statusVersion.value++

    try {
      await runPromise
      snapshotRunStateToCanvas()
    } finally {
      statusVersion.value++
    }
  }

  // ── 停止运行 ──

  async function stopRun(): Promise<void> {
    if (!engine) return
    await engine.stop()
    snapshotRunStateToCanvas()
    statusVersion.value++
  }

  // ── 单节点停止 ──

  async function stopNode(nodeId: string): Promise<void> {
    if (!engine) return
    await engine.stopNode(nodeId)
    snapshotNodeStatus(nodeId)
    statusVersion.value++
  }

  // ── 失败节点重试 ──

  async function retryNode(nodeId: string): Promise<void> {
    if (!engine) return
    // retry 时需要新 session — 引擎的 retryNode 会调用 createSession，
    // 而 composable 的 createSession 复用已有 sessionId，所以先清除节点的旧 sessionId
    const node = canvas.taskNodes.value.find(n => n.id === nodeId)
    if (node) {
      // 创建新 session 用于重试
      const newSession = sessionStore.createSession('Task Node (retry)')
      node.sessionId = newSession.id
      sessionToNodeMap.set(newSession.id, nodeId)
    }

    // 引擎 retryNode 把 Run 切回 running，isRunning 随之回到 true，
    // 待重试的传递闭包跑完后由 outcome 信号复位
    const retryPromise = engine.retryNode(nodeId)
    statusVersion.value++

    try {
      await retryPromise
      snapshotNodeStatus(nodeId)
    } finally {
      statusVersion.value++
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

    const runPromise = engine.run()
    statusVersion.value++

    try {
      await runPromise
      snapshotRunStateToCanvas()
    } finally {
      statusVersion.value++
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
    statusVersion.value++
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
    statusVersion,
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
