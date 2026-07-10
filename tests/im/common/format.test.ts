import { describe, it, expect } from 'vitest'
import { splitMessage, convertMarkdownTablesToBullets, formatImHelp, formatImStatus } from '@electron/im/adapters/common/format'

describe('Format', () => {
  describe('splitMessage', () => {
    it('should return single chunk for short text', () => {
      expect(splitMessage('hello', 100)).toEqual(['hello'])
    })

    it('should split at paragraph break', () => {
      const text = 'First paragraph here.\n\nSecond paragraph here.'
      const chunks = splitMessage(text, 30)
      expect(chunks.length).toBe(2)
    })

    it('should split at newline if no paragraph break', () => {
      const text = 'Line one\nLine two\nLine three'
      const chunks = splitMessage(text, 15)
      expect(chunks.length).toBeGreaterThanOrEqual(2)
    })

    it('should hard cut if no good split point', () => {
      const text = 'a'.repeat(100)
      const chunks = splitMessage(text, 30)
      expect(chunks.length).toBeGreaterThanOrEqual(3)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(30)
      }
    })
  })

  describe('convertMarkdownTablesToBullets', () => {
    it('should convert GFM tables to bullet lists', () => {
      const text = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |'
      const result = convertMarkdownTablesToBullets(text)
      expect(result).not.toContain('| --- |')
      expect(result).toContain('•')
      expect(result).toContain('Alice')
      expect(result).toContain('Bob')
    })

    it('should not convert tables inside code blocks', () => {
      const text = '```\n| Not | A | Table |\n| --- | - | ----- |\n```\n\n| Real | Table |\n| --- | --- |\n| A | B |'
      const result = convertMarkdownTablesToBullets(text)
      // Code block table should be preserved
      expect(result).toContain('| Not | A | Table |')
      // Real table should be converted
      expect(result).toContain('•')
    })
  })

  describe('formatImHelp', () => {
    it('should format help text with commands', () => {
      const help = formatImHelp()
      expect(help).toContain('/new')
      expect(help).toContain('/projects')
      expect(help).toContain('/help')
    })
  })

  describe('formatImStatus', () => {
    it('should format status with emoji', () => {
      const status = formatImStatus('thinking', 'sess1234567890', '/tmp/work', 'My Session')
      expect(status).toContain('💭')
      expect(status).toContain('thinking')
      expect(status).toContain('sess1234...')
      expect(status).toContain('My Session')
      expect(status).toContain('/tmp/work')
    })
  })
})
