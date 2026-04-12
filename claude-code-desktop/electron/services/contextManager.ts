/**
 * Context Manager - Simplified context compression and memory system
 * 
 * Inspired by claude-code's compact and session memory systems.
 * This is a simplified implementation that provides core functionality
 * without the full complexity of the original.
 */

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================================
// Types
// ============================================================================

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: {
    toolCalls?: any[]
    tokens?: number
  }
}

export interface CompactResult {
  success: boolean
  summary: string
  preservedMessages: Message[]
  removedCount: number
  tokenReduction: number
}

export interface MemoryEntry {
  id: string
  timestamp: number
  summary: string
  keyPoints: string[]
  relatedFiles: string[]
}

// ============================================================================
// Token Estimation (simplified from claude-code)
// ============================================================================

/**
 * Rough token count estimation
 * ~4 characters per token on average
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content)
  }, 0)
}

// ============================================================================
// Context Compression
// ============================================================================

export interface CompressionConfig {
  maxTokens: number
  preserveRecentMessages: number
  minMessagesToCompress: number
}

const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  maxTokens: 8000,
  preserveRecentMessages: 4,
  minMessagesToCompress: 6
}

/**
 * Check if compression is needed
 */
export function shouldCompress(
  messages: Message[],
  config: Partial<CompressionConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_COMPRESSION_CONFIG, ...config }
  const tokens = estimateMessagesTokens(messages)
  
  return tokens > cfg.maxTokens && messages.length > cfg.minMessagesToCompress
}

/**
 * Simple context compression
 * 
 * Strategy:
 * 1. Keep system messages
 * 2. Keep recent N messages
 * 3. Summarize older messages into a compact form
 */
export async function compressContext(
  messages: Message[],
  summarizeFn: (text: string) => Promise<string>,
  config: Partial<CompressionConfig> = {}
): Promise<CompactResult> {
  const cfg = { ...DEFAULT_COMPRESSION_CONFIG, ...config }
  
  if (messages.length <= cfg.minMessagesToCompress) {
    return {
      success: false,
      summary: '',
      preservedMessages: messages,
      removedCount: 0,
      tokenReduction: 0
    }
  }

  const originalTokens = estimateMessagesTokens(messages)
  
  // Separate system messages
  const systemMessages = messages.filter(m => m.role === 'system')
  const conversationMessages = messages.filter(m => m.role !== 'system')
  
  // Keep recent messages
  const recentMessages = conversationMessages.slice(-cfg.preserveRecentMessages)
  const olderMessages = conversationMessages.slice(0, -cfg.preserveRecentMessages)
  
  if (olderMessages.length === 0) {
    return {
      success: false,
      summary: '',
      preservedMessages: messages,
      removedCount: 0,
      tokenReduction: 0
    }
  }

  // Create summary of older messages
  const textToSummarize = olderMessages
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join('\n\n')
  
  let summary: string
  try {
    summary = await summarizeFn(textToSummarize)
  } catch (error) {
    // If summarization fails, use a simple truncation
    summary = `[Previous conversation: ${olderMessages.length} messages summarized]`
  }

  // Create compact messages
  const compactMessages: Message[] = [
    ...systemMessages,
    {
      id: randomUUID(),
      role: 'system',
      content: `Previous conversation summary: ${summary}`,
      timestamp: Date.now()
    },
    ...recentMessages
  ]

  const newTokens = estimateMessagesTokens(compactMessages)
  
  return {
    success: true,
    summary,
    preservedMessages: compactMessages,
    removedCount: olderMessages.length,
    tokenReduction: originalTokens - newTokens
  }
}

// ============================================================================
// Session Memory System
// ============================================================================

export interface MemoryConfig {
  storagePath: string
  maxEntries: number
  autoSaveInterval: number
}

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  storagePath: path.join(process.cwd(), '.claude-code-memory'),
  maxEntries: 100,
  autoSaveInterval: 60000 // 1 minute
}

export class SessionMemory {
  private entries: Map<string, MemoryEntry> = new Map()
  private config: MemoryConfig
  private lastSave: number = 0

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config }
    this.load()
  }

  /**
   * Add a memory entry
   */
  addEntry(summary: string, keyPoints: string[] = [], relatedFiles: string[] = []): MemoryEntry {
    const entry: MemoryEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      summary,
      keyPoints,
      relatedFiles
    }
    
    this.entries.set(entry.id, entry)
    
    // Prune old entries if needed
    if (this.entries.size > this.config.maxEntries) {
      const oldestId = Array.from(this.entries.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0]
      if (oldestId) {
        this.entries.delete(oldestId)
      }
    }
    
    this.maybeAutoSave()
    return entry
  }

  /**
   * Get all memory entries
   */
  getEntries(): MemoryEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Get recent entries
   */
  getRecentEntries(count: number = 5): MemoryEntry[] {
    return this.getEntries().slice(0, count)
  }

  /**
   * Search entries by keyword
   */
  searchEntries(keyword: string): MemoryEntry[] {
    const lowerKeyword = keyword.toLowerCase()
    return this.getEntries().filter(entry =>
      entry.summary.toLowerCase().includes(lowerKeyword) ||
      entry.keyPoints.some(kp => kp.toLowerCase().includes(lowerKeyword)) ||
      entry.relatedFiles.some(rf => rf.toLowerCase().includes(lowerKeyword))
    )
  }

  /**
   * Delete an entry
   */
  deleteEntry(id: string): boolean {
    return this.entries.delete(id)
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear()
    this.save()
  }

  /**
   * Export to string for context injection
   */
  exportToContext(): string {
    const entries = this.getRecentEntries(3)
    if (entries.length === 0) return ''
    
    return `\n\n[Session Memory]\n${entries.map(e => 
      `- ${e.summary}${e.keyPoints.length > 0 ? '\n  Key points: ' + e.keyPoints.join(', ') : ''}`
    ).join('\n')}`
  }

  /**
   * Save to disk
   */
  save(): void {
    try {
      const data = {
        entries: Array.from(this.entries.values()),
        lastSave: Date.now()
      }
      
      fs.mkdirSync(path.dirname(this.config.storagePath), { recursive: true })
      fs.writeFileSync(this.config.storagePath, JSON.stringify(data, null, 2))
      this.lastSave = Date.now()
    } catch (error) {
      console.error('[SessionMemory] Failed to save:', error)
    }
  }

  /**
   * Load from disk
   */
  load(): void {
    try {
      if (fs.existsSync(this.config.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.config.storagePath, 'utf-8'))
        if (data.entries) {
          this.entries = new Map(data.entries.map((e: MemoryEntry) => [e.id, e]))
        }
      }
    } catch (error) {
      console.error('[SessionMemory] Failed to load:', error)
    }
  }

  /**
   * Auto-save if needed
   */
  private maybeAutoSave(): void {
    if (Date.now() - this.lastSave > this.config.autoSaveInterval) {
      this.save()
    }
  }
}

// ============================================================================
// Dynamic System Prompt
// ============================================================================

export interface PromptContext {
  cwd: string
  memory: SessionMemory
  toolNames: string[]
  recentFiles?: string[]
  customInstructions?: string
}

/**
 * Build dynamic system prompt
 */
export function buildDynamicSystemPrompt(context: PromptContext): string {
  const parts: string[] = [
    `You are Claude Code, an AI assistant for software engineering tasks.`,
    ``,
    `Current working directory: ${context.cwd}`,
    ``
  ]

  // Add available tools
  if (context.toolNames.length > 0) {
    parts.push(`Available tools:`)
    context.toolNames.forEach(tool => parts.push(`- ${tool}`))
    parts.push(``)
  }

  // Add session memory
  const memoryContext = context.memory.exportToContext()
  if (memoryContext) {
    parts.push(memoryContext)
    parts.push(``)
  }

  // Add recent files if available
  if (context.recentFiles && context.recentFiles.length > 0) {
    parts.push(`Recently accessed files:`)
    context.recentFiles.slice(0, 5).forEach(file => parts.push(`- ${file}`))
    parts.push(``)
  }

  // Add custom instructions
  if (context.customInstructions) {
    parts.push(`Custom instructions: ${context.customInstructions}`)
    parts.push(``)
  }

  // Add guidelines
  parts.push(`Guidelines:`)
  parts.push(`- Be concise but thorough`)
  parts.push(`- Use markdown for code blocks`)
  parts.push(`- When using tools, explain what you're doing`)
  parts.push(`- If a task is complex, break it down into steps`)

  return parts.join('\n')
}

// ============================================================================
// Context Manager (main class)
// ============================================================================

export class ContextManager {
  public memory: SessionMemory
  private compressionConfig: CompressionConfig

  constructor(
    private summarizeFn: (text: string) => Promise<string>,
    memoryConfig?: Partial<MemoryConfig>,
    compressionConfig?: Partial<CompressionConfig>
  ) {
    this.memory = new SessionMemory(memoryConfig)
    this.compressionConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...compressionConfig }
  }

  /**
   * Check if messages need compression
   */
  shouldCompress(messages: Message[]): boolean {
    return shouldCompress(messages, this.compressionConfig)
  }

  /**
   * Compress messages if needed
   */
  async compressIfNeeded(messages: Message[]): Promise<CompactResult> {
    if (!this.shouldCompress(messages)) {
      return {
        success: false,
        summary: '',
        preservedMessages: messages,
        removedCount: 0,
        tokenReduction: 0
      }
    }

    const result = await compressContext(messages, this.summarizeFn, this.compressionConfig)
    
    if (result.success) {
      // Add to memory
      this.memory.addEntry(
        `Compressed ${result.removedCount} messages`,
        [`Reduced ${result.tokenReduction} tokens`, `Summary: ${result.summary.slice(0, 100)}...`]
      )
    }

    return result
  }

  /**
   * Build system prompt with context
   */
  buildSystemPrompt(context: Omit<PromptContext, 'memory'>): string {
    return buildDynamicSystemPrompt({
      ...context,
      memory: this.memory
    })
  }

  /**
   * Add memory entry
   */
  addMemory(summary: string, keyPoints?: string[], relatedFiles?: string[]): MemoryEntry {
    return this.memory.addEntry(summary, keyPoints, relatedFiles)
  }

  /**
   * Save state
   */
  save(): void {
    this.memory.save()
  }

  /**
   * Load state
   */
  load(): void {
    this.memory.load()
  }
}
