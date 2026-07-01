import { describe, it, expect } from 'vitest'
import { iconFor, formatSize } from '@/utils/artifactFormat'

describe('iconFor', () => {
  it('maps known extensions to emoji', () => {
    expect(iconFor('pptx')).toBe('📊')
    expect(iconFor('docx')).toBe('📝')
    expect(iconFor('xlsx')).toBe('📈')
    expect(iconFor('html')).toBe('🌐')
    expect(iconFor('pdf')).toBe('📄')
  })

  it('falls back to a generic icon for unknown extensions', () => {
    expect(iconFor('xyz')).toBe('📁')
    expect(iconFor('')).toBe('📁')
  })
})

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(512)).toBe('512 B')
  })
  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0 KB')
  })
  it('formats megabytes', () => {
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
