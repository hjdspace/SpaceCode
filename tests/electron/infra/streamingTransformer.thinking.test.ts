// @vitest-environment node
/**
 * Tests for the proxy's OpenAI→Anthropic streaming transformer thinking/reasoning support.
 *
 * Background: DeepSeek and other OpenAI-compatible providers send
 * `delta.reasoning_content` for chain-of-thought. The transformer must map
 * this to Anthropic's `thinking` content blocks so the desktop UI can
 * display the model's reasoning process.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { OpenAIToAnthropicStreamTransformer } from '../../../electron/proxy/streamingTransformer.ts'
import { openAIToAnthropicResponse, anthropicToOpenAIRequest } from '../../../electron/proxy/transformer.ts'

function collect(events: { data: string }[], estimate = 0) {
  const t = new OpenAIToAnthropicStreamTransformer(estimate)
  const out: string[] = []
  for (const e of events) out.push(...t.transform(e))
  out.push(...t.finish())
  return out
    .filter(s => s.startsWith('event:'))
    .map(s => JSON.parse(s.slice(s.indexOf('data: ') + 6)))
}

function collectWithoutThinking(events: { data: string }[]) {
  const t = new OpenAIToAnthropicStreamTransformer(0, false)
  const out: string[] = []
  for (const e of events) out.push(...t.transform(e))
  out.push(...t.finish())
  return out
    .filter(s => s.startsWith('event:'))
    .map(s => JSON.parse(s.slice(s.indexOf('data: ') + 6)))
}

const sse = (obj: unknown) => ({ data: JSON.stringify(obj) })

describe('streamingTransformer thinking/reasoning', () => {
  it('converts reasoning_content to thinking blocks (DeepSeek-style)', () => {
    const events = [
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: { reasoning_content: 'Let me think about this...' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: { reasoning_content: ' and more reasoning.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: { content: 'Here is my answer.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events)

    // Should have two content blocks: thinking + text
    const blockStarts = parsed.filter(e => e.type === 'content_block_start')
    assert.equal(blockStarts.length, 2)
    assert.equal(blockStarts[0].content_block.type, 'thinking')
    assert.equal(blockStarts[1].content_block.type, 'text')

    // Thinking block should be closed before text block starts
    const blockStops = parsed.filter(e => e.type === 'content_block_stop')
    assert.equal(blockStops[0].index, 0) // thinking block closed at index 0
    assert.equal(blockStarts[1].index, 1) // text block starts at index 1

    // Verify thinking deltas
    const thinkingDeltas = parsed.filter(
      e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta',
    )
    assert.equal(thinkingDeltas.length, 2)
    assert.equal(thinkingDeltas[0].delta.thinking, 'Let me think about this...')
    assert.equal(thinkingDeltas[1].delta.thinking, ' and more reasoning.')

    // Verify text delta
    const textDelta = parsed.find(
      e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta',
    )
    assert.equal(textDelta.delta.text, 'Here is my answer.')
  })

  it('opens thinking block on empty reasoning_content (DeepSeek v4 direct-answer)', () => {
    const events = [
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: { reasoning_content: '' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: { content: 'Direct answer.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events)

    const blockStarts = parsed.filter(e => e.type === 'content_block_start')
    assert.equal(blockStarts.length, 2)
    assert.equal(blockStarts[0].content_block.type, 'thinking')
    assert.equal(blockStarts[1].content_block.type, 'text')

    // No empty thinking_delta should be emitted
    const thinkingDeltas = parsed.filter(
      e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta',
    )
    assert.equal(thinkingDeltas.length, 0)
  })

  it('handles reasoning followed by tool calls', () => {
    const events = [
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: { reasoning_content: 'I need to use a tool.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
            }],
          },
        }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'deepseek-v4',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events)

    const blockStarts = parsed.filter(e => e.type === 'content_block_start')
    assert.equal(blockStarts.length, 2)
    assert.equal(blockStarts[0].content_block.type, 'thinking')
    assert.equal(blockStarts[1].content_block.type, 'tool_use')

    // Thinking block must be closed before tool_use block starts, and tool_use
    // must get its own index — reusing the thinking index leaves the thinking
    // block permanently open.
    const blockStops = parsed.filter(e => e.type === 'content_block_stop')
    assert.equal(blockStops[0].index, 0)
    assert.equal(blockStarts[1].index, 1)
  })

  it('keeps one text block open when the gateway echoes empty reasoning_content per chunk', () => {
    // Regression: qwen/DeepSeek-style gateways keep sending
    // `reasoning_content: ""` on every content chunk after reasoning ends.
    // Treating that as a block boundary chopped one answer into one text block
    // per chunk with an empty thinking block in between, which the timeline
    // rendered as interleaved fragments and blank reasoning cards.
    const events = [
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { reasoning_content: 'Thinking hard.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { reasoning_content: '', content: '"做一个考勤表"' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { reasoning_content: '', content: ' 有几种可能的' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { reasoning_content: '', content: '理解，我需要确认一下再动手。' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events)

    const blockStarts = parsed.filter(e => e.type === 'content_block_start')
    assert.deepEqual(
      blockStarts.map(e => e.content_block.type),
      ['thinking', 'text'],
    )

    const textDeltas = parsed.filter(
      e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta',
    )
    assert.equal(textDeltas.length, 3)
    assert.ok(textDeltas.every(e => e.index === blockStarts[1].index))
    assert.equal(
      textDeltas.map(e => e.delta.text).join(''),
      '"做一个考勤表" 有几种可能的理解，我需要确认一下再动手。',
    )

    const thinkingDeltas = parsed.filter(
      e => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta',
    )
    assert.equal(thinkingDeltas.length, 1)
  })

  it('still opens a thinking block for genuinely interleaved reasoning', () => {
    const events = [
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { content: 'First part. ' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { reasoning_content: 'Wait, let me reconsider.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: { content: 'Second part.' } }],
      }),
      sse({
        id: 'chatcmpl-1',
        model: 'qwen3.8-max',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events)

    const blockStarts = parsed.filter(e => e.type === 'content_block_start')
    assert.deepEqual(
      blockStarts.map(e => e.content_block.type),
      ['text', 'thinking', 'text'],
    )
  })
})

describe('openAIToAnthropicResponse thinking', () => {
  it('converts reasoning_content to thinking block in non-streaming response', () => {
    const openaiResponse = {
      id: 'chatcmpl-1',
      model: 'deepseek-v4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          reasoning_content: 'Let me think about this...',
          content: 'Here is my answer.',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }

    const anthropicResponse = openAIToAnthropicResponse(openaiResponse)

    assert.ok(Array.isArray(anthropicResponse.content))
    assert.equal(anthropicResponse.content.length, 2)
    assert.equal(anthropicResponse.content[0].type, 'thinking')
    assert.equal(anthropicResponse.content[0].thinking, 'Let me think about this...')
    assert.equal(anthropicResponse.content[1].type, 'text')
    assert.equal(anthropicResponse.content[1].text, 'Here is my answer.')
  })

  it('handles response with only reasoning_content and no text content', () => {
    const openaiResponse = {
      id: 'chatcmpl-1',
      model: 'deepseek-v4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          reasoning_content: 'Just thinking, no answer yet.',
          content: null,
        },
        finish_reason: 'stop',
      }],
    }

    const anthropicResponse = openAIToAnthropicResponse(openaiResponse)

    assert.equal(anthropicResponse.content.length, 1)
    assert.equal(anthropicResponse.content[0].type, 'thinking')
    assert.equal(anthropicResponse.content[0].thinking, 'Just thinking, no answer yet.')
  })
})

/**
 * 客户端没请求思考时（CLI 的 --thinking disabled → 请求体里没有 thinking），
 * 兼容网关仍会默认吐 reasoning_content。此前代理无条件把它映射成 thinking 块，
 * 于是"关了思考开关却照样看到推理过程"。
 */
describe('streamingTransformer — 未请求思考时不呈现推理', () => {
  const reasoningThenAnswer = [
    sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: { reasoning_content: '不该被看到的推理' } }] }),
    sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: { content: '正式回答' } }] }),
    sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    { data: '[DONE]' },
  ]

  it('reasoning_content 不再开出 thinking 块，正文完整', () => {
    const parsed = collectWithoutThinking(reasoningThenAnswer)

    const blockTypes = parsed
      .filter(e => e.type === 'content_block_start')
      .map(e => e.content_block.type)
    assert.deepEqual(blockTypes, ['text'])
    assert.equal(
      parsed.filter(e => e.type === 'content_block_delta').some(d => d.delta?.type === 'thinking_delta'),
      false,
    )
    const text = parsed
      .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      .map(e => e.delta.text)
      .join('')
    assert.equal(text, '正式回答')
  })

  it('空 reasoning_content 的回执残留也不会攒进兜底缓冲', () => {
    const parsed = collectWithoutThinking([
      sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: { reasoning_content: '' } }] }),
      sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: { content: '答' } }] }),
      sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      { data: '[DONE]' },
    ])

    assert.deepEqual(
      parsed.filter(e => e.type === 'content_block_start').map(e => e.content_block.type),
      ['text'],
    )
  })

  it('纯推理模型（正文只在 reasoning_content 里）不会被吞成空白回复', () => {
    const parsed = collectWithoutThinking([
      sse({ id: 'c1', model: 'deepseek-r1', choices: [{ index: 0, delta: { reasoning_content: '只有推理，没有 content' } }] }),
      sse({ id: 'c1', model: 'deepseek-r1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      { data: '[DONE]' },
    ])

    const blocks = parsed.filter(e => e.type === 'content_block_start')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].content_block.type, 'text')
    const text = parsed
      .filter(e => e.type === 'content_block_delta')
      .map(e => e.delta?.text)
      .join('')
    assert.equal(text, '只有推理，没有 content')
  })

  it('工具调用也算可见内容，兜底不会把推理塞进正文', () => {
    const parsed = collectWithoutThinking([
      sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: { reasoning_content: '我要调工具' } }] }),
      sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'tu_1', function: { name: 'Read', arguments: '{}' } }] } }] }),
      sse({ id: 'c1', model: 'glm-5-3-flash', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      { data: '[DONE]' },
    ])

    const blocks = parsed.filter(e => e.type === 'content_block_start')
    assert.deepEqual(blocks.map(b => b.content_block.type), ['tool_use'])
  })

  it('非流式响应同样按 includeReasoning 决定', () => {
    const openaiResponse = {
      id: 'c1',
      model: 'glm-5-3-flash',
      choices: [{ index: 0, message: { role: 'assistant', reasoning_content: '推理', content: '回答' }, finish_reason: 'stop' }],
    }

    const suppressed = openAIToAnthropicResponse(openaiResponse, { includeReasoning: false })
    assert.deepEqual(suppressed.content.map((b: Record<string, any>) => b.type), ['text'])

    const shown = openAIToAnthropicResponse(openaiResponse, { includeReasoning: true })
    assert.deepEqual(shown.content.map((b: Record<string, any>) => b.type), ['thinking', 'text'])
  })

  it('请求体的 thinking 口径：adaptive/enabled 算请求，disabled 与缺省不算', () => {
    const withAdaptive = anthropicToOpenAIRequest({ model: 'glm-5-3-flash', messages: [{ role: 'user', content: 'hi' }], thinking: { type: 'adaptive' } })
    assert.ok(withAdaptive.enable_thinking === true || withAdaptive.thinking)

    const withEnabled = anthropicToOpenAIRequest({ model: 'glm-5-3-flash', messages: [{ role: 'user', content: 'hi' }], thinking: { type: 'enabled', budget_tokens: 1000 } })
    assert.ok(withEnabled.enable_thinking === true || withEnabled.thinking)

    for (const thinking of [undefined, { type: 'disabled' }]) {
      const body = anthropicToOpenAIRequest({ model: 'glm-5-3-flash', messages: [{ role: 'user', content: 'hi' }], ...(thinking ? { thinking } : {}) })
      assert.equal(body.thinking, undefined)
      assert.equal(body.enable_thinking, undefined)
      assert.equal(body.chat_template_kwargs, undefined)
    }
  })
})

describe('anthropicToOpenAIRequest thinking', () => {
  it('converts Anthropic thinking.enabled to OpenAI-compatible params', () => {
    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      thinking: { type: 'enabled' },
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    // The transformer emits all three thinking format variants so each
    // endpoint can use the one it recognizes:
    assert.deepEqual(openaiBody.thinking, { type: 'enabled' })
    assert.equal(openaiBody.enable_thinking, true)
    assert.deepEqual(openaiBody.chat_template_kwargs, { thinking: true, enable_thinking: true })
  })

  it('converts Anthropic thinking.adaptive to OpenAI-compatible params', () => {
    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      thinking: { type: 'adaptive' },
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    assert.equal(openaiBody.enable_thinking, true)
    assert.deepEqual(openaiBody.chat_template_kwargs, { thinking: true, enable_thinking: true })
  })

  it('omits the Anthropic-style thinking param for chat-template families', () => {
    // Qwen behind LiteLLM/vLLM validates parameters: sending `thinking` there is
    // a deterministic 400 UnsupportedParamsError, so the model name decides
    // which spelling goes out.
    const anthropicBody = {
      model: 'qwen3.8-27b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      thinking: { type: 'enabled' },
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    assert.equal(openaiBody.thinking, undefined)
    assert.equal(openaiBody.enable_thinking, true)
    assert.deepEqual(openaiBody.chat_template_kwargs, { thinking: true, enable_thinking: true })
  })

  it('keeps every known spelling for unrecognised models', () => {
    // Narrowing the default would break the gateways that historically ignore
    // unknown parameters; only recognised chat-template families get trimmed.
    const anthropicBody = {
      model: 'some-alias-not-in-the-table',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      thinking: { type: 'enabled' },
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    assert.deepEqual(openaiBody.thinking, { type: 'enabled' })
    assert.equal(openaiBody.enable_thinking, true)
  })

  it('does not add thinking params when thinking is disabled', () => {
    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      thinking: { type: 'disabled' },
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    assert.equal(openaiBody.enable_thinking, undefined)
    assert.equal(openaiBody.chat_template_kwargs, undefined)
  })

  it('does not add thinking params when thinking is absent', () => {
    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    assert.equal(openaiBody.enable_thinking, undefined)
    assert.equal(openaiBody.chat_template_kwargs, undefined)
  })

  it('round-trips thinking blocks in assistant messages as reasoning_content', () => {
    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Previous reasoning.' },
          { type: 'text', text: 'Previous answer.' },
        ],
      }],
      stream: true,
    }

    const openaiBody = anthropicToOpenAIRequest(anthropicBody)

    const assistantMsg = openaiBody.messages.find((m: any) => m.role === 'assistant')
    assert.ok(assistantMsg)
    assert.equal(assistantMsg.reasoning_content, 'Previous reasoning.')
    assert.equal(assistantMsg.content, 'Previous answer.')
  })
})
