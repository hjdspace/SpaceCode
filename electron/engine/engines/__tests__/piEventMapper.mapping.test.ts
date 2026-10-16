// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mapPiEvent } from '../PiEventMapper'

/**
 * Pi RPC frame → UnifiedEngineEvent 翻译表契约。
 *
 * mapPiEvent 是 Pi 引擎 stdout 帧进入渲染层的唯一翻译点：
 *  - 返回 null 表示"引擎噪音帧"（turn_start/turn_end/queue_update/session_info_changed、
 *    未识别类型），绝不透传给 renderer —— 上游据此丢弃而不是广播。
 *  - 每个映射出的 UnifiedEngineEvent 必须透传 sessionId（多会话并发时的事件归属）。
 *  - message_update 的 stream delta 是逐字段的形状改写（text/thinking/toolcall 各三态），
 *    渲染层按 Anthropic content block 形状消费，字段名错一个就静默丢文本；
 *    text/thinking 的取值优先 `delta` 字段，回退到 `text`/`thinking` 旧字段。
 *  - agent_end 的 result 提取规则：最后一条 assistant 消息的文本（string 直取 /
 *    块数组取第一个 text 块），取不到时为空串而不是 undefined。
 *  - message_start 对 user 消息原样透传，对 assistant 消息做白名单裁剪
 *    （仅 role/content/model/usage）；message_end 不为 user 消息发事件（与
 *    message_start 不对称，user 帧的入口只有 message_start）。
 *  - tool_execution_end 的 output 统一为 string：对象 JSON.stringify(两空格缩进)，
 *    null/undefined → ''，循环引用（JSON 不安全）→ String 兜底。
 *
 * 纯函数直测，无 mock —— Pi 事件 fixture 直接按帧字面量构造
 * （与 piSessionProcess.stream.test.ts 的 frame 形状一致）。
 */

const SID = 'pi-sess-1'

describe('mapPiEvent — 生命周期与消息事件', () => {
  it('agent_start 映射为 system/agent_start 并透传 sessionId', () => {
    expect(mapPiEvent(SID, { type: 'agent_start' })).toEqual({
      sessionId: SID,
      type: 'system',
      data: { subtype: 'agent_start' },
    })
  })

  it('agent_end 映射为 result：取最后一条 assistant 文本、stop_reason 固定 end_turn、messages 原样保留', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '第一轮回答' },
      { role: 'user', content: '再来' },
      { role: 'assistant', content: '最终回答' },
    ]
    expect(mapPiEvent(SID, { type: 'agent_end', messages })).toEqual({
      sessionId: SID,
      type: 'result',
      data: { result: '最终回答', stop_reason: 'end_turn', messages },
    })
  })

  it('agent_end 的 content 为块数组时取第一个 text 块的 text', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考过程' },
          { type: 'text', text: '块内回答' },
        ],
      },
    ]
    expect(mapPiEvent(SID, { type: 'agent_end', messages })?.data.result).toBe('块内回答')
  })

  it('agent_end 兜底：无 assistant / messages 非数组 / 块数组无 text 块 → result 为空串', () => {
    const noAssistant = mapPiEvent(SID, { type: 'agent_end', messages: [{ role: 'user', content: 'x' }] })
    const notArray = mapPiEvent(SID, { type: 'agent_end', messages: 'oops' })
    const noTextBlock = mapPiEvent(SID, {
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't' }] }],
    })
    expect(noAssistant?.data.result).toBe('')
    expect(notArray?.data.result).toBe('')
    expect(noTextBlock?.data.result).toBe('')
  })

  it('message_start assistant → assistant 事件，message 白名单仅 role/content/model/usage', () => {
    const msg = {
      role: 'assistant',
      content: 'hi',
      model: 'pi-model',
      usage: { input: 1, output: 2 },
      providerMetadata: { junk: true },
      stopReason: 'stop',
    }
    expect(mapPiEvent(SID, { type: 'message_start', message: msg })).toEqual({
      sessionId: SID,
      type: 'assistant',
      data: { message: { role: 'assistant', content: 'hi', model: 'pi-model', usage: { input: 1, output: 2 } } },
    })
  })

  it('message_start user → user 事件且 message 原样透传（不做白名单裁剪）', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: '带附件的输入' }] }
    expect(mapPiEvent(SID, { type: 'message_start', message: msg })).toEqual({
      sessionId: SID,
      type: 'user',
      data: { message: msg },
    })
  })

  it('message_start：message 缺失或角色非 assistant/user → null', () => {
    expect(mapPiEvent(SID, { type: 'message_start' })).toBeNull()
    expect(mapPiEvent(SID, { type: 'message_start', message: { role: 'system', content: 'x' } })).toBeNull()
  })

  it('message_end：assistant 与 message_start 同构；user → null（与 message_start 不对称）', () => {
    const msg = { role: 'assistant', content: 'done', model: 'pi-model', usage: {} }
    expect(mapPiEvent(SID, { type: 'message_end', message: msg })).toEqual({
      sessionId: SID,
      type: 'assistant',
      data: { message: { role: 'assistant', content: 'done', model: 'pi-model', usage: {} } },
    })
    expect(mapPiEvent(SID, { type: 'message_end', message: { role: 'user', content: 'x' } })).toBeNull()
  })

  it('message_update text_delta → content_block_delta，delta 缺失时回退 text 字段', () => {
    expect(
      mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello', partial: false } }),
    ).toEqual({
      sessionId: SID,
      type: 'stream_event',
      data: { event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' }, partial: false } },
    })
    expect(
      mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', text: 'fallback' } })?.data.event,
    ).toEqual({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'fallback' } })
  })

  it('message_update thinking 三态 → content_block_start/delta/stop，content_block.type 为 thinking', () => {
    const up = (ev: any) => mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: ev })?.data.event
    expect(up({ type: 'thinking_start', partial: true })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'thinking' },
      partial: true,
    })
    expect(up({ type: 'thinking_delta', thinking: '来自 thinking 字段', partial: false })).toEqual({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: '来自 thinking 字段' },
      partial: false,
    })
    expect(up({ type: 'thinking_delta', delta: '增量优先', thinking: '旧字段' })?.delta.thinking).toBe('增量优先')
    expect(up({ type: 'thinking_end', partial: false })).toEqual({
      type: 'content_block_stop',
      content_block: { type: 'thinking' },
      partial: false,
    })
  })

  it('message_update toolcall 三态 → tool_use content_block_start（含 id/name）/ input_json_delta / content_block_stop', () => {
    const up = (ev: any) => mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: ev })?.data.event
    expect(up({ type: 'toolcall_start', toolCallId: 'tc1', toolName: 'read_file', partial: false })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tc1', name: 'read_file' },
      partial: false,
    })
    expect(up({ type: 'toolcall_delta', delta: '{"path":', partial: false })).toEqual({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"path":' },
      partial: false,
    })
    expect(up({ type: 'toolcall_end', partial: false })).toEqual({
      type: 'content_block_stop',
      content_block: { type: 'tool_use' },
      partial: false,
    })
  })

  it('message_update：未知 delta 类型原样透传；缺 assistantMessageEvent → null', () => {
    const exotic = { type: 'something_new', payload: { x: 1 } }
    expect(mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: exotic })?.data.event).toEqual(exotic)
    expect(mapPiEvent(SID, { type: 'message_update' })).toBeNull()
  })
})

describe('mapPiEvent — 工具执行事件', () => {
  it('tool_execution_start → tool_use：id=toolCallId、name=toolName、input=args', () => {
    expect(
      mapPiEvent(SID, { type: 'tool_execution_start', toolCallId: 'tc9', toolName: 'bash', args: { cmd: 'ls' } }),
    ).toEqual({
      sessionId: SID,
      type: 'tool_use',
      data: { id: 'tc9', name: 'bash', input: { cmd: 'ls' } },
    })
  })

  it('tool_execution_update → stream_event 内嵌 tool_execution_delta，partialResult 原样', () => {
    const partialResult = { content: [{ type: 'text', text: 'partial' }] }
    expect(mapPiEvent(SID, { type: 'tool_execution_update', toolCallId: 'tc9', partialResult })).toEqual({
      sessionId: SID,
      type: 'stream_event',
      data: {
        event: {
          type: 'content_block_delta',
          delta: { type: 'tool_execution_delta', toolCallId: 'tc9', partialResult },
        },
      },
    })
  })

  it('tool_execution_end → tool_result：string result 原样、is_error 透传', () => {
    expect(mapPiEvent(SID, { type: 'tool_execution_end', toolCallId: 'tc9', result: 'ok', isError: true })).toEqual({
      sessionId: SID,
      type: 'tool_result',
      data: { tool_use_id: 'tc9', output: 'ok', is_error: true },
    })
  })

  it('tool result 形状：对象 JSON 化（两空格缩进）、null/undefined → 空串、循环引用 String 兜底', () => {
    const output = (result: any) =>
      mapPiEvent(SID, { type: 'tool_execution_end', toolCallId: 't', result, isError: false })?.data.output

    const obj = { path: 'D:/x', lines: 3 }
    expect(output(obj)).toBe(JSON.stringify(obj, null, 2))
    expect(output(null)).toBe('')
    expect(output(undefined)).toBe('')

    const cyclic: any = {}
    cyclic.self = cyclic
    expect(output(cyclic)).toBe(String(cyclic))
  })
})

describe('mapPiEvent — 系统与终止事件', () => {
  it('系统事件族字段透传：compaction_start/end、thinking_level_changed、auto_retry_start/end', () => {
    expect(mapPiEvent(SID, { type: 'compaction_start', reason: 'threshold' })).toEqual({
      sessionId: SID,
      type: 'system',
      data: { subtype: 'compaction_start', reason: 'threshold' },
    })
    expect(mapPiEvent(SID, { type: 'compaction_end', reason: 'manual', aborted: true })?.data).toEqual({
      subtype: 'compaction_end', reason: 'manual', aborted: true,
    })
    expect(mapPiEvent(SID, { type: 'thinking_level_changed', level: 'high' })?.data).toEqual({
      subtype: 'thinking_level_changed', level: 'high',
    })
    expect(mapPiEvent(SID, { type: 'auto_retry_start', attempt: 2, maxAttempts: 5 })?.data).toEqual({
      subtype: 'auto_retry_start', attempt: 2, maxAttempts: 5,
    })
    expect(mapPiEvent(SID, { type: 'auto_retry_end', success: true, attempt: 2 })?.data).toEqual({
      subtype: 'auto_retry_end', success: true, attempt: 2,
    })
  })

  it('suspended：type 为 suspended，reason 缺失回退 unknown', () => {
    expect(mapPiEvent(SID, { type: 'suspended', reason: 'user_switch' })).toEqual({
      sessionId: SID,
      type: 'suspended',
      data: { reason: 'user_switch' },
    })
    expect(mapPiEvent(SID, { type: 'suspended' })?.data).toEqual({ reason: 'unknown' })
  })

  it('exit / error 事件字段透传', () => {
    expect(mapPiEvent(SID, { type: 'exit', code: 1, signal: 'SIGTERM', stderr: 'boom' })).toEqual({
      sessionId: SID,
      type: 'exit',
      data: { code: 1, signal: 'SIGTERM', stderr: 'boom' },
    })
    expect(mapPiEvent(SID, { type: 'error', message: 'spawn failed', code: 'ENOENT' })).toEqual({
      sessionId: SID,
      type: 'error',
      data: { message: 'spawn failed', code: 'ENOENT' },
    })
  })

  it('噪音帧：turn_start/turn_end/queue_update/session_info_changed/未知类型 → 一律 null', () => {
    for (const type of ['turn_start', 'turn_end', 'queue_update', 'session_info_changed', 'something_totally_new']) {
      expect(mapPiEvent(SID, { type })).toBeNull()
    }
  })
})
