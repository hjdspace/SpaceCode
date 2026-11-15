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
  'ExitPlanMode': () => import('./ExitPlanModeToolCard.vue'),
  // pi plan mode 扩展工具（tool_use 事件带结构化 questions/plan）
  'plan_mode_question': () => import('./PlanModeQuestionToolCard.vue'),
  'plan_mode_complete': () => import('./PlanModeCompleteToolCard.vue'),
  'TaskOutput': () => import('./TaskOutputToolCard.vue'),
  // Browser-Use tools
  'browser_use': () => import('./BrowserUseToolCard.vue'),
  'browse': () => import('./BrowserUseToolCard.vue'),
  'scrape': () => import('./BrowserUseToolCard.vue'),
  'screenshot': () => import('./BrowserUseToolCard.vue'),
  'navigate': () => import('./BrowserUseToolCard.vue'),
  'BrowserUse': () => import('./BrowserUseToolCard.vue'),
  'browser-use': () => import('./BrowserUseToolCard.vue'),
  'SearchExtraTools': () => import('./SearchExtraToolsToolCard.vue'),
  'ExecuteExtraTool': () => import('./ExecuteExtraToolCard.vue'),
  // 内置生图 MCP：这张表是精确名匹配，必须用完整工具名，裸名 generate_image 命中不了
  'mcp__spacecode-imagegen__generate_image': () => import('./ImageGenToolCard.vue'),
  'mcp__spacecode-imagegen__edit_image': () => import('./ImageGenToolCard.vue'),
  'mcp__spacecode-imagegen__generate_batch': () => import('./ImageGenToolCard.vue'),
}

// 承重交付物工具：卡片本身就是用户要看的结论（plan 要批准、生图要看图），
// 折进「N 个工具调用」等于把结果藏起来 —— 永远独立成行，不参与折叠组。
export const PROMOTED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'plan_mode_question',
  'plan_mode_complete',
  'mcp__spacecode-imagegen__generate_image',
  'mcp__spacecode-imagegen__edit_image',
  'mcp__spacecode-imagegen__generate_batch',
])

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
