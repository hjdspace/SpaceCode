/**
 * useDragDrop composable tests
 *
 * Tests the drag-and-drop logic extracted from ChatInput.vue:
 * - Drag content detection
 * - Drop data extraction
 */
import { describe, it, expect } from 'vitest'

// ── Pure logic functions ─────────────────────────────────────────

/**
 * Check if a drag event has droppable content
 */
function hasDragContent(dataTransferTypes: string[], files: Array<{ type: string }>): boolean {
  if (dataTransferTypes.includes('application/x-claude-path')) return true
  if (dataTransferTypes.includes('Files')) {
    return files.some(file => file.type.startsWith('image/'))
  }
  return false
}

/**
 * Extract dropped data from a drop event
 */
function extractDropData(dataTransfer: {
  getData: (type: string) => string
  files: Array<{ type: string; name: string }>
}): { type: 'tree-path'; path: string; isFolder: boolean; name: string } | { type: 'image-files'; files: Array<{ type: string; name: string }> } | null {
  const claudePath = dataTransfer.getData('application/x-claude-path')
  if (claudePath) {
    const nodeType = dataTransfer.getData('application/x-claude-type')
    const name = claudePath.split(/[/\\]/).pop() || claudePath
    return {
      type: 'tree-path',
      path: claudePath,
      isFolder: nodeType === 'directory',
      name,
    }
  }

  const imageFiles = Array.from(dataTransfer.files).filter(f => f.type.startsWith('image/'))
  if (imageFiles.length > 0) {
    return { type: 'image-files', files: imageFiles }
  }

  return null
}

// ── Tests ────────────────────────────────────────────────────────

describe('useDragDrop - pure logic', () => {
  describe('drag content detection', () => {
    it('should detect tree path drag', () => {
      expect(hasDragContent(['application/x-claude-path'], [])).toBe(true)
    })

    it('should detect image file drag', () => {
      expect(hasDragContent(['Files'], [{ type: 'image/png' }])).toBe(true)
    })

    it('should not detect non-image file drag', () => {
      expect(hasDragContent(['Files'], [{ type: 'text/plain' }])).toBe(false)
    })

    it('should not detect empty drag', () => {
      expect(hasDragContent([], [])).toBe(false)
    })

    it('should not detect text-only drag', () => {
      expect(hasDragContent(['text/plain'], [])).toBe(false)
    })
  })

  describe('drop data extraction', () => {
    it('should extract tree path data', () => {
      const result = extractDropData({
        getData: (type: string) => type === 'application/x-claude-path' ? '/src/file.ts' : (type === 'application/x-claude-type' ? 'file' : ''),
        files: [],
      })
      expect(result).toEqual({
        type: 'tree-path',
        path: '/src/file.ts',
        isFolder: false,
        name: 'file.ts',
      })
    })

    it('should extract folder from tree path', () => {
      const result = extractDropData({
        getData: (type: string) => type === 'application/x-claude-path' ? '/src/components' : (type === 'application/x-claude-type' ? 'directory' : ''),
        files: [],
      })
      expect(result).toEqual({
        type: 'tree-path',
        path: '/src/components',
        isFolder: true,
        name: 'components',
      })
    })

    it('should extract image files', () => {
      const result = extractDropData({
        getData: () => '',
        files: [{ type: 'image/png', name: 'screenshot.png' }],
      })
      expect(result).toEqual({
        type: 'image-files',
        files: [{ type: 'image/png', name: 'screenshot.png' }],
      })
    })

    it('should return null for empty drop', () => {
      const result = extractDropData({
        getData: () => '',
        files: [],
      })
      expect(result).toBeNull()
    })

    it('should filter out non-image files', () => {
      const result = extractDropData({
        getData: () => '',
        files: [{ type: 'text/plain', name: 'doc.txt' }],
      })
      expect(result).toBeNull()
    })
  })
})
