/**
 * Commands — Telegram bot command definitions
 *
 * Defines the 14-command menu synced via setMyCommands.
 * Also provides command parsing and routing.
 */

import type { BotCommand } from './telegramBot'

// ──────────────────────────────────────────────────────────────────────────
// Command definitions
// ──────────────────────────────────────────────────────────────────────────

export const TELEGRAM_COMMANDS: BotCommand[] = [
  { command: 'new', description: '创建新会话' },
  { command: 'projects', description: '列出并切换项目' },
  { command: 'status', description: '查看当前会话状态' },
  { command: 'stop', description: '停止生成' },
  { command: 'clear', description: '清空上下文' },
  { command: 'resume', description: '恢复历史会话' },
  { command: 'provider', description: '切换 LLM Provider' },
  { command: 'model', description: '切换模型' },
  { command: 'skills', description: '列出技能' },
  { command: 'pair', description: '配对绑定' },
  { command: 'unpair', description: '取消配对' },
  { command: 'help', description: '显示帮助' },
  { command: 'cancel', description: '取消当前操作' },
  { command: 'health', description: '检查健康状态' },
]

// ──────────────────────────────────────────────────────────────────────────
// Command parsing
// ──────────────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  command: string
  args: string
}

/**
 * Parse a Telegram message text into a command + args.
 * Returns null if the text is not a command.
 * Commands start with / and are case-insensitive.
 *
 * Examples:
 *   "/new" → { command: 'new', args: '' }
 *   "/projects myapp" → { command: 'projects', args: 'myapp' }
 *   "hello" → null
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  // Extract command and args
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    const command = trimmed.slice(1).toLowerCase()
    // Remove optional bot mention suffix (@botname)
    const cleanCommand = command.replace(/@.+$/, '')
    if (!cleanCommand) return null
    return { command: cleanCommand, args: '' }
  }

  const command = trimmed.slice(1, spaceIdx).toLowerCase().replace(/@.+$/, '')
  const args = trimmed.slice(spaceIdx + 1).trim()
  if (!command) return null

  return { command, args }
}

/** Check if a command name is a known command. */
export function isKnownCommand(command: string): boolean {
  return TELEGRAM_COMMANDS.some((c) => c.command === command)
}
