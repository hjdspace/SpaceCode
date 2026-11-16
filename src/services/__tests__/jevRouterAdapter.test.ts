import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouterConfig } from '@/types/workRouting'

const mocks = vi.hoisted(() => ({
  httpFetch: vi.fn(),
  routerConfig: {
    enabled: true,
    modelSource: 'jev',
    jevEndpoint: 'https://jev.test/v1/choice',
    jevApiKey: 'sk-jev',
    jevModel: 'jev-1',
  } as RouterConfig,
  config: {
    provider: 'anthropic',
    apiKey: 'sk-test',
    baseUrl: undefined as string | undefined,
    model: 'claude-sonnet-4-5',
  },
  haikuModel: 'claude-haiku-4-5' as string | undefined,
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    httpFetch: mocks.httpFetch,
  },
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    routerConfig: mocks.routerConfig,
    config: mocks.config,
    getHaikuModel: () => mocks.haikuModel,
  }),
}))

import { createJevRouterAdapter, RouterUnavailableError } from '@/services/assistantRouter'
import type { RoutingCandidate } from '@/types/workRouting'

const CANDIDATES: RoutingCandidate[] = [
  { name: 'ppt-creator', description: '制作可编辑的 PPTX 演示文稿', skillDescriptions: ['PPTX 排版', '模板套用'] },
  { name: 'html-ppt-creator', description: '生成 HTML 幻灯片', skillDescriptions: ['HTML 动画'] },
  { name: 'docx-writer', description: '撰写 Word 文档' },
]

function jevResponse(choice: string, probabilities: Record<string, number>, modelId = 'jev-1'): string {
  return JSON.stringify({ choice, probabilities, modelId })
}

function okResponse(data: string) {
  return { ok: true as const, status: 200, data, error: undefined }
}

function errorResponse(status: number, error: string) {
  return { ok: false as const, status, data: '', error }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.routerConfig = {
    enabled: true,
    modelSource: 'jev',
    jevEndpoint: 'https://jev.test/v1/choice',
    jevApiKey: 'sk-jev',
    jevModel: 'jev-1',
  }
})

describe('createJevRouterAdapter', () => {
  it('sends a Choice request with candidates + none option and returns a routing decision', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', {
        'ppt-creator': 0.92,
        'html-ppt-creator': 0.05,
        'docx-writer': 0.03,
      })),
    )

    const adapter = createJevRouterAdapter()
    const result = await adapter.decide({
      message: '帮我做个可编辑的 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })

    expect(result.none).toBe(false)
    expect(result.ranked).toEqual([
      { name: 'ppt-creator', score: 0.92, reason: '' },
      { name: 'html-ppt-creator', score: 0.05, reason: '' },
      { name: 'docx-writer', score: 0.03, reason: '' },
    ])

    // Verify the request shape: POST to jevEndpoint with Bearer auth
    expect(mocks.httpFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.httpFetch.mock.calls[0]
    expect(url).toBe('https://jev.test/v1/choice')
    expect(options.method).toBe('POST')
    expect(options.headers['Authorization']).toBe('Bearer sk-jev')
    expect(options.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(options.body)
    // state contains the user message and candidate descriptions
    expect(body.state.request).toBe('帮我做个可编辑的 PPT')
    expect(body.state.candidates).toHaveLength(3)
    expect(body.state.candidates[0]).toEqual({
      name: 'ppt-creator',
      description: '制作可编辑的 PPTX 演示文稿',
      skillDescriptions: ['PPTX 排版', '模板套用'],
    })
    // options = candidate names + "none"
    expect(body.options).toEqual(['ppt-creator', 'html-ppt-creator', 'docx-writer', 'none'])
    // model version is sent
    expect(body.model).toBe('jev-1')
  })

  it('maps probability distribution to score in descending order, capped at 3', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', {
        'ppt-creator': 0.5,
        'html-ppt-creator': 0.3,
        'docx-writer': 0.2,
      })),
    )

    const adapter = createJevRouterAdapter()
    const result = await adapter.decide({
      message: '做个文档',
      candidates: CANDIDATES,
      isZh: true,
    })

    expect(result.ranked.map(r => r.name)).toEqual(['ppt-creator', 'html-ppt-creator', 'docx-writer'])
    expect(result.ranked.map(r => r.score)).toEqual([0.5, 0.3, 0.2])
  })

  it('maps choice="none" to RoutingDecision.none', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('none', {
        'ppt-creator': 0.1,
        'html-ppt-creator': 0.1,
        'docx-writer': 0.1,
        'none': 0.7,
      })),
    )

    const adapter = createJevRouterAdapter()
    const result = await adapter.decide({
      message: '你好',
      candidates: CANDIDATES,
      isZh: true,
    })

    expect(result.none).toBe(true)
    expect(result.ranked).toEqual([])
  })

  it('drops probabilities for unknown candidate names', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', {
        'ppt-creator': 0.8,
        'unknown-agent': 0.15,
        'none': 0.05,
      })),
    )

    const adapter = createJevRouterAdapter()
    const result = await adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })

    expect(result.ranked.map(r => r.name)).toEqual(['ppt-creator'])
    expect(result.ranked[0].score).toBe(0.8)
  })

  it('clamps probabilities to [0,1]', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', {
        'ppt-creator': 1.5,
        'docx-writer': -0.2,
      })),
    )

    const adapter = createJevRouterAdapter()
    const result = await adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })

    expect(result.ranked[0].score).toBe(1)
    expect(result.ranked[1].score).toBe(0)
  })

  it('throws RouterUnavailableError when no endpoint or key is configured', async () => {
    mocks.routerConfig = { enabled: true, modelSource: 'jev' }

    const adapter = createJevRouterAdapter()
    await expect(adapter.decide({
      message: 'hi',
      candidates: CANDIDATES,
      isZh: true,
    })).rejects.toBeInstanceOf(RouterUnavailableError)

    expect(mocks.httpFetch).not.toHaveBeenCalled()
  })

  it('throws RouterUnavailableError when key is missing', async () => {
    mocks.routerConfig = {
      enabled: true,
      modelSource: 'jev',
      jevEndpoint: 'https://jev.test/v1/choice',
    }

    const adapter = createJevRouterAdapter()
    await expect(adapter.decide({
      message: 'hi',
      candidates: CANDIDATES,
      isZh: true,
    })).rejects.toBeInstanceOf(RouterUnavailableError)
  })

  it('throws on HTTP error response', async () => {
    mocks.httpFetch.mockResolvedValueOnce(errorResponse(500, 'Internal server error'))

    const adapter = createJevRouterAdapter()
    await expect(adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })).rejects.toThrow()
  })

  it('throws on non-JSON response', async () => {
    mocks.httpFetch.mockResolvedValueOnce(okResponse('not json'))

    const adapter = createJevRouterAdapter()
    await expect(adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })).rejects.toThrow()
  })

  it('throws on response missing choice field', async () => {
    mocks.httpFetch.mockResolvedValueOnce(okResponse(JSON.stringify({
      probabilities: { 'ppt-creator': 0.9 },
      modelId: 'jev-1',
    })))

    const adapter = createJevRouterAdapter()
    await expect(adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })).rejects.toThrow()
  })

  it('throws on response missing probabilities', async () => {
    mocks.httpFetch.mockResolvedValueOnce(okResponse(JSON.stringify({
      choice: 'ppt-creator',
      modelId: 'jev-1',
    })))

    const adapter = createJevRouterAdapter()
    await expect(adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })).rejects.toThrow()
  })

  it('sends model in request body only when configured', async () => {
    mocks.routerConfig = {
      enabled: true,
      modelSource: 'jev',
      jevEndpoint: 'https://jev.test/v1/choice',
      jevApiKey: 'sk-jev',
    }

    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', { 'ppt-creator': 0.9 })),
    )

    const adapter = createJevRouterAdapter()
    await adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
    })

    const body = JSON.parse(mocks.httpFetch.mock.calls[0][1].body)
    expect(body.model).toBeUndefined()
  })

  it('passes AbortSignal to httpFetch as timeoutMs', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', { 'ppt-creator': 0.9 })),
    )

    const controller = new AbortController()
    const adapter = createJevRouterAdapter()
    await adapter.decide({
      message: '做个 PPT',
      candidates: CANDIDATES,
      isZh: true,
      signal: controller.signal,
    })

    const options = mocks.httpFetch.mock.calls[0][1]
    // Jev adapter uses the routing timeout (8s) consistent with LLM adapter
    expect(options.timeoutMs).toBe(8_000)
  })

  it('includes routingHints in candidate state when present', async () => {
    mocks.httpFetch.mockResolvedValueOnce(
      okResponse(jevResponse('ppt-creator', { 'ppt-creator': 0.9 })),
    )

    const candidatesWithHints: RoutingCandidate[] = [
      { name: 'ppt-creator', description: 'Editable PPTX', routingHints: 'format: pptx, editable' },
    ]

    const adapter = createJevRouterAdapter()
    await adapter.decide({
      message: '做个 PPT',
      candidates: candidatesWithHints,
      isZh: false,
    })

    const body = JSON.parse(mocks.httpFetch.mock.calls[0][1].body)
    expect(body.state.candidates[0].routingHints).toBe('format: pptx, editable')
  })
})
