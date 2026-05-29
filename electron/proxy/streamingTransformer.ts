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
  }
}

const enum ContentBlockType {
  None,
  Text,
  ToolUse,
}

export class OpenAIToAnthropicStreamTransformer {
  private messageStarted = false
  private contentBlockType: ContentBlockType = ContentBlockType.None
  private finished = false
  private contentBlockIndex = 0
  private currentToolIndex = -1
  private model = ''
  private messageId = ''
  private inputTokens = 0
  private outputTokens = 0

  transform(event: { data: string }): string[] {
    if (event.data === '[DONE]') {
      if (!this.finished) {
        return this.emitClosingEvents()
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
      this.inputTokens = chunk.usage.prompt_tokens || 0
      this.outputTokens = chunk.usage.completion_tokens || 0
    }

    if (!this.messageStarted) {
      this.messageStarted = true
      this.model = chunk.model || ''
      this.messageId = chunk.id?.replace('chatcmpl-', 'msg_') || `msg_${Date.now()}`
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
          usage: { input_tokens: this.inputTokens, output_tokens: 0 },
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
      output.push(...this.emitClosingEvents(choice.finish_reason))
    }

    return output
  }

  finish(): string[] {
    if (!this.finished) {
      return this.emitClosingEvents()
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

    output.push(this.formatSSE('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: this.mapFinishReason(finishReason),
        stop_sequence: null,
      },
      usage: { output_tokens: this.outputTokens },
    }))

    output.push(this.formatSSE('message_stop', {
      type: 'message_stop',
    }))

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
