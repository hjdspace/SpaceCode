// models.dev 目录加载：磁盘缓存（7 天）→ 联网拉取 → 过期缓存兜底。
// 缓存位于 <userData>/model-catalog-cache.json，无打包快照。

import { ref } from 'vue'
import { parseModelsDevCatalog } from './modelCatalog'
import type { Catalog } from './modelCatalog'
import { api } from '@/services/electronAPI'

const MODELS_DEV_API_URL = 'https://models.dev/api.json'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

interface CacheFile {
  fetchedAt: number
  catalog: Catalog
}

const catalogRef = ref<Catalog | null>(null)
let loadPromise: Promise<Catalog> | null = null

function isCacheFresh(cache: CacheFile | null): boolean {
  return !!cache && typeof cache.fetchedAt === 'number' && Date.now() - cache.fetchedAt < CACHE_TTL_MS
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const userData = await api.app.getPath('userData')
    const content = await api.readFile(`${userData}/model-catalog-cache.json`)
    if (!content) return null
    const parsed = JSON.parse(content)
    if (typeof parsed?.fetchedAt !== 'number' || typeof parsed?.catalog !== 'object') return null
    return parsed as CacheFile
  } catch {
    return null
  }
}

async function writeCache(catalog: Catalog): Promise<void> {
  try {
    const userData = await api.app.getPath('userData')
    const cache: CacheFile = { fetchedAt: Date.now(), catalog }
    await api.writeFile(`${userData}/model-catalog-cache.json`, JSON.stringify(cache))
  } catch {
    // 缓存写失败不影响功能
  }
}

async function fetchCatalog(): Promise<Catalog> {
  const result = await api.httpFetch(MODELS_DEV_API_URL, { timeoutMs: FETCH_TIMEOUT_MS })
  if (!result || !result.ok) throw new Error(`models.dev fetch failed: ${result?.status ?? 'no proxy'}`)
  return parseModelsDevCatalog(JSON.parse(result.data))
}

/**
 * 获取模型目录（带缓存）。首次调用后进程内复用。
 * 优先新鲜缓存；无缓存则联网拉取并写盘；联网失败回退过期缓存。
 */
export async function loadModelCatalog(): Promise<Catalog> {
  if (catalogRef.value) return catalogRef.value
  if (!loadPromise) {
    loadPromise = (async () => {
      const cached = await readCache()
      if (isCacheFresh(cached)) {
        catalogRef.value = cached!.catalog
        return catalogRef.value
      }
      try {
        const catalog = await fetchCatalog()
        catalogRef.value = catalog
        void writeCache(catalog)
        return catalog
      } catch {
        if (cached) {
          catalogRef.value = cached.catalog
          return catalogRef.value
        }
        return {}
      }
    })().finally(() => {
      loadPromise = null
    })
  }
  return loadPromise
}
