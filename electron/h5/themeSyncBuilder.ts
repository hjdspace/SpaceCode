// electron/themeSyncBuilder.ts
import type { ThemeSyncData } from './mobileServerTypes'

const THEME_COLORS: Record<string, Record<string, string>> = {
  light: {
    bgPrimary: '#f8f9fb', bgSecondary: '#f0f1f5', bgTertiary: '#e7e9ef',
    bgElevated: '#ffffff', bgHover: '#e4e6ec', bgActive: '#dbdde5',
    textPrimary: '#18191f', textSecondary: '#44475a', textMuted: '#6e7191', textDisabled: '#9da1b8',
    accentPrimary: '#0d9488', accentPrimaryHover: '#14b8a6',
    accentSecondary: '#6366f1', accentTertiary: '#7c3aed',
    success: '#059669', warning: '#d97706', error: '#dc2626',
    borderSubtle: 'rgba(24,25,31,0.05)', borderDefault: 'rgba(24,25,31,0.09)', borderStrong: 'rgba(24,25,31,0.15)',
  },
  dark: {
    bgPrimary: '#0d0d0d', bgSecondary: '#141414', bgTertiary: '#1a1a1a',
    bgElevated: '#1f1f1f', bgHover: '#262626', bgActive: '#2e2e2e',
    textPrimary: '#f5f5f5', textSecondary: '#a3a3a3', textMuted: '#737373', textDisabled: '#525252',
    accentPrimary: '#3b82f6', accentPrimaryHover: '#60a5fa',
    accentSecondary: '#64748b', accentTertiary: '#8b5cf6',
    success: '#22c55e', warning: '#f59e0b', error: '#ef4444',
    borderSubtle: 'rgba(255,255,255,0.04)', borderDefault: 'rgba(255,255,255,0.08)', borderStrong: 'rgba(255,255,255,0.15)',
  },
  anthropic: {
    bgPrimary: '#faf9f5', bgSecondary: '#efe9de', bgTertiary: '#e8e0d2',
    bgElevated: '#faf9f5', bgHover: '#e5e0d5', bgActive: '#dcd6c8',
    textPrimary: '#141413', textSecondary: '#3d3d3a', textMuted: '#6c6a64', textDisabled: '#8e8b82',
    accentPrimary: '#cc785c', accentPrimaryHover: '#a9583e',
    accentSecondary: '#5db8a6', accentTertiary: '#e8a55a',
    success: '#5db872', warning: '#d4a017', error: '#c64545',
    borderSubtle: 'rgba(20,20,19,0.04)', borderDefault: 'rgba(20,20,19,0.08)', borderStrong: 'rgba(20,20,19,0.16)',
  },
  'anthropic-dark': {
    bgPrimary: '#181715', bgSecondary: '#1c1b1a', bgTertiary: '#1f1e1b',
    bgElevated: '#252320', bgHover: '#2d2c29', bgActive: '#353332',
    textPrimary: '#faf9f5', textSecondary: '#a09d96', textMuted: '#6c6a64', textDisabled: '#3d3d3a',
    accentPrimary: '#cc785c', accentPrimaryHover: '#dd8a6e',
    accentSecondary: '#5db8a6', accentTertiary: '#e8a55a',
    success: '#5db872', warning: '#d4a017', error: '#c64545',
    borderSubtle: 'rgba(250,249,245,0.04)', borderDefault: 'rgba(250,249,245,0.08)', borderStrong: 'rgba(250,249,245,0.14)',
  },
}

const CODE_THEMES: Record<string, Record<string, string>> = {
  light: {
    bg: '#eef0f5', fg: '#18191f', keyword: '#be123c', string: '#1e40af',
    number: '#7c3aed', comment: '#6e7191', function: '#0d9488',
    builtin: '#0d9488', attr: '#6366f1', tag: '#059669',
  },
  dark: {
    bg: '#0d1117', fg: '#c9d1d9', keyword: '#ff7b72', string: '#a5d6ff',
    number: '#79c0ff', comment: '#8b949e', function: '#d2a8ff',
    builtin: '#ffa657', attr: '#79c0ff', tag: '#7ee787',
  },
  anthropic: {
    bg: '#f0ede4', fg: '#2d2a24', keyword: '#c44e3f', string: '#5db872',
    number: '#e8a55a', comment: '#8e8b82', function: '#5db8a6',
    builtin: '#cc785c', attr: '#5db8a6', tag: '#5db872',
  },
  'anthropic-dark': {
    bg: '#1a1918', fg: '#faf9f5', keyword: '#e08870', string: '#7dce94',
    number: '#f0b56a', comment: '#6c6a64', function: '#7dccbe',
    builtin: '#dd8a6e', attr: '#7dccbe', tag: '#7dce94',
  },
}

export function buildThemeSyncData(
  effectiveTheme: string,
  appearance?: { accentColor?: string; density?: string }
): ThemeSyncData {
  const colors = THEME_COLORS[effectiveTheme] || THEME_COLORS.light
  const codeTheme = CODE_THEMES[effectiveTheme] || CODE_THEMES.light

  return {
    theme: effectiveTheme,
    accentColor: appearance?.accentColor || 'blue',
    density: appearance?.density || 'default',
    colors,
    codeTheme,
  }
}
