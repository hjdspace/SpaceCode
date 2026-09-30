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
      chars += contentCharLength(msg.content)
    }
  }
  if (Array.isArray(body.tools)) {
    chars += JSON.stringify(body.tools).length
  }

  return Math.ceil(chars / 4)
}

/**
 * Anthropic 对一张 ≤1.15 百万像素的图片约计 1300 token，按本文件的 chars/4 口径
 * 折算成字符数。不能直接量 base64 字符串 —— 一张 25KB 的截图就有 ~34k 字符，
 * 会让上下文用量条凭空多报 8k+ token。
 */
const IMAGE_APPROX_CHARS = 1300 * 4

function contentCharLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0

  let chars = 0
  for (const block of content) {
    if (block?.type === 'image') chars += IMAGE_APPROX_CHARS
    else if (block?.type === 'tool_result') chars += contentCharLength(block.content)
    else chars += JSON.stringify(block ?? '').length
  }
  return chars
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

  // ── thinking / extended thinking → OpenAI-compatible chain-of-thought ──
  //
  // Anthropic sends `thinking: { type: 'enabled' | 'adaptive' | 'disabled' }`
  // to control extended thinking. OpenAI-compatible endpoints (DeepSeek, MiMo)
  // use different parameter names. We emit all known formats simultaneously;
  // each endpoint uses the one it recognizes and ignores the rest.
  //   Official DeepSeek API:  `thinking: { type: 'enabled' }`
  //   Self-hosted DeepSeek:   `enable_thinking: true`
  //   MiMo (Xiaomi):          `chat_template_kwargs: { enable_thinking: true }`
  const thinkingEnabled = body.thinking && (
    body.thinking.type === 'enabled' || body.thinking.type === 'adaptive'
  )
  if (thinkingEnabled) {
    result.thinking = { type: 'enabled' }
    result.enable_thinking = true
    result.chat_template_kwargs = { thinking: true, enable_thinking: true }
  }

  return result
}

/**
 * Convert one Anthropic message into one or more OpenAI messages.
 * - assistant tool_use blocks → assistant.tool_calls
 * - user tool_result blocks   → separate { role: 'tool', tool_call_id } messages
 * - user image blocks         → image_url parts on a multimodal user content array
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
    let reasoning = ''
    const toolCalls: Array<Record<string, any>> = []
    for (const block of content) {
      if (block.type === 'text') {
        text += block.text || ''
      } else if (block.type === 'thinking') {
        // Anthropic thinking blocks → OpenAI reasoning_content (sent back
        // to the API in subsequent requests). DeepSeek v4 thinking mode
        // requires this round-trip — see openaiStreamAdapter.ts thinking support.
        reasoning += block.thinking || block.text || ''
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
    if (reasoning) m.reasoning_content = reasoning
    if (toolCalls.length > 0) m.tool_calls = toolCalls
    out.push(m)
    return
  }

  // role === 'user'：可能混有 text / image / tool_result
  const textParts: string[] = []
  const imageParts: Array<Record<string, any>> = []
  const toolResultImageParts: Array<Record<string, any>> = []
  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text || '')
    } else if (block.type === 'image') {
      const part = toOpenAIImagePart(block)
      if (part) imageParts.push(part)
    } else if (block.type === 'tool_result') {
      out.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: extractToolResultText(block.content),
      })
      toolResultImageParts.push(...collectImageParts(block.content))
    }
  }

  if (textParts.length > 0 || imageParts.length > 0) {
    out.push(
      imageParts.length > 0
        ? {
            role: 'user',
            content: [
              ...(textParts.length > 0 ? [{ type: 'text', text: textParts.join('') }] : []),
              ...imageParts,
            ],
          }
        : { role: 'user', content: textParts.join('') },
    )
  }

  // 模型自己 Read 回来的图片藏在 tool_result 里，而 OpenAI 的 role:'tool' 只能带
  // 字符串 —— 只能另起一条 user 消息把图片补上，否则这条链上的图必然丢。
  // 放在所有 tool 消息之后，避免把 tool 消息插到 user 消息后面破坏配对顺序。
  if (toolResultImageParts.length > 0) {
    out.push({
      role: 'user',
      content: [
        { type: 'text', text: '[Image content attached from the tool results above]' },
        ...toolResultImageParts,
      ],
    })
  }
}

/**
 * Anthropic image block → OpenAI image_url part。
 *
 * base64 源拼成 data URL；url 源直接透传。其余（如 file source）返回 null。
 */
function toOpenAIImagePart(block: any): Record<string, any> | null {
  const source = block?.source
  if (!source) return null
  if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 0) {
    const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png'
    return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${source.data}` } }
  }
  if (source.type === 'url' && typeof source.url === 'string' && source.url.length > 0) {
    return { type: 'image_url', image_url: { url: source.url } }
  }
  return null
}

/** 从任意 content（block 数组）里收集可转换的 image_url part */
function collectImageParts(content: any): Array<Record<string, any>> {
  if (!Array.isArray(content)) return []
  const parts: Array<Record<string, any>> = []
  for (const block of content) {
    if (block?.type !== 'image') continue
    const part = toOpenAIImagePart(block)
    if (part) parts.push(part)
  }
  return parts
}

export function openAIToAnthropicResponse(body: Record<string, any>): Record<string, any> {
  const choice = body.choices?.[0]
  const message = choice?.message || {}

  const contentBlocks: Array<Record<string, any>> = []
  // OpenAI reasoning_content → Anthropic thinking block. DeepSeek and other
  // compatible providers put chain-of-thought in `message.reasoning_content`.
  // Without this mapping the thinking content is silently dropped and the
  // desktop UI never shows the model's reasoning process.
  if (message.reasoning_content) {
    contentBlocks.push({ type: 'thinking', thinking: message.reasoning_content })
  }
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
