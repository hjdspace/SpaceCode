/**
 * Commands — WhatsApp bot command definitions
 */

export interface ParsedCommand {
  command: string
  args: string
}

export const WHATSAPP_COMMANDS = [
  { command: 'new', description: 'Create new session' },
  { command: 'projects', description: 'List and switch projects' },
  { command: 'status', description: 'View session status' },
  { command: 'stop', description: 'Stop generation' },
  { command: 'clear', description: 'Clear context' },
  { command: 'resume', description: 'Resume session' },
  { command: 'provider', description: 'Switch LLM provider' },
  { command: 'model', description: 'Switch model' },
  { command: 'skills', description: 'List skills' },
  { command: 'pair', description: 'Pair device' },
  { command: 'unpair', description: 'Unpair' },
  { command: 'help', description: 'Show help' },
  { command: 'cancel', description: 'Cancel current operation' },
  { command: 'health', description: 'Check health' },
] as const

export const WHATSAPP_KNOWN_COMMANDS: Set<string> = new Set(WHATSAPP_COMMANDS.map((c) => c.command))

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    const command = trimmed.slice(1).toLowerCase()
    if (!command) return null
    return { command, args: '' }
  }

  const command = trimmed.slice(1, spaceIdx).toLowerCase()
  const args = trimmed.slice(spaceIdx + 1).trim()
  if (!command) return null

  return { command, args }
}

export function isKnownCommand(command: string): boolean {
  return WHATSAPP_KNOWN_COMMANDS.has(command)
}
