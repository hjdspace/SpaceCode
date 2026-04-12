/**
 * QueryEngine Service
 * 
 * This service provides a frontend interface to the QueryEngine running in Electron Main process.
 */

import { ref, computed } from 'vue'
import type { Message } from '@/types'

const electronAPI = (window as any).electronAPI

interface QueryEngineSession {
  id: string
  cwd: string
}

interface CompactInfo {
  isCompacting: boolean
  removedCount?: number
  tokenReduction?: number
}

const currentSession = ref<QueryEngineSession | null>(null)
const messages = ref<Message[]>([])
const isLoading = ref(false)
const streamingContent = ref('')
const compactInfo = ref<CompactInfo>({ isCompacting: false })

export const queryEngineState = {
  currentSession,
  messages,
  isLoading,
  streamingContent,
  compactInfo
}

/**
 * Initialize the QueryEngine service
 */
export async function initQueryEngine(cwd?: string): Promise<void> {
  if (!electronAPI?.queryEngine) {
    console.warn('[QueryEngine] electronAPI.queryEngine not available')
    return
  }

  try {
    const result = await electronAPI.queryEngine.createSession({ cwd })
    currentSession.value = {
      id: result.sessionId,
      cwd: result.cwd
    }
    console.log('[QueryEngine] Session created:', result.sessionId)

    // Set up event listeners
    setupEventListeners()
  } catch (error) {
    console.error('[QueryEngine] Failed to initialize:', error)
    throw error
  }
}

/**
 * Send a message and get a streaming response
 */
export async function sendMessageStreaming(
  content: string,
  onChunk?: (chunk: string) => void
): Promise<void> {
  if (!currentSession.value) {
    throw new Error('No active session')
  }

  if (!electronAPI?.queryEngine) {
    throw new Error('QueryEngine not available')
  }

  isLoading.value = true
  streamingContent.value = ''

  try {
    // Add user message to local state
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    messages.value.push(userMessage)

    // Create a promise that resolves when streaming is complete
    return new Promise((resolve, reject) => {
      const sessionId = currentSession.value!.id
      let accumulatedContent = ''

      // Set up one-time event handlers for this request
      const handleChunk = (data: { sessionId: string; chunk: string }) => {
        if (data.sessionId !== sessionId) return
        
        accumulatedContent += data.chunk
        streamingContent.value = accumulatedContent
        onChunk?.(data.chunk)
      }

      const handleCompactStart = (data: { sessionId: string }) => {
        if (data.sessionId !== sessionId) return
        compactInfo.value = { isCompacting: true }
      }

      const handleCompactComplete = (data: { 
        sessionId: string
        removedCount: number
        tokenReduction: number 
      }) => {
        if (data.sessionId !== sessionId) return
        compactInfo.value = {
          isCompacting: false,
          removedCount: data.removedCount,
          tokenReduction: data.tokenReduction
        }
      }

      const handleComplete = (data: { sessionId: string }) => {
        if (data.sessionId !== sessionId) return
        
        // Add assistant message to local state
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulatedContent,
          timestamp: Date.now()
        }
        messages.value.push(assistantMessage)
        
        streamingContent.value = ''
        isLoading.value = false
        compactInfo.value = { isCompacting: false }
        
        cleanup()
        resolve()
      }

      const handleError = (data: { sessionId: string; error: string }) => {
        if (data.sessionId !== sessionId) return
        
        isLoading.value = false
        streamingContent.value = ''
        compactInfo.value = { isCompacting: false }
        
        cleanup()
        reject(new Error(data.error))
      }

      const cleanup = () => {
        electronAPI.queryEngine.offChunk(handleChunk)
        electronAPI.queryEngine.offCompactStart(handleCompactStart)
        electronAPI.queryEngine.offCompactComplete(handleCompactComplete)
        electronAPI.queryEngine.offComplete(handleComplete)
        electronAPI.queryEngine.offError(handleError)
      }

      // Subscribe to events
      electronAPI.queryEngine.onChunk(handleChunk)
      electronAPI.queryEngine.onCompactStart(handleCompactStart)
      electronAPI.queryEngine.onCompactComplete(handleCompactComplete)
      electronAPI.queryEngine.onComplete(handleComplete)
      electronAPI.queryEngine.onError(handleError)

      // Start streaming
      electronAPI.queryEngine.streamMessage({
        sessionId,
        content,
        options: {}
      })
    })
  } catch (error) {
    isLoading.value = false
    streamingContent.value = ''
    throw error
  }
}

/**
 * Send a message and get a complete response (non-streaming)
 */
export async function sendMessage(content: string): Promise<string> {
  if (!currentSession.value) {
    throw new Error('No active session')
  }

  if (!electronAPI?.queryEngine) {
    throw new Error('QueryEngine not available')
  }

  isLoading.value = true

  try {
    // Add user message to local state
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    messages.value.push(userMessage)

    const result = await electronAPI.queryEngine.sendMessage({
      sessionId: currentSession.value.id,
      content,
      options: {}
    })

    // Add assistant message to local state
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: result.content,
      timestamp: Date.now()
    }
    messages.value.push(assistantMessage)

    return result.content
  } finally {
    isLoading.value = false
  }
}

/**
 * Get all messages for the current session
 */
export async function getMessages(): Promise<Message[]> {
  if (!currentSession.value) {
    return []
  }

  if (!electronAPI?.queryEngine) {
    return messages.value
  }

  try {
    const result = await electronAPI.queryEngine.getMessages({
      sessionId: currentSession.value.id
    })
    return result
  } catch (error) {
    console.error('[QueryEngine] Failed to get messages:', error)
    return messages.value
  }
}

/**
 * Delete the current session
 */
export async function deleteSession(): Promise<void> {
  if (!currentSession.value) {
    return
  }

  if (!electronAPI?.queryEngine) {
    currentSession.value = null
    messages.value = []
    return
  }

  try {
    await electronAPI.queryEngine.deleteSession({
      sessionId: currentSession.value.id
    })
    currentSession.value = null
    messages.value = []
  } catch (error) {
    console.error('[QueryEngine] Failed to delete session:', error)
    throw error
  }
}

/**
 * Set up event listeners for QueryEngine events
 */
function setupEventListeners(): void {
  if (!electronAPI?.queryEngine) return

  // These are handled per-request in sendMessageStreaming
  // But we could add global handlers here if needed
}

/**
 * Check if QueryEngine is available
 */
export function isQueryEngineAvailable(): boolean {
  return !!electronAPI?.queryEngine
}
