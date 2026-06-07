interface OpenAIStreamChunk {
  id?: string
  model?: string
  choices?: Array<{
    index: number
    delta?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
}

const ContentBlockType = {
  None: 0,
  Text: 1,
  ToolUse: 2,
} as const
type ContentBlockType = (typeof ContentBlockType)[keyof typeof ContentBlockType]

export class OpenAIToAnthropicStreamTransformer {
  private messageStarted = false
  private contentBlockType: ContentBlockType = ContentBlockType.None
  private finished = false
  private contentBlockIndex = 0
  private currentToolIndex = -1
  private model = ''
  private messageId = ''
  // Track usage — all four Anthropic fields, populated from OpenAI usage fields:
  //   prompt_tokens                       → input_tokens
  //   completion_tokens                   → output_tokens
  //   prompt_tokens_details.cached_tokens → cache_read_input_tokens
  //   (no OpenAI equivalent)              → cache_creation_input_tokens (always 0)
  private inputTokens = 0
  private outputTokens = 0
  private cachedReadTokens = 0
  // Rough input-token estimate from the request body. OpenAI-compatible endpoints
  // only send usage in a trailing chunk (after message_start is already emitted),
  // so message_start would otherwise carry input_tokens=0. The official Claude CLI
  // reads input_tokens primarily from message_start, leaving the context-usage
  // indicator stuck at 0. We seed message_start with this estimate; the real value
  // (if the endpoint sends one) still overrides it via message_delta.
  private estimatedInputTokens = 0

  constructor(estimatedInputTokens = 0) {
    this.estimatedInputTokens = estimatedInputTokens
  }
  // Deferred finish: when finish_reason arrives, we defer message_delta/message_stop
  // until [DONE] so that trailing usage chunks (sent after finish_reason by some
  // OpenAI-compatible endpoints like DeepSeek) are captured before final counts.
  private pendingFinishReason: string | null = null

  transform(event: { data: string }): string[] {
    if (event.data === '[DONE]') {
      if (!this.finished) {
        return this.emitClosingEvents(this.pendingFinishReason ?? undefined)
      }
      return []
    }

    let chunk: Record<string, any>
    try {
      chunk = JSON.parse(event.data)
    } catch {
      return []
    }

    const output: string[] = []

    if (chunk.usage) {
      this.inputTokens = chunk.usage.prompt_tokens ?? this.inputTokens
      this.outputTokens = chunk.usage.completion_tokens ?? this.outputTokens
      // OpenAI prompt caching: prompt_tokens_details.cached_tokens → cache_read_input_tokens
      const details = (chunk.usage as any).prompt_tokens_details
      if (details?.cached_tokens != null) {
        this.cachedReadTokens = details.cached_tokens
      }
    }

    if (!this.messageStarted) {
      this.messageStarted = true
      this.model = chunk.model || ''
      this.messageId = chunk.id?.replace('chatcmpl-', 'msg_') || `msg_${Date.now()}`
      // Seed with the real prompt_tokens if this first chunk already carries usage;
      // otherwise fall back to the request-body estimate so message_start is never 0.
      const startInputTokens = this.inputTokens > 0 ? this.inputTokens : this.estimatedInputTokens
      output.push(this.formatSSE('message_start', {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: this.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: startInputTokens,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: this.cachedReadTokens,
          },
        },
      }))
    }

    const choice = chunk.choices?.[0]
    if (!choice) return output

    if (choice.delta?.content != null && choice.delta.content !== '') {
      if (this.contentBlockType === ContentBlockType.ToolUse) {
        output.push(this.formatSSE('content_block_stop', {
          type: 'content_block_stop',
          index: this.contentBlockIndex,
        }))
        this.contentBlockIndex++
        this.currentToolIndex = -1
      }

      if (this.contentBlockType !== ContentBlockType.Text) {
        this.contentBlockType = ContentBlockType.Text
        output.push(this.formatSSE('content_block_start', {
          type: 'content_block_start',
          index: this.contentBlockIndex,
          content_block: { type: 'text', text: '' },
        }))
      }

      output.push(this.formatSSE('content_block_delta', {
        type: 'content_block_delta',
        index: this.contentBlockIndex,
        delta: { type: 'text_delta', text: choice.delta.content },
      }))
    }

    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        if (tc.function?.name) {
          if (this.contentBlockType === ContentBlockType.Text) {
            output.push(this.formatSSE('content_block_stop', {
              type: 'content_block_stop',
              index: this.contentBlockIndex,
            }))
            this.contentBlockIndex++
          } else if (this.contentBlockType === ContentBlockType.ToolUse && this.currentToolIndex >= 0) {
            output.push(this.formatSSE('content_block_stop', {
              type: 'content_block_stop',
              index: this.contentBlockIndex,
            }))
            this.contentBlockIndex++
          }

          output.push(this.formatSSE('content_block_start', {
            type: 'content_block_start',
            index: this.contentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: tc.id || `toolu_${Date.now()}_${tc.index}`,
              name: tc.function.name,
              input: {},
            },
          }))
          this.contentBlockType = ContentBlockType.ToolUse
          this.currentToolIndex = tc.index
        }

        if (tc.function?.arguments) {
          if (this.currentToolIndex !== tc.index) {
            if (this.contentBlockType === ContentBlockType.ToolUse) {
              output.push(this.formatSSE('content_block_stop', {
                type: 'content_block_stop',
                index: this.contentBlockIndex,
              }))
              this.contentBlockIndex++
            }

            output.push(this.formatSSE('content_block_start', {
              type: 'content_block_start',
              index: this.contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: `toolu_${Date.now()}_${tc.index}`,
                name: '',
                input: {},
              },
            }))
            this.contentBlockType = ContentBlockType.ToolUse
            this.currentToolIndex = tc.index
          }

          output.push(this.formatSSE('content_block_delta', {
            type: 'content_block_delta',
            index: this.contentBlockIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          }))
        }
      }
    }

    if (choice.finish_reason) {
      // Defer message_delta/message_stop until [DONE] so that trailing usage
      // chunks (sent after finish_reason by some OpenAI-compatible endpoints)
      // are captured before we emit the final token counts.
      this.pendingFinishReason = choice.finish_reason
      // Close any open content blocks now, but don't emit message_delta yet.
      output.push(...this.closeContentBlocks())
    }

    return output
  }

  finish(): string[] {
    if (!this.finished) {
      return this.emitClosingEvents(this.pendingFinishReason ?? undefined)
    }
    return []
  }

  reset(): void {
    this.messageStarted = false
    this.contentBlockType = ContentBlockType.None
    this.finished = false
    this.contentBlockIndex = 0
    this.currentToolIndex = -1
    this.model = ''
    this.messageId = ''
    this.inputTokens = 0
    this.outputTokens = 0
    this.cachedReadTokens = 0
    this.pendingFinishReason = null
    // estimatedInputTokens is intentionally NOT reset — it's a per-request
    // construction parameter, not stream state.
  }

  private emitClosingEvents(finishReason?: string): string[] {
    if (this.finished) return []
    this.finished = true

    const output: string[] = []

    if (this.contentBlockType !== ContentBlockType.None) {
      output.push(this.formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: this.contentBlockIndex,
      }))
    }

    // Carry all four Anthropic usage fields so the consumer can calculate
    // context fill from input_tokens + cache tokens. Matches engine layer's
    // streamAdapter.ts message_delta format.
    output.push(this.formatSSE('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: this.mapFinishReason(finishReason),
        stop_sequence: null,
      },
      usage: {
        input_tokens: this.inputTokens > 0 ? this.inputTokens : this.estimatedInputTokens,
        output_tokens: this.outputTokens,
        cache_read_input_tokens: this.cachedReadTokens,
        cache_creation_input_tokens: 0,
      },
    }))

    output.push(this.formatSSE('message_stop', {
      type: 'message_stop',
    }))

    return output
  }

  /** Close any open content block without emitting message_delta/message_stop. */
  private closeContentBlocks(): string[] {
    const output: string[] = []
    if (this.contentBlockType !== ContentBlockType.None) {
      output.push(this.formatSSE('content_block_stop', {
        type: 'content_block_stop',
        index: this.contentBlockIndex,
      }))
      this.contentBlockType = ContentBlockType.None
    }
    return output
  }

  private mapFinishReason(reason?: string): string {
    switch (reason) {
      case 'stop': return 'end_turn'
      case 'length': return 'max_tokens'
      case 'tool_calls': return 'tool_use'
      default: return 'end_turn'
    }
  }

  private formatSSE(event: string, data: any): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  }
}
