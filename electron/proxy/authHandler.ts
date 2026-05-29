import { ProxyConfig } from './types'

export interface UpstreamRequestOptions {
  url: string
  headers: Record<string, string>
}

export function buildUpstreamRequest(
  path: string,
  body: Record<string, any>,
  config: ProxyConfig
): UpstreamRequestOptions {
  const baseUrl = config.upstreamBaseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'SpaceCode-Proxy/1.0',
  }

  switch (config.upstreamProvider) {
    case 'openai':
    case 'openai_compatible': {
      const targetUrl = `${baseUrl}/v1/chat/completions`
      headers['Authorization'] = `Bearer ${config.upstreamApiKey}`
      return { url: targetUrl, headers }
    }
    case 'anthropic': {
      const targetUrl = `${baseUrl}/v1/messages`
      headers['x-api-key'] = config.upstreamApiKey
      headers['anthropic-version'] = '2023-06-01'
      return { url: targetUrl, headers }
    }
    default: {
      const targetUrl = `${baseUrl}${path}`
      headers['Authorization'] = `Bearer ${config.upstreamApiKey}`
      return { url: targetUrl, headers }
    }
  }
}
