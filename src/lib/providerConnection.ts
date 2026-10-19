import type { AuthMethod, ProviderConfig } from '@/stores/settings'
import type { RawModel } from './modelCatalog'
import { normalizeApiUrl } from '@/utils/apiUrl'
import { api } from '@/services/electronAPI'

export type ProviderTarget = 'anthropic' | 'openai' | 'gemini'

/** claudeai / console 走 CLI 自身登录，应用内没有可直接探测的凭据。 */
export const OAUTH_METHODS: ReadonlySet<AuthMethod> = new Set(['claudeai', 'console'])

const TARGET_BY_METHOD: Record<AuthMethod, ProviderTarget> = {
  anthropic_compatible: 'anthropic',
  claudeai: 'anthropic',
  console: 'anthropic',
  openai_compatible: 'openai',
  gemini_api: 'gemini'
}

const DEFAULT_BASE_URL: Record<ProviderTarget, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta'
}

export interface ProviderEndpoint {
  target: ProviderTarget
  baseUrl: string
  apiKey: string
}

export function providerTargetOf(method: AuthMethod): ProviderTarget {
  return TARGET_BY_METHOD[method]
}

export function defaultBaseUrlOf(method: AuthMethod): string {
  return DEFAULT_BASE_URL[TARGET_BY_METHOD[method]]
}

/** 解析出某接入方式实际要打的地址与密钥；OAuth 方式返回 null。 */
export function resolveEndpoint(
  method: AuthMethod,
  configs: Record<'anthropic' | 'openai' | 'gemini', ProviderConfig>
): ProviderEndpoint | null {
  if (OAUTH_METHODS.has(method)) return null
  const target = TARGET_BY_METHOD[method]
  const config = configs[target]
  return {
    target,
    baseUrl: config.baseUrl || DEFAULT_BASE_URL[target],
    apiKey: config.apiKey
  }
}

export type ProbeFailure = 'no-key' | 'proxy' | 'http' | 'network'

export type ProbeOutcome =
  | { status: 'ok'; models: RawModel[] }
  | { status: 'failed'; reason: ProbeFailure; httpStatus?: number }

/**
 * /models 的响应形状各家网关不统一（裸数组 / data / models），
 * 且 id 与 name 字段互为主备 —— 设置页与引导向导共用这一份归一化。
 */
export function toRawModels(payload: unknown): RawModel[] {
  if (typeof payload === 'string') return [{ id: payload }]
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown })?.models)
        ? (payload as { models: unknown[] }).models
        : []

  return list
    .map((entry): RawModel | null => {
      if (typeof entry === 'string') return { id: entry, name: entry }
      const item = entry as { id?: string; name?: string }
      // 有的网关只回 name，id 要补上 —— 下游按 id 建索引与选中值。
      const id = item?.id || item?.name
      if (!id) return null
      return { ...item, id, name: item.name || id }
    })
    .filter((m): m is RawModel => m !== null)
}

/** 打一次 GET {baseUrl}/models 验证连通性，顺带取回可用模型。 */
export async function probeEndpoint(endpoint: ProviderEndpoint): Promise<ProbeOutcome> {
  if (!endpoint.apiKey) return { status: 'failed', reason: 'no-key' }

  const url = `${normalizeApiUrl(endpoint.baseUrl, endpoint.target)}/models`
  let result: Awaited<ReturnType<typeof api.httpFetch>>
  try {
    result = await api.httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${endpoint.apiKey}`,
        'Content-Type': 'application/json'
      }
    })
  } catch {
    return { status: 'failed', reason: 'network' }
  }

  if (!result) return { status: 'failed', reason: 'proxy' }
  if (!result.ok) return { status: 'failed', reason: 'http', httpStatus: result.status }

  try {
    return { status: 'ok', models: toRawModels(JSON.parse(result.data)) }
  } catch {
    return { status: 'failed', reason: 'network' }
  }
}
