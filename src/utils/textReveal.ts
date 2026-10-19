// 上游网关按 ~500ms 一批回吐 thinking，一批内的几十条 delta 在同一毫秒落地，
// 直接映射到屏幕就是一段一段蹦。这里把积压平摊到 DRAIN_WINDOW_MS 内放出：
// 平摊时长 < 批间隔，所以既看得出连续推进，又不会越落越远。
const DRAIN_WINDOW_MS = 450
const MIN_CHARS_PER_SEC = 20

/** 返回本帧应展示到第几个字符（小数，由调用方取整）。 */
export function nextRevealedLength(revealed: number, total: number, elapsedMs: number): number {
  if (revealed >= total) return total
  const backlog = total - revealed
  const charsPerMs = Math.max(MIN_CHARS_PER_SEC / 1000, backlog / DRAIN_WINDOW_MS)
  return Math.min(total, revealed + charsPerMs * elapsedMs)
}
