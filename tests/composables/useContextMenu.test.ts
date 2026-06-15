/**
 * useContextMenu composable tests
 *
 * Tests the @ context menu logic extracted from ChatInput.vue:
 * - @ trigger detection
 * - Context item navigation
 * - Context search query extraction
 */
import { describe, it, expect } from 'vitest'

// ── Types ────────────────────────────────────────────────────────

interface ContextItem {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
}

// ── Pure logic functions ─────────────────────────────────────────

/**
 * Check if text before cursor triggers @ context menu
 */
function checkContextTrigger(textBeforeCursor: string): { triggered: boolean; query: string; triggerPosition: number } | null {
  const lastAtIndex = textBeforeCursor.lastIndexOf('@')
  if (lastAtIndex === -1) return null

  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
  const hasInvalidChar = /[\s\n]/.test(textAfterAt)

  if (hasInvalidChar) return null

  return {
    triggered: true,
    query: textAfterAt,
    triggerPosition: lastAtIndex,
  }
}

/**
 * Navigate through context items
 */
function navigateContextItems(
  items: ContextItem[],
  currentHighlightedPath: string | null,
  direction: number
): string | null {
  if (items.length === 0) return null

  const currentIndex = items.findIndex(i => i.path === currentHighlightedPath)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = items.length - 1
  if (newIndex >= items.length) newIndex = 0

  return items[newIndex].path
}

/**
 * Get the first item's path for initial highlight
 */
function getInitialHighlight(items: ContextItem[]): string | null {
  return items.length > 0 ? items[0].path : null
}

// ── Tests ────────────────────────────────────────────────────────

describe('useContextMenu - pure logic', () => {
  describe('@ trigger detection', () => {
    it('should detect @ at start of text', () => {
      const result = checkContextTrigger('@')
      expect(result).toEqual({ triggered: true, query: '', triggerPosition: 0 })
    })

    it('should detect @query pattern', () => {
      const result = checkContextTrigger('@src/')
      expect(result).toEqual({ triggered: true, query: 'src/', triggerPosition: 0 })
    })

    it('should detect @ after text', () => {
      const result = checkContextTrigger('look at @src/')
      expect(result).toEqual({ triggered: true, query: 'src/', triggerPosition: 8 })
    })

    it('should use the last @ when multiple exist', () => {
      const result = checkContextTrigger('@first @second')
      expect(result).toEqual({ triggered: true, query: 'second', triggerPosition: 7 })
    })

    it('should not trigger for text without @', () => {
      const result = checkContextTrigger('hello world')
      expect(result).toBeNull()
    })

    it('should not trigger when @ is followed by space', () => {
      const result = checkContextTrigger('@ user')
      expect(result).toBeNull()
    })

    it('should not trigger when @ is followed by newline', () => {
      const result = checkContextTrigger('@\nfile')
      expect(result).toBeNull()
    })

    it('should allow @ followed by path characters', () => {
      const result = checkContextTrigger('@src/components/Chat')
      expect(result).toEqual({ triggered: true, query: 'src/components/Chat', triggerPosition: 0 })
    })

    it('should allow @ followed by dots and underscores', () => {
      const result = checkContextTrigger('@my_file.test')
      expect(result).toEqual({ triggered: true, query: 'my_file.test', triggerPosition: 0 })
    })
  })

  describe('context item navigation', () => {
    const items: ContextItem[] = [
      { name: 'a.ts', path: '/a.ts', relativePath: 'a.ts', type: 'file' },
      { name: 'b.ts', path: '/b.ts', relativePath: 'b.ts', type: 'file' },
      { name: 'c.ts', path: '/c.ts', relativePath: 'c.ts', type: 'file' },
    ]

    it('should navigate down', () => {
      expect(navigateContextItems(items, '/a.ts', 1)).toBe('/b.ts')
    })

    it('should wrap around going down past end', () => {
      expect(navigateContextItems(items, '/c.ts', 1)).toBe('/a.ts')
    })

    it('should navigate up', () => {
      expect(navigateContextItems(items, '/c.ts', -1)).toBe('/b.ts')
    })

    it('should wrap around going up past start', () => {
      expect(navigateContextItems(items, '/a.ts', -1)).toBe('/c.ts')
    })

    it('should return null for empty list', () => {
      expect(navigateContextItems([], null, 1)).toBeNull()
    })

    it('should handle null current highlight (starts from -1)', () => {
      // null → findIndex returns -1, so -1 + 1 = 0 → first item
      expect(navigateContextItems(items, null, 1)).toBe(items[0].path)
    })
  })

  describe('initial highlight', () => {
    it('should return first item path when items exist', () => {
      const items: ContextItem[] = [
        { name: 'a.ts', path: '/a.ts', relativePath: 'a.ts', type: 'file' },
      ]
      expect(getInitialHighlight(items)).toBe('/a.ts')
    })

    it('should return null for empty list', () => {
      expect(getInitialHighlight([])).toBeNull()
    })
  })
})
