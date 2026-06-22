/**
 * Chat Commands Hook
 *
 * Handles immediate commands like /help, /clear, /cost
 * Similar to CodePilot's useChatCommands.ts
 */

import { ref, computed } from 'vue'
import type { Message, Session } from '@/types'
import { BUILT_IN_COMMANDS, findCommand, COMMAND_PROMPTS, type CommandKind } from '@/lib/constants/commands'

export interface CommandBadge {
  command: string
  label: string
  description: string
  kind: CommandKind
}

export interface UseChatCommandsOptions {
  sessionId: string
  messages: Message[]
  workingDirectory?: string
  onClearMessages?: () => void
  onOpenTerminal?: (command?: string) => void
  onOpenSettings?: () => void
  onOpenSkills?: () => void
  onOpenMcp?: () => void
  onOpenRewind?: () => void
}

export interface CommandResult {
  type: 'immediate' | 'badge' | 'sdk_command' | 'codepilot_command' | 'unknown'
  content?: string
  badge?: CommandBadge
  expandedPrompt?: string
}

export function useChatCommands(options: UseChatCommandsOptions) {
  const activeBadge = ref<CommandBadge | null>(null)

  const hasActiveBadge = computed(() => activeBadge.value !== null)

  /**
   * Execute an immediate command
   */
  function executeImmediateCommand(command: string): string | null {
    const cmd = findCommand(command)

    switch (command.toLowerCase()) {
      case 'help':
        return generateHelpMessage()

      case 'clear':
      case 'reset':
      case 'new':
        options.onClearMessages?.()
        return 'Conversation cleared. Start a new chat!'

      case 'cost':
        return generateCostMessage(options.messages)

      case 'context':
        return generateContextMessage(options.messages, options.workingDirectory)

      case 'terminal':
        options.onOpenTerminal?.()
        return 'Terminal panel opened.'

      case 'settings':
        options.onOpenSettings?.()
        return 'Settings panel opened.'

      case 'skills':
        options.onOpenSkills?.()
        return 'Skills manager opened.'

      case 'mcp':
        options.onOpenMcp?.()
        return 'MCP server manager opened.'

      case 'rewind':
      case 'checkpoint':
        options.onOpenRewind?.()
        return null

      default:
        return null
    }
  }

  /**
   * Set an active badge (for non-immediate commands)
   */
  function setBadge(badge: CommandBadge): void {
    activeBadge.value = badge
  }

  /**
   * Clear the active badge
   */
  function clearBadge(): void {
    activeBadge.value = null
  }

  /**
   * Dispatch the badge to get the final prompt
   */
  function dispatchBadge(userContent: string): { prompt: string; displayLabel: string } | null {
    if (!activeBadge.value) return null

    const badge = activeBadge.value
    const baseLabel = `/${badge.label}`
    const displayLabel = userContent ? `${baseLabel}\n${userContent}` : baseLabel

    switch (badge.kind) {
      case 'agent_skill': {
        const agentPrompt = userContent
          ? `Use the ${badge.label} skill. User context: ${userContent}`
          : `Please use the ${badge.label} skill.`
        return { prompt: agentPrompt, displayLabel }
      }

      case 'sdk_command':
      case 'slash_command': {
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

      default:
        return { prompt: userContent || badge.command, displayLabel }
    }
  }

  /**
   * Resolve a slash command from user input
   */
  function resolveSlashCommand(content: string): CommandResult {
    if (!content.startsWith('/')) {
      return { type: 'unknown' }
    }

    const parts = content.slice(1).split(/\s+/, 2)
    const commandName = parts[0]
    const args = parts[1] || ''

    const cmd = findCommand(commandName)

    if (!cmd) {
      // Unknown command - treat as badge
      return {
        type: 'badge',
        badge: {
          command: `/${commandName}`,
          label: commandName,
          description: '',
          kind: 'slash_command',
        },
      }
    }

    // Immediate commands
    if (cmd.immediate || cmd.kind === 'immediate') {
      const result = executeImmediateCommand(commandName)
      return {
        type: 'immediate',
        content: result || `Executed /${commandName}`,
      }
    }

    // SDK commands - return as badge for user to add context
    if (cmd.kind === 'sdk_command') {
      return {
        type: 'badge',
        badge: {
          command: `/${commandName}`,
          label: commandName,
          description: cmd.description,
          kind: 'sdk_command',
        },
      }
    }

    // CodePilot commands - return as badge
    if (cmd.kind === 'codepilot_command') {
      return {
        type: 'badge',
        badge: {
          command: `/${commandName}`,
          label: commandName,
          description: cmd.description,
          kind: 'codepilot_command',
        },
      }
    }

    return { type: 'unknown' }
  }

  /**
   * Generate help message
   */
  function generateHelpMessage(): string {
    const immediate = BUILT_IN_COMMANDS.filter((c) => c.immediate || c.kind === 'immediate')
    const sdk = BUILT_IN_COMMANDS.filter((c) => c.kind === 'sdk_command')
    const codepilot = BUILT_IN_COMMANDS.filter((c) => c.kind === 'codepilot_command')

    return `## Available Commands

### Instant Commands
${immediate.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### SDK Commands (sent to Claude Code)
${sdk.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### CodePilot Commands (expanded before sending)
${codepilot.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### Custom Skills
Skills from \`~/.claude/commands/\` and project \`.claude/commands/\` are also available via \`/\`.

**Tips:**
- Type \`/\` to browse commands and skills
- Type \`@\` to mention files
- Use Shift+Enter for new line
- Select a project folder to enable file operations`
  }

  /**
   * Generate cost message
   */
  function generateCostMessage(messages: Message[]): string {
    let totalInput = 0
    let totalOutput = 0
    let turnCount = 0

    for (const msg of messages) {
      // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
      const content = msg.content || ''
      const estimatedTokens = Math.ceil(content.length / 4)

      if (msg.role === 'user') {
        totalInput += estimatedTokens
      } else if (msg.role === 'assistant') {
        totalOutput += estimatedTokens
        turnCount++
      }
    }

    const totalTokens = totalInput + totalOutput

    if (turnCount === 0) {
      return `## Token Usage\n\nNo messages yet. Send a message to see token usage estimates.`
    }

    return `## Token Usage (Estimated)

| Metric | Count |
|--------|-------|
| Input tokens | ${totalInput.toLocaleString()} |
| Output tokens | ${totalOutput.toLocaleString()} |
| **Total tokens** | **${totalTokens.toLocaleString()}** |
| Turns | ${turnCount} |

*Note: These are rough estimates based on character count. Actual token counts may vary.*`
  }

  /**
   * Generate context message
   */
  function generateContextMessage(messages: Message[], workingDirectory?: string): string {
    const messageCount = messages.length
    const userMessages = messages.filter((m) => m.role === 'user').length
    const assistantMessages = messages.filter((m) => m.role === 'assistant').length

    let context = `## Current Context

| Metric | Value |
|--------|-------|
| Total messages | ${messageCount} |
| User messages | ${userMessages} |
| Assistant messages | ${assistantMessages} |
`

    if (workingDirectory) {
      context += `| Working directory | \`${workingDirectory}\` |`
    }

    return context
  }

  return {
    activeBadge,
    hasActiveBadge,
    setBadge,
    clearBadge,
    dispatchBadge,
    executeImmediateCommand,
    resolveSlashCommand,
  }
}
