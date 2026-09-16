// src/stores/orchestration/index.ts
// 编排引擎 — 纯状态机深模块（工厂函数模式，参照 turnStateMachine 先例）。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。
// 决策依据 ADR-0010。

export { createOrchestrationEngine } from './engine'
export type {
  OrchestrationEngine,
  OrchestrationEngineOptions,
  TaskNode,
  Edge,
  NodeStatus,
  NodeRunState,
  RunState,
  TurnOutcome,
  SessionLauncher,
  TurnOutcomeSource,
  SessionAborter,
  OrchestrationGraph,
  CycleDetectionResult,
} from './types'
