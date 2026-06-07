/**
 * Regression tests for the proxy's OpenAI→Anthropic streaming transformer usage
 * handling. Run with:
 *
 *   node --experimental-strip-types --test tests/electron/*.test.ts
 *
 * Background: the official Claude CLI (used in "官网" mode) reads input_tokens and
 * cache fields ONLY from message_start; message_delta only updates output_tokens.
 * OpenAI-compatible endpoints send usage in a trailing chunk that arrives AFTER
 * message_start is emitted, so message_start.input_tokens was always 0 — leaving
 * the context-usage indicator stuck at 0. The transformer now seeds message_start
 * with a request-body estimate, overridden by the real value when it arrives.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { OpenAIToAnthropicStreamTransformer } from '../../electron/proxy/streamingTransformer.ts'
import { estimateInputTokens } from '../../electron/proxy/transformer.ts'

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

describe('streamingTransformer usage', () => {
  it('seeds message_start.input_tokens from the estimate when usage is trailing', () => {
    // DeepSeek-style: content chunks first, usage only in a trailing chunk.
    const events = [
      sse({ id: 'chatcmpl-1', model: 'm', choices: [{ index: 0, delta: { content: 'hi' } }] }),
      sse({ id: 'chatcmpl-1', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      sse({ choices: [], usage: { prompt_tokens: 5000, completion_tokens: 42 } }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events, 1234)

    const start = parsed.find(e => e.type === 'message_start')
    assert.equal(start.message.usage.input_tokens, 1234, 'message_start seeded with estimate')

    const delta = parsed.find(e => e.type === 'message_delta')
    assert.equal(delta.usage.input_tokens, 5000, 'message_delta carries real value')
    assert.equal(delta.usage.output_tokens, 42)
  })

  it('uses the real prompt_tokens in message_start when the first chunk already has usage', () => {
    const events = [
      sse({ id: 'c', model: 'm', usage: { prompt_tokens: 777 }, choices: [{ index: 0, delta: { content: 'x' } }] }),
      sse({ id: 'c', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events, 1234)
    const start = parsed.find(e => e.type === 'message_start')
    assert.equal(start.message.usage.input_tokens, 777, 'real value preferred over estimate')
  })

  it('falls back to the estimate in message_delta when the endpoint never sends usage', () => {
    const events = [
      sse({ id: 'c', model: 'm', choices: [{ index: 0, delta: { content: 'x' } }] }),
      sse({ id: 'c', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      { data: '[DONE]' },
    ]
    const parsed = collect(events, 999)
    const delta = parsed.find(e => e.type === 'message_delta')
    assert.equal(delta.usage.input_tokens, 999, 'estimate kept when no real usage arrives')
  })
})

describe('estimateInputTokens', () => {
  it('counts system, messages and tools', () => {
    const body = {
      system: 'a'.repeat(40),
      messages: [{ role: 'user', content: 'b'.repeat(40) }],
      tools: [{ name: 'x', description: 'c'.repeat(20), input_schema: {} }],
    }
    const est = estimateInputTokens(body)
    assert.ok(est > 0, 'non-zero estimate')
    // Roughly chars/4; far above zero and below the raw char count.
    assert.ok(est < 200)
  })

  it('returns 0 for an empty body', () => {
    assert.equal(estimateInputTokens({}), 0)
  })
})
