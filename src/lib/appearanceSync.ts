import type { AppearanceSettings } from '@/stores/settings'

export type EffectiveTheme = 'light' | 'dark' | 'anthropic' | 'anthropic-dark'

export const ACCENT_COLORS: ReadonlyArray<{ id: string; hex: string }> = [
  { id: 'blue', hex: '#3b82f6' },
  { id: 'purple', hex: '#8b5cf6' },
  { id: 'green', hex: '#22c55e' },
  { id: 'orange', hex: '#f97316' },
  { id: 'pink', hex: '#ec4899' },
  { id: 'cyan', hex: '#06b6d4' },
  { id: 'anthropic-orange', hex: '#d97757' },
  { id: 'anthropic-blue', hex: '#6a9bcc' },
  { id: 'anthropic-green', hex: '#788c5d' }
]

export function resolveEffectiveTheme(theme: AppearanceSettings['theme']): EffectiveTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyAccentColor(colorId: string): void {
  const color = ACCENT_COLORS.find(c => c.id === colorId)
  if (!color) return
  document.documentElement.style.setProperty('--accent-primary', color.hex)
  const r = parseInt(color.hex.slice(1, 3), 16)
  const g = parseInt(color.hex.slice(3, 5), 16)
  const b = parseInt(color.hex.slice(5, 7), 16)
  document.documentElement.style.setProperty('--accent-primary-rgb', `${r}, ${g}, ${b}`)
}

export function applyDensity(density: AppearanceSettings['density']): void {
  document.documentElement.setAttribute('data-density', density)
}

/**
 * 把一份外观配置立刻打到 documentElement。
 * 外观设置页与引导向导都调它 —— 两者都要求"点了就生效"，而字号那条链路
 * 由 font store 自己的 watch 负责，这里不重复。
 */
export function applyAppearanceNow(appearance: AppearanceSettings): void {
  document.documentElement.setAttribute('data-theme', resolveEffectiveTheme(appearance.theme))
  applyAccentColor(appearance.accentColor)
  applyDensity(appearance.density)
}
