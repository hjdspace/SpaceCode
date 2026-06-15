/**
 * useFileAttachments composable tests
 *
 * Tests the file attachment logic extracted from ChatInput.vue:
 * - Duplicate detection
 * - Relative path building
 */
import { describe, it, expect } from 'vitest'

// ── Pure logic functions ─────────────────────────────────────────

interface FileEntry {
  name: string
  path: string
  isFolder: boolean
}

/**
 * Build relative path from working directory and full path
 */
function buildRelativePath(workingDirectory: string | undefined, filePath: string): string {
  if (!workingDirectory) return filePath.split(/[/\\]/).pop() || filePath
  return filePath.replace(workingDirectory, '').replace(/^[/\\]/, '')
}

/**
 * Check if file is already attached
 */
function isDuplicateAttachment(files: FileEntry[], path: string): boolean {
  return files.some(f => f.path === path)
}

/**
 * Create a file attachment entry
 */
function createFileAttachment(name: string, path: string, isFolder: boolean): FileEntry {
  return { name, path, isFolder }
}

/**
 * Extract display name from path
 */
function extractDisplayName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

// ── Tests ────────────────────────────────────────────────────────

describe('useFileAttachments - pure logic', () => {
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

  describe('duplicate detection', () => {
    const files: FileEntry[] = [
      { name: 'a.ts', path: '/a.ts', isFolder: false },
      { name: 'b.ts', path: '/b.ts', isFolder: false },
    ]

    it('should detect duplicate path', () => {
      expect(isDuplicateAttachment(files, '/a.ts')).toBe(true)
    })

    it('should not flag new path as duplicate', () => {
      expect(isDuplicateAttachment(files, '/c.ts')).toBe(false)
    })

    it('should handle empty list', () => {
      expect(isDuplicateAttachment([], '/a.ts')).toBe(false)
    })
  })

  describe('file attachment creation', () => {
    it('should create file attachment', () => {
      const result = createFileAttachment('file.ts', '/path/file.ts', false)
      expect(result).toEqual({ name: 'file.ts', path: '/path/file.ts', isFolder: false })
    })

    it('should create folder attachment', () => {
      const result = createFileAttachment('src', '/path/src', true)
      expect(result).toEqual({ name: 'src', path: '/path/src', isFolder: true })
    })
  })

  describe('display name extraction', () => {
    it('should extract from Unix path', () => {
      expect(extractDisplayName('/path/to/file.ts')).toBe('file.ts')
    })

    it('should extract from Windows path', () => {
      expect(extractDisplayName('C:\\path\\to\\file.ts')).toBe('file.ts')
    })

    it('should handle plain filename', () => {
      expect(extractDisplayName('file.ts')).toBe('file.ts')
    })
  })
})
