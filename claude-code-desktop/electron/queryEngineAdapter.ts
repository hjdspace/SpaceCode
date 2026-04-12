/**
 * QueryEngine Adapter
 * 
 * This module attempts to import and use the actual claude-code QueryEngine.
 * It handles the necessary mocks and adaptations for Electron environment.
 */

import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Set up global mocks before importing QueryEngine
;(globalThis as any).feature = (flag: string): boolean => {
  // Return false for all feature flags by default
  return false
}

// Set up required environment variables
process.env.USER_TYPE = process.env.USER_TYPE || 'consumer'
process.env.CLAUDE_CODE_EAGER_FLUSH = 'false'
process.env.CLAUDE_CODE_IS_COWORK = 'false'

// Mock Bun if needed
if (typeof (globalThis as any).Bun === 'undefined') {
  (globalThis as any).Bun = {
    gc: () => {},
    version: '1.0.0'
  }
}

// Track if QueryEngine is available
let QueryEngineModule: any = null
let isAvailable = false

/**
 * Try to load the actual QueryEngine from claude-code
 */
export async function tryLoadQueryEngine(): Promise<boolean> {
  try {
    // Try multiple possible paths
    const possiblePaths = [
      path.resolve(__dirname, '../../../claude-code/src/QueryEngine.ts'),
      path.resolve(__dirname, '../../../claude-code/src/QueryEngine.js'),
      path.resolve(__dirname, '../../node_modules/@anthropic-ai/claude-code/src/QueryEngine.js'),
    ]

    for (const queryEnginePath of possiblePaths) {
      if (fs.existsSync(queryEnginePath)) {
        console.log('[QueryEngineAdapter] Found QueryEngine at:', queryEnginePath)
        
        // Dynamic import
        QueryEngineModule = await import(queryEnginePath)
        isAvailable = true
        console.log('[QueryEngineAdapter] Successfully loaded QueryEngine')
        return true
      }
    }

    console.log('[QueryEngineAdapter] QueryEngine not found in any path')
    return false
  } catch (error) {
    console.error('[QueryEngineAdapter] Failed to load QueryEngine:', error)
    isAvailable = false
    return false
  }
}

/**
 * Check if QueryEngine is available
 */
export function queryEngineIsAvailable(): boolean {
  return isAvailable && QueryEngineModule !== null
}

/**
 * Create a QueryEngine instance
 */
export async function createQueryEngine(config: any): Promise<any> {
  if (!isAvailable || !QueryEngineModule) {
    throw new Error('QueryEngine not available')
  }

  const { QueryEngine } = QueryEngineModule
  return new QueryEngine(config)
}

/**
 * Create a minimal QueryEngine-like implementation as fallback
 */
export function createMinimalQueryEngine(config: {
  cwd: string
  apiKey?: string
  provider?: 'openai' | 'anthropic'
}): any {
  const messages: any[] = []
  
  return {
    async *submitMessage(prompt: string, options?: any): AsyncGenerator<any> {
      // Add user message
      const userMessage = {
        type: 'user',
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: prompt
        }
      }
      messages.push(userMessage)
      yield userMessage

      // TODO: Integrate with actual LLM API
      // For now, return a placeholder
      const response = `[QueryEngine integration in progress. Received: "${prompt.slice(0, 50)}..."]`
      
      const assistantMessage = {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          role: 'assistant',
          content: response,
          stop_reason: 'end_turn'
        }
      }
      messages.push(assistantMessage)
      yield assistantMessage
    },
    
    getMessages() {
      return messages
    },
    
    getReadFileState() {
      return {}
    }
  }
}

/**
 * Get the best available QueryEngine implementation
 */
export async function getQueryEngine(config: any): Promise<any> {
  if (queryEngineIsAvailable()) {
    return createQueryEngine(config)
  }
  
  console.log('[QueryEngineAdapter] Using minimal QueryEngine fallback')
  return createMinimalQueryEngine(config)
}
