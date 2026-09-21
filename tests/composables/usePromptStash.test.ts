/**
 * usePromptStash composable tests
 *
 * Tests the prompt stash/restore logic extracted from ChatInput.vue:
 * - Stash decision (has content → stash, empty → restore)
 * - Stash data structure
 * - Per-session draft save/load decisions (session switch / page navigation)
 */
import { describe, it, expect } from 'vitest'
import {
  resolveDraftSave,
  resolveDraftLoad,
  isMirrorValid,
} from '@/composables/usePromptStash'

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

  describe('resolveDraftSave', () => {
    it('saves session draft for a session with messages', () => {
      expect(resolveDraftSave(true, 's1', 5, undefined)).toEqual({
        saveDraft: true,
        saveMirror: false,
        clearMirror: false,
      })
    })

    it('saves session draft AND mirror for a fresh (message-less) session', () => {
      expect(resolveDraftSave(true, 's1', 0, undefined)).toEqual({
        saveDraft: true,
        saveMirror: true,
        clearMirror: false,
      })
    })

    it('saves only mirror when no session exists yet', () => {
      expect(resolveDraftSave(true, null, null, undefined)).toEqual({
        saveDraft: false,
        saveMirror: true,
        clearMirror: false,
      })
    })

    it('clears session draft when editor is empty', () => {
      expect(resolveDraftSave(false, 's1', 5, undefined)).toEqual({
        saveDraft: false,
        saveMirror: false,
        clearMirror: false,
      })
    })

    it('clears mirror when editor is empty and mirror belongs to the session being left', () => {
      expect(resolveDraftSave(false, 's1', 0, 's1')).toEqual({
        saveDraft: false,
        saveMirror: false,
        clearMirror: true,
      })
    })

    it('does not clear mirror owned by another session', () => {
      expect(resolveDraftSave(false, 's2', 0, 's1')).toEqual({
        saveDraft: false,
        saveMirror: false,
        clearMirror: false,
      })
    })

    it('does not clear mirror owned by null when leaving a real session', () => {
      expect(resolveDraftSave(false, 's1', 5, null)).toEqual({
        saveDraft: false,
        saveMirror: false,
        clearMirror: false,
      })
    })

    it('clears mirror owned by null when leaving no session', () => {
      expect(resolveDraftSave(false, null, null, null)).toEqual({
        saveDraft: false,
        saveMirror: false,
        clearMirror: true,
      })
    })
  })

  describe('resolveDraftLoad', () => {
    it('prefers the session draft', () => {
      expect(resolveDraftLoad(true, true, true)).toBe('draft')
    })

    it('falls back to Ctrl+S stash when no draft', () => {
      expect(resolveDraftLoad(false, true, true)).toBe('stash')
    })

    it('falls back to mirror when no draft/stash and mirror usable', () => {
      expect(resolveDraftLoad(false, false, true)).toBe('mirror')
    })

    it('clears when nothing is available', () => {
      expect(resolveDraftLoad(false, false, false)).toBe('clear')
    })
  })

  describe('isMirrorValid', () => {
    it('is valid when owner session is null (typed before any session)', () => {
      expect(isMirrorValid(null, null)).toBe(true)
    })

    it('is valid while owner session is still message-less', () => {
      expect(isMirrorValid('s1', 0)).toBe(true)
    })

    it('is invalid once owner session has messages (draft was sent)', () => {
      expect(isMirrorValid('s1', 3)).toBe(false)
    })

    it('is invalid when owner session no longer exists', () => {
      expect(isMirrorValid('s1', null)).toBe(false)
    })
  })
})
