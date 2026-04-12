/**
 * Full QueryEngine Integration
 * 
 * This module attempts to integrate with the actual claude-code QueryEngine
 * from the package/cli.js bundle.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to claude-code package
const CLAUDE_CODE_PATH = path.resolve(__dirname, '../../../claude-code/package/cli.js')

// Check if claude-code is available
export function isClaudeCodeAvailable(): boolean {
  return fs.existsSync(CLAUDE_CODE_PATH)
}

// Session management
interface Session {
  id: string
  cwd: string
  messages: any[]
  queryEngine?: any
}

const sessions = new Map<string, Session>()

/**
 * Initialize the full QueryEngine integration
 */
export async function initQueryEngineFull() {
  if (!isClaudeCodeAvailable()) {
    console.log('[QueryEngineFull] claude-code package not found at:', CLAUDE_CODE_PATH)
    return false
  }

  console.log('[QueryEngineFull] Found claude-code at:', CLAUDE_CODE_PATH)

  // Set up IPC handlers
  ipcMain.handle('queryengine-full:createSession', async (_event, options: { cwd?: string }) => {
    const sessionId = randomUUID()
    const cwd = options.cwd || process.cwd()
    
    const session: Session = {
      id: sessionId,
      cwd,
      messages: []
    }
    
    sessions.set(sessionId, session)
    console.log('[QueryEngineFull] Created session:', sessionId)
    
    return { sessionId, cwd }
  })

  ipcMain.handle('queryengine-full:sendMessage', async (_event, {
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

    try {
      // Add user message
      session.messages.push({
        role: 'user',
        content,
        timestamp: Date.now()
      })

      // TODO: Integrate with actual QueryEngine from cli.js
      // This requires importing the bundle and using the ask() function
      
      // For now, return a placeholder
      const response = {
        role: 'assistant',
        content: `[Full QueryEngine integration pending. Message: "${content.slice(0, 50)}..."]`,
        timestamp: Date.now()
      }
      
      session.messages.push(response)
      
      return {
        content: response.content,
        messages: session.messages
      }
    } catch (error) {
      console.error('[QueryEngineFull] Error:', error)
      throw error
    }
  })

  ipcMain.on('queryengine-full:streamMessage', async (event, {
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
      event.reply('queryengine-full:error', { sessionId, error: 'Session not found' })
      return
    }

    try {
      // Add user message
      session.messages.push({
        role: 'user',
        content,
        timestamp: Date.now()
      })

      // TODO: Stream from actual QueryEngine
      const response = `[Full QueryEngine streaming pending. Message: "${content.slice(0, 50)}..."]`
      
      // Simulate streaming
      const chunks = response.split(' ')
      for (const chunk of chunks) {
        event.reply('queryengine-full:chunk', { sessionId, chunk: chunk + ' ' })
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      session.messages.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      })

      event.reply('queryengine-full:complete', { sessionId })
    } catch (error) {
      event.reply('queryengine-full:error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  console.log('[QueryEngineFull] Initialized')
  return true
}

/**
 * Try to import and use the actual QueryEngine from claude-code
 */
async function tryImportQueryEngine() {
  try {
    // The cli.js is a bundled ES module
    // We need to dynamically import it
    const claudeCodeModule = await import(CLAUDE_CODE_PATH)
    
    console.log('[QueryEngineFull] Imported claude-code module:', Object.keys(claudeCodeModule))
    
    // Look for the ask function or QueryEngine
    if (claudeCodeModule.ask) {
      console.log('[QueryEngineFull] Found ask function')
      return claudeCodeModule.ask
    }
    
    if (claudeCodeModule.QueryEngine) {
      console.log('[QueryEngineFull] Found QueryEngine class')
      return claudeCodeModule.QueryEngine
    }
    
    // The module might have a default export
    if (claudeCodeModule.default) {
      console.log('[QueryEngineFull] Found default export:', typeof claudeCodeModule.default)
      return claudeCodeModule.default
    }
    
    console.log('[QueryEngineFull] Could not find ask or QueryEngine in module')
    return null
  } catch (error) {
    console.error('[QueryEngineFull] Failed to import claude-code:', error)
    return null
  }
}

// Attempt to import on init
tryImportQueryEngine().then((result) => {
  if (result) {
    console.log('[QueryEngineFull] Successfully loaded QueryEngine')
  }
})
