import type { Message, ToolCall, Session } from '@/types'

// Turn → chatSession 的窄写回 seam。chatSession 实现它，Turn 消费它，测试替换它。
// 这是 ADR-0003 的内部 seam：所有 turn 对会话状态的修改必须经过这 6 个方法。
export interface SessionSink {
  get(sessionId: string): Session | undefined
  appendMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'> & { id?: string }): Message
  patchMessage(sessionId: string, messageId: string, patch: Partial<Message>): void
  patchToolCall(sessionId: string, messageId: string, toolUseId: string, status: ToolCall['status']): void
  persist(sessionId: string): void
  ensureSession(sessionId: string, hint?: { title?: string; projectPath?: string }): Session
}
