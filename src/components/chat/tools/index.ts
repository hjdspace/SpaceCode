import type { Component } from 'vue'

export const TOOL_COMPONENT_MAP: Record<string, () => Promise<any>> = {
  'Bash': () => import('./BashToolCard.vue'),
  'Read': () => import('./ReadToolCard.vue'),
  'FileRead': () => import('./ReadToolCard.vue'),
  'Write': () => import('./WriteToolCard.vue'),
  'FileWrite': () => import('./WriteToolCard.vue'),
  'Edit': () => import('./EditToolCard.vue'),
  'FileEdit': () => import('./EditToolCard.vue'),
  'Glob': () => import('./GlobToolCard.vue'),
  'Grep': () => import('./GrepToolCard.vue'),
  'Agent': () => import('./AgentToolCard.vue'),
  'Skill': () => import('./SkillToolCard.vue'),
  'WebFetch': () => import('./WebFetchToolCard.vue'),
  'WebSearch': () => import('./WebSearchToolCard.vue'),
  'AskUserQuestion': () => import('./AskUserQuestionToolCard.vue'),
}

const componentCache = new Map<string, Component>()

export async function resolveToolComponent(toolName: string): Promise<Component | null> {
  if (componentCache.has(toolName)) return componentCache.get(toolName)!
  const loader = TOOL_COMPONENT_MAP[toolName]
  if (!loader) return null
  const mod = await loader()
  const comp: Component = mod.default || mod
  componentCache.set(toolName, comp)
  return comp
}

export function hasToolComponent(toolName: string): boolean {
  return toolName in TOOL_COMPONENT_MAP
}

export function getToolComponentNames(): string[] {
  return Object.keys(TOOL_COMPONENT_MAP)
}
