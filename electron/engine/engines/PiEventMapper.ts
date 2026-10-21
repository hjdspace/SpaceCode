import type { ExtensionDialogMethod, ExtensionDialogRequest } from '@/shared/channels/claudeCode'
import { isEngineBlockedPayload } from '@/shared/engineErrors'
import type { UnifiedEngineEvent } from './types'
import { mapPiToolName } from './piToolNames'

export interface PiAgentEvent {
  type: string
  [key: string]: any
}

/**
 * mapper 有意丢弃（mapPiEvent 返回 null）且会周期性重复的「噪音帧」：turn 生命周期、
 * system 角色的消息框架、队列/会话信息。每回合固定出现，逐条 INFO 会刷屏 —— 原始层
 * （PiSessionProcess）与路由层（PiProcessPool）都用它静默。其余丢弃仍保留 INFO 诊断：
 * 未知类型（default 分支）、缺 assistantMessageEvent 的 message_update、缺 id/method 的
 * 扩展帧 —— 那些一旦出现就是异常信号。
 */
export function isExpectedDroppedPiEvent(event: { type: string; message?: { role?: string } }): boolean {
  if (event.type === 'turn_start' || event.type === 'turn_end' || event.type === 'queue_update' || event.type === 'session_info_changed') {
    return true
  }
  if (event.type === 'message_start' || event.type === 'message_end') {
    const role = event.message?.role
    // 缺 message 字段的畸形帧不算预期内，保持可见
    return typeof role === 'string' && role !== 'assistant' && role !== 'user'
  }
  return false
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
        // content 必须抹掉：这一帧带的是**流式进行中的活对象**。pi-ai 在
        // `stream.push({type:'start', partial: output})` 之后继续原地改 output.content
        // （ensureThinkingBlock 往里 push 块、再 `block.thinking += delta`），而
        // agent-loop 是从异步队列里取到 "start" 才转发 —— 所以宿主收到的时候，
        // content 里已经躺着半截 thinking（运行时日志的 msgContentLen=1 就是它）。
        // 渲染层此刻还没有任何 timeline 事件，会把这半截当成一条完整消息落成一张推理卡，
        // 紧接着真正的 thinking_start 又开一张：同一段思考渲染两遍，第一张只剩开头几个字。
        // 这一帧可信的只有 model/usage；完整 content 由 message_end 那条负责。
        return {
          sessionId,
          type: 'assistant',
          data: { message: { ...mapAssistantMessage(msg), content: [] } },
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

    case 'error': {
      // 拦截类错误是主进程给的结构化原因码：原样透传，文案由渲染层按 i18n 渲染。
      const blocked = { reason: event.reason, detail: event.detail, context: event.context }
      if (isEngineBlockedPayload(blocked)) {
        return { sessionId, type: 'error', data: blocked }
      }
      return {
        sessionId,
        type: 'error',
        data: { message: event.message, code: event.code },
      }
    }

    case 'queue_update':
      return null

    // 扩展的 UI 帧分两拨。fire-and-forget 的那五类（notify / setStatus / setWidget /
    // setTitle / set_editor_text）发了不回头，确实没有可渲染的东西；会 await 宿主回帧的
    // 四类过去在这里被就地自动取消 (#45)，现在映射成对话框事件，交给渲染层应答 (#54)。
    case 'extension_ui_request': {
      const method = dialogMethodOf(event.method)
      if (!method) return null
      // 回帧按 id 匹配，没有 id 就没人能答；编一个只会让卡片停在按钮上无人认领
      if (typeof event.id !== 'string' || !event.id) return null
      return { sessionId, type: 'extension_dialog_request', data: toExtensionDialog(event.id, method, event) }
    }

    // 对话框退场由宿主发（用户答完、取消、超时、进程没了），不是 pi 的帧
    case 'extension_dialog_closed':
      return {
        sessionId,
        type: 'extension_dialog_closed',
        data: { dialogId: event.dialogId, method: event.method, reason: event.reason },
      }

    case 'session_info_changed':
      return null

    default:
      return null
  }
}

/**
 * 会 await 宿主回帧的四类对话框方法 (docs/rpc-extension-ui.md)。`confirm` 也在其中 ——
 * 注意 pi 的 RPC 适配层（@narumitw/pi-tui-kit 的 runRpcConfirmation）把确认框拼成
 * `select([确认项, 取消项])` 发来，所以界面上真正高频的是 select。
 */
export const EXTENSION_DIALOG_METHODS: ReadonlySet<string> = new Set(['select', 'confirm', 'input', 'editor'])

function dialogMethodOf(value: unknown): ExtensionDialogMethod | null {
  return typeof value === 'string' && EXTENSION_DIALOG_METHODS.has(value) ? (value as ExtensionDialogMethod) : null
}

/** 把按方法变化的原始帧字段收成渲染层认得的那几个；非字符串选项回传不了，直接不收 */
function toExtensionDialog(dialogId: string, method: ExtensionDialogMethod, event: PiAgentEvent): ExtensionDialogRequest {
  const dialog: ExtensionDialogRequest = { dialogId, method, title: String(event.title ?? '') }
  if (typeof event.message === 'string') dialog.message = event.message
  if (Array.isArray(event.options)) {
    const options = event.options.filter((o): o is string => typeof o === 'string' && o.length > 0)
    if (options.length > 0) dialog.options = options
  }
  if (typeof event.placeholder === 'string') dialog.placeholder = event.placeholder
  if (typeof event.prefill === 'string') dialog.prefill = event.prefill
  return dialog
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
 * bundled 副本，版本低于 MIN_PI_VERSION（现 1.1.0）会被判不可用，旧形状不再有活的调用方，兜底分支一并删掉。
 * 身份读空会造出 id=undefined 的幽灵卡片，真卡片另由 tool_execution_start 建一条 →
 * 同一次调用渲染两行。
 */
function toolCallIdentity(delta: PiAgentEvent): { id?: string; name?: string } {
  return { id: delta.id, name: delta.toolName }
}
