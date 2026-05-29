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

export class OpenAIToAnthropicStreamTransformer {
  private messageStarted = false
  private contentBlockStarted = false
  private finished = false
  private contentBlockIndex = 0
  private model = ''
  private messageId = ''

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
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }))
    }

    const choice = chunk.choices?.[0]
    if (!choice) return output

    if (choice.delta?.content) {
      if (!this.contentBlockStarted) {
        this.contentBlockStarted = true
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
    this.contentBlockStarted = false
    this.finished = false
    this.contentBlockIndex = 0
    this.model = ''
    this.messageId = ''
  }

  private emitClosingEvents(finishReason?: string): string[] {
    if (this.finished) return []
    this.finished = true

    const output: string[] = []

    if (this.contentBlockStarted) {
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
      usage: { output_tokens: 0 },
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
