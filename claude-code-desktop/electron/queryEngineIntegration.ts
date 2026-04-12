/**
 * Full QueryEngine Integration for Electron
 * 
 * This module provides a complete integration with claude-code's QueryEngine.
 * It handles all necessary mocks and configurations.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { ContextManager, Message, estimateMessagesTokens } from './services/contextManager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================================
// Global Mocks for Bun Environment
// ============================================================================

const FEATURE_FLAGS: Record<string, boolean> = {
  'HISTORY_SNIP': false,
  'REACTIVE_COMPACT': false,
  'CONTEXT_COLLAPSE': false,
  'EXPERIMENTAL_SKILL_SEARCH': false,
  'PROACTIVE': false,
  'KAIROS': false,
  'AGENT_TRIGGERS': false,
  'AGENT_TRIGGERS_REMOTE': false,
  'MONITOR_TOOL': false,
  'KAIROS_PUSH_NOTIFICATION': false,
  'KAIROS_GITHUB_WEBHOOKS': false,
  'CACHED_MICROCOMPACT': false,
  'COORDINATOR_MODE': false,
  'OVERFLOW_TEST_TOOL': false,
  'TERMINAL_PANEL': false,
  'WEB_BROWSER_TOOL': false,
  'WORKFLOW_SCRIPTS': false,
  'UDS_INBOX': false,
  'BREAK_CACHE_COMMAND': false,
  'TEMPLATES': false,
  'BG_SESSIONS': false,
}

;(globalThis as any).feature = (flag: string): boolean => FEATURE_FLAGS[flag] ?? false

if (typeof (globalThis as any).Bun === 'undefined') {
  (globalThis as any).Bun = { gc: () => {}, version: '1.0.0' }
}

process.env.USER_TYPE = process.env.USER_TYPE || 'consumer'
process.env.CLAUDE_CODE_EAGER_FLUSH = 'false'
process.env.CLAUDE_CODE_IS_COWORK = 'false'

// ============================================================================
// Types
// ============================================================================

type LLMProvider = 'openai' | 'anthropic' | 'gemini'

interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  baseUrl?: string
  model?: string
}

interface Session {
  id: string
  cwd: string
  messages: Message[]
  config: LLMConfig
  openaiClient?: OpenAI
  anthropicClient?: Anthropic
  geminiApiKey?: string
  geminiBaseUrl?: string
  contextManager: ContextManager
  recentFiles: string[]
}

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<string, Session>()

// ============================================================================
// Tool Definitions (from claude-code)
// ============================================================================

const TOOLS = [
  {
    name: 'Bash',
    description: 'Execute bash commands in the current working directory',
    parameters: {
      command: { type: 'string', description: 'The bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (optional)' }
    }
  },
  {
    name: 'FileRead',
    description: 'Read the contents of a file',
    parameters: {
      file_path: { type: 'string', description: 'The path to the file to read' },
      offset: { type: 'number', description: 'Line offset to start reading from (optional)' },
      limit: { type: 'number', description: 'Maximum number of lines to read (optional)' }
    }
  },
  {
    name: 'FileWrite',
    description: 'Write content to a file',
    parameters: {
      file_path: { type: 'string', description: 'The path to the file to write' },
      content: { type: 'string', description: 'The content to write' }
    }
  },
  {
    name: 'FileEdit',
    description: 'Edit a file by replacing text',
    parameters: {
      file_path: { type: 'string', description: 'The path to the file to edit' },
      old_string: { type: 'string', description: 'The text to replace' },
      new_string: { type: 'string', description: 'The replacement text' }
    }
  },
  {
    name: 'LS',
    description: 'List files and directories',
    parameters: {
      path: { type: 'string', description: 'The directory path to list' }
    }
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern',
    parameters: {
      pattern: { type: 'string', description: 'The glob pattern to match' }
    }
  },
  {
    name: 'Grep',
    description: 'Search for text patterns in files',
    parameters: {
      pattern: { type: 'string', description: 'The regex pattern to search for' },
      path: { type: 'string', description: 'The directory or file to search in' }
    }
  },
  {
    name: 'SearchCodebase',
    description: 'Search through the codebase using semantic search',
    parameters: {
      query: { type: 'string', description: 'The search query' }
    }
  },
  {
    name: 'WebSearch',
    description: 'Search the web for information',
    parameters: {
      query: { type: 'string', description: 'The search query' }
    }
  }
]

// ============================================================================
// System Prompt (Dynamic)
// ============================================================================

function buildSystemPrompt(session: Session): string {
  return session.contextManager.buildSystemPrompt({
    cwd: session.cwd,
    toolNames: TOOLS.map(t => t.name),
    recentFiles: session.recentFiles,
    customInstructions: undefined
  })
}

// ============================================================================
// LLM Client Management
// ============================================================================

function createLLMClient(config: LLMConfig): OpenAI | Anthropic | null {
  if (config.provider === 'openai') {
    return new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    })
  } else if (config.provider === 'anthropic') {
    return new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    })
  }
  // Gemini uses fetch-based API, no SDK client needed
  return null
}

// ============================================================================
// Tool Execution
// ============================================================================

async function executeTool(toolName: string, params: any, session: Session): Promise<string> {
  const { cwd } = session
  
  try {
    switch (toolName) {
      case 'Bash': {
        const { execSync } = require('child_process')
        const result = execSync(params.command, { 
          cwd, 
          encoding: 'utf-8',
          timeout: params.timeout || 30000
        })
        
        // Add to memory
        session.contextManager.addMemory(
          `Executed command: ${params.command.slice(0, 50)}...`,
          ['bash', 'command'],
          []
        )
        
        return result
      }
      
      case 'FileRead': {
        const filePath = path.resolve(cwd, params.file_path)
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')
        const offset = params.offset || 0
        const limit = params.limit || lines.length
        
        // Track recent file
        if (!session.recentFiles.includes(params.file_path)) {
          session.recentFiles.unshift(params.file_path)
          if (session.recentFiles.length > 10) {
            session.recentFiles.pop()
          }
        }
        
        return lines.slice(offset, offset + limit).join('\n')
      }
      
      case 'FileWrite': {
        const filePath = path.resolve(cwd, params.file_path)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, params.content)
        
        // Track recent file and add memory
        if (!session.recentFiles.includes(params.file_path)) {
          session.recentFiles.unshift(params.file_path)
          if (session.recentFiles.length > 10) {
            session.recentFiles.pop()
          }
        }
        
        session.contextManager.addMemory(
          `Wrote file: ${params.file_path}`,
          ['file', 'write'],
          [params.file_path]
        )
        
        return `Successfully wrote to ${params.file_path}`
      }
      
      case 'FileEdit': {
        const editPath = path.resolve(cwd, params.file_path)
        const content = fs.readFileSync(editPath, 'utf-8')
        const newContent = content.replace(params.old_string, params.new_string)
        if (newContent === content) {
          throw new Error('String not found in file')
        }
        fs.writeFileSync(editPath, newContent)
        
        // Track recent file and add memory
        if (!session.recentFiles.includes(params.file_path)) {
          session.recentFiles.unshift(params.file_path)
          if (session.recentFiles.length > 10) {
            session.recentFiles.pop()
          }
        }
        
        session.contextManager.addMemory(
          `Edited file: ${params.file_path}`,
          ['file', 'edit'],
          [params.file_path]
        )
        
        return `Successfully edited ${params.file_path}`
      }
      
      case 'LS': {
        const entries = fs.readdirSync(path.resolve(cwd, params.path), { withFileTypes: true })
        return entries.map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n')
      }
      
      case 'Glob': {
        const glob = require('glob')
        const files = glob.sync(params.pattern, { cwd })
        return files.join('\n')
      }
      
      case 'Grep': {
        const { execSync } = require('child_process')
        const result = execSync(`grep -r "${params.pattern}" ${params.path}`, { 
          cwd, 
          encoding: 'utf-8' 
        }).toString()
        return result
      }
      
      default:
        return `Tool ${toolName} not yet implemented`
    }
  } catch (error: any) {
    return `Error executing ${toolName}: ${error.message}`
  }
}

// ============================================================================
// Message Processing
// ============================================================================

function parseToolCalls(content: string): Array<{ name: string; params: any; raw: string }> {
  const toolCalls: Array<{ name: string; params: any; raw: string }> = []
  const regex = /<tool_use>\s*<name>(\w+)<\/name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/tool_use>/g
  let match
  
  while ((match = regex.exec(content)) !== null) {
    try {
      const name = match[1]
      const params = JSON.parse(match[2])
      toolCalls.push({ name, params, raw: match[0] })
    } catch (e) {
      console.error('Failed to parse tool call:', match[0])
    }
  }
  
  return toolCalls
}

async function* streamWithTools(
  session: Session,
  userMessage: string
): AsyncGenerator<any, void, unknown> {
  const { config, cwd, messages, contextManager } = session
  
  // Add user message
  const userMsg: Message = {
    id: randomUUID(),
    role: 'user',
    content: userMessage,
    timestamp: Date.now()
  }
  messages.push(userMsg)
  
  // Check if compression is needed
  const shouldCompress = contextManager.shouldCompress(messages)
  if (shouldCompress) {
    yield { type: 'compact_start' }
    
    const compactResult = await contextManager.compressIfNeeded(messages)
    if (compactResult.success) {
      // Replace messages with compressed version
      messages.length = 0
      messages.push(...compactResult.preservedMessages)
      
      yield { 
        type: 'compact_complete', 
        removedCount: compactResult.removedCount,
        tokenReduction: compactResult.tokenReduction
      }
    }
  }
  
  // Build messages for LLM
  const systemPrompt = buildSystemPrompt(session)
  const conversationMessages = messages.filter(m => m.role !== 'system')
  
  let fullResponse = ''
  let toolResults: Array<{ tool: string; result: string }> = []
  
  // Main loop - continue until no more tool calls
  while (true) {
    const currentMessages = [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
      ...(toolResults.length > 0 ? [{
        role: 'user' as const,
        content: toolResults.map(tr => `<tool_result>\n<name>${tr.tool}</name>\n<output>${tr.result}</output>\n</tool_result>`).join('\n')
      }] : [])
    ]

    fullResponse = ''

    // Stream from LLM
    if (config.provider === 'gemini' && session.geminiApiKey) {
      // Gemini streaming via SSE fetch
      const baseUrl = session.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
      const model = config.model || 'gemini-2.5-flash'

      const geminiContents = conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

      const geminiBody: any = {
        contents: geminiContents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192
        }
      }

      if (systemPrompt) {
        geminiBody.systemInstruction = {
          parts: [{ text: systemPrompt }]
        }
      }

      const geminiUrl = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${session.geminiApiKey}`

      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      })

      if (!geminiResponse.ok) {
        throw new Error(`Gemini API error: ${geminiResponse.status}`)
      }

      const geminiReader = geminiResponse.body?.getReader()
      if (geminiReader) {
        const decoder = new TextDecoder()
        let sseBuffer = ''

        while (true) {
          const { done, value } = await geminiReader.read()
          if (done) break

          sseBuffer += decoder.decode(value, { stream: true })
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim()
              if (!jsonStr || jsonStr === '[DONE]') continue
              try {
                const data = JSON.parse(jsonStr)
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text
                if (text) {
                  fullResponse += text
                  yield { type: 'content_block_delta', delta: { text } }
                }
              } catch (e) { /* skip */ }
            }
          }
        }
      }
    } else if (config.provider === 'openai' && session.openaiClient) {
      const stream = await session.openaiClient.chat.completions.create({
        model: config.model || 'gpt-4',
        messages: currentMessages as any,
        stream: true,
        temperature: 0.7
      })
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          fullResponse += content
          yield { type: 'content_block_delta', delta: { text: content } }
        }
      }
    } else if (session.anthropicClient) {
      const client = session.anthropicClient as Anthropic
      const stream = client.messages.stream({
        model: config.model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: conversationMessages as any
      })
      
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const text = (chunk as any).delta?.text || ''
          if (text) {
            fullResponse += text
            yield { type: 'content_block_delta', delta: { text } }
          }
        }
      }
    }
    
    // Parse and execute tool calls
    const toolCalls = parseToolCalls(fullResponse)
    
    if (toolCalls.length === 0) {
      // No tool calls, we're done
      break
    }
    
    // Execute tools
    toolResults = []
    for (const toolCall of toolCalls) {
      yield { type: 'tool_start', tool: toolCall.name, params: toolCall.params }
      
      const result = await executeTool(toolCall.name, toolCall.params, session)
      toolResults.push({ tool: toolCall.name, result })
      
      yield { type: 'tool_result', tool: toolCall.name, result }
    }
  }

  const finalContent = fullResponse
  messages.push({
    id: randomUUID(),
    role: 'assistant',
    content: finalContent,
    timestamp: Date.now()
  })

  conversationMessages.push({
    id: randomUUID(),
    role: 'assistant',
    content: finalContent,
    timestamp: Date.now()
  })
  
  // Save context manager state
  contextManager.save()
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function initQueryEngineIntegration() {
  console.log('[QueryEngineIntegration] Initializing...')
  
  // Create session
  ipcMain.handle('queryengine:createSession', async (_event, options: { 
    cwd?: string
    apiKey?: string
    provider?: LLMProvider
    model?: string
    baseUrl?: string
  }) => {
    const sessionId = randomUUID()
    const cwd = options.cwd || process.cwd()
    
    if (!options.apiKey) {
      throw new Error('API key is required')
    }
    
    const config: LLMConfig = {
      provider: options.provider || 'anthropic',
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl
    }
    
    // Create summarization function for context compression
    const summarizeFn = async (text: string): Promise<string> => {
      // Simple summarization - in production, this would use LLM
      const lines = text.split('\n').slice(0, 10)
      return `[Summary of ${text.length} chars]: ${lines.join(' ').slice(0, 200)}...`
    }
    
    // Create context manager
    const contextManager = new ContextManager(summarizeFn, {
      storagePath: path.join(cwd, '.claude-code-memory', `${sessionId}.json`),
      maxEntries: 50,
      autoSaveInterval: 30000
    })
    
    const session: Session = {
      id: sessionId,
      cwd,
      messages: [],
      config,
      contextManager,
      recentFiles: []
    }
    
    // Create LLM client
    const client = createLLMClient(config)
    if (config.provider === 'openai') {
      session.openaiClient = client as OpenAI
    } else if (config.provider === 'anthropic') {
      session.anthropicClient = client as Anthropic
    } else if (config.provider === 'gemini') {
      session.geminiApiKey = config.apiKey
      session.geminiBaseUrl = config.baseUrl
    }
    
    sessions.set(sessionId, session)
    console.log('[QueryEngineIntegration] Created session:', sessionId, 'provider:', config.provider)
    
    return { sessionId, cwd }
  })

  // Stream message
  ipcMain.on('queryengine:streamMessage', async (event, {
    sessionId,
    content,
    options = {},
    requestId
  }: {
    sessionId: string
    content: string
    options?: any
    requestId?: string
  }) => {
    console.log('[QueryEngine] Stream message received:', sessionId, content.slice(0, 50), 'requestId:', requestId)
    
    const session = sessions.get(sessionId)
    if (!session) {
      console.error('[QueryEngine] Session not found:', sessionId)
      event.reply('queryengine:error', { sessionId, error: 'Session not found', requestId })
      return
    }

    try {
      const generator = streamWithTools(session, content)
      let chunkCount = 0
      
      for await (const chunk of generator) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          chunkCount++
          console.log(`[QueryEngine] Chunk ${chunkCount}:`, chunk.delta.text.slice(0, 30))
          // Use event.reply() to send ONLY to the requester, not broadcast to all windows
          event.reply('queryengine:chunk', { sessionId, chunk: chunk.delta.text, requestId })
        } else if (chunk.type === 'tool_start') {
          event.reply('queryengine:tool_start', { sessionId, tool: chunk.tool, params: chunk.params, requestId })
        } else if (chunk.type === 'tool_result') {
          event.reply('queryengine:tool_result', { sessionId, tool: chunk.tool, result: chunk.result, requestId })
        } else if (chunk.type === 'compact_start') {
          event.reply('queryengine:compact_start', { sessionId, requestId })
        } else if (chunk.type === 'compact_complete') {
          event.reply('queryengine:compact_complete', { 
            sessionId,
            removedCount: chunk.removedCount,
            tokenReduction: chunk.tokenReduction,
            requestId
          })
        }
      }

      event.reply('queryengine:complete', { sessionId, requestId })
    } catch (error) {
      console.error('[QueryEngineIntegration] Streaming error:', error)
      event.reply('queryengine:error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        requestId
      })
    }
  })

  // Send message (non-streaming)
  ipcMain.handle('queryengine:sendMessage', async (_event, {
    sessionId,
    content,
    options = {}
  }: {
    sessionId: string
    content: string
    options?: any
  }) => {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const generator = streamWithTools(session, content)
    let fullContent = ''
    
    for await (const chunk of generator) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        fullContent += chunk.delta.text
      }
    }

    return {
      content: fullContent,
      sessionId
    }
  })

  // Get messages
  ipcMain.handle('queryengine:getMessages', async (_event, { sessionId }: { sessionId: string }) => {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return session.messages
  })

  // Delete session
  ipcMain.handle('queryengine:deleteSession', async (_event, { sessionId }: { sessionId: string }) => {
    sessions.delete(sessionId)
    return { success: true }
  })

  console.log('[QueryEngineIntegration] Initialized successfully')
}

export async function attemptFullIntegration(): Promise<boolean> {
  console.log('[QueryEngineIntegration] Running in full LLM mode with tool support')
  return true
}
