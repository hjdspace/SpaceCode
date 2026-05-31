import { ProxyConfig } from './types'

export interface UpstreamRequestOptions {
  url: string
  headers: Record<string, string>
}

/**
 * Join a base URL with a versioned API path without duplicating the version
 * segment. OpenAI-compatible base URLs are conventionally configured WITH the
 * version (e.g. "https://token.sensenova.cn/v1"), so blindly appending
 * "/v1/chat/completions" would produce ".../v1/v1/chat/completions" → 404.
 */
function joinUpstreamUrl(baseUrl: string, versionedPath: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  // versionedPath is like "/v1/chat/completions" → version="/v1", rest="/chat/completions"
  const m = versionedPath.match(/^(\/v\d+[a-z]*)(\/.+)$/i)
  if (m && new RegExp(`${m[1]}$`, 'i').test(trimmed)) {
    return trimmed + m[2]
  }
  return trimmed + versionedPath
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
      const targetUrl = joinUpstreamUrl(baseUrl, '/v1/chat/completions')
      headers['Authorization'] = `Bearer ${config.upstreamApiKey}`
      return { url: targetUrl, headers }
    }
    case 'anthropic': {
      const targetUrl = joinUpstreamUrl(baseUrl, '/v1/messages')
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
