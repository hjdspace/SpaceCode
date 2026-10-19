import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 服务商连通性探测。引导向导的「测试连接」和 ModelSettings 的取模型走同一套地址归一化
 * 与响应解析，所以这套判断收在一个模块里，避免第三份手抄实现。
 */
vi.mock('@/services/electronAPI', () => ({
  api: {
    httpFetch: vi.fn(),
  },
}))

import { api } from '@/services/electronAPI'
import {
  OAUTH_METHODS,
  defaultBaseUrlOf,
  probeEndpoint,
  resolveEndpoint
} from '../providerConnection'
import type { ProviderConfig } from '@/stores/settings'

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    baseUrl: '',
    apiKey: '',
    haikuModel: '',
    sonnetModel: '',
    opusModel: '',
    ...overrides
  }
}

const CONFIGS = {
  anthropic: config({ baseUrl: 'https://open.zhipuai.cn/anthropic', apiKey: 'sk-ant-test' }),
  openai: config({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-openai-test' }),
  gemini: config({ apiKey: 'AIza-test' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveEndpoint', () => {
  it('OAuth 两种方式没有可在应用内探测的凭据', () => {
    for (const method of OAUTH_METHODS) {
      expect(resolveEndpoint(method, CONFIGS)).toBeNull()
    }
  })

  it('按接入方式取对应那份配置', () => {
    expect(resolveEndpoint('anthropic_compatible', CONFIGS)?.apiKey).toBe('sk-ant-test')
    expect(resolveEndpoint('openai_compatible', CONFIGS)?.apiKey).toBe('sk-openai-test')
    expect(resolveEndpoint('gemini_api', CONFIGS)?.apiKey).toBe('AIza-test')
  })

  it('地址留空时退回各家官方端点', () => {
    expect(resolveEndpoint('gemini_api', CONFIGS)?.baseUrl).toBe(defaultBaseUrlOf('gemini_api'))
    expect(resolveEndpoint('anthropic_compatible', { ...CONFIGS, anthropic: config() })?.baseUrl)
      .toBe(defaultBaseUrlOf('anthropic_compatible'))
  })
})

describe('probeEndpoint', () => {
  it('没填 Key 直接判缺，不发请求', async () => {
    const outcome = await probeEndpoint({ target: 'anthropic', baseUrl: 'https://x.test', apiKey: '' })

    expect(outcome).toEqual({ status: 'failed', reason: 'no-key' })
    expect(api.httpFetch).not.toHaveBeenCalled()
  })

  it('anthropic 地址缺 /v1 时补上再打 /models', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue({ ok: true, status: 200, data: '[]' })

    await probeEndpoint({ target: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k' })

    expect(api.httpFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('本地代理不可用与 HTTP 非 2xx 分开报', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue(null)
    expect(await probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' }))
      .toEqual({ status: 'failed', reason: 'proxy' })

    vi.mocked(api.httpFetch).mockResolvedValue({ ok: false, status: 401, data: '', error: 'Unauthorized' })
    const denied = await probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' })
    expect(denied).toEqual({ status: 'failed', reason: 'http', httpStatus: 401 })
  })

  it('请求抛错按网络故障收口，不把异常漏给调用方', async () => {
    vi.mocked(api.httpFetch).mockRejectedValue(new Error('boom'))

    await expect(probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' }))
      .resolves.toEqual({ status: 'failed', reason: 'network' })
  })

  it('响应体不是 JSON 时也按网络故障收口', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue({ ok: true, status: 200, data: '<html>502</html>' })

    await expect(probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' }))
      .resolves.toEqual({ status: 'failed', reason: 'network' })
  })

  it('兼容裸数组 / data 字段 / models 字段三种列表形状', async () => {
    const shapes = [
      JSON.stringify([{ id: 'a' }, { id: 'b' }]),
      JSON.stringify({ data: [{ id: 'c' }] }),
      JSON.stringify({ models: [{ name: 'd' }] })
    ]

    const ids: string[] = []
    for (const data of shapes) {
      vi.mocked(api.httpFetch).mockResolvedValue({ ok: true, status: 200, data })
      const outcome = await probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' })
      expect(outcome.status).toBe('ok')
      if (outcome.status === 'ok') ids.push(...outcome.models.map(m => m.id))
    }

    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })

  it('端点自述的能力字段原样带出，供目录富化', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue({
      ok: true, status: 200, data: '[{"id":"m1","context_length":200000,"input_modalities":["text","image"]}]'
    })

    const outcome = await probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.models[0]).toMatchObject({ id: 'm1', context_length: 200000 })
    }
  })

  it('列表项可能是纯字符串', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue({ ok: true, status: 200, data: '["gpt-x"]' })

    const outcome = await probeEndpoint({ target: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k' })

    expect(outcome).toEqual({ status: 'ok', models: [{ id: 'gpt-x', name: 'gpt-x' }] })
  })
})
