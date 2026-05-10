/**
 * Shared utilities for rendering "@file"/"@folder" mention markers as
 * inline chips in chat messages.
 *
 * The ChatInput editor serializes inline chips to plain-text markers
 * like `@file:"<path>"` / `@folder:"<path>"` when the user sends a
 * message. We use these utilities to transform those markers back into
 * styled HTML chips when displaying messages (both user and assistant).
 *
 * Path handling supports both forward and backward slashes so Windows
 * paths (e.g. `D:\AI\SpaceCode\electron`) render the trailing segment
 * as the chip label.
 */

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
  return (
    `<span class="${chipClass}" title="${escapeHtml(path)}">` +
    `<span class="chip-icon">${icon}</span>` +
    `<span class="chip-name">${escapeHtml(name)}</span>` +
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
