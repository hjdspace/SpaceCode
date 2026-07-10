/**
 * Attachment Limits — Size and MIME type validation for attachments
 */

import type { AttachmentType } from './attachment-types'

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024 // 10MB
export const FILE_MAX_BYTES = 30 * 1024 * 1024 // 30MB

export const IMAGE_MIME_WHITELIST = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
])

// Explicitly reject HEIC (Apple's format) — many platforms don't support it
export const IMAGE_MIME_BLACKLIST = new Set([
  'image/heic',
  'image/heif',
])

export interface ValidationResult {
  valid: boolean
  error?: 'too_large' | 'unsupported_mime' | 'rejected_mime'
  maxSize?: number
}

export function validateAttachment(
  type: AttachmentType,
  mimeType: string,
  size: number
): ValidationResult {
  if (type === 'image') {
    if (size > IMAGE_MAX_BYTES) {
      return { valid: false, error: 'too_large', maxSize: IMAGE_MAX_BYTES }
    }

    if (IMAGE_MIME_BLACKLIST.has(mimeType.toLowerCase())) {
      return { valid: false, error: 'rejected_mime' }
    }

    if (!IMAGE_MIME_WHITELIST.has(mimeType.toLowerCase())) {
      return { valid: false, error: 'unsupported_mime' }
    }
  } else {
    if (size > FILE_MAX_BYTES) {
      return { valid: false, error: 'too_large', maxSize: FILE_MAX_BYTES }
    }
  }

  return { valid: true }
}
