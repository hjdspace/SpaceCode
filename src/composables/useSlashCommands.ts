/**
 * useSlashCommands - Slash command menu logic extracted from ChatInput.vue
 *
 * Manages:
 * - Slash trigger detection (/command)
 * - Command palette integration
 * - Command navigation and selection
 * - Immediate command dispatch vs chip insertion
 */
import { ref, computed } from 'vue'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { BUILT_IN_COMMANDS } from '@/lib/constants/commands'
import { useSkillsStore } from '@/stores/skills'
import { useMcpStore } from '@/stores/mcp'
import {
  Zap, HelpCircle, Trash2, Coins, Minimize2, Stethoscope, FilePlus, Layers,
  Terminal, Settings, Code, GitBranch, Bug, Bookmark, Eye, Cpu, MessageSquare,
  FileDiff, Play, FolderPlus, Download, Shield, ListTree, Webhook, FileText,
  Activity, Palette, Command, Keyboard, RotateCcw, GitCommit, Target
} from 'lucide-vue-next'

export interface SlashCommand {
  name: string
  description: string
  icon: any
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command' | 'mcp_tool'
  immediate?: boolean
  aliases?: string[]
  source?: string
}

// ── Pure logic (exported for testing) ──────────────────────────

/**
 * 宿主裁剪：按名称（含别名）隐藏命令 —— 只影响菜单展示，不裁剪组件能力。
 * Super Agent Router 等宿主用它隐藏依赖主聊天本地 UI 的命令（rewind/diff/context）。
 * 空排除列表时原样返回输入引用（纯过滤，无 mutation）。
 */
export function excludeSlashCommands<T extends { name: string; aliases?: string[] }>(
  commands: T[],
  excluded: readonly string[],
): T[] {
  if (excluded.length === 0) return commands
  return commands.filter(
    cmd => !excluded.includes(cmd.name) && !(cmd.aliases?.some(alias => excluded.includes(alias)) ?? false)
  )
}

/** Check if text before cursor triggers slash command menu */
export function checkSlashTrigger(textBeforeCursor: string): { triggered: boolean; query: string } | null {
  const lastNewLine = textBeforeCursor.lastIndexOf('\n')
  const textAfterLastNewLine = textBeforeCursor.slice(lastNewLine + 1)
  const slashMatch = textAfterLastNewLine.match(/^\/([\w:-]*)$/)

  if (slashMatch) {
    return { triggered: true, query: slashMatch[1] || '' }
  }
  return null
}

/** Navigate through slash commands by index */
export function navigateSlashCommandIndex(currentIndex: number, direction: number, length: number): number {
  if (length === 0) return -1
  let newIndex = currentIndex + direction
  if (newIndex < 0) newIndex = length - 1
  if (newIndex >= length) newIndex = 0
  return newIndex
}

/** Determine action when a slash command is selected */
export function resolveSlashCommandAction(cmd: SlashCommand): 'immediate' | 'chip' {
  if (cmd.immediate || cmd.kind === 'immediate') return 'immediate'
  return 'chip'
}

/** Remove slash trigger text from content */
export function removeSlashTriggerText(text: string): { cleaned: string; triggerLength: number } | null {
  const slashMatch = text.match(/(^|\s)\/([^\s]*)$/)
  if (!slashMatch) return null
  const triggerOffset = slashMatch.index! + (slashMatch[1] ? 1 : 0)
  const triggerLength = slashMatch[0].length - (slashMatch[1] ? 1 : 0)
  return {
    cleaned: text.slice(0, triggerOffset) + text.slice(triggerOffset + triggerLength),
    triggerLength,
  }
}

// ── Composable ─────────────────────────────────────────────────

export function useSlashCommands(options: {
  workingDirectory?: () => string
  /** 宿主裁剪：要隐藏的内置命令名（含别名）；只影响菜单，不裁剪派发能力 */
  excludeCommands?: () => string[]
} = {}) {
  const commandPalette = useCommandPalette()
  const skillsStore = useSkillsStore()
  const mcpStore = useMcpStore()

  // DOM refs
  const slashSearchInput = ref<HTMLInputElement | null>(null)
  const slashListRef = ref<HTMLElement | null>(null)
  const slashTriggerPosition = ref<number>(-1)
  const slashMenuPosition = ref<{ top?: string; bottom?: string; left: string }>({ top: '0px', left: '0px' })

  // Icon mapping
  const iconMap: Record<string, any> = {
    HelpCircle, Trash2, Coins, Minimize2, Stethoscope, FilePlus, Zap, Layers,
    Terminal, Settings, Code, GitBranch, Bug, Bookmark, Eye, Cpu, MessageSquare,
    FileDiff, Play, FolderPlus, Download, Shield, ListTree, Webhook, FileText,
    Activity, Palette, Command, Keyboard, RotateCcw, GitCommit, Target
  }

  // Computed command lists
  const builtinSlashCommands = computed<SlashCommand[]>(() => {
    return excludeSlashCommands(BUILT_IN_COMMANDS, options.excludeCommands?.() ?? []).map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      icon: (cmd.icon && iconMap[cmd.icon]) || Zap,
      kind: cmd.kind,
      immediate: cmd.immediate,
      aliases: cmd.aliases
    }))
  })

  const skillCommands = computed<SlashCommand[]>(() => {
    return skillsStore.skills.map(skill => ({
      name: skill.name,
      description: skill.description || `Skill: /${skill.name}`,
      icon: Zap,
      kind: 'agent_skill' as const,
      source: 'skill',
    }))
  })

  const mcpCommands = computed<SlashCommand[]>(() => {
    return mcpStore.allMcpTools.map(({ serverName, tool }) => ({
      name: tool.name,
      description: tool.description || `MCP: ${serverName}`,
      icon: Webhook,
      kind: 'mcp_tool' as const,
      source: 'mcp',
    }))
  })

  const allSlashCommands = computed<SlashCommand[]>(() => {
    return [...builtinSlashCommands.value, ...skillCommands.value, ...mcpCommands.value]
  })

  const filteredSlashCommands = computed<SlashCommand[]>(() => {
    const query = commandPalette.searchQuery.value
    if (!query) return allSlashCommands.value
    return commandPalette.filteredCommands.value.map(cmd => {
      const icon = (cmd.icon && iconMap[cmd.icon]) || Zap
      return {
        name: cmd.name,
        description: cmd.description,
        icon,
        kind: cmd.kind,
        immediate: cmd.immediate,
        aliases: cmd.aliases,
        source: cmd.source,
      }
    })
  })

  const showSlashCommandMenu = computed({
    get: () => commandPalette.showMenu.value,
    set: (val: boolean) => { if (!val) commandPalette.closeMenu() }
  })

  const slashSearchQuery = computed(() => commandPalette.searchQuery.value)
  const highlightedSlashCommand = computed(() => commandPalette.highlightedName.value)

  // Actions
  function navigateSlashCommands(direction: number) {
    if (direction > 0) {
      commandPalette.navigateDown()
    } else {
      commandPalette.navigateUp()
    }
  }

  function closeSlashCommandMenu() {
    commandPalette.closeMenu()
    slashTriggerPosition.value = -1
  }

  async function triggerSlashMenu(filter: string = ''): Promise<void> {
    commandPalette.triggerMenu(filter)
    // Refresh on every trigger so newly-created links and skills are visible immediately.
    await skillsStore.fetchSkills(options.workingDirectory?.() || undefined)
  }

  function openSkillsManager() {
    commandPalette.closeMenu()
  }

  return {
    // State
    slashSearchInput,
    slashListRef,
    slashTriggerPosition,
    slashMenuPosition,

    // Computed
    allSlashCommands,
    filteredSlashCommands,
    showSlashCommandMenu,
    slashSearchQuery,
    highlightedSlashCommand,
    builtinSlashCommands,
    skillCommands,
    mcpCommands,

    // Actions
    navigateSlashCommands,
    triggerSlashMenu,
    closeSlashCommandMenu,
    openSkillsManager,
    commandPalette,
    iconMap,
  }
}
