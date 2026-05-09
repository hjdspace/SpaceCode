import { PROMPT_OPTIMIZER_SYSTEM_PROMPT } from './system-prompt.js'
import type { PromptOptimizerResult, OptimizePromptOptions } from './types.js'

export async function optimizePrompt(options: OptimizePromptOptions): Promise<PromptOptimizerResult> {
  const { prompt, maxTokens = 4096 } = options

  if (!prompt || prompt.trim().length === 0) {
    return {
      success: false,
      error: 'Prompt cannot be empty',
    }
  }

  try {
    const response = await callAnthropicAPI(prompt, PROMPT_OPTIMIZER_SYSTEM_PROMPT, maxTokens)
    return {
      success: true,
      optimizedPrompt: response,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

async function callAnthropicAPI(userPrompt: string, systemPrompt: string, maxTokens: number): Promise<string> {
  const { getApiKeyFromApiKeyHelper } = await import('../../utils/auth.js')
  const { getAnthropicClient } = await import('../../services/api/client.js')
  const { getDefaultSonnetModel } = await import('../../utils/model/model.js')

  const apiKey = await getApiKeyFromApiKeyHelper()
  if (!apiKey) {
    throw new Error('API key not configured')
  }

  const client = await getAnthropicClient({
    apiKey,
    maxRetries: 2,
    model: getDefaultSonnetModel(),
  })

  const response = await client.messages.create({
    model: getDefaultSonnetModel(),
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt.trim(),
      },
    ],
  })

  const textContent = response.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response received')
  }

  return textContent.text.trim()
}
