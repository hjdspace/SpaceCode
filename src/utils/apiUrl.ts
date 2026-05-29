export function normalizeApiUrl(baseUrl: string, provider: string): string {
  let url = baseUrl.replace(/\/+$/, '')

  if (provider === 'anthropic' && !url.includes('/v1')) {
    url += '/v1'
  } else if (provider === 'openai' && !url.includes('/v1')) {
    url += '/v1'
  }

  return url
}
