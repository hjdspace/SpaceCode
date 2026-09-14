// src/stores/orchestration/types.ts
// 编排引擎类型定义 — 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。

/** 节点状态 — Task Node 在一次 Run 中的生命周期状态 */
export type NodeStatus = 'pending' | 'running' | 'settled' | 'failed' | 'skipped' | 'queued'

/** Turn 结局类型 — 区分 settled / failed / aborted 三种结局 */
export type TurnOutcome = 'settled' | 'failed' | 'aborted'

/** Task Node — 编排图中的一个任务节点 */
export interface TaskNode {
  id: string
  /** 节点草稿 — 用户在 Run 前输入的 prompt 文本 */
  draft: string
}

/** Edge — 依赖连线，触发型依赖：source settle 后 target 才启动 */
export interface Edge {
  source: string
  target: string
}

/** 编排图结构 */
export interface OrchestrationGraph {
  nodes: Map<string, TaskNode>
  edges: Edge[]
}

/** Run 中单个节点的运行时状态 */
export interface NodeRunState {
  nodeId: string
  status: NodeStatus
  /** 本次 Run 分配的会话 ID（running/settled/failed 时有值） */
  sessionId?: string
}

/** 一次 Run 的整体状态 */
export interface RunState {
  status: 'idle' | 'running' | 'stopped'
  nodeStates: Map<string, NodeRunState>
}

/** 环检测结果 */
export interface CycleDetectionResult {
  hasCycle: boolean
  /** 环路上的节点 ID 列表（有环时） */
  cycleNodes: string[]
}

/** 会话启动器 — 为节点创建 session 并发出首条消息 */
export interface SessionLauncher {
  /** 创建新会话并返回 sessionId */
  createSession(nodeId: string): Promise<string>
  /** 向会话发出首条消息（草稿） */
  sendDraft(sessionId: string, draft: string): Promise<void>
}

/** Turn 结局信号源 — 订阅 turn 的三种结局 */
export interface TurnOutcomeSource {
  /** 订阅 turn 结局，返回取消订阅函数 */
  subscribe(listener: (sessionId: string, outcome: TurnOutcome) => void): () => void
}

/** 会话中止器 — 停止一个正在运行的会话 */
export interface SessionAborter {
  abort(sessionId: string): Promise<void>
}

/** 编排引擎工厂参数 */
export interface OrchestrationEngineOptions {
  sessionLauncher: SessionLauncher
  outcomeSource: TurnOutcomeSource
  sessionAborter: SessionAborter
  /** 并发上限，默认 20 */
  maxConcurrency?: number
}

/** 编排引擎 — 纯状态机深模块 */
export interface OrchestrationEngine {
  // ── 图结构操作 ──
  addNode(node: TaskNode): void
  removeNode(nodeId: string): void
  addEdge(edge: Edge): void
  removeEdge(source: string, target: string): void
  setDraft(nodeId: string, draft: string): void
  getGraph(): OrchestrationGraph

  // ── Run 控制 ──
  /** 启动一次 Run；有环时抛出含环路节点信息的错误 */
  run(): Promise<void>
  /** 重试一个 failed 节点 */
  retryNode(nodeId: string): Promise<void>
  /** 停止单个节点（= failed 语义，下游传递闭包 skipped，旁支继续） */
  stopNode(nodeId: string): Promise<void>
  /** 停止整个 Run */
  stop(): Promise<void>

  // ── 状态查询 ──
  getRunState(): RunState
  getNodeStatus(nodeId: string): NodeStatus | undefined
  /** 检测图中是否有环 */
  detectCycle(): CycleDetectionResult
}
