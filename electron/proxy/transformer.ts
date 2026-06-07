/**
 * Rough input-token estimate (~chars/4) over the full Anthropic request body:
 * system prompt, messages, and tool definitions. Used to seed message_start's
 * input_tokens for OpenAI-compatible streams, which only report real usage in a
 * trailing chunk (after message_start is already emitted). Approximate but enough
 * to keep the context-usage indicator from sitting at 0 until the real value
 * (if any) arrives via message_delta.
 */
export function estimateInputTokens(body: Record<string, any>): number {
  let chars = 0

  if (body.system) {
    chars += typeof body.system === 'string'
      ? body.system.length
      : JSON.stringify(body.system).length
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      chars += typeof msg.content === 'string'
        ? msg.content.length
        : JSON.stringify(msg.content ?? '').length
    }
  }
  if (Array.isArray(body.tools)) {
    chars += JSON.stringify(body.tools).length
  }

  return Math.ceil(chars / 4)
}

export function anthropicToOpenAIRequest(body: Record<string, any>): Record<string, any> {
  const messages: Array<Record<string, any>> = []

  if (body.system) {
    const systemContent = typeof body.system === 'string'
      ? body.system
      : extractTextFromContent(body.system)
    if (systemContent) messages.push({ role: 'system', content: systemContent })
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      convertMessage(msg, messages)
    }
  }

  const result: Record<string, any> = {
    model: body.model,
    messages,
    stream: body.stream || false,
    // Request usage data in streaming responses. Without this, OpenAI-compatible
    // endpoints omit the usage field from SSE chunks, causing token counts to
    // always show as 0 in the UI.
    stream_options: { include_usage: true },
  }

  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens
  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p
  if (body.stop_sequences) result.stop = body.stop_sequences

  // 转发工具定义：Anthropic tool → OpenAI function。缺了这一步，模型会把工具
  // 调用当成纯文本（如 DeepSeek 的 <｜DSML｜tool_calls｜>）吐出来。
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const tools = body.tools
      .filter((t: any) => t && t.name)
      .map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || { type: 'object', properties: {} },
        },
      }))
    if (tools.length > 0) result.tools = tools
  }

  if (body.tool_choice) {
    result.tool_choice = mapToolChoice(body.tool_choice)
  }

  return result
}

/**
 * Convert one Anthropic message into one or more OpenAI messages.
 * - assistant tool_use blocks → assistant.tool_calls
 * - user tool_result blocks   → separate { role: 'tool', tool_call_id } messages
 */
function convertMessage(msg: any, out: Array<Record<string, any>>): void {
  const role = msg.role
  const content = msg.content

  if (typeof content === 'string') {
    out.push({ role, content })
    return
  }
  if (!Array.isArray(content)) {
    out.push({ role, content: content == null ? '' : String(content) })
    return
  }

  if (role === 'assistant') {
    let text = ''
    const toolCalls: Array<Record<string, any>> = []
    for (const block of content) {
      if (block.type === 'text') {
        text += block.text || ''
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
      }
    }
    const m: Record<string, any> = { role: 'assistant', content: text || null }
    if (toolCalls.length > 0) m.tool_calls = toolCalls
    out.push(m)
    return
  }

  // role === 'user'：可能混有 text / tool_result（image 暂只提取文本）
  const textParts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text || '')
    } else if (block.type === 'tool_result') {
      out.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: extractToolResultText(block.content),
      })
    }
  }
  if (textParts.length > 0) {
    out.push({ role: 'user', content: textParts.join('') })
  }
}

export function openAIToAnthropicResponse(body: Record<string, any>): Record<string, any> {
  const choice = body.choices?.[0]
  const message = choice?.message || {}

  const contentBlocks: Array<Record<string, any>> = []
  if (message.content) {
    contentBlocks.push({ type: 'text', text: message.content })
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let input: unknown = {}
      try {
        input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        input = {}
      }
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function?.name || '',
        input,
      })
    }
  }
  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '' })
  }

  return {
    id: body.id?.replace('chatcmpl-', 'msg_') || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    model: body.model || '',
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: body.usage?.prompt_tokens || 0,
      output_tokens: body.usage?.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: body.usage?.prompt_tokens_details?.cached_tokens || 0,
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

function extractToolResultText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text || '')
      .join('')
  }
  return content == null ? '' : String(content)
}

function mapToolChoice(toolChoice: any): any {
  if (typeof toolChoice === 'string') return toolChoice
  switch (toolChoice?.type) {
    case 'auto': return 'auto'
    case 'any': return 'required'
    case 'none': return 'none'
    case 'tool': return { type: 'function', function: { name: toolChoice.name } }
    default: return 'auto'
  }
}

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'tool_calls': return 'tool_use'
    default: return 'end_turn'
  }
}
