export function anthropicToOpenAIRequest(body: Record<string, any>): Record<string, any> {
  const messages: Array<{ role: string; content: string }> = []

  if (body.system) {
    const systemContent = typeof body.system === 'string'
      ? body.system
      : extractTextFromContent(body.system)
    messages.push({ role: 'system', content: systemContent })
  }

  if (body.messages) {
    for (const msg of body.messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : extractTextFromContent(msg.content)
      messages.push({ role: msg.role, content })
    }
  }

  const result: Record<string, any> = {
    model: body.model,
    messages,
    stream: body.stream || false,
  }

  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens
  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p
  if (body.stop_sequences) result.stop = body.stop_sequences

  return result
}

export function openAIToAnthropicResponse(body: Record<string, any>): Record<string, any> {
  const choice = body.choices?.[0]
  const content = choice?.message?.content || ''

  return {
    id: body.id?.replace('chatcmpl-', 'msg_') || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: body.model || '',
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: body.usage?.prompt_tokens || 0,
      output_tokens: body.usage?.completion_tokens || 0,
    },
  }
}

function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join('')
  }
  return String(content)
}

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'tool_calls': return 'tool_use'
    default: return 'end_turn'
  }
}
