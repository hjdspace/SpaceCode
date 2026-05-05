import type { UnifiedEngineEvent } from './types'

export interface PiAgentEvent {
  type: string
  [key: string]: any
}

export function mapPiEvent(sessionId: string, event: PiAgentEvent): UnifiedEngineEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { sessionId, type: 'system', data: { subtype: 'agent_start' } }

    case 'agent_end':
      return {
        sessionId,
        type: 'result',
        data: {
          result: extractFinalText(event.messages),
          stop_reason: 'end_turn',
          messages: event.messages,
        },
      }

    case 'turn_start':
      return null

    case 'turn_end':
      return null

    case 'message_start': {
      const msg = event.message
      if (msg?.role === 'assistant') {
        return {
          sessionId,
          type: 'assistant',
          data: { message: mapAssistantMessage(msg) },
        }
      }
      if (msg?.role === 'user') {
        return {
          sessionId,
          type: 'user',
          data: { message: msg },
        }
      }
      return null
    }

    case 'message_update': {
      const delta = event.assistantMessageEvent
      if (!delta) return null
      return {
        sessionId,
        type: 'stream_event',
        data: { event: delta },
      }
    }

    case 'message_end': {
      const msg = event.message
      if (msg?.role === 'assistant') {
        return {
          sessionId,
          type: 'assistant',
          data: { message: mapAssistantMessage(msg) },
        }
      }
      return null
    }

    case 'tool_execution_start':
      return {
        sessionId,
        type: 'tool_use',
        data: {
          id: event.toolCallId,
          name: event.toolName,
          input: event.args,
        },
      }

    case 'tool_execution_update':
      return {
        sessionId,
        type: 'stream_event',
        data: {
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'tool_execution_delta',
              toolCallId: event.toolCallId,
              partialResult: event.partialResult,
            },
          },
        },
      }

    case 'tool_execution_end':
      return {
        sessionId,
        type: 'tool_result',
        data: {
          tool_use_id: event.toolCallId,
          output: formatToolResult(event.result),
          is_error: event.isError,
        },
      }

    case 'compaction_start':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'compaction_start', reason: event.reason },
      }

    case 'compaction_end':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'compaction_end', reason: event.reason, aborted: event.aborted },
      }

    case 'thinking_level_changed':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'thinking_level_changed', level: event.level },
      }

    case 'auto_retry_start':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'auto_retry_start', attempt: event.attempt, maxAttempts: event.maxAttempts },
      }

    case 'auto_retry_end':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'auto_retry_end', success: event.success, attempt: event.attempt },
      }

    case 'queue_update':
      return null

    case 'session_info_changed':
      return null

    default:
      return null
  }
}

function mapAssistantMessage(msg: any): any {
  return {
    role: 'assistant',
    content: msg.content,
    model: msg.model,
    usage: msg.usage,
  }
}

function extractFinalText(messages: any[]): string {
  if (!Array.isArray(messages)) return ''
  const lastAssistant = [...messages].reverse().find((m: any) => m.role === 'assistant')
  if (!lastAssistant) return ''
  const content = lastAssistant.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textBlock = content.find((c: any) => c.type === 'text')
    return textBlock?.text || ''
  }
  return ''
}

function formatToolResult(result: any): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
