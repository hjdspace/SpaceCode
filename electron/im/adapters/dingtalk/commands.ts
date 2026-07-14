/**
 * Commands — DingTalk bot command definitions
 */

export interface ParsedCommand {
  command: string
  args: string
}

export const DINGTALK_COMMANDS = [
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
] as const

export const DINGTALK_KNOWN_COMMANDS: Set<string> = new Set(DINGTALK_COMMANDS.map((c) => c.command))

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
  return DINGTALK_KNOWN_COMMANDS.has(command)
}
