import type { Message } from '@/types'

/**
 * 把 Claude Code JSONL 格式的历史消息流转换为内部 Message[] 结构。
 *
 * 复用现有的渲染管线（AgentTimeline / MessageItem / 工具卡片），关键是要
 * 还原以下字段，使其与实时流式产生的 Message 形状保持一致：
 *
 *   • user 文本 + 附件                  → role: 'user', content + attachments
 *   • assistant 文本块 (text)           → 拼接到 content
 *   • assistant 思考块 (thinking)       → reasoning + 'reasoning' timelineEvent
 *   • assistant 工具调用 (tool_use)     → toolCalls[] + 'tool_call' timelineEvent
 *   • user 内的 tool_result             → 回填到对应 toolCalls 项的 output / status
 *   • teammate 消息 (sidechain / type)  → role: 'system' 文本展示
 *
 * 顺序很重要：thinking → text → tool_use 在同一条 assistant 消息里依出现顺序排列，
 * 这样 AgentTimeline 才能按时间线把它们错落地铺出来。
 *
 * 同一 msgId 的多条 JSONL 记录会被合并为一条 Message（Claude Code 的 JSONL
 * 格式中，一次 assistant 回复可能被拆成多行，如 text 行 + tool_use 行）。
 */
export type RestoredMessage = Omit<Message, 'id' | 'timestamp'> & { id?: string }

export function buildMessagesFromHistory(rawMessages: any[]): RestoredMessage[] {
  const messages: RestoredMessage[] = []
  // toolUseId → 指向已经创建好的 ToolCall 对象，便于稍后用 tool_result 回填
  const toolCallIndex = new Map<string, { toolCall: any; messageRef: RestoredMessage }>()
  // assistant msgId → 已创建的 Message，用于合并同一 msgId 的多行 JSONL 记录
  const assistantMsgIndex = new Map<string, RestoredMessage>()

  const parseTimestamp = (raw: any): number => {
    if (!raw) return Date.now()
    if (typeof raw === 'number') return raw
    const t = Date.parse(raw)
    return Number.isFinite(t) ? t : Date.now()
  }

  const stringifyToolResult = (content: any): string => {
    if (content == null) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part: any) => {
          if (typeof part === 'string') return part
          if (part?.type === 'text' && typeof part.text === 'string') return part.text
          return JSON.stringify(part)
        })
        .join('\n')
    }
    if (typeof content === 'object') {
      try {
        return JSON.stringify(content)
      } catch {
        return String(content)
      }
    }
    return String(content)
  }

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object') continue

    // 跳过非对话型记录（permission-mode / queue-operation / file-history-snapshot / attachment 等）
    if (raw.type !== 'user' && raw.type !== 'assistant' && raw.type !== 'teammate') {
      continue
    }

    const ts = parseTimestamp(raw.timestamp)
    const messageId =
      typeof raw.uuid === 'string' && raw.uuid
        ? raw.uuid
        : typeof raw.message?.id === 'string' && raw.message.id
          ? raw.message.id
          : crypto.randomUUID()

    // ── 用户消息 ────────────────────────────────────────────────────
    if (raw.type === 'user' && raw.message?.content !== undefined) {
      const content = raw.message.content
      const textParts: string[] = []
      const toolResults: Array<{ tool_use_id: string; output: string; isError: boolean }> = []

      if (typeof content === 'string') {
        textParts.push(content)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text)
          } else if (block.type === 'tool_result') {
            toolResults.push({
              tool_use_id: block.tool_use_id,
              output: stringifyToolResult(block.content),
              isError: !!block.is_error,
            })
          } else if (block.type === 'image') {
            textParts.push('[image]')
          }
        }
      }

      // 把 tool_result 回填到先前的 tool_use
      for (const tr of toolResults) {
        const entry = toolCallIndex.get(tr.tool_use_id)
        if (!entry) continue
        entry.toolCall.status = tr.isError ? 'error' : 'completed'
        entry.toolCall.output = tr.output
        entry.toolCall.endTime = ts
      }

      const userText = textParts.join('').trim()

      if (!userText && toolResults.length > 0) continue
      if (!userText) continue

      // 提取附件（文件引用 / 图片）
      const attachments: any[] = []
      const imageAttachments: any[] = []
      if (Array.isArray(raw.attachments)) {
        for (const att of raw.attachments) {
          if (!att) continue
          if (att.type === 'image' && att.data) {
            imageAttachments.push({
              id: att.id || crypto.randomUUID(),
              name: att.name || 'image',
              type: 'image',
              mimeType: att.mimeType || 'image/png',
              previewUrl: att.previewUrl || '',
              data: att.data,
            })
          } else if (att.path || att.name) {
            attachments.push({
              name: att.name || att.path || 'file',
              path: att.path || '',
              isFolder: !!att.isFolder,
            })
          }
        }
      }

      messages.push({
        id: messageId,
        role: 'user',
        content: userText,
        ...(attachments.length ? { attachments } : {}),
        ...(imageAttachments.length ? { imageAttachments } : {}),
      })
      continue
    }

    // ── 助手消息 ────────────────────────────────────────────────────
    if (raw.type === 'assistant' && raw.message?.content) {
      const content = raw.message.content
      const msgId = typeof raw.message?.id === 'string' && raw.message.id
        ? raw.message.id
        : messageId

      // 检查是否已有同 msgId 的 Message（同一 assistant 回复被拆成多行 JSONL）
      const existingMsg = assistantMsgIndex.get(msgId)

      let textContent = ''
      let reasoningContent = ''
      let reasoningStartTime: number | null = null
      let reasoningEndTime: number | null = null
      const toolCalls: any[] = []
      const timelineEvents: any[] = []

      const blocks = Array.isArray(content)
        ? content
        : typeof content === 'string'
          ? [{ type: 'text', text: content }]
          : []

      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue

        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          const thinkingText = block.thinking || block.text || ''
          if (!thinkingText) continue
          if (reasoningStartTime === null) reasoningStartTime = ts
          reasoningContent += thinkingText
          reasoningEndTime = ts
          timelineEvents.push({
            id: crypto.randomUUID(),
            type: 'reasoning',
            timestamp: ts,
            status: 'completed',
            content: thinkingText,
          })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          textContent += block.text
          if (block.text.trim()) {
            timelineEvents.push({
              id: crypto.randomUUID(),
              type: 'text',
              timestamp: ts,
              status: 'completed',
              content: block.text,
            })
          }
        } else if (block.type === 'tool_use' && block.id) {
          const tc = {
            id: block.id,
            name: block.name || 'Unknown Tool',
            input: block.input || {},
            status: 'completed' as const,
            startTime: ts,
            endTime: ts,
          }
          toolCalls.push(tc)
          timelineEvents.push({
            id: `tool-${block.id}`,
            type: 'tool_call',
            timestamp: ts,
            status: 'completed',
            toolCallId: block.id,
          })
        }
      }

      if (existingMsg) {
        // 合并到已有的 Message：追加 text/reasoning/toolCalls/timelineEvents
        if (textContent) {
          existingMsg.content = (existingMsg.content || '') + textContent
        }
        if (reasoningContent) {
          if (existingMsg.reasoning) {
            existingMsg.reasoning.content += reasoningContent
            existingMsg.reasoning.endTime = reasoningEndTime ?? ts
          } else {
            existingMsg.reasoning = {
              content: reasoningContent,
              startTime: reasoningStartTime ?? ts,
              endTime: reasoningEndTime ?? ts,
              isExpanded: false,
            }
          }
        }
        if (toolCalls.length) {
          if (!existingMsg.toolCalls) existingMsg.toolCalls = []
          existingMsg.toolCalls.push(...toolCalls)
        }
        if (timelineEvents.length) {
          if (!existingMsg.timelineEvents) existingMsg.timelineEvents = []
          existingMsg.timelineEvents.push(...timelineEvents)
        }
        for (const tc of toolCalls) {
          toolCallIndex.set(tc.id, { toolCall: tc, messageRef: existingMsg })
        }
      } else {
        const usage = raw.message?.usage || {}
        const metadata: any = {}
        if (raw.message?.model) metadata.model = raw.message.model
        if (typeof usage.input_tokens === 'number') metadata.inputTokens = usage.input_tokens
        if (typeof usage.output_tokens === 'number') metadata.outputTokens = usage.output_tokens
        if (typeof usage.cache_read_input_tokens === 'number') {
          metadata.cacheReadInputTokens = usage.cache_read_input_tokens
        }
        if (typeof usage.cache_creation_input_tokens === 'number') {
          metadata.cacheCreationInputTokens = usage.cache_creation_input_tokens
        }

        const restored: RestoredMessage = {
          id: msgId,
          role: 'assistant',
          content: textContent,
          ...(reasoningContent
            ? {
                reasoning: {
                  content: reasoningContent,
                  startTime: reasoningStartTime ?? ts,
                  endTime: reasoningEndTime ?? ts,
                  isExpanded: false,
                },
              }
            : {}),
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(timelineEvents.length ? { timelineEvents } : {}),
          ...(Object.keys(metadata).length ? { metadata } : {}),
        }

        messages.push(restored)
        assistantMsgIndex.set(msgId, restored)

        for (const tc of toolCalls) {
          toolCallIndex.set(tc.id, { toolCall: tc, messageRef: restored })
        }
      }
      continue
    }

    // ── 队友/侧链消息（可选展示）───────────────────────────────────
    if (raw.type === 'teammate' || raw.isSidechain) {
      const content = raw.message?.content
      let text = ''
      if (typeof content === 'string') {
        text = content
      } else if (Array.isArray(content)) {
        text = content
          .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n')
      }
      if (!text.trim()) continue
      const tag = raw.agentName || raw.subagent_type || 'teammate'
      const rawTeammateId = raw?.agentTaskId || raw?.taskId || raw?.agentId || raw?.agentName || raw?.subagent_type || raw?.name || tag
      const teammateId = String(rawTeammateId).trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-') || 'teammate'
      const statusStr = String(raw?.status || raw?.state || raw?.event || raw?.subtype || '').toLowerCase()
      const status: 'failed' | 'completed' | 'running' = /fail|error|reject|cancel/.test(statusStr) ? 'failed'
        : /complete|done|finish|success|result/.test(statusStr) ? 'completed'
        : 'running'
      messages.push({
        id: messageId,
        role: 'system',
        content: `[${tag}] ${text}`,
        metadata: {
          kind: 'teammate-message',
          agentTaskId: teammateId,
          agentName: tag,
          teamName: raw?.teamName || raw?.team_name || raw?.team || 'Agent Team',
          status,
        },
      })
    }
  }

  return messages
}
