import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCENT_COLORS,
  applyAccentColor,
  applyDensity,
  resolveEffectiveTheme
} from '../appearanceSync'

/**
 * 外观应用函数的行为。它们此前散在 AppearanceSettings.vue 内部，
 * 于是强调色和密度只有打开过外观页才打到 documentElement —— 重启即回到主题默认值。
 * 引导向导要求"选了就生效"，所以这些函数被抽到这里，也由这里钉住。
 */

function stubPrefersDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-density')
  document.documentElement.style.removeProperty('--accent-primary')
  document.documentElement.style.removeProperty('--accent-primary-rgb')
})

describe('resolveEffectiveTheme', () => {
  it('非 system 的主题原样通过', () => {
    stubPrefersDark(false)
    expect(resolveEffectiveTheme('dark')).toBe('dark')
    expect(resolveEffectiveTheme('anthropic')).toBe('anthropic')
    expect(resolveEffectiveTheme('anthropic-dark')).toBe('anthropic-dark')
  })

  it('system 跟随偏好', () => {
    stubPrefersDark(true)
    expect(resolveEffectiveTheme('system')).toBe('dark')

    stubPrefersDark(false)
    expect(resolveEffectiveTheme('system')).toBe('light')
  })
})

describe('applyAccentColor', () => {
  it('写入 --accent-primary 与其 rgb 形式', () => {
    const blue = ACCENT_COLORS.find(c => c.id === 'blue')
    expect(blue?.hex).toBe('#3b82f6')

    applyAccentColor('blue')

    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#3b82f6')
    expect(document.documentElement.style.getPropertyValue('--accent-primary-rgb')).toBe('59, 130, 246')
  })

  it('未知 id 不动已有值', () => {
    applyAccentColor('blue')
    applyAccentColor('not-a-color')

    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('#3b82f6')
  })
})

describe('applyDensity', () => {
  it('写到 documentElement 的 data-density', () => {
    applyDensity('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')

    applyDensity('comfortable')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')
  })
})
