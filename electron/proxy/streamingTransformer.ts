export enum TransformerState {
  Init = 'init',
  MessageStarted = 'message_started',
  TextBlockOpen = 'text_block_open',
  ToolUseBlockOpen = 'tool_use_block_open',
  Finished = 'finished',
}

interface OpenAIStreamChunk {
  id?: string
  object?: string
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
}

function sse(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export class OpenAIToAnthropicStreamTransformer {
  state: TransformerState = TransformerState.Init
  private contentBlockIndex = 0
  private currentToolIndex = -1
  private messageId = ''
  private model = ''
  private inputTokens = 0
  private outputTokens = 0

  transform(chunk: OpenAIStreamChunk): string[] {
    const events: string[] = []
    const choice = chunk.choices?.[0]
    if (!choice) return events

    if (this.state === TransformerState.Finished) return events

    if (this.state === TransformerState.Init) {
      this.messageId = chunk.id || `msg_${Date.now()}`
      this.model = chunk.model || ''
      events.push(sse('message_start', {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: this.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.inputTokens, output_tokens: 0 },
        },
      }))
      this.state = TransformerState.MessageStarted
    }

    const delta = choice.delta

    if (delta?.content != null && delta.content !== '') {
      if (this.state === TransformerState.ToolUseBlockOpen) {
        events.push(sse('content_block_stop', {
          type: 'content_block_stop',
          index: this.contentBlockIndex,
        }))
        this.contentBlockIndex++
        this.currentToolIndex = -1
      }

      if (this.state !== TransformerState.TextBlockOpen) {
        events.push(sse('content_block_start', {
          type: 'content_block_start',
          index: this.contentBlockIndex,
          content_block: { type: 'text', text: '' },
        }))
        this.state = TransformerState.TextBlockOpen
      }

      events.push(sse('content_block_delta', {
        type: 'content_block_delta',
        index: this.contentBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      }))
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.function?.name) {
          if (this.state === TransformerState.TextBlockOpen) {
            events.push(sse('content_block_stop', {
              type: 'content_block_stop',
              index: this.contentBlockIndex,
            }))
            this.contentBlockIndex++
          } else if (this.state === TransformerState.ToolUseBlockOpen && this.currentToolIndex >= 0) {
            events.push(sse('content_block_stop', {
              type: 'content_block_stop',
              index: this.contentBlockIndex,
            }))
            this.contentBlockIndex++
          }

          events.push(sse('content_block_start', {
            type: 'content_block_start',
            index: this.contentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: tc.id || `toolu_${Date.now()}_${tc.index}`,
              name: tc.function.name,
              input: {},
            },
          }))
          this.state = TransformerState.ToolUseBlockOpen
          this.currentToolIndex = tc.index
        }

        if (tc.function?.arguments) {
          if (this.state !== TransformerState.ToolUseBlockOpen || this.currentToolIndex !== tc.index) {
            if (this.state === TransformerState.ToolUseBlockOpen && this.currentToolIndex !== tc.index) {
              events.push(sse('content_block_stop', {
                type: 'content_block_stop',
                index: this.contentBlockIndex,
              }))
              this.contentBlockIndex++
            }
            continue
          }

          events.push(sse('content_block_delta', {
            type: 'content_block_delta',
            index: this.contentBlockIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          }))
        }
      }
    }

    if (choice.finish_reason) {
      if (this.state === TransformerState.TextBlockOpen || this.state === TransformerState.ToolUseBlockOpen) {
        events.push(sse('content_block_stop', {
          type: 'content_block_stop',
          index: this.contentBlockIndex,
        }))
      }

      const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn'

      events.push(sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: this.outputTokens },
      }))

      events.push(sse('message_stop', {
        type: 'message_stop',
      }))

      this.state = TransformerState.Finished
    }

    return events
  }

  reset(): void {
    this.state = TransformerState.Init
    this.contentBlockIndex = 0
    this.currentToolIndex = -1
    this.messageId = ''
    this.model = ''
    this.inputTokens = 0
    this.outputTokens = 0
  }
}
