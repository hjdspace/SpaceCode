import { describe, it, expect } from 'vitest'
import { parseCommand, isKnownCommand, WHATSAPP_COMMANDS } from '@electron/im/adapters/whatsapp/commands'

describe('WhatsApp Commands', () => {
  describe('parseCommand', () => {
    it('should parse a simple command', () => {
      expect(parseCommand('/new')).toEqual({ command: 'new', args: '' })
    })

    it('should parse a command with args', () => {
      expect(parseCommand('/pair CODE123')).toEqual({ command: 'pair', args: 'CODE123' })
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

  describe('WHATSAPP_COMMANDS', () => {
    it('should have 14 commands', () => {
      expect(WHATSAPP_COMMANDS).toHaveLength(14)
    })
  })
})
