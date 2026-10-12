import { describe, it, expect } from 'vitest'
import {
  looksLikeSseText,
  normalizeContentBlock,
  normalizeUsageValue,
  reassembleSseText,
} from '@/lib/trace/sse'

/**
 * 拼接一段 SSE 文本。每个完整事件块以 '\n' 结尾，
 * 与 sseText 的 '\n' 连接符配合产生空行分隔（触发 flush）。
 */
function sseText(...chunks: string[]): string {
  return chunks.join('\n')
}

/** 构造 Anthropic 风格的 event 行 + data 行（自带结束空行） */
function eventLine(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n`
}

/** 构造 OpenAI 风格的 data 行（自带结束空行） */
function dataLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n`
}

/** 最小可用的 Anthropic message_start 事件 */
function messageStart(extra: Record<string, unknown> = {}): string {
  return eventLine('message_start', {
    type: 'message_start',
    message: { role: 'assistant', content: [], ...extra },
  })
}

describe('looksLikeSseText', () => {
  it('非字符串或空内容返回 false', () => {
    expect(looksLikeSseText(42 as unknown as string)).toBe(false)
    expect(looksLikeSseText('')).toBe(false)
    expect(looksLikeSseText('   \n  ')).toBe(false)
  })

  it('普通文本返回 false', () => {
    expect(looksLikeSseText('hello world')).toBe(false)
    expect(looksLikeSseText('[DONE]')).toBe(false)
  })

  it('以 event: / data: 开头的行返回 true（含前置空白）', () => {
    expect(looksLikeSseText('event: message_start')).toBe(true)
    expect(looksLikeSseText('data: {}')).toBe(true)
    expect(looksLikeSseText('  data: {}')).toBe(true)
    expect(looksLikeSseText('\ndata: {}')).toBe(true)
  })
})

describe('normalizeUsageValue', () => {
  it('非对象返回 null', () => {
    expect(normalizeUsageValue(null)).toBeNull()
    expect(normalizeUsageValue('10')).toBeNull()
  })

  it('缺少全部用量字段返回 null', () => {
    expect(normalizeUsageValue({})).toBeNull()
    expect(normalizeUsageValue({ foo: 1 })).toBeNull()
  })

  it('Anthropic 字段直接映射', () => {
    expect(normalizeUsageValue({ input_tokens: 10, output_tokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    })
  })

  it('OpenAI/其它命名自动填充 input/output', () => {
    expect(normalizeUsageValue({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    })
    expect(normalizeUsageValue({ inputTokens: 3, outputTokens: 2 })).toEqual({ inputTokens: 3, outputTokens: 2 })
  })

  it('缺失 input 时输出 0，缺失 output 时输出 0', () => {
    expect(normalizeUsageValue({ input_tokens: 10 })).toEqual({ inputTokens: 10, outputTokens: 0 })
    expect(normalizeUsageValue({ output_tokens: 5 })).toEqual({ inputTokens: 0, outputTokens: 5 })
  })

  it('缓存字段映射：cached_tokens / cacheWriteInputTokens', () => {
    expect(normalizeUsageValue({ input_tokens: 10, output_tokens: 5, cached_tokens: 3 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 3,
    })
    expect(normalizeUsageValue({ input_tokens: 10, output_tokens: 5, cacheWriteInputTokens: 2 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 2,
    })
  })

  it('从 input_tokens_details.cached_tokens 提取缓存读数', () => {
    expect(
      normalizeUsageValue({
        input_tokens: 10,
        output_tokens: 5,
        input_tokens_details: { cached_tokens: 7 },
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 7 })
  })

  it('已存在 cache_read_input_tokens 时不覆盖', () => {
    expect(
      normalizeUsageValue({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, cached_tokens: 3 }),
    ).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 1 })
  })

  it('非数字 token 字段视为缺失', () => {
    expect(normalizeUsageValue({ input_tokens: '10' })).toBeNull()
  })
})

describe('normalizeContentBlock', () => {
  it('字符串块转 text', () => {
    expect(normalizeContentBlock('hi')).toEqual({ type: 'text', text: 'hi' })
  })

  it('非记录（null / 数组）返回 null', () => {
    expect(normalizeContentBlock(null)).toBeNull()
    expect(normalizeContentBlock([1, 2])).toBeNull()
  })

  it('text / thinking 块', () => {
    expect(normalizeContentBlock({ type: 'text', text: 'a' })).toEqual({ type: 'text', text: 'a' })
    expect(normalizeContentBlock({ type: 'text' })).toEqual({ type: 'text', text: '' })
    expect(normalizeContentBlock({ type: 'thinking', thinking: 't' })).toEqual({ type: 'thinking', thinking: 't' })
  })

  it('redacted_thinking 归一为脱敏文本', () => {
    expect(normalizeContentBlock({ type: 'redacted_thinking' })).toEqual({
      type: 'thinking',
      thinking: '[redacted thinking]',
    })
  })

  it('tool_use 块：保留 id / name / input', () => {
    expect(
      normalizeContentBlock({ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { cmd: 'ls' } }),
    ).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { cmd: 'ls' } })
    expect(normalizeContentBlock({ type: 'tool_use', name: 'bash', input: {} })).toEqual({
      type: 'tool_use',
      name: 'bash',
      input: {},
    })
    // 非字符串 name 归空
    expect(normalizeContentBlock({ type: 'tool_use', name: 123 })).toEqual({
      type: 'tool_use',
      name: '',
      input: undefined,
    })
  })

  it('tool_result 块：tool_use_id / is_error 可选', () => {
    expect(
      normalizeContentBlock({ type: 'tool_result', tool_use_id: 'u1', content: 'ok', is_error: true }),
    ).toEqual({ type: 'tool_result', toolUseId: 'u1', content: 'ok', isError: true })
    expect(normalizeContentBlock({ type: 'tool_result', content: 'ok' })).toEqual({
      type: 'tool_result',
      content: 'ok',
    })
  })

  it('image 块：base64 / url 两种数据源', () => {
    expect(
      normalizeContentBlock({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }),
    ).toEqual({ type: 'image', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' })
    // 无 media_type 时回退 image/png
    expect(normalizeContentBlock({ type: 'image', source: { type: 'base64', data: 'BBBB' } })).toEqual({
      type: 'image',
      dataUrl: 'data:image/png;base64,BBBB',
    })
    expect(normalizeContentBlock({ type: 'image', source: { type: 'url', url: 'http://x/y.png' } })).toEqual({
      type: 'image',
      mediaType: undefined,
      dataUrl: 'http://x/y.png',
    })
  })

  it('image 块缺少有效数据源时仅保留 type', () => {
    expect(normalizeContentBlock({ type: 'image' })).toEqual({ type: 'image' })
    expect(normalizeContentBlock({ type: 'image', source: { type: 'foo', data: 'x' } })).toEqual({ type: 'image' })
  })

  it('未知类型归为 text 并序列化原始块', () => {
    expect(normalizeContentBlock({ type: 'weird', value: 1 })).toEqual({
      type: 'text',
      text: '{"type":"weird","value":1}',
    })
  })
})

describe('reassembleSseText — Anthropic Messages API', () => {
  it('完整文本流：message_start → content_block → message_delta', () => {
    const stream = sseText(
      eventLine('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 25, output_tokens: 1 },
        },
      }),
      eventLine('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      eventLine('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
      eventLine('content_block_stop', { type: 'content_block_stop', index: 0 }),
      eventLine('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 12 },
      }),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      usage: { inputTokens: 25, outputTokens: 12 },
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-6',
    })
  })

  it('message_start 直接携带 content 块时无需后续事件', () => {
    const stream = sseText(
      messageStart({ content: [{ type: 'text', text: 'hi' }], model: 'claude-3' }),
      eventLine('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      usage: null,
      stopReason: 'end_turn',
      model: 'claude-3',
    })
  })

  it('tool_use 流：input_json_delta 累积并在 content_block_stop 解析为 input', () => {
    const stream = sseText(
      messageStart({ model: 'claude-3' }),
      eventLine('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_01', name: 'bash', input: {} },
      }),
      eventLine('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } }),
      eventLine('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' "ls -la"}' } }),
      eventLine('content_block_stop', { type: 'content_block_stop', index: 0 }),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_01', name: 'bash', input: { command: 'ls -la' } }],
      },
      usage: null,
      model: 'claude-3',
    })
  })

  it('截断的 partial JSON 在 stop 时保留上一次 input', () => {
    const stream = sseText(
      messageStart(),
      eventLine('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_01', name: 'bash', input: {} },
      }),
      eventLine('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":' } }),
      eventLine('content_block_stop', { type: 'content_block_stop', index: 0 }),
    )
    const result = reassembleSseText(stream)
    expect(result?.message?.content[0]).toEqual({ type: 'tool_use', id: 'toolu_01', name: 'bash', input: {} })
  })

  it('thinking 流：thinking_delta 累积并携带 signature', () => {
    const stream = sseText(
      messageStart({ model: 'claude-3' }),
      eventLine('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
      eventLine('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me ' } }),
      eventLine('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think', signature: 'sig_123' } }),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Let me think' }] },
      usage: null,
      model: 'claude-3',
    })
  })

  it('message_delta 的顶层字段合并进 snapshot', () => {
    const stream = sseText(
      messageStart({ model: 'claude-3' }),
      eventLine('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
    )
    expect(reassembleSseText(stream)?.stopReason).toBe('tool_use')
  })
})

describe('reassembleSseText — OpenAI Chat Completions', () => {
  it('完整文本流：role + content + finish_reason + usage', () => {
    const stream = sseText(
      dataLine({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      }),
      dataLine({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      }),
      dataLine({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      dataLine('[DONE]'),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'stop',
      model: 'gpt-4o',
    })
  })

  it('reasoning_content 镜像为 thinking 块且位于 text 之前', () => {
    const stream = sseText(
      dataLine({
        id: '1',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning_content: 'Let me think' } }],
      }),
      dataLine({ id: '1', model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Answer' } }] }),
      dataLine('[DONE]'),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me think' },
          { type: 'text', text: 'Answer' },
        ],
      },
      usage: null,
      model: 'gpt-4o',
    })
  })

  it('tool_calls 流：id/name/arguments 累积并镜像到 content', () => {
    const stream = sseText(
      dataLine({
        id: '1',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '' } }] } }],
      }),
      dataLine({
        id: '1',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":' } }] } }],
      }),
      dataLine({
        id: '1',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ' "ls"}' } }] } }],
      }),
      dataLine('[DONE]'),
    )
    const result = reassembleSseText(stream)
    expect(result?.message?.content).toEqual([
      { type: 'text', text: '' },
      { type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } },
    ])
    expect(result?.stopReason).toBeUndefined()
  })

  it('仅 usage 的 data 行（空 choices）也并入 snapshot', () => {
    const stream = sseText(
      dataLine({ id: '1', model: 'gpt-4o', choices: [{ index: 0, delta: { content: 'Hi' } }] }),
      dataLine({ id: '1', model: 'gpt-4o', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      dataLine('[DONE]'),
    )
    expect(reassembleSseText(stream)?.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })
})

describe('reassembleSseText — 边界与容错', () => {
  it('非字符串 / 非 SSE 文本 / 空文本返回 null', () => {
    expect(reassembleSseText(42 as unknown as string)).toBeNull()
    expect(reassembleSseText('')).toBeNull()
    expect(reassembleSseText('hello world')).toBeNull()
  })

  it('仅 [DONE] 哨兵返回 null', () => {
    expect(reassembleSseText('data: [DONE]\n\n')).toBeNull()
  })

  it('非法 JSON 载荷返回 null', () => {
    expect(reassembleSseText('event: message_start\ndata: not-json\n\n')).toBeNull()
  })

  it('无快照时 content_block 事件被忽略', () => {
    const stream = sseText(
      eventLine('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'x' } }),
    )
    expect(reassembleSseText(stream)).toBeNull()
  })

  it('处理 CRLF 换行', () => {
    const stream = [
      'event: message_start',
      'data: {"message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
      '',
      'event: message_delta',
      'data: {"delta":{"stop_reason":"end_turn"}}',
      '',
    ].join('\r\n')
    expect(reassembleSseText(stream)).toEqual({
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      usage: null,
      stopReason: 'end_turn',
    })
  })

  it('跨多行 data 的 JSON 重新拼接后解析', () => {
    const stream = sseText(
      'event: message_start',
      'data: {"type":"message_start","message":{"role":"assistant","content":[]',
      'data: ,"usage":{"input_tokens":3}}}\n',
      eventLine('message_delta', { type: 'message_delta', delta: { stop_reason: 'stop' } }),
    )
    expect(reassembleSseText(stream)).toEqual({
      message: { role: 'assistant', content: [] },
      usage: { inputTokens: 3, outputTokens: 0 },
      stopReason: 'stop',
    })
  })

  it('乱序 content_block_start：缺失索引先补空占位再覆盖', () => {
    const stream = sseText(
      messageStart({ model: 'claude-3' }),
      eventLine('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'B' } }),
      eventLine('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'A' } }),
    )
    expect(reassembleSseText(stream)?.message?.content).toEqual([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
    ])
  })

  it('delta 缺失或负 index 回退到 0', () => {
    const noIndex = sseText(
      messageStart(),
      eventLine('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'NoIndex' } }),
    )
    expect(reassembleSseText(noIndex)?.message?.content).toEqual([{ type: 'text', text: 'NoIndex' }])

    const negative = sseText(
      messageStart(),
      eventLine('content_block_delta', { type: 'content_block_delta', index: -1, delta: { type: 'text_delta', text: 'Neg' } }),
    )
    expect(reassembleSseText(negative)?.message?.content).toEqual([{ type: 'text', text: 'Neg' }])
  })

  it('content_block_stop 越界 index 为 no-op', () => {
    const stream = sseText(
      messageStart(),
      eventLine('content_block_stop', { type: 'content_block_stop', index: 5 }),
    )
    expect(reassembleSseText(stream)?.message?.content).toEqual([])
  })

  it('thinking + tool_use 混合流：镜像后的 tool_use 索引偏移正确', () => {
    const stream = sseText(
      dataLine({
        id: '1',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'think', tool_calls: [{ index: 0, id: 'c1', function: { name: 'bash', arguments: '{}' } }] } }],
      }),
      dataLine('[DONE]'),
    )
    const result = reassembleSseText(stream)
    expect(result?.message?.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use'])
  })
})
