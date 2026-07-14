import { describe, it, expect } from 'vitest'
import { parseCommand, isKnownCommand, FEISHU_COMMANDS } from '@electron/im/adapters/feishu/commands'

describe('Feishu Commands', () => {
  describe('parseCommand', () => {
    it('should parse a simple command', () => {
      const result = parseCommand('/new')
      expect(result).toEqual({ command: 'new', args: '' })
    })

    it('should parse a command with args', () => {
      const result = parseCommand('/projects myapp')
      expect(result).toEqual({ command: 'projects', args: 'myapp' })
    })

    it('should be case-insensitive', () => {
      const result = parseCommand('/HELP')
      expect(result).toEqual({ command: 'help', args: '' })
    })

    it('should return null for non-command text', () => {
      expect(parseCommand('hello world')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseCommand('')).toBeNull()
    })

    it('should return null for just a slash', () => {
      expect(parseCommand('/')).toBeNull()
    })

    it('should trim whitespace', () => {
      const result = parseCommand('  /help  ')
      expect(result).toEqual({ command: 'help', args: '' })
    })
  })

  describe('isKnownCommand', () => {
    it('should return true for known commands', () => {
      expect(isKnownCommand('new')).toBe(true)
      expect(isKnownCommand('help')).toBe(true)
      expect(isKnownCommand('pair')).toBe(true)
    })

    it('should return false for unknown commands', () => {
      expect(isKnownCommand('unknown')).toBe(false)
      expect(isKnownCommand('')).toBe(false)
    })
  })

  describe('FEISHU_COMMANDS', () => {
    it('should have 14 commands', () => {
      expect(FEISHU_COMMANDS).toHaveLength(14)
    })

    it('should have non-empty descriptions', () => {
      for (const cmd of FEISHU_COMMANDS) {
        expect(cmd.description).toBeTruthy()
        expect(cmd.command).toBeTruthy()
      }
    })
  })
})
