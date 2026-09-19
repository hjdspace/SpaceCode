// src/components/orchestration/edgeVisuals.ts
// 编排连线的视觉状态 — 由上游（source）节点的运行状态推导连线的配色与动效。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。

import { MarkerType, type Edge as FlowEdge } from '@vue-flow/core'
import type { NodeStatus } from '@/stores/orchestration/types'

/** 自定义连线类型名 — 与 OrchestrationCanvas 的 `#edge-flow` slot 名保持一致 */
export const ORCHESTRATION_EDGE_TYPE = 'flow'

/** 编排连线的最小结构（画布上的 CanvasEdge） */
export interface EdgeEndpoints {
  id: string
  source: string
  target: string
}

/** 连线视觉状态 — 描述一条 Edge 当前"该长什么样" */
export type EdgeVisualState =
  /** 上游未运行 / 排队中：待触发的依赖 */
  | 'idle'
  /** 上游运行中：依赖正在被消费，连线流动 */
  | 'active'
  /** 上游已完成：依赖已兑现 */
  | 'done'
  /** 上游失败 / 被跳过：依赖断裂，下游不会启动 */
  | 'blocked'

/**
 * 状态配色。
 *
 * 用字面色值而非 CSS 变量：vue-flow 会按 marker 定义的键值拼出 marker id
 * （`color=var(--accent-primary)` 这种值会污染 id 并需要转义），
 * 而 marker 的 fill/stroke 无法从 CSS 变量继承。这四个色值在明暗主题下都可读。
 */
export const EDGE_STATE_COLORS: Record<EdgeVisualState, string> = {
  idle: '#94a3b8',
  active: '#6366f1',
  done: '#22c55e',
  blocked: '#ef4444',
}

/** 连线基础线的不透明度 — blocked 最弱，active 最实 */
export const EDGE_STATE_BASE_OPACITY: Record<EdgeVisualState, number> = {
  idle: 0.35,
  active: 0.85,
  done: 0.7,
  blocked: 0.4,
}

/** 由上游节点状态推导连线视觉状态 */
export function toEdgeVisualState(status?: NodeStatus): EdgeVisualState {
  switch (status) {
    case 'running':
      return 'active'
    case 'settled':
      return 'done'
    case 'failed':
    case 'skipped':
      return 'blocked'
    // pending / queued / interrupted / undefined → 尚未流动
    default:
      return 'idle'
  }
}

/** 该状态下是否叠加"流动"高亮层 */
export function hasFlowOverlay(state: EdgeVisualState): boolean {
  return state === 'idle' || state === 'active'
}

/**
 * 把一个画布 Edge 编译成 vue-flow 渲染用 Edge：
 * 指定自定义连线类型、写入视觉状态、并按状态给箭头着色。
 */
export function toFlowEdge(edge: EdgeEndpoints, state: EdgeVisualState): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: ORCHESTRATION_EDGE_TYPE,
    data: { state },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: EDGE_STATE_COLORS[state],
    },
  }
}
