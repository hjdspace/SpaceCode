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

/** 路由兜底时被扣住的首消息：扣住期间不发送、不起引擎，选中助手后原样重放。 */
export interface PendingWorkFirstMessage {
  /** 扣住该消息的原始会话（路由发生地）。 */
  sessionId: string
  /** 用户键入的原文（画廊被关掉时随草稿还给输入框）。 */
  content: string
  messageContent: string
  userContent?: string
  attachments: { files: Attachment[]; images: ImageAttachment[] }
  at: number
}

export interface RouterConfig {
  /** 关闭后办公模式回到画廊优先，首消息不再拦截。 */
  enabled: boolean
  /** follow-fast = 当前 authMethod 的 haiku 槽位（未配置回退主模型）；custom = 自带连接。 */
  modelSource: 'follow-fast' | 'custom'
  provider?: 'anthropic' | 'openai'
  baseUrl?: string
  apiKey?: string
  model?: string
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

export interface RoutingDecision {
  /** 模型显式判定没有合适的助手。 */
  none: boolean
  /** score ∈ [0,1]，降序，至多 3 条。 */
  ranked: RankedCandidate[]
}
