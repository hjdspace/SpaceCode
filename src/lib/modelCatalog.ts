// 模型元数据：优先用上游 /models 端点自述字段（context_length、modalities 等），
// 缺失时用 models.dev 公共目录（运行时拉取 + 7 天磁盘缓存）按 baseUrl/modelId 匹配补全。

export interface EnrichedModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  supportsImages?: boolean
}

/** 上游 /models 响应中的单个原始模型条目 */
export interface RawModel {
  id: string
  name?: string
  /** 端点自述能力字段（各家网关命名不一） */
  context_length?: unknown
  max_context_length?: unknown
  context_window?: unknown
  max_model_len?: unknown
  max_context_tokens?: unknown
  max_completion_tokens?: unknown
  max_output_tokens?: unknown
  max_tokens?: unknown
  modalities?: unknown
  input_modalities?: unknown
}

/** models.dev 目录中的模型条目（已归一化） */
export interface CatalogModelMeta {
  context: number | null
  output: number | null
  image: boolean
}

export interface CatalogProvider {
  name: string
  baseUrl: string | null
  models: Record<string, CatalogModelMeta>
}

export type Catalog = Record<string, CatalogProvider>

// models.dev 中主流 provider 的 api 字段为 null，此处内置其公开 baseUrl
const KNOWN_PROVIDER_BASE_URLS: Record<string, string[]> = {
  openai: ['https://api.openai.com/v1', 'https://chatgpt.com/backend-api'],
  anthropic: ['https://api.anthropic.com'],
  google: ['https://generativelanguage.googleapis.com/v1beta'],
  mistral: ['https://api.mistral.ai/v1'],
  xai: ['https://api.x.ai/v1'],
  groq: ['https://api.groq.com/openai/v1'],
  togetherai: ['https://api.together.xyz/v1'],
  deepseek: ['https://api.deepseek.com'],
  openrouter: ['https://openrouter.ai/api/v1'],
  'fireworks-ai': ['https://api.fireworks.ai/inference/v1'],
  'alibaba-cn': ['https://dashscope.aliyuncs.com/compatible-mode/v1'],
  'moonshotai-cn': ['https://api.moonshot.cn/v1'],
  'siliconflow-cn': ['https://api.siliconflow.cn/v1'],
  volcengine: ['https://ark.cn-beijing.volces.com/api/v3'],
  minimax: ['https://api.minimax.io/v1', 'https://api.minimax.io/anthropic/v1'],
  'minimax-cn': ['https://api.minimaxi.com/v1', 'https://api.minimaxi.com/anthropic/v1'],
}

const PROVIDER_ALIASES: Record<string, string[]> = {
  together: ['together', 'togetherai'],
  'together-ai': ['together', 'togetherai'],
  fireworks: ['fireworks', 'fireworks-ai'],
  kimi: ['kimi-for-coding', 'kimi-coding'],
  'google-vertex': ['google-vertex', 'google'],
  vercel: ['vercel', 'vercel-ai-gateway'],
  zai: ['zhipuai', 'zai-coding-cn'],
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/** baseUrl → provider key（精确或 host 包含匹配） */
export function providerKeyFromBaseUrl(baseUrl: string, catalog: Catalog): string | null {
  const normalized = normalizeUrl(baseUrl)
  if (!normalized) return null

  for (const [key, urls] of Object.entries(KNOWN_PROVIDER_BASE_URLS)) {
    if (urls.some((u) => normalizeUrl(u) === normalized)) return key
  }

  for (const [key, prov] of Object.entries(catalog)) {
    if (prov.baseUrl && normalizeUrl(prov.baseUrl) === normalized) return key
  }

  // host 包含匹配：e.g. https://api.deepseek.com/v1 → deepseek
  let host: string
  try {
    host = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`).hostname
  } catch {
    return null
  }
  for (const [key, prov] of Object.entries(catalog)) {
    if (!prov.baseUrl) continue
    try {
      const provHost = new URL(prov.baseUrl).hostname
      if (host === provHost || host.endsWith(`.${provHost}`) || provHost.endsWith(`.${host}`)) {
        return key
      }
    } catch {
      continue
    }
  }
  return null
}

/** modelId → 候选 provider keys（别名展开 + 常见前缀推断） */
function candidateProvidersForId(modelId: string): string[] {
  const lower = modelId.toLowerCase()
  for (const [alias, targets] of Object.entries(PROVIDER_ALIASES)) {
    if (lower.startsWith(`${alias}/`) || lower === alias) return targets
  }
  if (lower.startsWith('claude')) return ['anthropic']
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return ['openai']
  if (lower.startsWith('gemini')) return ['google']
  if (lower.startsWith('deepseek')) return ['deepseek']
  if (lower.startsWith('kimi')) return ['moonshotai', 'moonshotai-cn']
  if (lower.startsWith('qwen')) return ['alibaba-cn', 'qwen']
  if (lower.startsWith('glm')) return ['zhipuai']
  return []
}

function metaForModel(prov: CatalogProvider, modelId: string): CatalogModelMeta | null {
  if (prov.models[modelId]) return prov.models[modelId]
  // 前缀匹配：目录中带日期后缀（claude-haiku-4-5-20251001），请求 id 可能无后缀，反之亦然
  const exactBase = modelId.replace(/-\d{8}$/, '')
  for (const [key, meta] of Object.entries(prov.models)) {
    if (key === exactBase || key.replace(/-\d{8}$/, '') === exactBase) return meta
  }
  return null
}

// ─── 端点自述字段解析 ───

function firstPositiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const n = parseInt(value, 10)
      if (n > 0) return n
    }
  }
  return undefined
}

/** 端点 modalities 字段 → 是否支持图片输入 */
function parseEndpointImage(modalities: unknown, inputModalities: unknown): boolean | undefined {
  for (const value of [inputModalities, modalities]) {
    if (Array.isArray(value)) {
      return value.map(String).some((m) => m.toLowerCase() === 'image')
    }
  }
  return undefined
}

/** 从上游 /models 原始条目解析自述能力（主来源，零额外请求） */
export function parseEndpointCapabilities(raw: RawModel): {
  contextWindow?: number
  maxTokens?: number
  supportsImages?: boolean
} {
  const contextWindow = firstPositiveInteger(
    raw.context_length,
    raw.max_context_length,
    raw.context_window,
    raw.max_model_len,
    raw.max_context_tokens,
  )
  const maxTokens = firstPositiveInteger(
    raw.max_completion_tokens,
    raw.max_output_tokens,
    raw.max_tokens,
  )
  const supportsImages = parseEndpointImage(raw.modalities, raw.input_modalities)
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(supportsImages !== undefined ? { supportsImages } : {}),
  }
}

// ─── models.dev api.json → Catalog 归一化 ───

interface ModelsDevRawModel {
  id?: string
  name?: string
  limit?: { context?: unknown; output?: unknown }
  modalities?: { input?: unknown }
}

interface ModelsDevRawProvider {
  name?: string
  api?: unknown
  models?: Record<string, ModelsDevRawModel>
}

/** 解析 models.dev api.json 为内部索引（纯函数，便于测试） */
export function parseModelsDevCatalog(data: unknown): Catalog {
  if (typeof data !== 'object' || data === null) return {}
  const out: Catalog = {}
  for (const [provKey, prov] of Object.entries(data as Record<string, ModelsDevRawProvider>)) {
    if (!prov || typeof prov !== 'object' || !prov.models) continue
    const models: Record<string, CatalogModelMeta> = {}
    for (const [mid, m] of Object.entries(prov.models)) {
      if (!m || typeof m !== 'object' || !m.id) continue
      const context = typeof m.limit?.context === 'number' ? m.limit.context : null
      const output = typeof m.limit?.output === 'number' ? m.limit.output : null
      const image = Array.isArray(m.modalities?.input)
        ? m.modalities.input.map(String).some((x) => x.toLowerCase() === 'image')
        : false
      models[mid] = { context, output, image }
    }
    if (Object.keys(models).length) {
      out[provKey] = {
        name: prov.name || provKey,
        baseUrl: typeof prov.api === 'string' ? prov.api : null,
        models,
      }
    }
  }
  return out
}

// ─── enrich 主入口 ───

/**
 * 为模型列表补全元数据。
 * 端点自述字段优先；缺失时按 baseUrl → provider → modelId 查目录补全；
 * 全部失败则留空（UI 不显示徽标）。
 */
export function enrichModels(
  models: { id: string; name?: string }[],
  baseUrl: string,
  catalog: Catalog,
  rawById?: Map<string, RawModel>,
): EnrichedModel[] {
  const providerKey = baseUrl ? providerKeyFromBaseUrl(baseUrl, catalog) : null
  const provider = providerKey ? catalog[providerKey] : null

  return models.map((m) => {
    const enriched: EnrichedModel = { id: m.id, name: m.name || m.id }

    // 1. 端点自述字段优先
    const raw = rawById?.get(m.id)
    if (raw) Object.assign(enriched, parseEndpointCapabilities(raw))

    // 2. 目录补缺
    let meta: CatalogModelMeta | null = null
    if (provider) {
      meta = metaForModel(provider, m.id)
    }
    if (!meta) {
      for (const key of candidateProvidersForId(m.id)) {
        const cand = catalog[key]
        if (!cand) continue
        meta = metaForModel(cand, m.id)
        if (meta) break
      }
    }
    if (meta) {
      if (enriched.contextWindow === undefined && meta.context != null) enriched.contextWindow = meta.context
      if (enriched.maxTokens === undefined && meta.output != null) enriched.maxTokens = meta.output
      if (enriched.supportsImages === undefined) enriched.supportsImages = meta.image
    }
    return enriched
  })
}

/** 格式化 token 数：1000000 → 1M, 200000 → 200K */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`
  }
  if (count >= 1000) {
    const k = count / 1000
    return `${k % 1 === 0 ? k : k.toFixed(0)}K`
  }
  return String(count)
}
