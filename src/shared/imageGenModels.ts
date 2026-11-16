/**
 * 生图模型列表的共享契约。
 *
 * 「OpenAI 兼容」的 GET /models 形状各家不一致：裸数组 / data / models，
 * 且 id 与 name 字段互为主备。主进程探测与 H5 直连共用这一份归一化逻辑。
 */

export type ImageModelListResult =
  | { success: true; models: string[] }
  | { success: false; reason: 'http'; status: number }
  | { success: false; reason: 'no-key' | 'invalid-base-url' | 'network' | 'unavailable' }

/** 从任意 /models 响应里抽出可选模型 id，去重并保持上游顺序。 */
export function parseImageModelIds(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown })?.models)
        ? (payload as { models: unknown[] }).models
        : []

  const ids = list.map((entry): string => {
    if (typeof entry === 'string') return entry.trim()
    if (!entry || typeof entry !== 'object') return ''
    const item = entry as { id?: unknown; name?: unknown }
    // 有的网关只回 name，id 要补上 —— 下游按 id 建索引与选中值。
    if (typeof item.id === 'string' && item.id.trim()) return item.id.trim()
    if (typeof item.name === 'string' && item.name.trim()) return item.name.trim()
    return ''
  })

  return [...new Set(ids.filter(id => id.length > 0))]
}
