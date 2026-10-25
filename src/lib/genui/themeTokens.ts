/**
 * 主题下发：卡片只认明暗两套 token，读不到父窗口 CSS（ADR 0015 后果一节）。
 */
import type { GenuiTheme } from '@/shared/genuiSandbox'

/**
 * 把应用当前生效的主题名归并成明暗二值。
 * 应用主题含 `anthropic` / `anthropic-dark` 等变体，沙箱只区分明暗；
 * 取不到时按应用默认深色处理。
 */
export function toSandboxTheme(appliedTheme: string | null | undefined): GenuiTheme {
  if (!appliedTheme) return 'dark'
  return appliedTheme.includes('dark') ? 'dark' : 'light'
}
