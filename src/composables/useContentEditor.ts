/**
 * useContentEditor - ContentEditable DOM manipulation logic extracted from ChatInput.vue
 *
 * Manages:
 * - Plain text extraction from contenteditable with chip serialization
 * - Mention/command/image chip insertion
 * - Trigger text removal
 * - Paste handling with marker conversion
 * - Cursor management
 * - Auto-resize
 */
import { ref, nextTick } from 'vue'
import { pathBasename } from '@/utils/mention-chips'
import type { ImageAttachment, Attachment } from '@/composables/types'

// ── Pure logic (exported for testing) ──────────────────────────

/** Get MIME type from file extension */
export function getMimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/png'
  }
}

/** Parse mention markers from plain text */
export function parseMentionMarkers(text: string): Array<{ kind: 'file' | 'folder' | 'image'; value: string; fullMatch: string; index: number }> {
  const MARKER_RE = /@(file|folder|image):"([^"]+)"/g
  const results: Array<{ kind: 'file' | 'folder' | 'image'; value: string; fullMatch: string; index: number }> = []
  let match: RegExpExecArray | null
  while ((match = MARKER_RE.exec(text)) !== null) {
    results.push({
      kind: match[1] as 'file' | 'folder' | 'image',
      value: match[2],
      fullMatch: match[0],
      index: match.index,
    })
  }
  return results
}

/** Serialize a mention chip to its text marker form */
export function serializeMentionChip(path: string, isFolder: boolean): string {
  return isFolder ? `@folder:"${path}" ` : `@file:"${path}" `
}

/** Serialize an image chip to its text marker form */
export function serializeImageChip(imageId: string): string {
  return `@image:"${imageId}" `
}

/** Serialize a command chip to its text marker form */
export function serializeCommandChip(name: string, kind: string, source: string): string {
  const cmdName = name.startsWith('/') ? name.slice(1) : name
  return `/cmd:"${cmdName}":${kind}:${source} `
}

/** Check if content has meaningful text */
export function hasMeaningfulContent(text: string): boolean {
  return text.trim().length > 0
}

/** Extract display name from path (last segment) */
export function extractDisplayName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/** Build relative path from working directory and full path */
export function buildRelativePath(workingDirectory: string | undefined, filePath: string): string {
  if (!workingDirectory) return filePath.split(/[/\\]/).pop() || filePath
  return filePath.replace(workingDirectory, '').replace(/^[/\\]/, '')
}

// ── Composable ─────────────────────────────────────────────────

export function useContentEditor(options?: {
  disabled?: () => boolean
}) {
  const editorRef = ref<HTMLElement | null>(null)
  const containerRef = ref<HTMLElement | null>(null)
  const inputText = ref('')

  // ── Text extraction ────────────────────────────────────────────

  /** Extract plain text from contenteditable, replacing chips with markers */
  function getEditorPlainText(): string {
    const editor = editorRef.value
    if (!editor) return ''

    function walkNodes(parent: Node): string {
      let text = ''
      for (const node of Array.from(parent.childNodes)) {
        if (node instanceof Element && node.classList.contains('mention-chip')) {
          const path = node.getAttribute('data-path')
          const imageId = node.getAttribute('data-image-id')
          if (imageId) {
            text += serializeImageChip(imageId)
          } else if (path) {
            const isFolder = node.getAttribute('data-is-folder') === 'true'
            text += serializeMentionChip(path, isFolder)
          }
        } else if (node instanceof Element && node.classList.contains('command-chip')) {
          const command = node.getAttribute('data-command') || ''
          const kind = node.getAttribute('data-kind') || 'slash_command'
          const source = node.getAttribute('data-source') || 'builtin'
          text += serializeCommandChip(command, kind, source)
        } else if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || ''
        } else if (node instanceof Element && node.tagName === 'BR') {
          text += '\n'
        } else if (node instanceof Element) {
          text += walkNodes(node)
          if (node.tagName === 'DIV' && node.nextSibling) {
            text += '\n'
          }
        }
      }
      return text
    }

    return walkNodes(editor)
  }

  // ── Cursor management ──────────────────────────────────────────

  /** Extract text before cursor in the contenteditable */
  function getTextBeforeCursor(): string {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return ''
    const range = sel.getRangeAt(0)
    const preRange = range.cloneRange()
    preRange.selectNodeContents(editorRef.value!)
    preRange.setEnd(range.startContainer, range.startOffset)
    return preRange.toString()
  }

  /** Get cursor offset relative to editor text content start */
  function getCursorOffset(): number {
    return getTextBeforeCursor().length
  }

  /** Set cursor to end of editor content */
  function setCursorToEnd() {
    const editor = editorRef.value
    if (!editor) return
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // ── Chip insertion ─────────────────────────────────────────────

  /** Insert an inline mention chip at current cursor position */
  function insertMentionChip(name: string, path: string, isFolder: boolean) {
    const editor = editorRef.value
    if (!editor) return

    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return

    const range = sel.getRangeAt(0)
    const chip = document.createElement('span')
    chip.className = `mention-chip${isFolder ? ' is-folder' : ''}`
    chip.setAttribute('contenteditable', 'false')
    chip.setAttribute('data-path', path)
    chip.setAttribute('data-is-folder', String(isFolder))

    const icon = document.createElement('span')
    icon.className = 'chip-icon'
    icon.textContent = isFolder ? '📁' : '📄'

    const nameSpan = document.createElement('span')
    nameSpan.className = 'chip-name'
    nameSpan.textContent = name

    chip.appendChild(icon)
    chip.appendChild(nameSpan)

    range.deleteContents()
    range.insertNode(chip)

    const afterRange = document.createRange()
    afterRange.setStartAfter(chip)
    afterRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(afterRange)

    const spaceNode = document.createTextNode('\u00A0')
    afterRange.insertNode(spaceNode)

    const finalRange = document.createRange()
    finalRange.setStartAfter(spaceNode)
    finalRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(finalRange)

    inputText.value = getEditorPlainText()
  }

  /** Insert an inline command chip at current cursor position */
  function insertCommandChip(cmd: { name: string; kind?: string; source?: string }) {
    const editor = editorRef.value
    if (!editor) return

    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return

    const range = sel.getRangeAt(0)
    const kind = cmd.kind || 'slash_command'
    const source = cmd.source || 'builtin'

    const sourceIcons: Record<string, string> = {
      builtin: '⚡', bundled: '📦', global: '🌐',
      project: '📂', plugin: '🧩', mcp: '🔌',
    }

    const chip = document.createElement('span')
    chip.className = `command-chip kind-${kind} source-${source}`
    chip.setAttribute('contenteditable', 'false')
    chip.setAttribute('data-command', `/${cmd.name}`)
    chip.setAttribute('data-kind', kind)
    chip.setAttribute('data-source', source)

    const iconSpan = document.createElement('span')
    iconSpan.className = 'chip-source-icon'
    iconSpan.textContent = sourceIcons[source] || '⚡'

    const labelSpan = document.createElement('span')
    labelSpan.className = 'chip-label'
    labelSpan.textContent = `/${cmd.name}`

    chip.appendChild(iconSpan)
    chip.appendChild(labelSpan)

    range.deleteContents()
    range.insertNode(chip)

    const afterRange = document.createRange()
    afterRange.setStartAfter(chip)
    afterRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(afterRange)

    const spaceNode = document.createTextNode('\u00A0')
    afterRange.insertNode(spaceNode)

    const finalRange = document.createRange()
    finalRange.setStartAfter(spaceNode)
    finalRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(finalRange)

    inputText.value = getEditorPlainText()
  }

  /** Insert image chip */
  function insertImageChip(image: ImageAttachment) {
    const editor = editorRef.value
    if (!editor) return

    const chip = document.createElement('span')
    chip.className = 'mention-chip is-image'
    chip.setAttribute('data-image-id', image.id)
    chip.setAttribute('contenteditable', 'false')

    const icon = document.createElement('span')
    icon.className = 'chip-icon'
    icon.textContent = '🖼️'

    const name = document.createElement('span')
    name.className = 'chip-name'
    name.textContent = image.name

    chip.appendChild(icon)
    chip.appendChild(name)

    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(chip)

      const space = document.createTextNode('\u00A0')
      range.collapse(false)
      range.insertNode(space)

      const finalRange = document.createRange()
      finalRange.setStartAfter(space)
      finalRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(finalRange)
    } else {
      editor.appendChild(chip)
      editor.appendChild(document.createTextNode('\u00A0'))
    }

    inputText.value = getEditorPlainText()
  }

  // ── Trigger text removal ───────────────────────────────────────

  /** Remove trigger text (@query or /query) from contenteditable by character offset */
  function removeTriggerText(triggerOffset: number, length: number) {
    const editor = editorRef.value
    if (!editor) return

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null)
    let charCount = 0
    let node: Text | null
    let remaining = length
    let cursorNode: Text | null = null
    let cursorOffset = 0

    while ((node = walker.nextNode() as Text | null)) {
      const nodeLen = node.textContent?.length || 0

      if (charCount + nodeLen > triggerOffset && remaining > 0) {
        const startInNode = Math.max(0, triggerOffset - charCount)
        const deleteLen = Math.min(remaining, nodeLen - startInNode)

        if (node.textContent) {
          const before = node.textContent.slice(0, startInNode)
          const after = node.textContent.slice(startInNode + deleteLen)
          node.textContent = before + after
          remaining -= deleteLen
        }

        if (!cursorNode) {
          cursorNode = node
          cursorOffset = startInNode
        }

        if (remaining <= 0) break
      }
      charCount += nodeLen
    }

    if (cursorNode) {
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.setStart(cursorNode, cursorOffset)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }

  // ── Editor content management ──────────────────────────────────

  function setEditorContent(text: string) {
    const editor = editorRef.value
    if (!editor) return
    editor.textContent = text
    inputText.value = text
  }

  function clearEditor() {
    const editor = editorRef.value
    if (!editor) return
    editor.innerHTML = ''
    inputText.value = ''
  }

  /** Collect all mention chips data from editor */
  function collectMentions(): Attachment[] {
    const editor = editorRef.value
    if (!editor) return []
    const chips = editor.querySelectorAll('.mention-chip')
    return Array.from(chips).map(chip => ({
      name: chip.querySelector('.chip-name')?.textContent || '',
      path: chip.getAttribute('data-path') || '',
      isFolder: chip.getAttribute('data-is-folder') === 'true'
    }))
  }

  /** Collect all attachments (files and images) from editor */
  function collectAllAttachments(attachedFiles: Attachment[], attachedImages: ImageAttachment[]) {
    const mentions = collectMentions()
    return {
      files: mentions,
      images: [...attachedImages]
    }
  }

  // ── Auto-resize ────────────────────────────────────────────────

  function autoResize() {
    const editor = editorRef.value
    if (editor) {
      editor.style.height = 'auto'
      editor.style.height = Math.min(editor.scrollHeight, 200) + 'px'
    }
  }

  // ── Focus ──────────────────────────────────────────────────────

  function focusEditor() {
    nextTick(() => {
      const editor = editorRef.value
      if (!editor || options?.disabled?.()) return
      editor.focus()
      if (!window.getSelection()?.rangeCount) {
        setCursorToEnd()
      }
      autoResize()
    })
  }

  // ── Paste handling ─────────────────────────────────────────────

  /** Build a chip element from a marker */
  function buildChipElementFromMarker(kind: 'file' | 'folder' | 'image', value: string): HTMLElement {
    const isFolder = kind === 'folder'
    const isImage = kind === 'image'
    const chip = document.createElement('span')
    let className = 'mention-chip'
    if (isFolder) className += ' is-folder'
    if (isImage) className += ' is-image'
    chip.className = className
    chip.setAttribute('contenteditable', 'false')
    if (isImage) {
      chip.setAttribute('data-image-id', value)
    } else {
      chip.setAttribute('data-path', value)
      chip.setAttribute('data-is-folder', String(isFolder))
    }

    const icon = document.createElement('span')
    icon.className = 'chip-icon'
    icon.textContent = isImage ? '🖼️' : (isFolder ? '📁' : '📄')

    const nameSpan = document.createElement('span')
    nameSpan.className = 'chip-name'
    nameSpan.textContent = isImage ? value : (pathBasename(value) || value)

    chip.appendChild(icon)
    chip.appendChild(nameSpan)
    return chip
  }

  /** Insert pasted plain text at the cursor, converting any mention markers back into chips */
  function insertPastedTextWithMarkers(text: string) {
    if (!text) return
    const MARKER_RE = /@(file|folder|image):"([^"]+)"/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    let inserted = false

    while ((match = MARKER_RE.exec(text)) !== null) {
      const [full, kind, value] = match
      const before = text.slice(lastIndex, match.index)
      if (before) {
        document.execCommand('insertText', false, before)
      }

      const chip = buildChipElementFromMarker(kind as 'file' | 'folder' | 'image', value)
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(chip)
        const after = document.createRange()
        after.setStartAfter(chip)
        after.collapse(true)
        sel.removeAllRanges()
        sel.addRange(after)
      } else {
        editorRef.value?.appendChild(chip)
      }

      lastIndex = match.index + full.length
      inserted = true
    }

    const tail = text.slice(lastIndex)
    if (tail) {
      document.execCommand('insertText', false, tail)
    }

    if (inserted) {
      inputText.value = getEditorPlainText()
    }
  }

  // ── Has content check ──────────────────────────────────────────

  function hasContent(attachedFiles: Attachment[], attachedImages: ImageAttachment[]): boolean {
    if (inputText.value.trim().length > 0) return true
    if (attachedFiles.length > 0) return true

    const editor = editorRef.value
    if (!editor) return false
    if (editor.textContent?.trim()) return true
    return editor.querySelectorAll('.mention-chip, .command-chip').length > 0
  }

  return {
    // State
    editorRef,
    containerRef,
    inputText,

    // Text extraction
    getEditorPlainText,
    getTextBeforeCursor,
    getCursorOffset,

    // Cursor management
    setCursorToEnd,
    focusEditor,

    // Chip insertion
    insertMentionChip,
    insertCommandChip,
    insertImageChip,

    // Trigger text removal
    removeTriggerText,

    // Editor content management
    setEditorContent,
    clearEditor,
    collectMentions,
    collectAllAttachments,

    // Auto-resize
    autoResize,

    // Paste handling
    buildChipElementFromMarker,
    insertPastedTextWithMarkers,

    // Content check
    hasContent,
  }
}
