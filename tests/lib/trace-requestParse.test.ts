import { describe, it, expect } from 'vitest'
import { parseTraceRequestBody, parseTraceResponseBody } from '@/lib/trace/requestParse'

describe('parseTraceRequestBody', () => {
  it('非法输入返回 null', () => {
    expect(parseTraceRequestBody('', 'anthropic')).toBeNull()
    expect(parseTraceRequestBody('not-json', 'anthropic')).toBeNull()
    expect(parseTraceRequestBody('123', 'anthropic')).toBeNull()
    expect(parseTraceRequestBody('[1,2]', 'anthropic')).toBeNull()
  })

  it('解析 model / system / messages（字符串内容）', () => {
    const body = JSON.stringify({
      model: 'claude-3',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(parseTraceRequestBody(body, 'anthropic')).toEqual({
      model: 'claude-3',
      system: 'You are helpful',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [],
      params: {},
    })
  })

  it('messages 数组内容块 + 角色归一 + 空内容', () => {
    const body = JSON.stringify({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }, null] },
        { role: 'admin', content: 'x' },
        { role: 'tool', content: 42 },
      ],
    })
    const parsed = parseTraceRequestBody(body, 'anthropic')
    expect(parsed?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'x' }] }, // 未知角色回退 user
      { role: 'tool', content: [] }, // 非字符串/数组内容 → 空块
    ])
  })

  it('system 数组块拼接为文本', () => {
    const body = JSON.stringify({ system: [{ type: 'text', text: 'sys1' }, 'sys2', { foo: 1 }] })
    expect(parseTraceRequestBody(body, 'anthropic')?.system).toBe('sys1\n\nsys2')
  })

  it('tools 支持 function 包裹 / 直接命名 / input_schema / parameters', () => {
    const body = JSON.stringify({
      tools: [
        { type: 'function', function: { name: 'bash', description: 'Run', parameters: { type: 'object' } } },
        { name: 'read', description: 'Read', input_schema: { type: 'object' } },
        { name: 'noDesc', input_schema: { type: 'object' } },
        { type: 'function', function: {} }, // 无 name → 过滤
      ],
    })
    expect(parseTraceRequestBody(body, 'anthropic')?.tools).toEqual([
      { name: 'bash', description: 'Run', schema: { type: 'object' } },
      { name: 'read', description: 'Read', schema: { type: 'object' } },
      { name: 'noDesc', schema: { type: 'object' } },
    ])
  })

  it('非核心字段收集进 params', () => {
    const body = JSON.stringify({ messages: [], max_tokens: 100, temperature: 0.5, stream: true })
    expect(parseTraceRequestBody(body, 'anthropic')?.params).toEqual({
      max_tokens: 100,
      temperature: 0.5,
      stream: true,
    })
  })

  it('proxy 源解包 anthropic 信封', () => {
    const body = JSON.stringify({ anthropic: { model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] } })
    const parsed = parseTraceRequestBody(body, 'proxy')
    expect(parsed?.model).toBe('claude-3')
    expect(parsed?.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(parsed?.params).toEqual({})
  })

  it('proxy 源无信封时透传', () => {
    const body = JSON.stringify({ model: 'claude-3', messages: [] })
    expect(parseTraceRequestBody(body, 'proxy')?.model).toBe('claude-3')
  })

  it('messages 非数组时为空数组', () => {
    const body = JSON.stringify({ messages: 'not-array' })
    expect(parseTraceRequestBody(body, 'anthropic')?.messages).toEqual([])
  })
})

describe('parseTraceResponseBody', () => {
  it('空白 / 非 JSON 非 SSE 文本返回 null', () => {
    expect(parseTraceResponseBody('', 'anthropic')).toBeNull()
    expect(parseTraceResponseBody('   ', 'anthropic')).toBeNull()
    expect(parseTraceResponseBody('hello', 'anthropic')).toBeNull()
    expect(parseTraceResponseBody('[1,2]', 'anthropic')).toBeNull()
  })

  it('SSE 文本解析为 kind=sse', () => {
    const sse = [
      'event: message_start',
      'data: {"message":{"role":"assistant","content":[],"model":"claude-3"}}',
      '',
      'event: message_delta',
      'data: {"delta":{"stop_reason":"end_turn"}}',
      '',
    ].join('\n')
    expect(parseTraceResponseBody(sse, 'anthropic')).toEqual({
      kind: 'sse',
      message: { role: 'assistant', content: [] },
      usage: null,
      stopReason: 'end_turn',
      model: 'claude-3',
    })
  })

  it('SSE 形态但内容非法返回 null', () => {
    expect(parseTraceResponseBody('data: not-json\n\n', 'anthropic')).toBeNull()
  })

  it('Anthropic JSON：content 块 + stop_reason + usage', () => {
    const body = JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { cmd: 'ls' } },
      ],
      stop_reason: 'end_turn',
      model: 'claude-3',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
    })
    expect(parseTraceResponseBody(body, 'anthropic')).toEqual({
      kind: 'json',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { cmd: 'ls' } },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2 },
      stopReason: 'end_turn',
      model: 'claude-3',
    })
  })

  it('OpenAI JSON：reasoning + content + tool_calls 组装为块', () => {
    const body = JSON.stringify({
      id: '1',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Answer',
            reasoning_content: 'think',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    expect(parseTraceResponseBody(body, 'anthropic')).toEqual({
      kind: 'json',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'think' },
          { type: 'text', text: 'Answer' },
          { type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'tool_calls',
      model: 'gpt-4o',
    })
  })

  it('工具参数非 JSON 字符串时保留原文', () => {
    const body = JSON.stringify({
      choices: [{ index: 0, message: { content: 'x', tool_calls: [{ function: { name: 'bash', arguments: '{broken' } }] } }],
    })
    const parsed = parseTraceResponseBody(body, 'anthropic')
    expect(parsed?.message?.content[1]).toEqual({ type: 'tool_use', name: 'bash', input: '{broken' })
  })

  it('JSON 无 content / choices 时 message 为 null，仍保留 usage / model', () => {
    const body = JSON.stringify({ model: 'gpt-4o', usage: { input_tokens: 5, output_tokens: 3 } })
    expect(parseTraceResponseBody(body, 'anthropic')).toEqual({
      kind: 'json',
      message: null,
      usage: { inputTokens: 5, outputTokens: 3 },
      model: 'gpt-4o',
    })
  })

  it('proxy 源 JSON 解包 anthropic 信封', () => {
    const body = JSON.stringify({ anthropic: { content: [{ type: 'text', text: 'hi' }], role: 'assistant' } })
    expect(parseTraceResponseBody(body, 'proxy')).toEqual({
      kind: 'json',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      usage: null,
    })
  })

  it('proxy 源信封内为 SSE 字符串时解析为 kind=sse', () => {
    const sse = [
      'event: message_start',
      'data: {"message":{"role":"assistant","content":[]}}',
      '',
      'event: message_delta',
      'data: {"delta":{"stop_reason":"end_turn"}}',
      '',
    ].join('\n')
    const body = JSON.stringify({ anthropic: sse })
    expect(parseTraceResponseBody(body, 'proxy')).toEqual({
      kind: 'sse',
      message: { role: 'assistant', content: [] },
      usage: null,
      stopReason: 'end_turn',
    })
  })
})
