/** 回合与工具耗时展示：把毫秒归一成可读档位，聊天 UI 全仓共用这一份。 */

const SECOND_MS = 1000
const MINUTE_SEC = 60
const HOUR_SEC = 3600
const HOUR_MIN = 60

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 分档判据用四舍五入后的整秒，所以 59.5s 起就进分钟档 —— 否则一位小数会渲染出 `60.0s`。
 * 亚分钟保留一位小数：工具卡片大多是个位数秒，收成整数会全变成 `5s`。
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < SECOND_MS) return `${Math.round(ms)}ms`

  const totalSec = Math.round(ms / SECOND_MS)
  if (totalSec < MINUTE_SEC) return `${(ms / SECOND_MS).toFixed(1)}s`
  if (totalSec < HOUR_SEC) return `${Math.floor(totalSec / MINUTE_SEC)}m ${pad(totalSec % MINUTE_SEC)}s`

  const totalMin = Math.floor(totalSec / MINUTE_SEC)
  return `${Math.floor(totalMin / HOUR_MIN)}h ${pad(totalMin % HOUR_MIN)}m`
}
