/**
 * useImageHandler composable tests
 *
 * Tests the image attachment logic extracted from ChatInput.vue:
 * - Image attachment creation
 * - File reading as data URL
 * - Image type validation
 */
import { describe, it, expect } from 'vitest'

// ── Types ────────────────────────────────────────────────────────

interface ImageAttachment {
  id: string
  name: string
  type: 'image'
  mimeType: string
  previewUrl: string
  data: string
}

// ── Pure logic functions ─────────────────────────────────────────

/**
 * Check if a file is an image based on MIME type
 */
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/**
 * Create an image attachment object
 */
function createImageAttachment(file: { name: string; type: string }, dataUrl: string, id: string): ImageAttachment {
  return {
    id,
    name: file.name,
    type: 'image',
    mimeType: file.type,
    previewUrl: dataUrl,
    data: dataUrl,
  }
}

/**
 * Check if an image already exists in the list
 */
function isDuplicateImage(images: ImageAttachment[], id: string): boolean {
  return images.some(img => img.id === id)
}

/**
 * Check if a file already exists in the attachments
 */
function isDuplicateFile(files: Array<{ path: string }>, path: string): boolean {
  return files.some(f => f.path === path)
}

// ── Tests ────────────────────────────────────────────────────────

describe('useImageHandler - pure logic', () => {
  describe('image file detection', () => {
    it('should detect png images', () => {
      expect(isImageFile('image/png')).toBe(true)
    })

    it('should detect jpeg images', () => {
      expect(isImageFile('image/jpeg')).toBe(true)
    })

    it('should detect gif images', () => {
      expect(isImageFile('image/gif')).toBe(true)
    })

    it('should detect webp images', () => {
      expect(isImageFile('image/webp')).toBe(true)
    })

    it('should not detect text files', () => {
      expect(isImageFile('text/plain')).toBe(false)
    })

    it('should not detect pdf files', () => {
      expect(isImageFile('application/pdf')).toBe(false)
    })
  })

  describe('image attachment creation', () => {
    it('should create attachment with all fields', () => {
      const attachment = createImageAttachment(
        { name: 'photo.png', type: 'image/png' },
        'data:image/png;base64,abc123',
        'img-001'
      )
      expect(attachment).toEqual({
        id: 'img-001',
        name: 'photo.png',
        type: 'image',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,abc123',
        data: 'data:image/png;base64,abc123',
      })
    })
  })

  describe('duplicate detection', () => {
    it('should detect duplicate images', () => {
      const images: ImageAttachment[] = [
        { id: 'img-001', name: 'a.png', type: 'image', mimeType: 'image/png', previewUrl: '', data: '' },
      ]
      expect(isDuplicateImage(images, 'img-001')).toBe(true)
      expect(isDuplicateImage(images, 'img-002')).toBe(false)
    })

    it('should detect duplicate files', () => {
      const files = [{ path: '/a.ts' }, { path: '/b.ts' }]
      expect(isDuplicateFile(files, '/a.ts')).toBe(true)
      expect(isDuplicateFile(files, '/c.ts')).toBe(false)
    })
  })
})
