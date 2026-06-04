/**
 * Shared utilities for rendering "@file"/"@folder"/"@image" mention markers as
 * inline chips in chat messages.
 *
 * The ChatInput editor serializes inline chips to plain-text markers
 * like `@file:"<path>"` / `@folder:"<path>"` / `@image:"<id>"` when the user sends a
 * message. We use these utilities to transform those markers back into
 * styled HTML chips when displaying messages (both user and assistant).
 *
 * Path handling supports both forward and backward slashes so Windows
 * paths (e.g. `D:\AI\SpaceCode\electron`) render the trailing segment
 * as the chip label.
 */

import type { ImageAttachment } from '@/types'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Extract the "name" (trailing segment) from a file/folder path.
 * Supports both `/` and `\` separators.
 */
export function pathBasename(path: string): string {
  if (!path) return ''
  // Strip trailing separators, then take the last segment.
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/**
 * Build the HTML for a single mention chip.
 */
function buildChipHtml(path: string, isFolder: boolean): string {
  const name = pathBasename(path) || path
  const icon = isFolder ? '📁' : '📄'
  const chipClass = isFolder ? 'mention-chip is-folder' : 'mention-chip'
  // data-path / data-is-folder are used by the copy handler to reconstruct
  // the original `@file:"<path>"` / `@folder:"<path>"` markers, so that
  // copy-pasting a sent user message round-trips back into the editor as
  // a chip rather than introducing stray newlines from inline-flex serialization.
  return (
    `<span class="${chipClass}" title="${escapeHtml(path)}" data-path="${escapeHtml(path)}" data-is-folder="${isFolder ? 'true' : 'false'}">` +
    `<span class="chip-icon">${icon}</span>` +
    `<span class="chip-name">${escapeHtml(name)}</span>` +
    `</span>`
  )
}

/**
 * Build the HTML for an image preview chip.
 */
function buildImageChipHtml(image: ImageAttachment): string {
  return (
    `<span class="mention-chip is-image" data-image-id="${escapeHtml(image.id)}">` +
    `<span class="chip-icon">🖼️</span>` +
    `<span class="chip-name">${escapeHtml(image.name)}</span>` +
    `</span>`
  )
}

/** Source icon mapping */
const SOURCE_ICONS: Record<string, string> = {
  builtin: '⚡',
  bundled: '📦',
  global: '🌐',
  project: '📂',
  plugin: '🧩',
  mcp: '🔌',
}

/**
 * Build the HTML for a single command chip.
 */
function buildCommandChipHtml(name: string, kind: string, source: string): string {
  const icon = SOURCE_ICONS[source] || '⚡'
  const chipClass = `command-chip kind-${kind} source-${source}`
  return (
    `<span class="${chipClass}" data-command="/${escapeHtml(name)}" data-kind="${escapeHtml(kind)}" data-source="${escapeHtml(source)}">` +
    `<span class="chip-source-icon">${icon}</span>` +
    `<span class="chip-label">/${escapeHtml(name)}</span>` +
    `<span class="chip-source-tag">${escapeHtml(source)}</span>` +
    `</span>`
  )
}

/**
 * Replace `@file:"<path>"` / `@folder:"<path>"` markers with HTML chip
 * spans, leaving all other text untouched. Use this when the surrounding
 * text is further processed (e.g. fed into a Markdown renderer), where
 * escaping the rest of the content would break formatting.
 */
export function replaceMentionChipMarkers(text: string): string {
  if (!text) return ''
  return text.replace(/@(file|folder):"([^"]+)"/g, (_match, kind, path) =>
    buildChipHtml(path, kind === 'folder')
  )
}

/**
 * Replace mention markers with chip HTML AND HTML-escape all surrounding
 * text. Returns a string safe to insert via v-html where the input is
 * plain text (e.g. user messages).
 */
export function renderMentionChipsToHtml(text: string): string {
  if (!text) return ''

  const MARKER_RE = /@(file|folder):"([^"]+)"/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = MARKER_RE.exec(text)) !== null) {
    const [full, kind, path] = match
    result += escapeHtml(text.slice(lastIndex, match.index))
    result += buildChipHtml(path, kind === 'folder')
    lastIndex = match.index + full.length
  }

  result += escapeHtml(text.slice(lastIndex))
  return result
}

/**
 * Replace /cmd:"name":kind:source markers with HTML command chip spans,
 * leaving all other text untouched.
 */
export function replaceCommandChipMarkers(text: string): string {
  if (!text) return ''
  return text.replace(/\/cmd:"([^"]+)":(\w+):(\w+)/g, (_match, name, kind, source) =>
    buildCommandChipHtml(name, kind, source)
  )
}

/**
 * Replace command markers with chip HTML AND HTML-escape all surrounding text.
 * Returns a string safe to insert via v-html where the input is plain text.
 */
export function renderCommandChipsToHtml(text: string): string {
  if (!text) return ''

  const CMD_MARKER_RE = /\/cmd:"([^"]+)":(\w+):(\w+)/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = CMD_MARKER_RE.exec(text)) !== null) {
    const [full, name, kind, source] = match
    result += escapeHtml(text.slice(lastIndex, match.index))
    result += buildCommandChipHtml(name, kind, source)
    lastIndex = match.index + full.length
  }

  result += escapeHtml(text.slice(lastIndex))
  return result
}

/**
 * Render mention chips and image previews together.
 */
export function renderContentWithAttachments(text: string, images?: ImageAttachment[]): string {
  if (!text) return ''

  const imageMap = new Map(images?.map(img => [img.id, img]) || [])

  const MARKER_RE = /@(file|folder|image):"([^"]+)"|\/cmd:"([^"]+)":(\w+):(\w+)/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = MARKER_RE.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index))

    if (match[3] !== undefined) {
      // Command chip marker: /cmd:"name":kind:source
      result += buildCommandChipHtml(match[3], match[4], match[5])
    } else if (match[1] === 'image') {
      const img = imageMap.get(match[2])
      if (img) {
        result += buildImageChipHtml(img)
      } else {
        result += escapeHtml(match[0])
      }
    } else {
      // file or folder
      result += buildChipHtml(match[2], match[1] === 'folder')
    }

    lastIndex = match.index + match[0].length
  }

  result += escapeHtml(text.slice(lastIndex))
  return result
}

/**
 * Generate a plain text string that includes image markers.
 */
export function buildContentWithMarkers(text: string, attachments: any[]): string {
  let content = text || ''
  
  // Add @file / @folder markers
  // This will be used when sending messages
  return content
}
