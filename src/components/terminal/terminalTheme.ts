import type { ITheme } from '@xterm/xterm'
import type { ThemeId } from '@/stores/app'

const lightAnsi = {
  black: '#18191f',
  red: '#c92a3d',
  green: '#13795b',
  yellow: '#a15c00',
  blue: '#2457c5',
  magenta: '#7048b8',
  cyan: '#087f8c',
  brightBlack: '#6e7191',
  brightRed: '#dc3548',
  brightGreen: '#158f68',
  brightYellow: '#bd6b00',
  brightBlue: '#3269dc',
  brightMagenta: '#8257c7',
  brightCyan: '#0995a5',
}

const darkAnsi = {
  black: '#0d0d0d',
  red: '#ef6b73',
  green: '#55c980',
  yellow: '#e5b454',
  blue: '#6aa7ff',
  magenta: '#b18cff',
  cyan: '#4fc1d9',
  white: '#d6d6d6',
  brightBlack: '#737373',
  brightRed: '#ff858c',
  brightGreen: '#70dc97',
  brightYellow: '#f3c96b',
  brightBlue: '#88b9ff',
  brightMagenta: '#c5a8ff',
  brightCyan: '#6dd5e9',
  brightWhite: '#f5f5f5',
}

export function getTerminalTheme(theme: ThemeId): ITheme {
  if (theme === 'anthropic-dark') {
    return {
      ...darkAnsi,
      background: '#181715',
      foreground: '#faf9f5',
      cursor: '#dd8a6e',
      cursorAccent: '#181715',
      selectionBackground: 'rgba(204, 120, 92, 0.28)',
    }
  }

  if (theme === 'dark') {
    return {
      ...darkAnsi,
      background: '#0d0d0d',
      foreground: '#f5f5f5',
      cursor: '#60a5fa',
      cursorAccent: '#0d0d0d',
      selectionBackground: 'rgba(59, 130, 246, 0.3)',
    }
  }

  if (theme === 'anthropic') {
    return {
      ...lightAnsi,
      background: '#faf9f5',
      foreground: '#2d2a24',
      white: '#2d2a24',
      brightWhite: '#2d2a24',
      cursor: '#a9583e',
      cursorAccent: '#faf9f5',
      selectionBackground: 'rgba(204, 120, 92, 0.22)',
    }
  }

  return {
    ...lightAnsi,
    background: '#f8f9fb',
    foreground: '#18191f',
    white: '#18191f',
    brightWhite: '#18191f',
    cursor: '#0d9488',
    cursorAccent: '#f8f9fb',
    selectionBackground: 'rgba(13, 148, 136, 0.2)',
  }
}
