import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 模型候选列表的组装：端点自述字段 → 目录富化 → 用户能力覆盖，
 * 拉不通时退回兜底清单。设置页与引导向导共用这条链，所以在这里钉住。
 */
vi.mock('@/services/electronAPI', () => ({
  api: { httpFetch: vi.fn() },
}))

vi.mock('../modelCatalogStore', () => ({
  loadModelCatalog: vi.fn().mockResolvedValue({}),
}))

import { api } from '@/services/electronAPI'
import { FALLBACK_MODELS, applyCapabilityOverride, applyCapabilityOverrides, enrichRawModels, loadProviderModels } from '../providerModels'
import type { EnrichedModel } from '../modelCatalog'
import type { ProviderEndpoint } from '../providerConnection'

const ENDPOINT: ProviderEndpoint = {
  target: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-test'
}

function okResponse(data: unknown) {
  vi.mocked(api.httpFetch).mockResolvedValue({ ok: true, status: 200, data: JSON.stringify(data) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enrichRawModels', () => {
  it('端点自述的上下文与识图字段优先于目录', () => {
    const models = enrichRawModels(
      [{ id: 'glm-4.6', name: 'GLM-4.6', context_length: 200_000, input_modalities: ['text', 'image'] }],
      ENDPOINT.baseUrl,
      {}
    )

    expect(models).toEqual([{ id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200_000, supportsImages: true }])
  })

  it('目录没命中时仍给出可用的 name', () => {
    const models = enrichRawModels([{ id: 'x1' }], ENDPOINT.baseUrl, {})
    expect(models[0]).toMatchObject({ id: 'x1', name: 'x1' })
  })
})

describe('applyCapabilityOverride(s)', () => {
  const model: EnrichedModel = { id: 'm', name: 'M', contextWindow: 1000, supportsImages: false }

  it('用户覆盖的字段胜出，未覆盖的保持原样', () => {
    const patched = applyCapabilityOverride(model, { m: { contextWindow: 8000 } })
    expect(patched.contextWindow).toBe(8000)
    expect(patched.supportsImages).toBe(false)
  })

  it('没有任何覆盖时原数组直接返回，不做无谓拷贝', () => {
    const list = [model]
    expect(applyCapabilityOverrides(list, {})).toBe(list)
  })

  it('列表里只改命中的那一项', () => {
    const other: EnrichedModel = { id: 'other', name: 'Other', contextWindow: 2000 }
    const result = applyCapabilityOverrides([model, other], { m: { supportsImages: true } })

    expect(result[0].supportsImages).toBe(true)
    expect(result[1]).toBe(other)
  })
})

describe('loadProviderModels', () => {
  it('端点返回时给出 fromEndpoint 与富化后的列表', async () => {
    okResponse({ data: [{ id: 'claude-x', context_length: 90_000 }] })

    const result = await loadProviderModels(ENDPOINT)

    expect(result.fromEndpoint).toBe(true)
    expect(result.models).toEqual([{ id: 'claude-x', name: 'claude-x', contextWindow: 90_000 }])
  })

  it('拉不通时退回该接入方式的兜底清单，并带上失败原因', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue({ ok: false, status: 401, data: '', error: 'Unauthorized' })

    const result = await loadProviderModels(ENDPOINT)

    expect(result.fromEndpoint).toBe(false)
    expect(result.reason).toBe('http')
    expect(result.models.map(m => m.id)).toEqual(FALLBACK_MODELS.anthropic.map(m => m.id))
  })

  it('兜底清单也吃用户覆盖', async () => {
    vi.mocked(api.httpFetch).mockResolvedValue(null)
    const firstId = FALLBACK_MODELS.anthropic[0].id

    const result = await loadProviderModels(ENDPOINT, { [firstId]: { contextWindow: 1_000_000 } })

    expect(result.models[0].contextWindow).toBe(1_000_000)
  })

  it('每个接入方式都有兜底候选，OAuth 方式也不例外', () => {
    for (const target of ['anthropic', 'openai', 'gemini'] as const) {
      expect(FALLBACK_MODELS[target].length).toBeGreaterThan(0)
    }
  })
})
