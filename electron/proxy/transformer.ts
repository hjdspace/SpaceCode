import { ModelMappingConfig } from './types'
import { mapModel } from './modelMapper'

export function anthropicToOpenAIRequest(
  body: Record<string, any>,
  mapping?: ModelMappingConfig
): Record<string, any> {
  const messages: Record<string, any>[] = []

  if (body.system) {
    const systemContent =
      typeof body.system === 'string'
        ? body.system
        : convertAnthropicContentToString(body.system)
    messages.push({ role: 'system', content: systemContent })
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      const converted = convertAnthropicMessage(msg)
      if (Array.isArray(converted)) {
        messages.push(...converted)
      } else {
        messages.push(converted)
      }
    }
  }

  const result: Record<string, any> = {
    model: mapModel(body.model || '', mapping),
    messages,
  }

  if (body.max_tokens !== undefined) {
    result.max_tokens = body.max_tokens
  }

  if (body.temperature !== undefined) {
    result.temperature = body.temperature
  }

  if (body.top_p !== undefined) {
    result.top_p = body.top_p
  }

  if (body.stream !== undefined) {
    result.stream = body.stream
  }

  if (body.stop_sequences !== undefined) {
    result.stop = body.stop_sequences
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    result.tools = body.tools.map((tool: Record<string, any>) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }))
  }

  if (body.tool_choice) {
    result.tool_choice = convertToolChoiceToOpenAI(body.tool_choice)
  }

  return result
}

function convertAnthropicContentToString(
  content: any[]
): string {
  return content
    .filter((block: Record<string, any>) => block.type === 'text')
    .map((block: Record<string, any>) => block.text)
    .join('\n')
}

function convertAnthropicMessage(
  msg: Record<string, any>
): Record<string, any> | Record<string, any>[] {
  if (msg.role === 'user') {
    return convertUserMessage(msg)
  }

  if (msg.role === 'assistant') {
    return convertAssistantMessage(msg)
  }

  return { role: msg.role, content: stringifyContent(msg.content) }
}

function convertUserMessage(
  msg: Record<string, any>
): Record<string, any> {
  if (typeof msg.content === 'string') {
    return { role: 'user', content: msg.content }
  }

  if (!Array.isArray(msg.content)) {
    return { role: 'user', content: String(msg.content ?? '') }
  }

  const hasToolResult = msg.content.some(
    (block: Record<string, any>) => block.type === 'tool_result'
  )

  if (hasToolResult) {
    const results: Record<string, any>[] = []
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        results.push({
          role: 'tool',
          tool_call_id: `call_${block.tool_use_id}`,
          content:
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .filter((b: Record<string, any>) => b.type === 'text')
                    .map((b: Record<string, any>) => b.text)
                    .join('\n')
                : String(block.content ?? ''),
        })
      }
    }
    if (results.length === 1) {
      return results[0]
    }
    return results[0] || { role: 'user', content: '' }
  }

  const parts: Record<string, any>[] = []
  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image' && block.source) {
      if (block.source.type === 'base64') {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        })
      } else if (block.source.type === 'url') {
        parts.push({
          type: 'image_url',
          image_url: { url: block.source.url },
        })
      }
    }
  }

  if (parts.length === 1 && parts[0].type === 'text') {
    return { role: 'user', content: parts[0].text }
  }

  return { role: 'user', content: parts }
}

function convertAssistantMessage(
  msg: Record<string, any>
): Record<string, any> {
  if (typeof msg.content === 'string') {
    return { role: 'assistant', content: msg.content }
  }

  if (!Array.isArray(msg.content)) {
    return { role: 'assistant', content: String(msg.content ?? '') }
  }

  const textParts: string[] = []
  const toolCalls: Record<string, any>[] = []

  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: `call_${block.id}`,
        type: 'function',
        function: {
          name: block.name,
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input),
        },
      })
    }
  }

  const result: Record<string, any> = {
    role: 'assistant',
    content: textParts.join('') || null,
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls
  }

  return result
}

function convertToolChoiceToOpenAI(
  toolChoice: Record<string, any> | string
): Record<string, any> | string {
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'any') return 'required'
    return toolChoice
  }

  if (toolChoice.type === 'auto') return 'auto'
  if (toolChoice.type === 'any') return 'required'
  if (toolChoice.type === 'none') return 'none'
  if (toolChoice.type === 'tool') {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    }
  }

  return 'auto'
}

function stringifyContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, any>) => b.type === 'text')
      .map((b: Record<string, any>) => b.text)
      .join('\n')
  }
  return String(content ?? '')
}

export function openAIToAnthropicResponse(
  openaiResp: Record<string, any>,
  originalModel: string
): Record<string, any> {
  const choice = openaiResp.choices?.[0]
  if (!choice) {
    return {
      id: openaiResp.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: originalModel,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    }
  }

  const content: Record<string, any>[] = []

  if (choice.message?.content) {
    content.push({ type: 'text', text: choice.message.content })
  }

  if (Array.isArray(choice.message?.tool_calls)) {
    for (const tc of choice.message.tool_calls) {
      let input: any
      try {
        input = JSON.parse(tc.function?.arguments || '{}')
      } catch {
        input = {}
      }

      const toolId = tc.id?.startsWith('call_')
        ? tc.id.slice(5)
        : tc.id || `toolu_${Date.now()}`

      content.push({
        type: 'tool_use',
        id: toolId,
        name: tc.function?.name || '',
        input,
      })
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  const stopReason = convertFinishReason(choice.finish_reason)

  const usage = openaiResp.usage || {}

  return {
    id: openaiResp.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: originalModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
  }
}

function convertFinishReason(reason: string | undefined): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}
