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

    // Thinking block must be closed before tool_use block starts
    const blockStops = parsed.filter(e => e.type === 'content_block_stop')
    assert.ok(blockStops.some(s => s.index === 0))
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
