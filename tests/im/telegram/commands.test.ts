import { describe, it, expect } from 'vitest'
import { parseCommand, isKnownCommand, TELEGRAM_COMMANDS } from '@electron/im/adapters/telegram/commands'

describe('Commands', () => {
  describe('parseCommand', () => {
    it('should parse a simple command', () => {
      const result = parseCommand('/new')
      expect(result).toEqual({ command: 'new', args: '' })
    })

    it('should parse a command with args', () => {
      const result = parseCommand('/projects myapp')
      expect(result).toEqual({ command: 'projects', args: 'myapp' })
    })

    it('should parse a command with multiple args', () => {
      const result = parseCommand('/pair ABC123')
      expect(result).toEqual({ command: 'pair', args: 'ABC123' })
    })

    it('should be case-insensitive for command name', () => {
      const result = parseCommand('/NEW')
      expect(result).toEqual({ command: 'new', args: '' })
    })

    it('should strip bot mention suffix', () => {
      const result = parseCommand('/new@mybot')
      expect(result).toEqual({ command: 'new', args: '' })
    })

    it('should strip bot mention with args', () => {
      const result = parseCommand('/projects@mybot myapp')
      expect(result).toEqual({ command: 'projects', args: 'myapp' })
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
      expect(isKnownCommand('projects')).toBe(true)
      expect(isKnownCommand('pair')).toBe(true)
    })

    it('should return false for unknown commands', () => {
      expect(isKnownCommand('unknown')).toBe(false)
      expect(isKnownCommand('foo')).toBe(false)
    })
  })

  describe('TELEGRAM_COMMANDS', () => {
    it('should have 14 commands', () => {
      expect(TELEGRAM_COMMANDS).toHaveLength(14)
    })

    it('should have all required commands', () => {
      const commandNames = TELEGRAM_COMMANDS.map((c) => c.command)
      expect(commandNames).toContain('new')
      expect(commandNames).toContain('projects')
      expect(commandNames).toContain('status')
      expect(commandNames).toContain('stop')
      expect(commandNames).toContain('clear')
      expect(commandNames).toContain('resume')
      expect(commandNames).toContain('provider')
      expect(commandNames).toContain('model')
      expect(commandNames).toContain('skills')
      expect(commandNames).toContain('pair')
      expect(commandNames).toContain('unpair')
      expect(commandNames).toContain('help')
      expect(commandNames).toContain('cancel')
      expect(commandNames).toContain('health')
    })

    it('should have non-empty descriptions', () => {
      for (const cmd of TELEGRAM_COMMANDS) {
        expect(cmd.description).toBeTruthy()
        expect(cmd.command).toBeTruthy()
      }
    })
  })
})
