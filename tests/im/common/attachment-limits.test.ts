import { describe, it, expect } from 'vitest'
import { validateAttachment, IMAGE_MAX_BYTES, FILE_MAX_BYTES } from '@electron/im/adapters/common/attachment/attachment-limits'

describe('AttachmentLimits', () => {
  it('should accept valid image within size limit', () => {
    const result = validateAttachment('image', 'image/png', 1024)
    expect(result.valid).toBe(true)
  })

  it('should reject image exceeding size limit', () => {
    const result = validateAttachment('image', 'image/png', IMAGE_MAX_BYTES + 1)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('too_large')
    expect(result.maxSize).toBe(IMAGE_MAX_BYTES)
  })

  it('should accept valid image MIME types', () => {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']
    for (const mime of validTypes) {
      const result = validateAttachment('image', mime, 1024)
      expect(result.valid).toBe(true)
    }
  })

  it('should reject HEIC images', () => {
    const result = validateAttachment('image', 'image/heic', 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('rejected_mime')
  })

  it('should reject unsupported MIME types', () => {
    const result = validateAttachment('image', 'image/avif', 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('unsupported_mime')
  })

  it('should accept files within size limit', () => {
    const result = validateAttachment('file', 'application/pdf', 1024)
    expect(result.valid).toBe(true)
  })

  it('should reject files exceeding size limit', () => {
    const result = validateAttachment('file', 'application/pdf', FILE_MAX_BYTES + 1)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('too_large')
    expect(result.maxSize).toBe(FILE_MAX_BYTES)
  })

  it('should be case insensitive for MIME types', () => {
    const result = validateAttachment('image', 'IMAGE/PNG', 1024)
    expect(result.valid).toBe(true)
  })
})
