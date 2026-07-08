// 三个独立 store，消费方按需 import。
// 原来的合并 facade 已删除——它隐藏了真实依赖结构且无法类型化。
// 见 ADR-0003 与架构深化文档。
export { useChatSessionStore } from './chatSession'
export { useTurnStore } from './turn'
export { usePermissionPolicyStore } from './permissionPolicy'

// 兼容：部分消费方仍 import 类型
export type { Session, Message, ToolCall, AgentInfo, SessionTurnCheckpoint, TurnChangeCardData, TeammateStatus } from '@/types'
export type { RewindOption, RewindState } from '@/types/rewind'
