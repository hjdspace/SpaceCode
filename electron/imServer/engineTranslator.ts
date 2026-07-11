/**
 * EngineTranslator — Translate engine events to ServerMessage format
 *
 * Converts UnifiedEngineEvent types from the IEngine abstraction
 * into the ServerMessage protocol that IM adapters understand.
 */

import type { ServerMessage, TokenUsage } from '../im/adapters/common/types'
import type { UnifiedEngineEvent } from '../engines/types'

/**
 * Translate a UnifiedEngineEvent into zero or more ServerMessages.
 * Returns an array because some engine events map to multiple protocol messages.
 */
export function translateEngineEvent(event: UnifiedEngineEvent): ServerMessage[] {
  const { type, data } = event
  const messages: ServerMessage[] = []

  switch (type) {
    case 'stream_event': {
      const streamType = data?.type
      if (streamType === 'message_start') {
        messages.push({ type: 'status', state: 'thinking' })
      } else if (streamType === 'content_block_start') {
        const blockType = data?.content_block?.type
        if (blockType === 'text') {
          messages.push({ type: 'content_start', blockType: 'text' })
        } else if (blockType === 'tool_use') {
          messages.push({
            type: 'content_start',
            blockType: 'tool_use',
            toolName: data?.content_block?.name,
            toolUseId: data?.content_block?.id,
          })
        }
      } else if (streamType === 'content_block_delta') {
        const delta = data?.delta
        if (delta?.type === 'text_delta' && delta.text) {
          messages.push({ type: 'content_delta', text: delta.text })
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          messages.push({ type: 'content_delta', toolInput: delta.partial_json })
        }
      } else if (streamType === 'content_block_stop') {
        // No action needed — tool_use_complete comes from assistant message
      }
      break
    }

    case 'assistant': {
      const content = data?.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            messages.push({
              type: 'tool_use_complete',
              toolName: block.name,
              toolUseId: block.id,
              input: block.input,
            })
          }
        }
      }
      break
    }

    case 'tool_result': {
      messages.push({
        type: 'tool_result',
        toolUseId: data?.tool_use_id ?? '',
        content: typeof data?.content === 'string' ? data.content : JSON.stringify(data?.content ?? ''),
        isError: data?.is_error ?? false,
      })
      break
    }

    case 'permission_request': {
      messages.push({
        type: 'permission_request',
        requestId: data?.requestId ?? data?.request_id ?? '',
        toolName: data?.toolName ?? data?.tool_name ?? '',
        input: data?.input ?? {},
        description: data?.description,
      })
      break
    }

    case 'permission_request_cancelled': {
      // Permission request was cancelled (e.g., tool completed without response)
      // No specific ServerMessage type — adapter should clear pending state
      break
    }

    case 'result': {
      const usage: TokenUsage = {
        inputTokens: data?.usage?.input_tokens ?? 0,
        outputTokens: data?.usage?.output_tokens ?? 0,
      }
      if (data?.usage?.cache_read_input_tokens) {
        usage.cacheReadInputTokens = data.usage.cache_read_input_tokens
      }
      if (data?.usage?.cache_creation_input_tokens) {
        usage.cacheCreationInputTokens = data.usage.cache_creation_input_tokens
      }
      messages.push({ type: 'message_complete', usage })
      messages.push({ type: 'status', state: 'idle' })
      break
    }

    case 'system': {
      const subtype = data?.subtype
      if (subtype === 'compact') {
        messages.push({ type: 'status', state: 'compacting' })
      }
      break
    }

    case 'error': {
      messages.push({
        type: 'error',
        message: typeof data === 'string' ? data : (data?.message ?? 'Unknown error'),
        code: data?.code ?? 'UNKNOWN',
        retryable: data?.retryable,
      })
      break
    }

    case 'api_retry': {
      messages.push({
        type: 'api_retry',
        attempt: data?.attempt ?? 0,
        maxRetries: data?.maxRetries ?? 0,
        retryDelayMs: data?.retryDelayMs ?? 0,
      })
      break
    }

    case 'user': {
      // Tool results may come as user messages — already handled by tool_result
      break
    }

    case 'exit': {
      messages.push({ type: 'status', state: 'idle' })
      break
    }

    case 'log': {
      // Internal log — not forwarded to adapter
      break
    }

    default: {
      // Unknown event type — ignore
      break
    }
  }

  return messages
}
