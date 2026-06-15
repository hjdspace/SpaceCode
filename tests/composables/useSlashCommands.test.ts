/**
 * useSlashCommands composable tests
 *
 * Tests the slash command menu logic extracted from ChatInput.vue:
 * - Slash trigger detection
 * - Command filtering and navigation
 * - Command selection (immediate vs chip insertion)
 */
import { describe, it, expect } from 'vitest'

// ── Types ────────────────────────────────────────────────────────

interface SlashCommand {
  name: string
  description: string
  icon?: any
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command' | 'mcp_tool'
  immediate?: boolean
  aliases?: string[]
  source?: string
}

// ── Pure logic functions ─────────────────────────────────────────

/**
 * Check if text before cursor triggers slash command menu
 */
function checkSlashTrigger(textBeforeCursor: string): { triggered: boolean; query: string } | null {
  const lastNewLine = textBeforeCursor.lastIndexOf('\n')
  const textAfterLastNewLine = textBeforeCursor.slice(lastNewLine + 1)
  const slashMatch = textAfterLastNewLine.match(/^\/([\w:-]*)$/)

  if (slashMatch) {
    return { triggered: true, query: slashMatch[1] || '' }
  }
  return null
}

/**
 * Navigate through slash commands
 */
function navigateSlashCommands(currentIndex: number, direction: number, length: number): number {
  if (length === 0) return -1
  let newIndex = currentIndex + direction
  if (newIndex < 0) newIndex = length - 1
  if (newIndex >= length) newIndex = 0
  return newIndex
}

/**
 * Determine action when a slash command is selected
 */
function resolveSlashCommandAction(cmd: SlashCommand): 'immediate' | 'chip' {
  if (cmd.immediate || cmd.kind === 'immediate') return 'immediate'
  return 'chip'
}

/**
 * Remove slash trigger text from content
 */
function removeSlashTriggerText(text: string): { cleaned: string; triggerLength: number } | null {
  const slashMatch = text.match(/(^|\s)\/([^\s]*)$/)
  if (!slashMatch) return null
  const triggerOffset = slashMatch.index! + (slashMatch[1] ? 1 : 0)
  const triggerLength = slashMatch[0].length - (slashMatch[1] ? 1 : 0)
  return {
    cleaned: text.slice(0, triggerOffset) + text.slice(triggerOffset + triggerLength),
    triggerLength,
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('useSlashCommands - pure logic', () => {
  describe('slash trigger detection', () => {
    it('should detect / at start of line', () => {
      const result = checkSlashTrigger('/')
      expect(result).toEqual({ triggered: true, query: '' })
    })

    it('should detect /command pattern', () => {
      const result = checkSlashTrigger('/help')
      expect(result).toEqual({ triggered: true, query: 'help' })
    })

    it('should detect / after newline', () => {
      const result = checkSlashTrigger('some text\n/help')
      expect(result).toEqual({ triggered: true, query: 'help' })
    })

    it('should detect / with hyphenated command', () => {
      const result = checkSlashTrigger('/my-command')
      expect(result).toEqual({ triggered: true, query: 'my-command' })
    })

    it('should detect / with colon-separated command', () => {
      const result = checkSlashTrigger('/mcp:tool')
      expect(result).toEqual({ triggered: true, query: 'mcp:tool' })
    })

    it('should not trigger for text without /', () => {
      const result = checkSlashTrigger('hello world')
      expect(result).toBeNull()
    })

    it('should not trigger for / in middle of word', () => {
      const result = checkSlashTrigger('path/to/file')
      expect(result).toBeNull()
    })

    it('should not trigger for / followed by space', () => {
      const result = checkSlashTrigger('/ help')
      expect(result).toBeNull()
    })

    it('should not trigger for // double slash', () => {
      const result = checkSlashTrigger('//comment')
      expect(result).toBeNull()
    })
  })

  describe('slash command navigation', () => {
    it('should navigate down', () => {
      expect(navigateSlashCommands(0, 1, 5)).toBe(1)
    })

    it('should wrap around going down past end', () => {
      expect(navigateSlashCommands(4, 1, 5)).toBe(0)
    })

    it('should navigate up', () => {
      expect(navigateSlashCommands(3, -1, 5)).toBe(2)
    })

    it('should wrap around going up past start', () => {
      expect(navigateSlashCommands(0, -1, 5)).toBe(4)
    })

    it('should return -1 for empty list', () => {
      expect(navigateSlashCommands(0, 1, 0)).toBe(-1)
    })
  })

  describe('slash command action resolution', () => {
    it('should resolve immediate commands', () => {
      expect(resolveSlashCommandAction({ name: 'help', description: '', immediate: true })).toBe('immediate')
      expect(resolveSlashCommandAction({ name: 'clear', description: '', kind: 'immediate' })).toBe('immediate')
    })

    it('should resolve chip insertion for non-immediate commands', () => {
      expect(resolveSlashCommandAction({ name: 'bug', description: '', kind: 'slash_command' })).toBe('chip')
      expect(resolveSlashCommandAction({ name: 'skill', description: '', kind: 'agent_skill' })).toBe('chip')
      expect(resolveSlashCommandAction({ name: 'tool', description: '', kind: 'mcp_tool' })).toBe('chip')
    })

    it('should default to chip for commands without kind', () => {
      expect(resolveSlashCommandAction({ name: 'custom', description: '' })).toBe('chip')
    })
  })

  describe('slash trigger text removal', () => {
    it('should remove /command at end of text', () => {
      const result = removeSlashTriggerText('hello /help')
      expect(result).not.toBeNull()
      expect(result!.cleaned).toBe('hello ')
    })

    it('should remove /command at start of text', () => {
      const result = removeSlashTriggerText('/help')
      expect(result).not.toBeNull()
      expect(result!.cleaned).toBe('')
    })

    it('should return null when no slash trigger found', () => {
      const result = removeSlashTriggerText('hello world')
      expect(result).toBeNull()
    })

    it('should handle /command after newline', () => {
      const result = removeSlashTriggerText('text\n/help')
      expect(result).not.toBeNull()
      expect(result!.cleaned).toBe('text\n')
    })
  })
})
