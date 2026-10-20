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
 *    块数组取第一个 text 块），取不到时为空串而不是 undefined。该消息 stopReason
 *    为 'error' 时改产 is_error:true + errorMessage 原文（Pi 的上游拒绝只写在那里）。
 *  - message_start 对 user 消息原样透传，对 assistant 消息做白名单裁剪
 *    （仅 role/content/model/usage）；message_end 不为 user 消息发事件（与
 *    message_start 不对称，user 帧的入口只有 message_start）。
 *  - tool_execution_end 的 output 统一为 string：对象 JSON.stringify(两空格缩进)，
 *    null/undefined → ''，循环引用（JSON 不安全）→ String 兜底。
 *  - Pi 的小写工具名（bash/read/write/edit/grep/find）在本题翻译点归一为渲染层用的
 *    PascalCase 名；未收录的名字（如 ls）原样透传。归一放这里是因为渲染层的组件、
 *    图标、标签与 trace 分类表全部按 PascalCase 精确匹配，小写名会静默退化成
 *    通用 JSON 行而不是终端/diff 卡片。
 *  - 帧 fixture 必须照 pi 的真实 wire 形状构造，不要按"字段应该存在"手写：
 *    pi ≥ 0.84.3 的 message_update 是 delta-only —— 顶层 message 与每个 delta 的 partial
 *    都被 toJsonEvent 剥掉，toolcall_start 改为顶层带 id/toolName。更旧的形状只挂在
 *    partial.content 里，而 #52 之后那种引擎根本进不来（版本低于下限即判不可用），
 *    所以这里只钉顶层形状那一条。
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

  // Pi 把上游拒绝写在最后一条 assistant 消息上（stopReason/errorMessage），agent_end
  // 帧本身不带错误标记。不透传就成了"成功的空结果"，渲染进程只剩笼统的 empty response
  // 文案，403 这类真原因全部丢失（cron 的执行记录同样看不到）。
  it('最后一条 assistant 报 error → result 标成失败并带上 errorMessage 原文', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [],
        provider: 'openai-compat',
        model: 'deepseek-v4.1-flash',
        stopReason: 'error',
        errorMessage: '403 model is not available in the current token plan',
      },
    ]
    expect(mapPiEvent(SID, { type: 'agent_end', messages })).toEqual({
      sessionId: SID,
      type: 'result',
      data: {
        result: '403 model is not available in the current token plan',
        is_error: true,
        stop_reason: 'error',
        messages,
      },
    })
  })

  it('errorMessage 缺失也算失败，文本留空由消费方兜底', () => {
    const event = mapPiEvent(SID, {
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [], stopReason: 'error' }],
    })
    expect(event?.data).toMatchObject({ is_error: true, stop_reason: 'error' })
    expect(event?.data.result).toBe('')
  })

  it('中途失败但收尾成功的一轮不算失败', () => {
    const event = mapPiEvent(SID, {
      type: 'agent_end',
      messages: [
        { role: 'assistant', content: [], stopReason: 'error', errorMessage: '429 slow down' },
        { role: 'assistant', content: '重试后答上了', stopReason: 'stop' },
      ],
    })
    expect(event?.data).toMatchObject({ result: '重试后答上了', stop_reason: 'end_turn' })
    expect(event?.data.is_error).toBeUndefined()
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
      data: { event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } },
    })
    expect(
      mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', text: 'fallback' } })?.data.event,
    ).toEqual({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'fallback' } })
  })

  it('message_update thinking 三态 → content_block_start/delta/stop，content_block.type 为 thinking', () => {
    const up = (ev: any) => mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: ev })?.data.event
    // partial 已从 wire 移除（toJsonEvent 逐个 delta 剥掉），渲染层也从不读它：
    // 上面 text_delta 那条刻意还带一个 partial 进帧，断言它不再被转发出来。
    expect(up({ type: 'thinking_start', partial: true })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'thinking' },
    })
    expect(up({ type: 'thinking_delta', thinking: '来自 thinking 字段', partial: false })).toEqual({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: '来自 thinking 字段' },
    })
    expect(up({ type: 'thinking_delta', delta: '增量优先', thinking: '旧字段' })?.delta.thinking).toBe('增量优先')
    expect(up({ type: 'thinking_end', partial: false })).toEqual({
      type: 'content_block_stop',
      content_block: { type: 'thinking' },
    })
  })

  it('message_update toolcall 三态 → tool_use content_block_start（含 id/name）/ input_json_delta / content_block_stop', () => {
    const up = (ev: any) => mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: ev })?.data.event
    // pi ≥ 0.84.3 的 RPC 帧：toolcall_start 在顶层带 id/toolName，且 wire 上已无 partial
    // （toJsonEvent 刻意剥掉，见 docs/json.md「delta-only」）。
    expect(up({ type: 'toolcall_start', contentIndex: 1, id: 'tc1', toolName: 'bash' })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tc1', name: 'Bash' },
    })
    expect(up({ type: 'toolcall_delta', contentIndex: 1, delta: '{"command":' })).toEqual({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"command":' },
    })
    expect(up({ type: 'toolcall_end', contentIndex: 1, toolCall: { id: 'tc1', name: 'bash' } })).toEqual({
      type: 'content_block_stop',
      content_block: { type: 'tool_use' },
    })
  })

  it('旧 wire 形状（只把 id/name 挂在 partial.content 上）不再被认作身份', () => {
    const up = (ev: any) => mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: ev })?.data.event
    // #52 之前这条分支是活的：打包版跑的是用户自装的全局旧 pi。现在打包版只 spawn 随产物
    // 走的那份、且版本低于 1.0.0 直接判不可用，所以这里钉的是「旧形状不再生成 id」——
    // 它不会再变成幽灵卡片，因为发不出这种帧的引擎根本起不来。
    const partial = {
      content: [
        { type: 'text', text: '先看一下' },
        { type: 'toolCall', id: 'tc1', name: 'bash', arguments: {}, partialJson: '', index: 1 },
      ],
    }
    expect(up({ type: 'toolcall_start', contentIndex: 1, partial })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: undefined, name: undefined },
    })
  })

  it('toolcall_start 取不到身份时 id/name 留空，不伪造', () => {
    const up = (ev: any) => mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: ev })?.data.event
    expect(up({ type: 'toolcall_start', contentIndex: 7, partial: { content: [] } })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: undefined, name: undefined },
    })
    expect(up({ type: 'toolcall_start', contentIndex: 0 })).toEqual({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: undefined, name: undefined },
    })
  })

  it('message_update：未知 delta 类型原样透传；缺 assistantMessageEvent → null', () => {
    const exotic = { type: 'something_new', payload: { x: 1 } }
    expect(mapPiEvent(SID, { type: 'message_update', assistantMessageEvent: exotic })?.data.event).toEqual(exotic)
    expect(mapPiEvent(SID, { type: 'message_update' })).toBeNull()
  })
})

describe('mapPiEvent — 工具执行事件', () => {
  it('tool_execution_start → tool_use：id=toolCallId、name=toolName 归一为渲染层词表、input=args', () => {
    expect(
      mapPiEvent(SID, { type: 'tool_execution_start', toolCallId: 'tc9', toolName: 'bash', args: { cmd: 'ls' } }),
    ).toEqual({
      sessionId: SID,
      type: 'tool_use',
      data: { id: 'tc9', name: 'Bash', input: { cmd: 'ls' } },
    })
    // 无对应卡片的 Pi 工具（ls）原样透传，不硬塞进别的词
    expect(
      mapPiEvent(SID, { type: 'tool_execution_start', toolCallId: 'tc10', toolName: 'ls', args: {} })?.data,
    ).toMatchObject({ name: 'ls' })
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
      subtype: 'api_retry', attempt: 2, maxRetries: 5, error: 'API error',
    })
    expect(mapPiEvent(SID, { type: 'auto_retry_end', success: true, attempt: 2 })?.data).toEqual({
      subtype: 'auto_retry_end', success: true, attempt: 2,
    })
  })

  // 渲染层的重试卡片只读 api_retry 这套字段（src/stores/turn/index.ts 的 onSystem）。
  // pi 的 auto_retry_start 若不换成这个形状，引擎在退避重试时 UI 全程静默。
  it('auto_retry_start 换成渲染层的 api_retry 载荷', () => {
    expect(mapPiEvent(SID, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: '429 rate limit exceeded on dimension: rpm',
    })).toEqual({
      sessionId: SID,
      type: 'system',
      data: {
        subtype: 'api_retry',
        attempt: 1,
        maxRetries: 3,
        retryInMs: 2000,
        error: '429 rate limit exceeded on dimension: rpm',
      },
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
