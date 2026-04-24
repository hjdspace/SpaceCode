/**
 * Pure algorithm functions for MessageInput behavior.
 *
 * These functions contain no Vue dependencies — they are plain TypeScript
 * and can be tested directly without any framework setup.
 *
 * Based on CodePilot's message-input-logic.ts
 */

import {
  BUILT_IN_COMMANDS,
  COMMAND_PROMPTS,
  findCommand,
  type CommandKind,
} from '@/lib/constants/commands'
import type { CommandBadge } from '@/types'

// ─── Result types ────────────────────────────────────────────────

export interface InsertResult {
  action: 'immediate_command' | 'set_badge' | 'insert_file_mention'
  commandValue?: string
  badge?: CommandBadge
  newInputValue?: string
}

export interface BadgeDispatchResult {
  prompt: string
  displayLabel: string
}

export type KeyAction =
  | { type: 'popover_navigate'; direction: 'up' | 'down' }
  | { type: 'popover_select' }
  | { type: 'close_popover' }
  | { type: 'remove_badge' }
  | { type: 'passthrough' }

export interface DirectSlashResult {
  action: 'immediate_command' | 'set_badge' | 'unknown_slash_badge' | 'not_slash'
  commandValue?: string
  badge?: CommandBadge
}

export interface PopoverItem {
  label: string
  value: string
  description?: string
  icon?: string
  kind?: CommandKind
  builtIn?: boolean
  immediate?: boolean
  aliases?: string[]
}

export type PopoverMode = 'skill' | 'file' | null

// ─── Functions ───────────────────────────────────────────────────

/**
 * Detects popover trigger from input text and cursor position.
 * Used by handleInputChange in useSlashCommands.
 */
export function detectPopoverTrigger(
  text: string,
  cursorPos: number,
): { mode: PopoverMode; filter: string; triggerPos: number } | null {
  const beforeCursor = text.slice(0, cursorPos)

  // Check for @ trigger
  const atMatch = beforeCursor.match(/@([^\s@]*)$/)
  if (atMatch) {
    return {
      mode: 'file',
      filter: atMatch[1],
      triggerPos: cursorPos - atMatch[0].length,
    }
  }

  // Check for / trigger. Only fires when `/` is at the start of input or
  // immediately after whitespace — regex alone can't tell "hello/skill" from
  // "src/app" or "foo/bar", so we accept the trade-off: typing `/` mid-word
  // does NOT open the picker (it would false-positive on every single-slash
  // path). Users who want to invoke a command mid-sentence use the slash
  // button, which auto-inserts a leading space (see handleInsertSlash).
  const slashMatch = beforeCursor.match(/(^|\s)\/([^\s]*)$/)
  if (slashMatch) {
    return {
      mode: 'skill',
      filter: slashMatch[2],
      triggerPos: cursorPos - slashMatch[2].length - 1,
    }
  }

  return null
}

/**
 * Filters popover items by substring match on label or description.
 * Used by the filteredItems useMemo in usePopoverState.
 */
export function filterItems(items: PopoverItem[], filter: string): PopoverItem[] {
  const q = filter.toLowerCase()
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q) ||
      item.aliases?.some((alias) => alias.toLowerCase().includes(q)),
  )
}

/**
 * Splits input text around a popover trigger, removing the trigger character
 * and any filter text that was typed after it.
 */
function splitAroundTrigger(
  inputValue: string,
  triggerPos: number,
  popoverFilter: string,
): { before: string; after: string } {
  const before = inputValue.slice(0, triggerPos)
  const cursorEnd = triggerPos + popoverFilter.length + 1 // +1 to consume the trigger character
  const after = inputValue.slice(cursorEnd)
  return { before, after }
}

/**
 * Determines what happens when an item is selected from the popover.
 * Used by insertItem in useSlashCommands.
 */
export function resolveItemSelection(
  item: PopoverItem,
  popoverMode: PopoverMode,
  triggerPos: number,
  inputValue: string,
  popoverFilter: string,
): InsertResult {
  // Immediate built-in commands
  if (item.builtIn && item.immediate) {
    return { action: 'immediate_command', commandValue: item.value }
  }

  // Non-immediate commands: show as badge, preserving any text outside the trigger
  if (popoverMode === 'skill') {
    const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter)
    return {
      action: 'set_badge',
      badge: {
        command: item.value,
        label: item.label,
        description: item.description || '',
        kind: item.kind || 'slash_command',
      },
      newInputValue: before + after,
    }
  }

  // File mention: insert into text
  const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter)
  const insertText = `@${item.value} `
  return {
    action: 'insert_file_mention',
    newInputValue: before + insertText + after,
  }
}

/**
 * Badge dispatch logic — what prompt is sent for each badge kind.
 * Used by handleSubmit in MessageInput.
 *
 * Accepts a single badge or an array. Multi-badge is only meaningful for
 * `agent_skill` kind (user can stack multiple skills); other kinds always
 * arrive as a single-element array because addBadge() replaces on non-skill.
 */
export function dispatchBadge(
  badgeOrBadges: CommandBadge | CommandBadge[],
  userContent: string,
): BadgeDispatchResult {
  const badges = Array.isArray(badgeOrBadges) ? badgeOrBadges : [badgeOrBadges]
  if (badges.length === 0) {
    return { prompt: userContent, displayLabel: userContent }
  }

  // Multi-skill path: combine labels into one prompt, join display labels.
  if (badges.length > 1 && badges.every((b) => b.kind === 'agent_skill')) {
    const skillNames = badges.map((b) => b.label).join(', ')
    const displayLabel = userContent
      ? `${badges.map((b) => `/${b.label}`).join(' ')}\n${userContent}`
      : badges.map((b) => `/${b.label}`).join(' ')
    const agentPrompt = userContent
      ? `Use the ${skillNames} skills. User context: ${userContent}`
      : `Please use the ${skillNames} skills.`
    return { prompt: agentPrompt, displayLabel }
  }

  const badge = badges[0]
  const baseLabel = `/${badge.label}`
  const displayLabel = userContent ? `${baseLabel}\n${userContent}` : baseLabel

  switch (badge.kind) {
    case 'agent_skill': {
      const agentPrompt = userContent
        ? `Use the ${badge.label} skill. User context: ${userContent}`
        : `Please use the ${badge.label} skill.`
      return { prompt: agentPrompt, displayLabel }
    }
    case 'slash_command':
    case 'sdk_command': {
      const expandedPrompt = COMMAND_PROMPTS[badge.command] || ''
      if (expandedPrompt) {
        const finalPrompt = userContent
          ? `${expandedPrompt}\n\nUser context: ${userContent}`
          : expandedPrompt
        return { prompt: finalPrompt, displayLabel }
      }
      const slashPrompt = userContent
        ? `${badge.command} ${userContent}`
        : badge.command
      return { prompt: slashPrompt, displayLabel }
    }
    case 'codepilot_command': {
      const expandedPrompt = COMMAND_PROMPTS[badge.command] || ''
      const finalPrompt = userContent
        ? `${expandedPrompt}\n\nUser context: ${userContent}`
        : expandedPrompt || badge.command
      return { prompt: finalPrompt, displayLabel }
    }
    default: {
      return { prompt: userContent || badge.command, displayLabel }
    }
  }
}

/**
 * ArrowDown/ArrowUp index cycling logic.
 * Used by handleKeyDown popover navigation in MessageInput.
 */
export function cycleIndex(current: number, direction: 'up' | 'down', length: number): number {
  if (direction === 'down') return (current + 1) % length
  return (current - 1 + length) % length
}

/**
 * Submit gating logic — determines whether submit is enabled.
 * Used by FileAwareSubmitButton disabled logic.
 */
export function isSubmitEnabled(opts: {
  inputValue: string
  hasBadge: boolean
  hasFiles: boolean
  isStreaming: boolean
  disabled: boolean
}): boolean {
  if (opts.disabled) return false
  if (opts.isStreaming) return true // streaming = stop button
  return !!(opts.inputValue.trim() || opts.hasBadge || opts.hasFiles)
}

/**
 * Keyboard dispatch logic — determines what action to take for a given key.
 * Used by handleKeyDown in MessageInput.
 */
export function resolveKeyAction(
  key: string,
  state: {
    popoverMode: PopoverMode
    popoverHasItems: boolean
    inputValue: string
    hasBadge: boolean
  },
): KeyAction {
  // Popover navigation (skill/file mode)
  if (state.popoverMode && state.popoverHasItems) {
    if (key === 'ArrowDown') return { type: 'popover_navigate', direction: 'down' }
    if (key === 'ArrowUp') return { type: 'popover_navigate', direction: 'up' }
    if (key === 'Enter' || key === 'Tab') return { type: 'popover_select' }
    if (key === 'Escape') return { type: 'close_popover' }
  }

  // Backspace removes badge when input is empty
  if (key === 'Backspace' && !state.inputValue) {
    if (state.hasBadge) return { type: 'remove_badge' }
  }

  // Escape removes badge
  if (key === 'Escape') {
    if (state.hasBadge) return { type: 'remove_badge' }
  }

  return { type: 'passthrough' }
}

/**
 * Direct slash command detection — when user types "/command" in input and submits.
 * Used by handleSubmit in MessageInput.
 */
export function resolveDirectSlash(content: string): DirectSlashResult {
  if (!content.startsWith('/')) return { action: 'not_slash' }

  const cmd = findCommand(content.slice(1).split(/\s+/)[0])
  if (cmd) {
    if (cmd.immediate) {
      return { action: 'immediate_command', commandValue: content }
    }
    return {
      action: 'set_badge',
      badge: {
        command: `/${cmd.name}`,
        label: cmd.name,
        description: cmd.description || '',
        kind: cmd.kind || 'slash_command',
      },
    }
  }

  const skillName = content.slice(1).split(/\s+/)[0]
  if (skillName) {
    return {
      action: 'unknown_slash_badge',
      badge: {
        command: `/${skillName}`,
        label: skillName,
        description: '',
        kind: 'slash_command',
      },
    }
  }

  return { action: 'not_slash' }
}

/**
 * Convert built-in commands to popover items
 */
export function getBuiltinPopoverItems(): PopoverItem[] {
  return BUILT_IN_COMMANDS.map((cmd) => ({
    label: cmd.name,
    value: `/${cmd.name}`,
    description: cmd.description,
    icon: cmd.icon,
    kind: cmd.kind,
    builtIn: true,
    immediate: cmd.immediate,
    aliases: cmd.aliases,
  }))
}
