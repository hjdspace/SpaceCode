export type CommandSource = 'builtin' | 'bundled' | 'global' | 'project' | 'plugin' | 'mcp'

export type CommandKind =
  | 'immediate'
  | 'sdk_command'
  | 'codepilot_command'
  | 'agent_skill'
  | 'slash_command'

export interface UnifiedCommand {
  name: string
  description: string
  source: CommandSource
  kind: CommandKind
  icon?: string
  aliases?: string[]
  immediate?: boolean
  argumentHint?: string
  argNames?: string[]
  isHidden?: boolean
  pluginName?: string
  content?: string
  filePath?: string
}

export interface CommandGroup {
  label: string
  source: CommandSource
  commands: UnifiedCommand[]
}

export interface GhostText {
  suffix: string
  fullCommand: string
}

export interface CommandSearchResult {
  command: UnifiedCommand
  score: number
}

const SOURCE_PRIORITY: Record<CommandSource, number> = {
  builtin: 0,
  bundled: 1,
  global: 2,
  project: 3,
  plugin: 4,
  mcp: 5,
}

export function getSourcePriority(source: CommandSource): number {
  return SOURCE_PRIORITY[source] ?? 99
}

export function getSourceLabel(source: CommandSource): string {
  const labels: Record<CommandSource, string> = {
    builtin: 'commands.builtin',
    bundled: 'commands.bundledSkills',
    global: 'commands.globalSkills',
    project: 'commands.projectSkills',
    plugin: 'commands.pluginSkills',
    mcp: 'commands.mcpSkills',
  }
  return labels[source]
}
