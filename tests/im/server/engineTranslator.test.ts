import { describe, expect, it } from 'vitest'
import { translateEngineEvent } from '@electron/imServer/engineTranslator'
import type { UnifiedEngineEvent } from '@electron/engines/types'

describe('translateEngineEvent', () => {
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
