import type { UnifiedEngineEvent } from './types'

export interface PiAgentEvent {
  type: string
  [key: string]: any
}

// Pi 的内置工具用小写名（bash/read/write/edit/grep/find），而渲染层的组件、图标、
// 标签与 trace 分类表一律按 Claude Code 的 PascalCase 名精确匹配。名字不在此归一，
// 小写名会同时错过专用卡片与终端 UI，退化成通用行 + JSON 直出。
// find→Glob、grep→Grep 的入参键（pattern/path）本就一致；ls 无对应卡片，故不映射。
const PI_TOOL_NAME_ALIASES: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  find: 'Glob',
}

function mapPiToolName(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name) return undefined
  return PI_TOOL_NAME_ALIASES[name] ?? name
}

export function mapPiEvent(sessionId: string, event: PiAgentEvent): UnifiedEngineEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { sessionId, type: 'system', data: { subtype: 'agent_start' } }

    case 'agent_end': {
      // Pi 的上游拒绝（403/429 等）只写在最后一条 assistant 消息的 stopReason/errorMessage
      // 上，agent_end 帧本身不标错 —— 不读它就等于报"成功的空结果"，真原因被兜底文案取代。
      const last = findLastAssistant(event.messages)
      return {
        sessionId,
        type: 'result',
        data: last?.stopReason === 'error'
          ? { result: last?.errorMessage || '', is_error: true, stop_reason: 'error', messages: event.messages }
          : { result: extractFinalText(event.messages), stop_reason: 'end_turn', messages: event.messages },
      }
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

      const mappedDelta = mapStreamDelta(delta)
      return {
        sessionId,
        type: 'stream_event',
        data: { event: mappedDelta },
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
          name: mapPiToolName(event.toolName),
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
      // 渲染层的重试卡片只读 api_retry 那套字段。原来这里发的是 pi 的原始 subtype，
      // 于是引擎正在退避重试而 UI 全程静默 —— 429 看起来就是「卡住没响应」。
      return {
        sessionId,
        type: 'system',
        data: {
          subtype: 'api_retry',
          attempt: event.attempt,
          maxRetries: event.maxAttempts,
          retryInMs: event.delayMs,
          error: event.errorMessage || 'API error',
        },
      }

    case 'auto_retry_end':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'auto_retry_end', success: event.success, attempt: event.attempt },
      }

    case 'suspended':
      return {
        sessionId,
        type: 'suspended',
        data: { reason: event.reason || 'unknown' },
      }

    case 'exit':
      return {
        sessionId,
        type: 'exit',
        data: { code: event.code, signal: event.signal, stderr: event.stderr },
      }

    case 'error':
      return {
        sessionId,
        type: 'error',
        data: { message: event.message, code: event.code },
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

interface PiAssistantMessage {
  role?: string
  content?: string | Array<{ type?: string; text?: string }>
  stopReason?: string
  errorMessage?: string
}

function findLastAssistant(messages: unknown): PiAssistantMessage | undefined {
  if (!Array.isArray(messages)) return undefined
  return [...messages].reverse().find((m: PiAssistantMessage) => m?.role === 'assistant')
}

function extractFinalText(messages: unknown): string {
  const content = findLastAssistant(messages)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textBlock = content.find((c) => c?.type === 'text')
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

function mapStreamDelta(delta: any): any {
  switch (delta.type) {
    case 'thinking_start':
      return {
        type: 'content_block_start',
        content_block: { type: 'thinking' },
      }
    case 'thinking_delta':
      return {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: delta.delta || delta.thinking },
      }
    case 'thinking_end':
      return {
        type: 'content_block_stop',
        content_block: { type: 'thinking' },
      }
    case 'text_start':
      return {
        type: 'content_block_start',
        content_block: { type: 'text' },
      }
    case 'text_delta':
      return {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: delta.delta || delta.text },
      }
    case 'text_end':
      return {
        type: 'content_block_stop',
        content_block: { type: 'text' },
      }
    case 'toolcall_start': {
      const tool = toolCallIdentity(delta)
      return {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: tool.id, name: mapPiToolName(tool.name) },
      }
    }
    case 'toolcall_delta':
      return {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: delta.delta },
      }
    case 'toolcall_end':
      return {
        type: 'content_block_stop',
        content_block: { type: 'tool_use' },
      }
    default:
      return delta
  }
}

/**
 * toolcall_start 的 id/name 取 RPC 帧顶层的 `{ contentIndex, id, toolName }`。
 *
 * 这里曾经还兜底读 `partial.content[contentIndex]` —— 那是给比 0.84.3 更早的 wire 形状留的，
 * 而它真正的存在理由是打包版实际跑用户自装的全局 pi (#52)。现在打包版只 spawn 随产物走的
 * bundled 副本，版本低于 1.0.0 会被判不可用，旧形状不再有活的调用方，兜底分支一并删掉。
 * 身份读空会造出 id=undefined 的幽灵卡片，真卡片另由 tool_execution_start 建一条 →
 * 同一次调用渲染两行。
 */
function toolCallIdentity(delta: PiAgentEvent): { id?: string; name?: string } {
  return { id: delta.id, name: delta.toolName }
}
