// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { listImageModels } from '../imageGenModels'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function fakeFetch(result: Response) {
  return vi.fn().mockResolvedValue(result)
}

describe('listImageModels', () => {
  it('GET {baseUrl}/models，带 Bearer，解 data[].id', async () => {
    const fetchImpl = fakeFetch(response({ data: [{ id: 'gpt-image-1' }, { id: 'dall-e-3' }] }))

    const outcome = await listImageModels('https://api.test/v1/', 'secret', fetchImpl as unknown as typeof fetch)

    expect(outcome).toEqual({ success: true, models: ['gpt-image-1', 'dall-e-3'] })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
  })

  it('裸数组、models 包裹、只回 name 的网关都能解析', async () => {
    const outcome = await listImageModels(
      'https://api.test/v1',
      'k',
      fakeFetch(response({ models: [{ name: 'cogview-4' }, { id: 'cogview-4-flash', name: 'flash' }, 'seedream-4'] })) as unknown as typeof fetch,
    )

    expect(outcome).toEqual({ success: true, models: ['cogview-4', 'cogview-4-flash', 'seedream-4'] })
  })

  it('非 2xx 回报 http 与状态码，交给调用方给可读提示', async () => {
    const outcome = await listImageModels('https://api.test/v1', 'k', fakeFetch(response(null, 401)) as unknown as typeof fetch)

    expect(outcome).toEqual({ success: false, reason: 'http', status: 401 })
  })

  it('网络异常回报 network，不把异常抛给 IPC 层', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const outcome = await listImageModels('https://api.test/v1', 'k', fetchImpl as unknown as typeof fetch)

    expect(outcome).toEqual({ success: false, reason: 'network' })
  })
})
