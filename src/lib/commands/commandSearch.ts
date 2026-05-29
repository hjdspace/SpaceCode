import Fuse from 'fuse.js'
import type { UnifiedCommand, CommandSearchResult, GhostText } from './types'

const SEPARATORS = /[:_-]/

interface CommandSearchItem {
  commandName: string
  command: UnifiedCommand
  partKey?: string[]
  aliasKey: string[]
  descriptionKey: string[]
}

function cleanWord(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function buildSearchItems(commands: UnifiedCommand[]): CommandSearchItem[] {
  return commands
    .filter(cmd => !cmd.isHidden)
    .map(cmd => {
      const commandName = cmd.name
      const parts = commandName.split(SEPARATORS).filter(Boolean)
      return {
        commandName,
        command: cmd,
        partKey: parts.length > 1 ? parts : undefined,
        aliasKey: cmd.aliases ?? [],
        descriptionKey: (cmd.description ?? '').split(' ').map(word => cleanWord(word)).filter(Boolean),
      }
    })
}

function createFuse(items: CommandSearchItem[]): Fuse<CommandSearchItem> {
  return new Fuse(items, {
    threshold: 0.3,
    keys: [
      { name: 'commandName', weight: 3 },
      { name: 'partKey', weight: 2 },
      { name: 'aliasKey', weight: 2 },
      { name: 'descriptionKey', weight: 0.5 },
    ],
  })
}

export function searchCommands(
  query: string,
  commands: UnifiedCommand[],
  usageStats: Record<string, number> = {},
): CommandSearchResult[] {
  if (!query) {
    return commands
      .filter(cmd => !cmd.isHidden)
      .sort((a, b) => {
        const usageA = usageStats[a.name] ?? 0
        const usageB = usageStats[b.name] ?? 0
        return usageB - usageA
      })
      .map(cmd => ({ command: cmd, score: 0 }))
  }

  const items = buildSearchItems(commands)
  const fuse = createFuse(items)
  const lowerQuery = query.toLowerCase()

  const fuseResults = fuse.search(lowerQuery)

  const results: CommandSearchResult[] = fuseResults.map(r => ({
    command: r.item.command,
    score: r.score ?? 1,
  }))

  results.sort((a, b) => {
    const aExact = a.command.name.toLowerCase() === lowerQuery ? -1000 : 0
    const bExact = b.command.name.toLowerCase() === lowerQuery ? -1000 : 0
    if (aExact !== bExact) return aExact - bExact

    const aAliasExact = a.command.aliases?.some(al => al.toLowerCase() === lowerQuery) ? -500 : 0
    const bAliasExact = b.command.aliases?.some(al => al.toLowerCase() === lowerQuery) ? -500 : 0
    if (aAliasExact !== bAliasExact) return aAliasExact - bAliasExact

    const aPrefix = a.command.name.toLowerCase().startsWith(lowerQuery) ? -200 : 0
    const bPrefix = b.command.name.toLowerCase().startsWith(lowerQuery) ? -200 : 0
    if (aPrefix !== bPrefix) return aPrefix - bPrefix

    const aAliasPrefix = a.command.aliases?.some(al => al.toLowerCase().startsWith(lowerQuery)) ? -100 : 0
    const bAliasPrefix = b.command.aliases?.some(al => al.toLowerCase().startsWith(lowerQuery)) ? -100 : 0
    if (aAliasPrefix !== bAliasPrefix) return aAliasPrefix - bAliasPrefix

    const usageA = usageStats[a.command.name] ?? 0
    const usageB = usageStats[b.command.name] ?? 0
    if (usageA !== usageB) return usageB - usageA

    return (a.score ?? 0) - (b.score ?? 0)
  })

  return results
}

export function getGhostText(
  query: string,
  commands: UnifiedCommand[],
): GhostText | null {
  if (!query) return null

  const results = searchCommands(query, commands)
  for (const { command } of results) {
    const name = command.name
    if (name.toLowerCase().startsWith(query.toLowerCase())) {
      const suffix = name.slice(query.length)
      if (suffix) {
        return { suffix, fullCommand: name }
      }
    }
  }
  return null
}

export function findMidInputSlashCommand(
  input: string,
  cursorOffset: number,
): { token: string; startPos: number; partialCommand: string } | null {
  if (input.startsWith('/')) return null

  const beforeCursor = input.slice(0, cursorOffset)
  const match = beforeCursor.match(/\s\/([a-zA-Z0-9_:-]*)$/)
  if (!match) return null

  const slashPos = beforeCursor.lastIndexOf(' /')
  const fullCommand = match[1]
  return {
    token: '/' + fullCommand,
    startPos: slashPos + 1,
    partialCommand: fullCommand,
  }
}
