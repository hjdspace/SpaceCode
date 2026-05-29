import { ref, computed, watch } from 'vue'
import { commandRegistry } from '@/lib/commands/commandRegistry'
import { searchCommands, getGhostText, findMidInputSlashCommand } from '@/lib/commands/commandSearch'
import type { UnifiedCommand, CommandGroup, GhostText } from '@/lib/commands/types'
import { useSkillsStore } from '@/stores/skills'

export function useCommandPalette() {
  const skillsStore = useSkillsStore()

  const showMenu = ref(false)
  const searchQuery = ref('')
  const selectedIndex = ref(0)
  const triggerPosition = ref<number>(-1)

  const allCommands = computed<UnifiedCommand[]>(() => {
    commandRegistry.refresh(skillsStore.skills)
    return commandRegistry.getAllCommands()
  })

  const usageStats = computed(() => commandRegistry.getUsageStats())

  const searchResults = computed(() => {
    return searchCommands(searchQuery.value, allCommands.value, usageStats.value)
  })

  const filteredCommands = computed<UnifiedCommand[]>(() => {
    return searchResults.value.map(r => r.command)
  })

  const groupedCommands = computed<CommandGroup[]>(() => {
    if (searchQuery.value) {
      const flat: CommandGroup = {
        label: 'commands.searchResults',
        source: 'builtin',
        commands: filteredCommands.value,
      }
      return flat.commands.length > 0 ? [flat] : []
    }

    allCommands.value
    return commandRegistry.getGroupedCommands()
  })

  const ghostText = computed<GhostText | null>(() => {
    if (!searchQuery.value || !showMenu.value) return null
    return getGhostText(searchQuery.value, allCommands.value)
  })

  const argumentHint = computed<string | undefined>(() => {
    if (!searchQuery.value) return undefined
    const cmd = filteredCommands.value[0]
    return cmd?.argumentHint
  })

  const highlightedName = computed<string | null>(() => {
    const flat = filteredCommands.value
    if (flat.length === 0) return null
    const idx = selectedIndex.value
    if (idx < 0 || idx >= flat.length) return flat[0]?.name ?? null
    return flat[idx]?.name ?? null
  })

  function triggerMenu(filter: string = ''): void {
    showMenu.value = true
    searchQuery.value = filter
    selectedIndex.value = 0
  }

  function closeMenu(): void {
    showMenu.value = false
    searchQuery.value = ''
    selectedIndex.value = 0
    triggerPosition.value = -1
  }

  function updateSearch(query: string): void {
    searchQuery.value = query
    selectedIndex.value = 0
  }

  function navigateUp(): void {
    const len = filteredCommands.value.length
    if (len === 0) return
    selectedIndex.value = selectedIndex.value <= 0 ? len - 1 : selectedIndex.value - 1
  }

  function navigateDown(): void {
    const len = filteredCommands.value.length
    if (len === 0) return
    selectedIndex.value = selectedIndex.value >= len - 1 ? 0 : selectedIndex.value + 1
  }

  function selectItem(cmd: UnifiedCommand): void {
    commandRegistry.recordUsage(cmd.name)
    closeMenu()
  }

  function getSelectedCommand(): UnifiedCommand | undefined {
    const flat = filteredCommands.value
    if (flat.length === 0) return undefined
    const idx = Math.min(selectedIndex.value, flat.length - 1)
    return flat[idx]
  }

  function findCommand(name: string): UnifiedCommand | undefined {
    return commandRegistry.findCommand(name)
  }

  function handleInput(text: string, cursorPos: number): { isSlashTrigger: boolean; midInputMatch: ReturnType<typeof findMidInputSlashCommand> } {
    const textBeforeCursor = text.slice(0, cursorPos)
    const lastNewLine = textBeforeCursor.lastIndexOf('\n')
    const textAfterLastNewLine = textBeforeCursor.slice(lastNewLine + 1)

    const slashMatch = textAfterLastNewLine.match(/^\/([\w:-]*)$/)

    if (slashMatch) {
      triggerPosition.value = lastNewLine + 1
      if (!showMenu.value) {
        triggerMenu(slashMatch[1] || '')
      } else {
        updateSearch(slashMatch[1] || '')
      }
      return { isSlashTrigger: true, midInputMatch: null }
    }

    if (!textAfterLastNewLine.startsWith('/')) {
      closeMenu()
      return { isSlashTrigger: false, midInputMatch: null }
    }

    const midInputMatch = findMidInputSlashCommand(text, cursorPos)
    if (midInputMatch) {
      return { isSlashTrigger: false, midInputMatch }
    }

    if (showMenu.value) {
      updateSearch(textAfterLastNewLine.slice(1))
    }

    return { isSlashTrigger: false, midInputMatch: null }
  }

  return {
    showMenu,
    searchQuery,
    selectedIndex,
    triggerPosition,
    allCommands,
    filteredCommands,
    groupedCommands,
    ghostText,
    argumentHint,
    highlightedName,
    triggerMenu,
    closeMenu,
    updateSearch,
    navigateUp,
    navigateDown,
    selectItem,
    getSelectedCommand,
    findCommand,
    handleInput,
  }
}
