/** 办公助手路由的共享契约（PRD: docs/prd/work-assistant-routing.md）。 */
import type { Attachment, ImageAttachment } from '@/composables/types'

/** 绑定一个 Work 助手所需的全部信息（手动选择与自动绑定共用）。 */
export interface WorkAssistantBinding {
  name: string
  skills?: string[]
  permission?: string
  skillRuntime?: 'officecli' | 'node' | 'none'
  skillsRequired?: boolean
}

/** 路由失败/无匹配时失败形态候选卡给出的库序助手。 */
export interface RoutingSuggestion {
  name: string
  description?: string
}

export type WorkRoutingFailure = 'none' | 'unavailable' | 'timeout' | 'abort' | 'error'

/**
 * 一次首消息路由的易失状态（按会话存放，不落盘）。
 * matching = 等待决策（composer 禁用 + 取消）；candidates = 等待点选。
 */
export interface PendingWorkRouting {
  /** 扣住该消息的原始会话（路由发生地）。 */
  sessionId: string
  /** 用户键入的原文（决策输入）。 */
  content: string
  /** 组装后发给引擎的正文（含附件摘要等）。 */
  messageContent: string
  /** 时间线气泡要展示的正文；缺省用 content。 */
  userContent?: string
  attachments: { files: Attachment[]; images: ImageAttachment[] }
  phase: 'matching' | 'candidates'
  /** 低置信候选（带模型理由）；失败形态为空。 */
  ranked: RankedCandidate[]
  failure?: WorkRoutingFailure
  /** 失败形态的库序候选，不空手。 */
  suggestions: RoutingSuggestion[]
  /** 本次路由尝试的序号：过期结果不得覆盖新一轮或已点选的状态。 */
  attempt: number
  at: number
  /** 用户手动重试的累计次数（从 0 开始）。 */
  retryCount?: number
}

export interface RouterConfig {
  /** 关闭后办公模式回到画廊优先，首消息不再拦截。 */
  enabled: boolean
  /** follow-fast = 当前 authMethod 的 haiku 槽位；custom = 自带 LLM 连接；jev = TypeSafe System One 专用协议。 */
  modelSource: 'follow-fast' | 'custom' | 'jev'
  /** custom 模式下的 LLM 供应商。 */
  provider?: 'anthropic' | 'openai'
  baseUrl?: string
  apiKey?: string
  model?: string
  /** jev 模式下的 TypeSafe endpoint。 */
  jevEndpoint?: string
  /** jev 模式下的 TypeSafe API key。 */
  jevApiKey?: string
  /** jev 模式下的模型版本（固定，记录响应中的模型 ID）。 */
  jevModel?: string
}

/** 会话上的路由结果快照。字段存在 = 已决策，后续发送不再路由。 */
export interface WorkRoutingState {
  outcome: 'auto' | 'picked' | 'general'
  assistant?: string
  ranked?: Array<{ name: string; score: number }>
  at: number
}

export interface RoutingCandidate {
  name: string
  description: string
  skillDescriptions?: string[]
  /** S5 才填充；先留出契约位，prompt 会喂入非空值。 */
  routingHints?: string
}

export interface RankedCandidate {
  name: string
  score: number
  reason: string
}

/** 候选卡渲染所需的全部状态：扣住消息状态里驱动 UI 的那几项。 */
export type WorkRoutingCardState = Pick<
  PendingWorkRouting,
  'phase' | 'ranked' | 'failure' | 'suggestions' | 'retryCount'
>

export interface RoutingDecision {
  /** 模型显式判定没有合适的助手。 */
  none: boolean
  /** score ∈ [0,1]，降序，至多 3 条。 */
  ranked: RankedCandidate[]
}
