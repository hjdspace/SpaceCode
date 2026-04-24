/**
 * LLM Service - Lightweight wrapper for direct LLM API calls
 *
 * Used for non-Agent features like commit message generation.
 * The main chat Agent now uses ClaudeCodeProcessManager instead.
 */

import { ref } from 'vue'

export interface LLMConfig {
  provider: string
  apiKey: string
  baseUrl?: string
  model?: string
}

export const llmState = {
  provider: ref<string>(''),
  isConfigured: ref<boolean>(false),
}

let currentConfig: LLMConfig | null = null

export async function initLLMService(config?: LLMConfig): Promise<void> {
  if (config) {
    currentConfig = config
    llmState.provider.value = config.provider
    llmState.isConfigured.value = !!config.apiKey
  } else {
    // Try to load from settings
    try {
      const { useSettingsStore } = await import('@/stores/settings')
      const settings = useSettingsStore()
      const cfg = settings.config
      if (cfg.apiKey) {
        currentConfig = {
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.apiUrl,
          model: cfg.model,
        }
        llmState.provider.value = cfg.provider
        llmState.isConfigured.value = true
      }
    } catch (e) {
      console.warn('[LLM] Failed to load config from settings:', e)
    }
  }
}

export function updateConfig(config: LLMConfig): void {
  currentConfig = config
  llmState.provider.value = config.provider
  llmState.isConfigured.value = !!config.apiKey
}

export function isLLMConfigured(): boolean {
  return !!currentConfig?.apiKey
}

export async function sendMessage(messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!currentConfig?.apiKey) {
    throw new Error('LLM not configured')
  }

  const { provider, apiKey, baseUrl, model } = currentConfig

  // Simple implementation for commit message generation and other non-Agent tasks
  // This is NOT used for the main chat Agent (which uses ClaudeCodeProcessManager)
  if (provider === 'anthropic' || provider === 'anthropic_compatible') {
    const response = await fetch(baseUrl || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data.content?.[0]?.text || ''
  }

  // OpenAI-compatible fallback
  const response = await fetch(baseUrl || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4',
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}
