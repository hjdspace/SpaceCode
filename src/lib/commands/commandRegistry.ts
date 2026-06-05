import type { UnifiedCommand, CommandGroup, CommandSource } from './types'
import { getSourcePriority, getSourceLabel } from './types'
import type { Skill, SkillSource } from '@/stores/skills'
import type { McpToolInfo } from '@/stores/mcp'
import { BUILT_IN_COMMANDS } from '@/lib/constants/commands'

const USAGE_STATS_KEY = 'command_usage_stats'

function loadUsageStats(): Record<string, number> {
  try {
    const stored = localStorage.getItem(USAGE_STATS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveUsageStats(stats: Record<string, number>): void {
  try {
    localStorage.setItem(USAGE_STATS_KEY, JSON.stringify(stats))
  } catch {
    // ignore
  }
}

function skillSourceToCommandSource(source: SkillSource): CommandSource {
  const mapping: Record<SkillSource, CommandSource> = {
    global: 'global',
    project: 'project',
    plugin: 'plugin',
    installed: 'global',
    builtin: 'bundled',
  }
  return mapping[source] ?? 'global'
}

function skillToCommand(skill: Skill): UnifiedCommand {
  return {
    name: skill.name,
    description: skill.description,
    source: skillSourceToCommandSource(skill.source),
    kind: 'agent_skill',
    icon: 'Zap',
    content: skill.content,
    filePath: skill.filePath,
    pluginName: skill.source === 'plugin' ? skill.installedSource : undefined,
  }
}

function builtinToCommand(cmd: typeof BUILT_IN_COMMANDS[number]): UnifiedCommand {
  return {
    name: cmd.name,
    description: cmd.description,
    source: cmd.source ?? 'builtin',
    kind: cmd.kind ?? 'slash_command',
    icon: cmd.icon,
    immediate: cmd.immediate,
    aliases: cmd.aliases,
  }
}

function mcpToolToCommand(entry: { serverName: string; tool: McpToolInfo }): UnifiedCommand {
  return {
    name: entry.tool.name,
    description: entry.tool.description || `MCP tool from ${entry.serverName}`,
    source: 'mcp',
    kind: 'mcp_tool',
    icon: 'Webhook',
  }
}

export class CommandRegistry {
  private commands: UnifiedCommand[] = []
  private usageStats: Record<string, number> = loadUsageStats()

  refresh(skills: Skill[], mcpTools: { serverName: string; tool: McpToolInfo }[] = []): void {
    const builtinCommands = BUILT_IN_COMMANDS.map(builtinToCommand)
    const skillCommands = skills.map(skillToCommand)
    const mcpCommands = mcpTools.map(mcpToolToCommand)

    const all = [...builtinCommands, ...skillCommands, ...mcpCommands]
    const seen = new Map<string, UnifiedCommand>()

    for (const cmd of all) {
      const existing = seen.get(cmd.name)
      if (!existing || getSourcePriority(cmd.source) < getSourcePriority(existing.source)) {
        seen.set(cmd.name, cmd)
      }
    }

    this.commands = Array.from(seen.values())
  }

  getAllCommands(): UnifiedCommand[] {
    return this.commands.filter(cmd => !cmd.isHidden)
  }

  getGroupedCommands(): CommandGroup[] {
    const groups = new Map<CommandSource, UnifiedCommand[]>()

    for (const cmd of this.getAllCommands()) {
      const list = groups.get(cmd.source) ?? []
      list.push(cmd)
      groups.set(cmd.source, list)
    }

    const result: CommandGroup[] = []
    const sourceOrder: CommandSource[] = ['builtin', 'bundled', 'global', 'project', 'plugin', 'mcp']

    for (const source of sourceOrder) {
      const commands = groups.get(source)
      if (commands && commands.length > 0) {
        result.push({
          label: getSourceLabel(source),
          source,
          commands,
        })
      }
    }

    return result
  }

  findCommand(name: string): UnifiedCommand | undefined {
    return this.commands.find(
      cmd => cmd.name === name || cmd.aliases?.includes(name),
    )
  }

  recordUsage(name: string): void {
    this.usageStats[name] = (this.usageStats[name] ?? 0) + 1
    saveUsageStats(this.usageStats)
  }

  getUsageStats(): Record<string, number> {
    return { ...this.usageStats }
  }

  getRecentCommands(limit: number = 5): UnifiedCommand[] {
    const entries = Object.entries(this.usageStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)

    return entries
      .map(([name]) => this.findCommand(name))
      .filter((cmd): cmd is UnifiedCommand => cmd != null && !cmd.isHidden)
  }
}

export const commandRegistry = new CommandRegistry()
