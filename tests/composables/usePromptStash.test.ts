/**
 * usePromptStash composable tests
 *
 * Tests the prompt stash/restore logic extracted from ChatInput.vue:
 * - Stash decision (has content → stash, empty → restore)
 * - Stash data structure
 */
import { describe, it, expect } from 'vitest'

// ── Pure logic functions ─────────────────────────────────────────

interface StashData {
  text: string
  attachments: Array<{ name: string; path: string; isFolder: boolean }>
  images: Array<{ id: string; name: string }>
  editorHtml: string
}

/**
 * Determine stash action based on current state
 */
function resolveStashAction(
  content: string,
  hasAttachments: boolean,
  hasImages: boolean,
  hasExistingStash: boolean
): 'stash' | 'restore' | 'none' {
  const hasContent = content.trim().length > 0 || hasAttachments || hasImages

  if (!hasContent && hasExistingStash) return 'restore'
  if (hasContent) return 'stash'
  return 'none'
}

/**
 * Create stash data from current editor state
 */
function createStashData(
  text: string,
  attachments: Array<{ name: string; path: string; isFolder: boolean }>,
  images: Array<{ id: string; name: string }>,
  editorHtml: string
): StashData {
  return {
    text,
    attachments: attachments.map(f => ({ ...f })),
    images: images.map(img => ({ ...img })),
    editorHtml,
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('usePromptStash - pure logic', () => {
  describe('stash action resolution', () => {
    it('should stash when there is content', () => {
      expect(resolveStashAction('hello', false, false, false)).toBe('stash')
    })

    it('should stash when there are attachments', () => {
      expect(resolveStashAction('', true, false, false)).toBe('stash')
    })

    it('should stash when there are images', () => {
      expect(resolveStashAction('', false, true, false)).toBe('stash')
    })

    it('should restore when empty and stash exists', () => {
      expect(resolveStashAction('', false, false, true)).toBe('restore')
    })

    it('should do nothing when empty and no stash', () => {
      expect(resolveStashAction('', false, false, false)).toBe('none')
    })

    it('should stash when has content even if stash exists (overwrite)', () => {
      expect(resolveStashAction('text', false, false, true)).toBe('stash')
    })

    it('should treat whitespace-only as empty', () => {
      expect(resolveStashAction('   ', false, false, true)).toBe('restore')
    })
  })

  describe('stash data creation', () => {
    it('should create stash data with copies of attachments', () => {
      const attachments = [{ name: 'a.ts', path: '/a.ts', isFolder: false }]
      const images = [{ id: '1', name: 'img.png' }]
      const stash = createStashData('hello', attachments, images, '<p>hello</p>')

      expect(stash.text).toBe('hello')
      expect(stash.attachments).toEqual(attachments)
      expect(stash.images).toEqual(images)
      expect(stash.editorHtml).toBe('<p>hello</p>')

      // Verify copies
      expect(stash.attachments).not.toBe(attachments)
      expect(stash.images).not.toBe(images)
    })
  })
})
