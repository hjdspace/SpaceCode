import { describe, expect, it } from 'vitest'
import type { ThemeId } from '@/stores/app'
import { getTerminalTheme } from '../terminalTheme'

describe('getTerminalTheme', () => {
  it.each<[ThemeId, string]>([
    ['light', '#f8f9fb'],
    ['dark', '#0d0d0d'],
    ['anthropic', '#faf9f5'],
    ['anthropic-dark', '#181715'],
  ])('maps %s to its application surface', (theme, background) => {
    expect(getTerminalTheme(theme).background).toBe(background)
  })

  it('keeps both dark themes on a dark terminal surface', () => {
    expect(getTerminalTheme('dark').foreground).toBe('#f5f5f5')
    expect(getTerminalTheme('anthropic-dark').foreground).toBe('#faf9f5')
  })

  it.each<ThemeId>(['light', 'anthropic'])(
    'keeps ANSI white text readable in the %s theme',
    (theme) => {
      const terminalTheme = getTerminalTheme(theme)

      expect(terminalTheme.white).toBe(terminalTheme.foreground)
      expect(terminalTheme.brightWhite).toBe(terminalTheme.foreground)
    },
  )
})
