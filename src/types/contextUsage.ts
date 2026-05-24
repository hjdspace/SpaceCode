/** Mirrors engine ContextData from analyzeContext.ts (subset used by UI). */

export interface ContextCategory {
  name: string
  tokens: number
  color?: string
  isDeferred?: boolean
  /** True when filled by SpaceCode client-side estimation (not from engine). */
  isEstimated?: boolean
}

export interface ContextMemoryFile {
  path: string
  type: string
  tokens: number
}

export interface ContextMcpTool {
  name: string
  serverName?: string
  tokens: number
  isLoaded?: boolean
}

export interface ContextAgent {
  agentType: string
  source?: string
  tokens: number
}

export interface ContextSkillFrontmatter {
  name: string
  source?: string
  tokens: number
}

export interface ContextApiUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface ContextUsageData {
  categories: ContextCategory[]
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  model: string
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
  apiUsage: ContextApiUsage | null
  messageBreakdown?: {
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
  }
  memoryFiles?: ContextMemoryFile[]
  mcpTools?: ContextMcpTool[]
  agents?: ContextAgent[]
  skills?: {
    totalSkills: number
    includedSkills: number
    tokens: number
    skillFrontmatter: ContextSkillFrontmatter[]
  }
}

export type ContextWarningLevel = 'ok' | 'warn' | 'error' | 'blocking'

export interface ContextUsageSnapshot {
  /** Engine-analyzed context fill (totalTokens / rawMaxTokens). */
  data: ContextUsageData | null
  /** Status-line style: input+cache only vs rawMaxTokens. */
  usedPercentage: number | null
  remainingPercentage: number | null
  /** Autocompact-style threshold against effective window. */
  warningLevel: ContextWarningLevel
  percentUntilAutocompact: number | null
  warningMessage: string | null
  /** Session cumulative from message metadata. */
  sessionTotals: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  }
}
