import { describe, it, expect } from 'vitest'
import { parseCommand, isKnownCommand, DINGTALK_COMMANDS } from '@electron/im/adapters/dingtalk/commands'

describe('DingTalk Commands', () => {
  describe('parseCommand', () => {
    it('should parse a simple command', () => {
      const result = parseCommand('/new')
      expect(result).toEqual({ command: 'new', args: '' })
    })

    it('should parse a command with args', () => {
      const result = parseCommand('/pair CODE123')
      expect(result).toEqual({ command: 'pair', args: 'CODE123' })
    })

    it('should be case-insensitive', () => {
      const result = parseCommand('/STATUS')
      expect(result).toEqual({ command: 'status', args: '' })
    })

    it('should return null for non-command text', () => {
      expect(parseCommand('hello')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseCommand('')).toBeNull()
    })
  })

  describe('isKnownCommand', () => {
    it('should return true for known commands', () => {
      expect(isKnownCommand('new')).toBe(true)
      expect(isKnownCommand('help')).toBe(true)
    })

    it('should return false for unknown commands', () => {
      expect(isKnownCommand('unknown')).toBe(false)
    })
  })

  describe('DINGTALK_COMMANDS', () => {
    it('should have 14 commands', () => {
      expect(DINGTALK_COMMANDS).toHaveLength(14)
    })
  })
})
