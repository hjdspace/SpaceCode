/**
 * LLM Service - Lightweight wrapper for direct LLM API calls
 *
 * Used for non-Agent features like commit message generation.
 * The main chat Agent now uses ClaudeCodeProcessManager instead.
 */

import { ref } from 'vue'
import { errorHandler } from '@/services/errorHandler'
import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'

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
      const settings = useSettingsStore()
      const cfg = settings.config
      if (cfg.apiKey) {
        currentConfig = {
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
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

function buildApiUrl(baseUrl: string | undefined, defaultBase: string, endpoint: string): string {
  if (!baseUrl) {
    return `${defaultBase}${endpoint}`
  }
  // Normalize baseUrl: remove trailing slash
  const normalized = baseUrl.replace(/\/$/, '')
  // If baseUrl already ends with the endpoint path, use it as-is
  if (normalized.endsWith(endpoint)) {
    return normalized
  }
  // If baseUrl ends with /v1, append the rest of the endpoint
  if (normalized.endsWith('/v1')) {
    return `${normalized}${endpoint.replace('/v1', '')}`
  }
  // Otherwise, append the full endpoint
  return `${normalized}${endpoint}`
}

export async function sendMessage(
  messages: Array<{ role: string; content: string }>,
  options?: { maxTokens?: number; system?: string; timeoutMs?: number },
): Promise<string> {
  if (!currentConfig?.apiKey) {
    throw new Error('LLM not configured')
  }

  const { provider, apiKey, baseUrl, model } = currentConfig
  console.log('[LLM] sendMessage called:', { provider, baseUrl, model, hasApiKey: !!apiKey })

  const fetchOptions = { timeoutMs: options?.timeoutMs ?? 120000 }

  // Simple implementation for commit message generation and other non-Agent tasks
  // This is NOT used for the main chat Agent (which uses ClaudeCodeProcessManager)
  if (provider === 'anthropic' || provider === 'anthropic_compatible') {
    const url = buildApiUrl(baseUrl, 'https://api.anthropic.com', '/v1/messages')
    console.log('[LLM] Anthropic URL:', url)
    const response = await api.httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-sonnet-20240229',
        max_tokens: options?.maxTokens || 1024,
        ...(options?.system ? { system: options.system } : {}),
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      }),
      ...fetchOptions,
    })

    if (!response || !response.ok) {
      const text = response?.error || response?.data || ''
      console.log('[LLM] Anthropic API error response:', text.slice(0, 500))
      const classified = errorHandler.handleError(
        new Error(`API error: ${response?.status ?? 'unknown'} - ${text.slice(0, 200)}`),
        { provider, baseUrl, phase: 'send' }
      )
      throw new Error(classified.message)
    }

    const responseText = response.data
    console.log('[LLM] Anthropic raw response:', responseText.slice(0, 500))
    let data
    try {
      data = JSON.parse(responseText)
    } catch (e: any) {
      throw new Error(`Invalid JSON response from API. Please check your Base URL setting. Error: ${e.message}`)
    }
    return data.content?.[0]?.text || ''
  }

  // OpenAI-compatible fallback
  const url = buildApiUrl(baseUrl, 'https://api.openai.com', '/v1/chat/completions')
  console.log('[LLM] OpenAI URL:', url)
  const response = await api.httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4',
      max_tokens: options?.maxTokens || 1024,
      messages: [
        ...(options?.system ? [{ role: 'system', content: options.system }] : []),
        ...messages,
      ],
    }),
    ...fetchOptions,
  })

  if (!response || !response.ok) {
    const text = response?.error || response?.data || ''
    console.log('[LLM] OpenAI API error response:', text.slice(0, 500))
    const classified = errorHandler.handleError(
      new Error(`API error: ${response?.status ?? 'unknown'} - ${text.slice(0, 200)}`),
      { provider, baseUrl, phase: 'send' }
    )
    throw new Error(classified.message)
  }

  const responseText = response.data
  console.log('[LLM] OpenAI raw response:', responseText.slice(0, 500))
  let data
  try {
    data = JSON.parse(responseText)
  } catch (e: any) {
    throw new Error(`Invalid JSON response from API. Please check your Base URL setting. Error: ${e.message}`)
  }
  return data.choices?.[0]?.message?.content || ''
}
