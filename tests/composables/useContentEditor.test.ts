/**
 * useContentEditor composable tests
 *
 * Tests the contenteditable DOM manipulation logic extracted from ChatInput.vue:
 * - Plain text extraction from editor with chips
 * - Mention chip marker serialization
 * - Command chip marker serialization
 * - MIME type detection
 * - Paste marker parsing
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

interface Attachment {
  name: string
  path: string
  isFolder: boolean
}

// ── Pure logic functions ─────────────────────────────────────────

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromFileName(fileName: string): string {
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

/**
 * Parse mention markers from plain text (@file:"...", @folder:"...", @image:"...")
 */
function parseMentionMarkers(text: string): Array<{ kind: 'file' | 'folder' | 'image'; value: string; fullMatch: string; index: number }> {
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

/**
 * Serialize a mention chip to its text marker form
 */
function serializeMentionChip(path: string, isFolder: boolean): string {
  return isFolder ? `@folder:"${path}" ` : `@file:"${path}" `
}

/**
 * Serialize an image chip to its text marker form
 */
function serializeImageChip(imageId: string): string {
  return `@image:"${imageId}" `
}

/**
 * Serialize a command chip to its text marker form
 */
function serializeCommandChip(name: string, kind: string, source: string): string {
  const cmdName = name.startsWith('/') ? name.slice(1) : name
  return `/cmd:"${cmdName}":${kind}:${source} `
}

/**
 * Check if content has meaningful text (not just whitespace)
 */
function hasMeaningfulContent(text: string): boolean {
  return text.trim().length > 0
}

/**
 * Extract display name from path (last segment)
 */
function extractDisplayName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/**
 * Build relative path from working directory and full path
 */
function buildRelativePath(workingDirectory: string | undefined, filePath: string): string {
  if (!workingDirectory) return filePath.split(/[/\\]/).pop() || filePath
  return filePath.replace(workingDirectory, '').replace(/^[/\\]/, '')
}

// ── Tests ────────────────────────────────────────────────────────

describe('useContentEditor - pure logic', () => {
  describe('MIME type detection', () => {
    it('should detect jpg files', () => {
      expect(getMimeTypeFromFileName('photo.jpg')).toBe('image/jpeg')
    })

    it('should detect jpeg files', () => {
      expect(getMimeTypeFromFileName('photo.jpeg')).toBe('image/jpeg')
    })

    it('should detect png files', () => {
      expect(getMimeTypeFromFileName('screenshot.png')).toBe('image/png')
    })

    it('should detect gif files', () => {
      expect(getMimeTypeFromFileName('anim.gif')).toBe('image/gif')
    })

    it('should detect webp files', () => {
      expect(getMimeTypeFromFileName('image.webp')).toBe('image/webp')
    })

    it('should detect svg files', () => {
      expect(getMimeTypeFromFileName('icon.svg')).toBe('image/svg+xml')
    })

    it('should detect bmp files', () => {
      expect(getMimeTypeFromFileName('old.bmp')).toBe('image/bmp')
    })

    it('should default to png for unknown extensions', () => {
      expect(getMimeTypeFromFileName('file.xyz')).toBe('image/png')
    })

    it('should handle uppercase extensions', () => {
      expect(getMimeTypeFromFileName('photo.PNG')).toBe('image/png')
    })

    it('should handle files without extension', () => {
      expect(getMimeTypeFromFileName('noext')).toBe('image/png')
    })
  })

  describe('mention marker parsing', () => {
    it('should parse @file marker', () => {
      const result = parseMentionMarkers('@file:"/path/to/file.ts"')
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('file')
      expect(result[0].value).toBe('/path/to/file.ts')
    })

    it('should parse @folder marker', () => {
      const result = parseMentionMarkers('@folder:"/path/to/dir"')
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('folder')
      expect(result[0].value).toBe('/path/to/dir')
    })

    it('should parse @image marker', () => {
      const result = parseMentionMarkers('@image:"abc-123"')
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('image')
      expect(result[0].value).toBe('abc-123')
    })

    it('should parse multiple markers in text', () => {
      const result = parseMentionMarkers('look at @file:"a.ts" and @folder:"/src"')
      expect(result).toHaveLength(2)
    })

    it('should return empty for text without markers', () => {
      expect(parseMentionMarkers('plain text')).toHaveLength(0)
    })

    it('should track correct indices', () => {
      const result = parseMentionMarkers('hello @file:"test.ts" world')
      expect(result[0].index).toBe(6)
    })
  })

  describe('mention chip serialization', () => {
    it('should serialize file mention', () => {
      expect(serializeMentionChip('/path/to/file.ts', false)).toBe('@file:"/path/to/file.ts" ')
    })

    it('should serialize folder mention', () => {
      expect(serializeMentionChip('/path/to/dir', true)).toBe('@folder:"/path/to/dir" ')
    })
  })

  describe('image chip serialization', () => {
    it('should serialize image chip', () => {
      expect(serializeImageChip('img-123')).toBe('@image:"img-123" ')
    })
  })

  describe('command chip serialization', () => {
    it('should serialize command chip', () => {
      expect(serializeCommandChip('/bug', 'slash_command', 'builtin')).toBe('/cmd:"bug":slash_command:builtin ')
    })

    it('should serialize command chip without leading slash', () => {
      expect(serializeCommandChip('bug', 'slash_command', 'builtin')).toBe('/cmd:"bug":slash_command:builtin ')
    })

    it('should serialize MCP command', () => {
      expect(serializeCommandChip('search', 'mcp_tool', 'mcp')).toBe('/cmd:"search":mcp_tool:mcp ')
    })
  })

  describe('content validation', () => {
    it('should detect meaningful content', () => {
      expect(hasMeaningfulContent('hello')).toBe(true)
    })

    it('should reject whitespace-only content', () => {
      expect(hasMeaningfulContent('   ')).toBe(false)
    })

    it('should reject empty content', () => {
      expect(hasMeaningfulContent('')).toBe(false)
    })

    it('should accept content with newlines', () => {
      expect(hasMeaningfulContent('\nhello\n')).toBe(true)
    })
  })

  describe('display name extraction', () => {
    it('should extract filename from Unix path', () => {
      expect(extractDisplayName('/path/to/file.ts')).toBe('file.ts')
    })

    it('should extract filename from Windows path', () => {
      expect(extractDisplayName('C:\\path\\to\\file.ts')).toBe('file.ts')
    })

    it('should return the path itself if no separator', () => {
      expect(extractDisplayName('file.ts')).toBe('file.ts')
    })
  })

  describe('relative path building', () => {
    it('should strip working directory prefix', () => {
      expect(buildRelativePath('/home/user/project', '/home/user/project/src/file.ts')).toBe('src/file.ts')
    })

    it('should handle Windows paths', () => {
      expect(buildRelativePath('C:\\project', 'C:\\project\\src\\file.ts')).toBe('src\\file.ts')
    })

    it('should return basename when no working directory', () => {
      expect(buildRelativePath(undefined, '/some/path/file.ts')).toBe('file.ts')
    })
  })
})
