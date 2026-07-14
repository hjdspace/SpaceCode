import { describe, expect, it } from 'vitest'
import { translateEngineEvent } from '@electron/imServer/engineTranslator'
import type { UnifiedEngineEvent } from '@electron/engines/types'

describe('translateEngineEvent', () => {
  it('should expose text from routed stream events before completion usage', () => {
    const events: UnifiedEngineEvent[] = [
      {
        sessionId: 'test-session',
        type: 'stream_event',
        data: {
          type: 'stream_event',
          event: { type: 'message_start', message: { model: 'deepseek-v4-flash' } },
        },
      },
      {
        sessionId: 'test-session',
        type: 'stream_event',
        data: {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'text', text: '' },
          },
        },
      },
      {
        sessionId: 'test-session',
        type: 'stream_event',
        data: {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '我是 SpaceCode 助手。' },
          },
        },
      },
      {
        sessionId: 'test-session',
        type: 'assistant',
        data: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '我是 SpaceCode 助手。' }],
          },
        },
      },
      {
        sessionId: 'test-session',
        type: 'stream_event',
        data: { type: 'stream_event', event: { type: 'message_stop' } },
      },
      {
        sessionId: 'test-session',
        type: 'result',
        data: {
          is_error: false,
          usage: { input_tokens: 12, output_tokens: 8 },
        },
      },
    ]

    const messages = events.flatMap(translateEngineEvent)

    expect(messages).toContainEqual({ type: 'content_start', blockType: 'text' })
    expect(messages).toContainEqual({ type: 'content_delta', text: '我是 SpaceCode 助手。' })
    expect(messages).toContainEqual({
      type: 'message_complete',
      usage: { inputTokens: 12, outputTokens: 8 },
    })
    expect(messages).toContainEqual({ type: 'status', state: 'idle' })
  })

  it('should expose an Engine result error instead of a zero-token completion', () => {
    const event: UnifiedEngineEvent = {
      sessionId: 'test-session',
      type: 'result',
      data: {
        is_error: true,
        result: 'API Error: Connection error.',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    }

    const messages = translateEngineEvent(event)

    expect(messages).toContainEqual({
      type: 'error',
      message: 'API Error: Connection error.',
      code: 'ENGINE_RESULT_ERROR',
      retryable: false,
    })
    expect(messages).toContainEqual({ type: 'status', state: 'idle' })
    expect(messages.some((message) => message.type === 'message_complete')).toBe(false)
  })
})
