/**
 * 生图模型列表探测：GET {baseUrl}/models。
 *
 * 生图 key 是只写字段，渲染层读不到明文，所以探测放在主进程 ——
 * 由 IPC 调用方决定用刚填的 key 还是磁盘上存档那份。
 * 本模块零 fs、零 electron，fetch 由参数注入，便于单测。
 */
import { parseImageModelIds } from '@/shared/imageGenModels'
import type { ImageModelListResult } from '@/shared/imageGenModels'

const FETCH_TIMEOUT_MS = 15_000

export async function listImageModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageModelListResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return { success: false, reason: 'http', status: res.status }
    return { success: true, models: parseImageModelIds(await res.json()) }
  } catch {
    return { success: false, reason: 'network' }
  }
}
