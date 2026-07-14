import { describe, it, expect } from 'vitest'
import { parseCommand, isKnownCommand, WECHAT_COMMANDS } from '@electron/im/adapters/wechat/commands'

describe('WeChat Commands', () => {
  describe('parseCommand', () => {
    it('should parse a simple command', () => {
      expect(parseCommand('/new')).toEqual({ command: 'new', args: '' })
    })

    it('should parse a command with args', () => {
      expect(parseCommand('/pair ABC123')).toEqual({ command: 'pair', args: 'ABC123' })
    })

    it('should be case-insensitive', () => {
      expect(parseCommand('/HELP')).toEqual({ command: 'help', args: '' })
    })

    it('should return null for non-command text', () => {
      expect(parseCommand('hello')).toBeNull()
    })
  })

  describe('isKnownCommand', () => {
    it('should return true for known commands', () => {
      expect(isKnownCommand('new')).toBe(true)
      expect(isKnownCommand('help')).toBe(true)
    })

    it('should return false for unknown', () => {
      expect(isKnownCommand('foo')).toBe(false)
    })
  })

  describe('WECHAT_COMMANDS', () => {
    it('should have 14 commands', () => {
      expect(WECHAT_COMMANDS).toHaveLength(14)
    })
  })
})
