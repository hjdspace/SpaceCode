import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { ref } from 'vue'

// Simple system prompt since we're now using QueryEngine for most functionality
function buildSystemPrompt(): string {
  return `You are Claude Code, an AI assistant for software engineering tasks.`
}

type LLMProvider = 'openai' | 'anthropic' | 'gemini'

interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  baseUrl?: string
  model?: string
}

let openaiClient: OpenAI | null = null
let anthropicClient: Anthropic | null = null
let geminiApiKey: string | null = null
let geminiBaseUrl: string | null = null
let currentConfig: LLMConfig | null = null
const isConfigured = ref(false)
const provider = ref<LLMProvider | null>(null)

export const llmState = {
  isConfigured,
  provider
}

export async function initLLMService(settings?: Partial<LLMConfig>): Promise<void> {
  if (settings) {
    currentConfig = {
      provider: settings.provider || 'openai',
      apiKey: settings.apiKey || '',
      baseUrl: settings.baseUrl,
      model: settings.model
    }
  }

  // 1. 尝试从 localStorage 加载
  if (!currentConfig || !currentConfig.apiKey) {
    const saved = localStorage.getItem('llm_settings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        currentConfig = {
          provider: parsed.provider || 'openai',
          apiKey: parsed.apiKey || '',
          baseUrl: parsed.baseUrl,
          model: parsed.model
        }
        console.log('[LLM] Loaded config from localStorage:', { provider: currentConfig.provider, hasKey: !!currentConfig.apiKey, model: currentConfig.model })
      } catch (e) {
        console.error('[LLM] Failed to parse localStorage settings:', e)
      }
    }
  }

  // 2. 尝试从 .env 加载
  if (!currentConfig || !currentConfig.apiKey) {
    await loadFromEnv()
  }

  // 3. 初始化客户端
  if (!currentConfig || !currentConfig.apiKey) {
    console.warn('[LLM] No API configuration found')
    return
  }

  try {
    console.log('[LLM] Initializing with provider:', currentConfig.provider)

    if (currentConfig.provider === 'openai') {
      openaiClient = new OpenAI({
        apiKey: currentConfig.apiKey,
        baseURL: currentConfig.baseUrl || undefined,
        dangerouslyAllowBrowser: true
      })
      console.log('[LLM] OpenAI client initialized')
    }

    if (currentConfig.provider === 'anthropic') {
      anthropicClient = new Anthropic({
        apiKey: currentConfig.apiKey,
        baseURL: currentConfig.baseUrl || undefined
      })
      console.log('[LLM] Anthropic client initialized')
    }

    if (currentConfig.provider === 'gemini') {
      geminiApiKey = currentConfig.apiKey
      geminiBaseUrl = currentConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
      console.log('[LLM] Gemini client initialized')
    }

    // Update reactive state
    isConfigured.value = true
    provider.value = currentConfig.provider
  } catch (error) {
    console.error('[LLM] Failed to initialize LLM clients:', error)
    isConfigured.value = false
    provider.value = null
  }
}

async function loadFromEnv(): Promise<void> {
  try {
    const electronAPI = (window as any).electronAPI
    if (!electronAPI?.getEnv) {
      console.log('[LLM] electronAPI.getEnv not available')
      return
    }

    // 获取环境变量（getEnv 返回 Promise）
    const anthropicKey = await electronAPI.getEnv('ANTHROPIC_API_KEY')
    const openaiKey = await electronAPI.getEnv('OPENAI_API_KEY')
    const geminiKey = await electronAPI.getEnv('GEMINI_API_KEY')
    const apiKey = anthropicKey || openaiKey || geminiKey

    if (!apiKey) {
      console.log('[LLM] No API key found in env')
      return
    }

    const provider = (await electronAPI.getEnv('LLM_PROVIDER') || 'openai') as LLMProvider
    const openaiBaseUrl = await electronAPI.getEnv('OPENAI_BASE_URL')
    const anthropicBaseUrl = await electronAPI.getEnv('ANTHROPIC_BASE_URL')
    const geminiBaseUrl = await electronAPI.getEnv('GEMINI_BASE_URL')
    const model = await electronAPI.getEnv('OPENAI_MODEL')

    let baseUrl: string | undefined
    if (provider === 'openai') baseUrl = openaiBaseUrl || undefined
    else if (provider === 'anthropic') baseUrl = anthropicBaseUrl || undefined
    else if (provider === 'gemini') baseUrl = geminiBaseUrl || undefined

    currentConfig = {
      provider,
      apiKey,
      baseUrl,
      model: model || undefined
    }
    
    console.log('[LLM] Loaded config from env:', { provider, hasKey: !!apiKey, baseUrl: currentConfig.baseUrl })
  } catch (error) {
    console.error('[LLM] Failed to load from env:', error)
  }
}

export async function sendMessage(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk?: (text: string) => void
): Promise<string> {
  if (!currentConfig || !currentConfig.apiKey) {
    throw new Error('LLM not configured. Please set API key in Settings.')
  }

  // Add system prompt if not present
  const hasSystemMessage = messages.some(m => m.role === 'system')
  const messagesWithSystem = hasSystemMessage
    ? messages
    : [{ role: 'system' as const, content: buildSystemPrompt() }, ...messages]

  console.log('[LLM] Sending messages:', JSON.stringify(messagesWithSystem, null, 2))
  console.log('[LLM] Current config:', { provider: currentConfig.provider, model: currentConfig.model, baseUrl: currentConfig.baseUrl })

  if (currentConfig.provider === 'openai' && openaiClient) {
    return sendOpenAIMessage(openaiClient, messagesWithSystem, currentConfig.model || 'gpt-4', onChunk)
  } else if (currentConfig.provider === 'gemini' && geminiApiKey) {
    return sendGeminiMessage(messagesWithSystem, currentConfig.model || 'gemini-2.5-flash', onChunk)
  } else if (anthropicClient) {
    return sendAnthropicMessage(anthropicClient, messagesWithSystem, onChunk)
  }

  throw new Error('No LLM client available')
}

async function sendOpenAIMessage(
  client: OpenAI,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  model: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
    stream: true,
    temperature: 0.7
  })

  let fullContent = ''

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      fullContent += content
      onChunk?.(content)
    }
  }

  return fullContent
}

async function sendAnthropicMessage(
  client: Anthropic,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk?: (text: string) => void
): Promise<string> {
  const systemMessage = messages.find(m => m.role === 'system')
  const conversationMessages = messages.filter(m => m.role !== 'system')

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemMessage?.content,
    messages: conversationMessages as Anthropic.MessageParam[],
  })

  let fullContent = ''

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta') {
      const text = (chunk as any).delta?.text || ''
      if (text) {
        fullContent += text
        onChunk?.(text)
      }
    }
  }

  return fullContent
}

async function sendGeminiMessage(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  model: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const baseUrl = geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  const systemMessage = messages.find(m => m.role === 'system')
  const conversationMessages = messages.filter(m => m.role !== 'system')

  // Convert to Gemini format
  const contents = conversationMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  const body: any = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192
    }
  }

  if (systemMessage) {
    body.systemInstruction = {
      parts: [{ text: systemMessage.content }]
    }
  }

  // Use streaming endpoint
  const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${geminiApiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${response.status} ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue

        try {
          const data = JSON.parse(jsonStr)
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) {
            fullContent += text
            onChunk?.(text)
          }
        } catch (e) {
          // Skip unparseable lines
        }
      }
    }
  }

  return fullContent
}

export function isLLMConfigured(): boolean {
  return isConfigured.value
}

export function getProvider(): LLMProvider | null {
  return provider.value
}

export function updateConfig(settings: LLMConfig): void {
  currentConfig = settings
  openaiClient = null
  anthropicClient = null
  initLLMService(settings)
}
