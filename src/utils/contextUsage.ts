import type { Message } from '@/types'
import type {
  ContextApiUsage,
  ContextCategory,
  ContextUsageData,
  ContextUsageSnapshot,
  ContextWarningLevel,
} from '@/types/contextUsage'

const MODEL_CONTEXT_DEFAULT = 200_000
const AUTOCOMPACT_BUFFER = 13_000
const WARNING_BUFFER = 20_000
const MAX_OUTPUT_RESERVE = 20_000
const MANUAL_COMPACT_BUFFER = 3_000

const RESERVED_CATEGORY_NAMES = new Set([
  'Free space',
  'Autocompact buffer',
  'Compact buffer',
])

/** Display order aligned with engine ContextVisualization / Cursor-style panel. */
export const CONTEXT_CATEGORY_ORDER = [
  'System prompt',
  'System tools',
  '[ANT-ONLY] System tools',
  'MCP tools',
  'Custom agents',
  'Memory files',
  'Skills',
  'Messages',
] as const

const CATEGORY_I18N_KEYS: Record<string, string> = {
  'System prompt': 'contextUsage.categorySystemPrompt',
  'System tools': 'contextUsage.categoryToolDefinitions',
  '[ANT-ONLY] System tools': 'contextUsage.categoryToolDefinitions',
  'MCP tools': 'contextUsage.categoryMcpTools',
  'MCP tools (deferred)': 'contextUsage.categoryMcpToolsDeferred',
  'System tools (deferred)': 'contextUsage.categoryToolDefinitionsDeferred',
  'Custom agents': 'contextUsage.categorySubagents',
  'Memory files': 'contextUsage.categoryRules',
  Skills: 'contextUsage.categorySkills',
  Messages: 'contextUsage.categoryConversation',
}

export function getCategoryI18nKey(name: string): string | undefined {
  return CATEGORY_I18N_KEYS[name]
}

export function sortContextCategories(categories: ContextCategory[]): ContextCategory[] {
  const orderIndex = new Map(
    CONTEXT_CATEGORY_ORDER.map((name, index) => [name, index]),
  )
  return [...categories].sort((a, b) => {
    const ai = orderIndex.get(a.name as (typeof CONTEXT_CATEGORY_ORDER)[number]) ?? 999
    const bi = orderIndex.get(b.name as (typeof CONTEXT_CATEGORY_ORDER)[number]) ?? 999
    if (ai !== bi) return ai - bi
    return b.tokens - a.tokens
  })
}

function sumTokens(values: Array<number | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

function messageBreakdownTotal(
  breakdown: NonNullable<ContextUsageData['messageBreakdown']>,
): number {
  return sumTokens([
    breakdown.toolCallTokens,
    breakdown.toolResultTokens,
    breakdown.attachmentTokens,
    breakdown.assistantMessageTokens,
    breakdown.userMessageTokens,
  ])
}

function upsertCategory(
  categories: ContextCategory[],
  byName: Map<string, ContextCategory>,
  name: string,
  tokens: number,
  color: string,
  isEstimated = false,
): void {
  if (tokens <= 0) return
  const existing = byName.get(name)
  if (existing) {
    if (existing.tokens <= 0) existing.tokens = tokens
    if (!existing.color) existing.color = color
    if (isEstimated) existing.isEstimated = true
    return
  }
  const category = { name, tokens, color, isEstimated: isEstimated || undefined }
  categories.push(category)
  byName.set(name, category)
}

function hasFixedOverheadCategories(byName: Map<string, ContextCategory>): boolean {
  return (
    (byName.get('System prompt')?.tokens ?? 0) > 0 ||
    (byName.get('System tools')?.tokens ?? 0) > 0 ||
    (byName.get('[ANT-ONLY] System tools')?.tokens ?? 0) > 0
  )
}

/** Rough chars/4 token estimate — works without Anthropic counting API. */
export function roughTokenEstimate(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Client-side message breakdown; engine-version agnostic. */
export function estimateMessageBreakdownFromMessages(
  messages: Message[],
): NonNullable<ContextUsageData['messageBreakdown']> {
  const breakdown = {
    toolCallTokens: 0,
    toolResultTokens: 0,
    attachmentTokens: 0,
    assistantMessageTokens: 0,
    userMessageTokens: 0,
  }

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      breakdown.assistantMessageTokens += roughTokenEstimate(msg.content)
      if (msg.reasoning?.content) {
        breakdown.assistantMessageTokens += roughTokenEstimate(msg.reasoning.content)
      }
      for (const toolCall of msg.toolCalls ?? []) {
        breakdown.toolCallTokens += roughTokenEstimate(
          JSON.stringify({ name: toolCall.name, input: toolCall.input }),
        )
      }
    } else if (msg.role === 'user') {
      breakdown.userMessageTokens += roughTokenEstimate(msg.content)
      for (const attachment of msg.attachments ?? []) {
        breakdown.attachmentTokens += roughTokenEstimate(JSON.stringify(attachment))
      }
      for (const image of msg.imageAttachments ?? []) {
        breakdown.attachmentTokens += roughTokenEstimate(image.data || image.name)
      }
    }

    for (const result of msg.toolResults ?? []) {
      breakdown.toolResultTokens += roughTokenEstimate(result.output)
    }
  }

  return breakdown
}

function distributeEstimatedFixedOverhead(
  categories: ContextCategory[],
  byName: Map<string, ContextCategory>,
  gap: number,
): number {
  if (gap <= 50 || hasFixedOverheadCategories(byName)) return gap

  const budget = Math.min(gap, 18_000)
  const systemPrompt = Math.min(800, Math.round(budget * 0.08))
  const tools = Math.min(10_000, Math.round(budget * 0.5))
  const rules = Math.min(4_000, Math.round(budget * 0.18))
  const agents = Math.min(600, Math.round(budget * 0.04))

  upsertCategory(categories, byName, 'System prompt', systemPrompt, 'system', true)
  upsertCategory(categories, byName, 'System tools', tools, 'tools', true)
  upsertCategory(categories, byName, 'Memory files', rules, 'memory', true)
  upsertCategory(categories, byName, 'Custom agents', agents, 'agents', true)

  const distributed = systemPrompt + tools + rules + agents
  return Math.max(0, gap - distributed)
}

/** Fill missing engine categories from detail fields, client messages, and API total. */
export function normalizeContextCategories(
  data: ContextUsageData,
  messages: Message[] = [],
): ContextCategory[] {
  const categories = [...(data.categories ?? [])]
  const byName = new Map(categories.map(category => [category.name, category]))

  if (data.memoryFiles?.length) {
    upsertCategory(
      categories,
      byName,
      'Memory files',
      sumTokens(data.memoryFiles.map(file => file.tokens)),
      'memory',
    )
  }

  if (data.mcpTools?.length) {
    upsertCategory(
      categories,
      byName,
      'MCP tools',
      sumTokens(
        data.mcpTools
          .filter(tool => tool.isLoaded !== false)
          .map(tool => tool.tokens),
      ),
      'mcp',
    )
  }

  if (data.agents?.length) {
    upsertCategory(
      categories,
      byName,
      'Custom agents',
      sumTokens(data.agents.map(agent => agent.tokens)),
      'agents',
    )
  }

  if (data.skills?.tokens) {
    upsertCategory(categories, byName, 'Skills', data.skills.tokens, 'skills')
  }

  if (data.messageBreakdown) {
    upsertCategory(
      categories,
      byName,
      'Messages',
      messageBreakdownTotal(data.messageBreakdown),
      'messages',
    )
  } else if (messages.length > 0) {
    upsertCategory(
      categories,
      byName,
      'Messages',
      messageBreakdownTotal(estimateMessageBreakdownFromMessages(messages)),
      'messages',
      true,
    )
  }

  let gap = Math.max(
    0,
    data.totalTokens -
      categories
        .filter(
          category =>
            !category.isDeferred && !RESERVED_CATEGORY_NAMES.has(category.name),
        )
        .reduce((sum, category) => sum + category.tokens, 0),
  )

  gap = distributeEstimatedFixedOverhead(categories, byName, gap)

  if (gap > 50) {
    const messagesCategory = byName.get('Messages')
    if (messagesCategory) {
      messagesCategory.tokens += gap
      if (!data.messageBreakdown) messagesCategory.isEstimated = true
    } else {
      upsertCategory(categories, byName, 'Messages', gap, 'messages', true)
    }
  }

  return categories
}

/**
 * Client-side enrichment layer — guarantees usable categories regardless of
 * bundled vs locally installed claude-code engine version.
 */
export function enrichContextDataFromClient(
  data: ContextUsageData,
  messages: Message[],
): ContextUsageData {
  const enriched: ContextUsageData = { ...data }

  const engineBreakdownTotal = enriched.messageBreakdown
    ? messageBreakdownTotal(enriched.messageBreakdown)
    : 0
  if (!enriched.messageBreakdown || engineBreakdownTotal === 0) {
    enriched.messageBreakdown = estimateMessageBreakdownFromMessages(messages)
  }

  enriched.categories = normalizeContextCategories(enriched, messages)
  return enriched
}

export function getVisibleContextCategories(
  data: ContextUsageData | null | undefined,
  messages: Message[] = [],
): ContextCategory[] {
  if (!data) return []
  const normalized = normalizeContextCategories(data, messages)
  return sortContextCategories(
    normalized.filter(
      category =>
        category.tokens > 0 &&
        !RESERVED_CATEGORY_NAMES.has(category.name) &&
        !category.isDeferred,
    ),
  )
}

/** Client-side context window resolution (mirrors engine getContextWindowForModel). */
export function getContextWindowForModel(model: string): number {
  const m = model.toLowerCase()
  if (/\[1m\]/i.test(model)) return 1_000_000
  if (m.includes('opus-4-6') || m.includes('sonnet-4-6')) {
    if (m.includes('sonnet-4-6') && !/\[1m\]/i.test(model)) {
      // Default sonnet 4.6 without [1m] — still 200k unless user opts in
    }
  }
  if (m.includes('claude-sonnet-4') || m.includes('opus-4-6')) {
    // 1M capable models default to 200k unless [1m] suffix
  }
  return MODEL_CONTEXT_DEFAULT
}

export function getMaxOutputTokensForModel(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('opus-4-6')) return 64_000
  if (m.includes('sonnet-4-6')) return 32_000
  if (m.includes('opus-4') || m.includes('sonnet-4') || m.includes('haiku-4')) return 32_000
  return 32_000
}

export function getEffectiveContextWindowSize(model: string): number {
  const reserved = Math.min(getMaxOutputTokensForModel(model), MAX_OUTPUT_RESERVE)
  return getContextWindowForModel(model) - reserved
}

export function getAutoCompactThreshold(model: string): number {
  return getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER
}

export function getWarningThreshold(model: string): number {
  return getAutoCompactThreshold(model) - WARNING_BUFFER
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(count)
}

export function formatNumber(count: number): string {
  return count.toLocaleString('en-US')
}

/** Mirrors engine forkedAgent / perfettoTracing cache hit rate formula. */
export function calculateCacheHitRate(totals: {
  inputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}): number | null {
  const promptTokens =
    totals.inputTokens + totals.cacheReadInputTokens + totals.cacheCreationInputTokens
  if (promptTokens <= 0) return null
  return Math.round((totals.cacheReadInputTokens / promptTokens) * 10000) / 100
}

/** Status-line / engine analyzeContext formula: input + cache only (no output). */
export function getContextFillFromApiUsage(usage: ContextApiUsage | null | undefined): number {
  if (!usage) return 0
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  )
}

/** StatusLine formula: input + cache only. */
export function calculateContextPercentages(
  usage: ContextApiUsage | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!usage) return { used: null, remaining: null }
  const totalInput = getContextFillFromApiUsage(usage)
  const used = Math.min(100, Math.max(0, Math.round((totalInput / contextWindowSize) * 100)))
  return { used, remaining: 100 - used }
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  isAutoCompactEnabled = true,
): {
  percentLeft: number
  warningLevel: ContextWarningLevel
  warningMessage: string | null
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold = isAutoCompactEnabled
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_BUFFER
  const errorThreshold = threshold - WARNING_BUFFER
  const blockingLimit = getEffectiveContextWindowSize(model) - MANUAL_COMPACT_BUFFER

  let warningLevel: ContextWarningLevel = 'ok'
  if (tokenUsage >= blockingLimit) warningLevel = 'blocking'
  else if (tokenUsage >= errorThreshold) warningLevel = 'error'
  else if (tokenUsage >= warningThreshold) warningLevel = 'warn'

  let warningMessage: string | null = null
  if (warningLevel === 'warn' || warningLevel === 'error') {
    warningMessage =
      isAutoCompactEnabled
        ? `${percentLeft}% until auto-compact`
        : `Context low (${percentLeft}% remaining)`
  } else if (warningLevel === 'blocking') {
    warningMessage = `Context nearly full · run /compact to continue`
  }

  return { percentLeft, warningLevel, warningMessage }
}

export function sumSessionTokensFromMessages(messages: Message[]): {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
} {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadInputTokens = 0
  let cacheCreationInputTokens = 0
  for (const msg of messages) {
    if (msg.metadata?.inputTokens) inputTokens += msg.metadata.inputTokens
    if (msg.metadata?.outputTokens) outputTokens += msg.metadata.outputTokens
    if (msg.metadata?.cacheReadInputTokens) {
      cacheReadInputTokens += msg.metadata.cacheReadInputTokens
    }
    if (msg.metadata?.cacheCreationInputTokens) {
      cacheCreationInputTokens += msg.metadata.cacheCreationInputTokens
    }
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
  }
}

export function buildSnapshotFromEngineData(
  data: ContextUsageData,
  model: string,
): ContextUsageSnapshot {
  const sessionTotals = {
    inputTokens: data.apiUsage?.input_tokens ?? 0,
    outputTokens: data.apiUsage?.output_tokens ?? 0,
    cacheReadInputTokens: data.apiUsage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: data.apiUsage?.cache_creation_input_tokens ?? 0,
  }
  const ctxSize = data.rawMaxTokens || getContextWindowForModel(model)
  const { used, remaining } = calculateContextPercentages(data.apiUsage, ctxSize)
  const { percentLeft, warningLevel, warningMessage } = calculateTokenWarningState(
    data.totalTokens,
    model,
    data.isAutoCompactEnabled,
  )

  return {
    data,
    usedPercentage: used ?? data.percentage,
    remainingPercentage: remaining,
    warningLevel,
    percentUntilAutocompact: percentLeft,
    warningMessage,
    sessionTotals,
  }
}

function getLastApiUsageFromMessages(messages: Message[]): ContextApiUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.metadata?.inputTokens != null) {
      return {
        input_tokens: m.metadata.inputTokens,
        output_tokens: m.metadata.outputTokens ?? 0,
        cache_read_input_tokens: m.metadata.cacheReadInputTokens ?? 0,
        cache_creation_input_tokens: m.metadata.cacheCreationInputTokens ?? 0,
      }
    }
  }
  return null
}

export function buildFallbackSnapshot(
  messages: Message[],
  model: string,
): ContextUsageSnapshot {
  const ctxSize = getContextWindowForModel(model)
  const lastUsage = getLastApiUsageFromMessages(messages)

  const sessionTotals = sumSessionTokensFromMessages(messages)
  let estimatedTotal = 0
  for (const msg of messages) {
    const len =
      typeof msg.content === 'string'
        ? msg.content.length
        : JSON.stringify(msg.content ?? '').length
    estimatedTotal += Math.ceil(len / 4)
  }

  const totalTokens = lastUsage ? getContextFillFromApiUsage(lastUsage) : estimatedTotal

  const percentage = Math.min(100, Math.round((totalTokens / ctxSize) * 100))
  const { used, remaining } = calculateContextPercentages(lastUsage, ctxSize)
  const { percentLeft, warningLevel, warningMessage } = calculateTokenWarningState(
    totalTokens,
    model,
  )

  const data: ContextUsageData = {
    categories: [],
    totalTokens,
    maxTokens: getEffectiveContextWindowSize(model),
    rawMaxTokens: ctxSize,
    percentage,
    model,
    isAutoCompactEnabled: true,
    apiUsage: lastUsage,
  }

  const enriched = enrichContextDataFromClient(data, messages)

  return {
    data: enriched,
    usedPercentage: used ?? percentage,
    remainingPercentage: remaining,
    warningLevel,
    percentUntilAutocompact: percentLeft,
    warningMessage,
    sessionTotals,
  }
}

/** Map engine theme color keys to CSS colors for grid. */
export function categoryColorToCss(color?: string): string {
  const map: Record<string, string> = {
    permission: '#d97757',
    plan: '#6a9bcc',
    mcp: '#c49a6c',
    memory: '#a3b985',
    skills: '#8bb3d9',
    tools: '#d97757',
    messages: '#6a9bcc',
    system: '#788c5d',
    agents: '#e0a87a',
    promptBorder: '#788c5d',
    inactive: '#8a8880',
    claude: '#a3b985',
    warning: '#8bb3d9',
    cyan_FOR_SUBAGENTS_ONLY: '#c49a6c',
    purple_FOR_SUBAGENTS_ONLY: '#6a9bcc',
  }
  if (!color) return '#6a9bcc'
  return map[color] ?? '#6a9bcc'
}
