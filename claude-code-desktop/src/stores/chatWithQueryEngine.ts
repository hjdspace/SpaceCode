/**
 * Chat Store with QueryEngine Integration
 * 
 * This store integrates with the QueryEngine running in Electron Main process.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Session, Message, ToolCall } from '@/types'
import { useSettingsStore } from './settings'

const electronAPI = (window as any).electronAPI

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<Session[]>([])
  const currentSessionId = ref<string | null>(null)
  const isLoading = ref(false)
  const streamingContent = ref('')
  const queryEngineSessions = ref<Map<string, string>>(new Map()) // sessionId -> queryEngineSessionId
  
  const currentSession = computed(() => 
    sessions.value.find(s => s.id === currentSessionId.value) || null
  )
  
  const currentMessages = computed(() => 
    currentSession.value?.messages || []
  )

  const settingsStore = useSettingsStore()
  
  function createSession(title = 'New Chat'): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    sessions.value.unshift(session)
    currentSessionId.value = session.id
    
    // Initialize QueryEngine session
    initQueryEngineSession(session.id)
    
    return session
  }

  async function initQueryEngineSession(sessionId: string) {
    if (!electronAPI?.queryEngine) {
      console.warn('[ChatStore] QueryEngine not available')
      return
    }

    try {
      const config = settingsStore.config
      const result = await electronAPI.queryEngine.createSession({
        cwd: process?.cwd?.() || '/',
        apiKey: config.apiKey,
        provider: config.provider,
        model: config.model
      })
      
      queryEngineSessions.value.set(sessionId, result.sessionId)
      console.log('[ChatStore] QueryEngine session created:', result.sessionId)
    } catch (error) {
      console.error('[ChatStore] Failed to create QueryEngine session:', error)
    }
  }
  
  function addMessage(message: Omit<Message, 'id' | 'timestamp'> & { id?: string }): Message {
    if (!currentSessionId.value) {
      createSession()
    }
    
    const newMessage: Message = {
      ...message,
      id: message.id || crypto.randomUUID(),
      timestamp: Date.now()
    }
    
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session) {
      const existingIndex = session.messages.findIndex(m => m.id === newMessage.id)
      if (existingIndex >= 0) {
        session.messages[existingIndex] = newMessage
      } else {
        session.messages.push(newMessage)
      }
      session.updatedAt = Date.now()
      
      if (session.messages.length === 1 && newMessage.role === 'user') {
        session.title = newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : '')
      }
    }
    
    return newMessage
  }

  async function sendMessage(content: string): Promise<void> {
    if (!currentSessionId.value) {
      createSession()
    }

    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (!session) return

    // Add user message
    addMessage({
      role: 'user',
      content
    })

    // Check if QueryEngine is available
    if (!electronAPI?.queryEngine) {
      // Fallback to simple response
      isLoading.value = true
      setTimeout(() => {
        addMessage({
          role: 'assistant',
          content: 'QueryEngine is not available. Please check your configuration.'
        })
        isLoading.value = false
      }, 500)
      return
    }

    // Get QueryEngine session ID
    let queryEngineSessionId = queryEngineSessions.value.get(session.id)
    if (!queryEngineSessionId) {
      await initQueryEngineSession(session.id)
      queryEngineSessionId = queryEngineSessions.value.get(session.id)
    }

    if (!queryEngineSessionId) {
      addMessage({
        role: 'assistant',
        content: 'Failed to initialize QueryEngine session.'
      })
      return
    }

    isLoading.value = true
    streamingContent.value = ''

    try {
      // Create assistant message placeholder
      const assistantMessageId = crypto.randomUUID()
      addMessage({
        id: assistantMessageId,
        role: 'assistant',
        content: ''
      })

      // Set up streaming handlers
      return new Promise((resolve, reject) => {
        let accumulatedContent = ''

        const handleChunk = (data: { sessionId: string; chunk: string }) => {
          if (data.sessionId !== queryEngineSessionId) return
          
          accumulatedContent += data.chunk
          streamingContent.value = accumulatedContent
          
          // Update the message in real-time
          updateMessage(assistantMessageId, { content: accumulatedContent })
        }

        const handleComplete = (data: { sessionId: string }) => {
          if (data.sessionId !== queryEngineSessionId) return
          
          streamingContent.value = ''
          isLoading.value = false
          
          // Final update
          updateMessage(assistantMessageId, { content: accumulatedContent })
          
          cleanup()
          resolve()
        }

        const handleError = (data: { sessionId: string; error: string }) => {
          if (data.sessionId !== queryEngineSessionId) return
          
          isLoading.value = false
          streamingContent.value = ''
          
          updateMessage(assistantMessageId, { 
            content: `Error: ${data.error}` 
          })
          
          cleanup()
          reject(new Error(data.error))
        }

        const cleanup = () => {
          electronAPI.queryEngine.offChunk(handleChunk)
          electronAPI.queryEngine.offComplete(handleComplete)
          electronAPI.queryEngine.offError(handleError)
        }

        // Subscribe to events
        electronAPI.queryEngine.onChunk(handleChunk)
        electronAPI.queryEngine.onComplete(handleComplete)
        electronAPI.queryEngine.onError(handleError)

        // Start streaming
        electronAPI.queryEngine.streamMessage({
          sessionId: queryEngineSessionId,
          content,
          options: {}
        })
      })
    } catch (error) {
      console.error('[ChatStore] Error sending message:', error)
      isLoading.value = false
      streamingContent.value = ''
      
      addMessage({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  
  function updateToolCall(messageId: string, toolCallId: string, status: ToolCall['status']) {
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session) {
      const message = session.messages.find(m => m.id === messageId)
      if (message?.toolCalls) {
        const toolCall = message.toolCalls.find(tc => tc.id === toolCallId)
        if (toolCall) {
          toolCall.status = status
        }
      }
    }
  }

  function updateMessage(messageId: string, updates: Partial<Message>) {
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session) {
      const index = session.messages.findIndex(m => m.id === messageId)
      if (index >= 0) {
        // Create a new array to trigger Vue reactivity
        const updatedMessage = { ...session.messages[index], ...updates }
        session.messages = [
          ...session.messages.slice(0, index),
          updatedMessage,
          ...session.messages.slice(index + 1)
        ]
      }
    }
  }
  
  function selectSession(sessionId: string) {
    currentSessionId.value = sessionId
  }
  
  async function deleteSession(sessionId: string) {
    const index = sessions.value.findIndex(s => s.id === sessionId)
    if (index > -1) {
      // Clean up QueryEngine session
      const queryEngineSessionId = queryEngineSessions.value.get(sessionId)
      if (queryEngineSessionId && electronAPI?.queryEngine) {
        try {
          await electronAPI.queryEngine.deleteSession({ sessionId: queryEngineSessionId })
        } catch (error) {
          console.error('[ChatStore] Failed to delete QueryEngine session:', error)
        }
      }
      queryEngineSessions.value.delete(sessionId)
      
      sessions.value.splice(index, 1)
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = sessions.value[0]?.id || null
      }
    }
  }
  
  return {
    sessions,
    currentSessionId,
    isLoading,
    streamingContent,
    currentSession,
    currentMessages,
    createSession,
    addMessage,
    sendMessage,
    updateToolCall,
    updateMessage,
    selectSession,
    deleteSession
  }
})
