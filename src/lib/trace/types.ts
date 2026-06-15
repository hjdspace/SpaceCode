/**
 * SSE/请求解析归一化类型 — fully replicated from cc-haha
 */

/** 归一化的内容块 */
export type NormalizedBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId?: string; content: unknown; isError?: boolean }
  | { type: 'image'; mediaType?: string; dataUrl?: string }

/** 归一化的消息 */
export type NormalizedMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: NormalizedBlock[]
}

/** 归一化的用量 */
export type NormalizedUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}
