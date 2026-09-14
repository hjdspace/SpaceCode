// src/stores/orchestration/engine.ts
// 编排引擎实现 — DAG 状态机核心逻辑。
// 通过依赖注入持有 DAG 结构与全部编排语义，不依赖 Pinia/IPC/Vue。

import type {
  OrchestrationEngine,
  OrchestrationEngineOptions,
  OrchestrationGraph,
  TaskNode,
  Edge,
  NodeStatus,
  NodeRunState,
  RunState,
  TurnOutcome,
  CycleDetectionResult,
  SessionLauncher,
  TurnOutcomeSource,
  SessionAborter,
} from './types'

const DEFAULT_MAX_CONCURRENCY = 20

export function createOrchestrationEngine(opts: OrchestrationEngineOptions): OrchestrationEngine {
  const {
    sessionLauncher,
    outcomeSource,
    sessionAborter,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  } = opts

  // ── 图结构 ──
  const nodes = new Map<string, TaskNode>()
  const edges: Edge[] = []

  // ── 运行时状态 ──
  let runState: RunState = {
    status: 'idle',
    nodeStates: new Map(),
  }

  // sessionId → nodeId 反查表（turn 结局信号只带 sessionId）
  const sessionToNode = new Map<string, string>()

  let unsubscribeOutcome: (() => void) | null = null

  // Run 完成时的 resolve 回调（run() 返回的 Promise 在所有节点到达终态时 resolve）
  let resolveRun: (() => void) | null = null

  // ── 工具函数 ──

  /** 获取节点的所有直接上游 */
  function getUpstream(nodeId: string): string[] {
    return edges.filter(e => e.target === nodeId).map(e => e.source)
  }

  /** 获取节点的所有直接下游 */
  function getDownstream(nodeId: string): string[] {
    return edges.filter(e => e.source === nodeId).map(e => e.target)
  }

  /** 检查一个节点的所有上游是否都已 settled */
  function allUpstreamSettled(nodeId: string): boolean {
    return getUpstream(nodeId).every(src => {
      const state = runState.nodeStates.get(src)
      return state?.status === 'settled'
    })
  }

  /** 检查一个节点的所有上游是否都已到达终态（settled/failed/skipped） */
  function allUpstreamFinished(nodeId: string): boolean {
    return getUpstream(nodeId).every(src => {
      const state = runState.nodeStates.get(src)
      return state?.status === 'settled' || state?.status === 'failed' || state?.status === 'skipped'
    })
  }

  /** 检查一个节点的任一上游是否 failed 或 skipped */
  function anyUpstreamFailedOrSkipped(nodeId: string): boolean {
    return getUpstream(nodeId).some(src => {
      const state = runState.nodeStates.get(src)
      return state?.status === 'failed' || state?.status === 'skipped'
    })
  }

  /** 统计当前 running 节点数 */
  function runningCount(): number {
    let count = 0
    for (const state of runState.nodeStates.values()) {
      if (state.status === 'running') count++
    }
    return count
  }

  /** 启动一个节点 */
  async function startNode(nodeId: string): Promise<void> {
    const node = nodes.get(nodeId)
    if (!node) return

    const sessionId = await sessionLauncher.createSession(nodeId)
    sessionToNode.set(sessionId, nodeId)

    const state: NodeRunState = { nodeId, status: 'running', sessionId }
    runState.nodeStates.set(nodeId, state)

    await sessionLauncher.sendDraft(sessionId, node.draft)
  }

  /** 尝试启动所有就绪的 pending/queued 节点（受并发闸门约束） */
  async function tryStartReadyNodes(): Promise<void> {
    let changed = true
    while (changed) {
      changed = false
      for (const [nodeId, state] of runState.nodeStates) {
        if (state.status !== 'pending' && state.status !== 'queued') continue

        // 所有上游都到达终态后才决定命运
        if (!allUpstreamFinished(nodeId)) continue

        // 任一上游 failed/skipped → skip 此节点
        if (anyUpstreamFailedOrSkipped(nodeId)) {
          state.status = 'skipped'
          changed = true
          continue
        }

        // 所有上游 settled → 可以启动，但检查并发闸门
        if (allUpstreamSettled(nodeId)) {
          if (runningCount() >= maxConcurrency) {
            // 超出并发上限 → 排队
            if (state.status !== 'queued') {
              state.status = 'queued'
              changed = true
            }
            continue
          }
          // 有空位 → 启动
          state.status = 'running'
          changed = true
          await startNode(nodeId)
        }
      }
    }
    // 检查 queued 节点是否有空位可以补位
    for (const [nodeId, state] of runState.nodeStates) {
      if (state.status === 'queued' && runningCount() < maxConcurrency) {
        if (allUpstreamSettled(nodeId)) {
          state.status = 'running'
          await startNode(nodeId)
        }
      }
    }
  }

  /** 处理 turn 结局信号 */
  async function handleOutcome(sessionId: string, outcome: TurnOutcome): Promise<void> {
    const nodeId = sessionToNode.get(sessionId)
    if (!nodeId) return

    const state = runState.nodeStates.get(nodeId)
    if (!state || state.status !== 'running') return

    if (outcome === 'settled') {
      state.status = 'settled'
    } else {
      // failed 或 aborted → 都按 failed 语义处理
      state.status = 'failed'
    }

    // 尝试启动就绪的下游节点
    await tryStartReadyNodes()

    // 检查是否所有节点都到达终态
    checkRunComplete()
  }

  /** 检查 Run 是否完成 */
  function checkRunComplete(): void {
    let allDone = true
    for (const state of runState.nodeStates.values()) {
      if (state.status === 'pending' || state.status === 'running' || state.status === 'queued') {
        allDone = false
        break
      }
    }
    if (allDone && runState.status === 'running') {
      runState.status = 'idle'
      resolveRun?.()
      resolveRun = null
    }
  }

  // ── 公共接口 ──

  function assertNotRunning(op: string): void {
    if (runState.status === 'running') {
      throw new Error(`Cannot ${op} while a Run is running`)
    }
  }

  function addNode(node: TaskNode): void {
    assertNotRunning('add node')
    nodes.set(node.id, node)
  }

  function removeNode(nodeId: string): void {
    assertNotRunning('remove node')
    nodes.delete(nodeId)
    // 移除相关边
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].source === nodeId || edges[i].target === nodeId) {
        edges.splice(i, 1)
      }
    }
  }

  function addEdge(edge: Edge): void {
    assertNotRunning('add edge')
    edges.push(edge)
  }

  function removeEdge(source: string, target: string): void {
    assertNotRunning('remove edge')
    const idx = edges.findIndex(e => e.source === source && e.target === target)
    if (idx >= 0) edges.splice(idx, 1)
  }

  function setDraft(nodeId: string, draft: string): void {
    const node = nodes.get(nodeId)
    if (node) node.draft = draft
  }

  function getGraph(): OrchestrationGraph {
    return { nodes: new Map(nodes), edges: [...edges] }
  }

  function detectCycle(): CycleDetectionResult {
    // Kahn's algorithm — 拓扑排序检测环
    const inDegree = new Map<string, number>()
    for (const id of nodes.keys()) inDegree.set(id, 0)
    for (const edge of edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    }

    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const node = queue.shift()!
      sorted.push(node)
      for (const edge of edges) {
        if (edge.source === node) {
          const newDeg = (inDegree.get(edge.target) ?? 0) - 1
          inDegree.set(edge.target, newDeg)
          if (newDeg === 0) queue.push(edge.target)
        }
      }
    }

    if (sorted.length < nodes.size) {
      // 有环 — 未被排序的节点在环上
      const sortedSet = new Set(sorted)
      const cycleNodes = [...nodes.keys()].filter(id => !sortedSet.has(id))
      return { hasCycle: true, cycleNodes }
    }

    return { hasCycle: false, cycleNodes: [] }
  }

  async function run(): Promise<void> {
    // 环检测
    const cycle = detectCycle()
    if (cycle.hasCycle) {
      throw new Error(`Graph contains a cycle involving nodes: ${cycle.cycleNodes.join(', ')}`)
    }

    // 初始化所有节点为 pending
    runState = {
      status: 'running',
      nodeStates: new Map(),
    }

    for (const id of nodes.keys()) {
      runState.nodeStates.set(id, { nodeId: id, status: 'pending' })
    }

    // 订阅 turn 结局
    unsubscribeOutcome?.()
    unsubscribeOutcome = outcomeSource.subscribe((sessionId, outcome) => {
      void handleOutcome(sessionId, outcome)
    })

    // 启动零入度节点
    await tryStartReadyNodes()

    // 如果所有节点已经到达终态（如空图或全部 skipped），直接完成
    if (runState.nodeStates.size === 0) return

    checkRunComplete()
    if (runState.status === 'idle') return

    // 返回在所有节点到达终态时 resolve 的 Promise
    return new Promise<void>(resolve => {
      resolveRun = resolve
    })
  }

  async function retryNode(nodeId: string): Promise<void> {
    const state = runState.nodeStates.get(nodeId)
    if (!state || state.status !== 'failed') return

    // 如果 Run 已停止或空闲，重新设为 running
    if (runState.status !== 'running') runState.status = 'running'

    // 重置该节点及其因它 skipped 的下游为 pending
    state.status = 'pending'
    state.sessionId = undefined

    // 递归重置 skipped 下游
    const toReset = [nodeId]
    const visited = new Set<string>()
    while (toReset.length > 0) {
      const current = toReset.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      for (const ds of getDownstream(current)) {
        const dsState = runState.nodeStates.get(ds)
        if (dsState?.status === 'skipped') {
          dsState.status = 'pending'
          dsState.sessionId = undefined
          toReset.push(ds)
        }
      }
    }

    // 尝试启动（该节点可能需要等上游，但 retry 要求上游已 settled）
    await tryStartReadyNodes()
  }

  async function stopNode(nodeId: string): Promise<void> {
    const state = runState.nodeStates.get(nodeId)
    if (!state || state.status !== 'running') return

    // 中止该节点的 session
    if (state.sessionId) {
      await sessionAborter.abort(state.sessionId)
    }
    // 标记为 failed
    state.status = 'failed'

    // 传播 skip 到下游传递闭包
    const toSkip = [nodeId]
    const visited = new Set<string>()
    while (toSkip.length > 0) {
      const current = toSkip.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      for (const ds of getDownstream(current)) {
        if (visited.has(ds)) continue
        const dsState = runState.nodeStates.get(ds)
        if (!dsState) continue
        // 只 skip 还未到达终态的节点
        if (dsState.status === 'pending' || dsState.status === 'queued') {
          dsState.status = 'skipped'
          toSkip.push(ds)
        }
      }
    }

    // 尝试启动就绪的节点（旁支不受影响）
    await tryStartReadyNodes()

    // 检查是否所有节点都到达终态
    checkRunComplete()
  }

  async function stop(): Promise<void> {
    // 中止所有 running 节点
    for (const state of runState.nodeStates.values()) {
      if (state.status === 'running' && state.sessionId) {
        await sessionAborter.abort(state.sessionId)
        state.status = 'failed'
      }
    }
    // 标记所有 pending/queued 为 skipped
    for (const state of runState.nodeStates.values()) {
      if (state.status === 'pending' || state.status === 'queued') {
        state.status = 'skipped'
      }
    }
    runState.status = 'stopped'
    resolveRun?.()
    resolveRun = null
  }

  function getRunState(): RunState {
    return runState
  }

  function getNodeStatus(nodeId: string): NodeStatus | undefined {
    return runState.nodeStates.get(nodeId)?.status
  }

  return {
    addNode,
    removeNode,
    addEdge,
    removeEdge,
    setDraft,
    getGraph,
    run,
    retryNode,
    stopNode,
    stop,
    getRunState,
    getNodeStatus,
    detectCycle,
  }
}
