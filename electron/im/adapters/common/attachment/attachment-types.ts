/**
 * Attachment Types — Type definitions for the attachment subsystem
 */

export type AttachmentType = 'file' | 'image'

export interface IncomingAttachment {
  type: AttachmentType
  name: string
  mimeType: string
  size: number
  data: Buffer // raw binary data
}

export interface StoredAttachment {
  type: AttachmentType
  name: string
  mimeType: string
  path: string // absolute path to stored file
  size: number
}

export interface AttachmentRef {
  type: AttachmentType
  name?: string
  path?: string
  data?: string // base64
  mimeType?: string
}

export interface PendingUpload {
  target: string // URL or path to upload
  kind: 'url' | 'path'
  alt?: string
}
