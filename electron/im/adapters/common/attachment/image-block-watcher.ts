/**
 * ImageBlockWatcher — Scan markdown for image blocks and extract pending uploads
 *
 * Watches streamed text chunks for markdown image syntax: ![alt](src)
 * Uses DJB2 fingerprint to deduplicate images across chunks.
 * Maintains a buffer to handle image blocks that span feed boundaries.
 */

import type { PendingUpload } from './attachment-types'

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g
const MAX_BUFFER = 4096
const TRIM_BUFFER = 2048

/** DJB2 hash function for fingerprinting. */
function djb2(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & 0xffffffff // keep 32-bit
  }
  return hash.toString(16)
}

/** Classify an image target as URL or path. */
function classify(target: string): 'url' | 'path' {
  if (target.startsWith('http://') || target.startsWith('https://')) {
    return 'url'
  }
  return 'path'
}

export class ImageBlockWatcher {
  private buffer: string = ''
  private seenFingerprints: Set<string> = new Set()

  /**
   * Feed a chunk of streamed text. Returns new (unseen) image blocks found.
   * Handles cross-boundary image markdown by retaining unconsumed buffer tail.
   */
  feed(chunk: string): PendingUpload[] {
    this.buffer += chunk

    const results: PendingUpload[] = []
    let lastConsumedEnd = 0

    // Reset regex lastIndex for each scan
    IMAGE_RE.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = IMAGE_RE.exec(this.buffer)) !== null) {
      const [fullMatch, alt, target] = match
      const fingerprint = djb2(`${classify(target)}:${target}`)

      if (!this.seenFingerprints.has(fingerprint)) {
        this.seenFingerprints.add(fingerprint)
        results.push({
          target,
          kind: classify(target),
          alt: alt || undefined,
        })
      }

      lastConsumedEnd = match.index + fullMatch.length
    }

    // Retain unconsumed tail (for cross-boundary matches)
    this.buffer = this.buffer.slice(lastConsumedEnd)

    // Prevent buffer overflow
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-TRIM_BUFFER)
    }

    return results
  }

  /** Reset the watcher state. */
  reset(): void {
    this.buffer = ''
    this.seenFingerprints.clear()
  }
}
