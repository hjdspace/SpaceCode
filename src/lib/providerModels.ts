import type { ModelCapabilityOverride } from '@/types/profile'
import type { Catalog, EnrichedModel, RawModel } from './modelCatalog'
import { enrichModels } from './modelCatalog'
import { loadModelCatalog } from './modelCatalogStore'
import { probeEndpoint, type ProbeFailure, type ProviderEndpoint } from './providerConnection'
import type { ProviderTarget } from './providerConnection'

/**
 * 端点没接通 / 还没填 Key 时给用户的兜底候选。
 * 设置页与引导向导共用这一份，避免两处各抄一遍模型名。
 */
export const FALLBACK_MODELS: Readonly<Record<ProviderTarget, ReadonlyArray<{ id: string; name: string }>>> = {
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4', name: 'GPT-4' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
  ],
  gemini: [
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    { id: 'gemini-pro', name: 'Gemini Pro' },
    { id: 'gemini-pro-vision', name: 'Gemini Pro Vision' }
  ]
}

/** 端点自述字段优先，其次 models.dev 目录 —— 两处调用都要这个顺序。 */
export function enrichRawModels(raw: RawModel[], baseUrl: string, catalog: Catalog): EnrichedModel[] {
  const rawById = new Map(raw.map(m => [m.id, m]))
  return enrichModels(raw, baseUrl, catalog, rawById)
}

/** 把用户对单个模型的能力覆盖（上下文窗口 / 识图）叠到富化结果上。 */
export function applyCapabilityOverride(
  model: EnrichedModel,
  overrides: Record<string, ModelCapabilityOverride>
): EnrichedModel {
  const override = overrides[model.id]
  if (!override) return model
  return {
    ...model,
    ...(override.contextWindow !== undefined ? { contextWindow: override.contextWindow } : {}),
    ...(override.supportsImages !== undefined ? { supportsImages: override.supportsImages } : {}),
  }
}

export function applyCapabilityOverrides(
  models: EnrichedModel[],
  overrides: Record<string, ModelCapabilityOverride>
): EnrichedModel[] {
  if (!Object.keys(overrides).length) return models
  return models.map(m => applyCapabilityOverride(m, overrides))
}

export interface ProviderModelsResult {
  models: EnrichedModel[]
  /** false 表示这批候选来自兜底清单，不是端点真实返回的。 */
  fromEndpoint: boolean
  reason?: ProbeFailure
}

/**
 * 取某接入方式可选的模型列表：拉端点 → 富化 → 叠用户覆盖；
 * 拉不通就退回兜底清单，并把失败原因带回去让调用方决定要不要提示。
 */
export async function loadProviderModels(
  endpoint: ProviderEndpoint,
  overrides: Record<string, ModelCapabilityOverride> = {}
): Promise<ProviderModelsResult> {
  const catalog = await loadModelCatalog()
  const outcome = await probeEndpoint(endpoint)

  if (outcome.status === 'failed') {
    const fallback = enrichModels([...FALLBACK_MODELS[endpoint.target]], endpoint.baseUrl, catalog)
    return {
      models: applyCapabilityOverrides(fallback, overrides),
      fromEndpoint: false,
      reason: outcome.reason
    }
  }

  return {
    models: applyCapabilityOverrides(enrichRawModels(outcome.models, endpoint.baseUrl, catalog), overrides),
    fromEndpoint: true
  }
}
