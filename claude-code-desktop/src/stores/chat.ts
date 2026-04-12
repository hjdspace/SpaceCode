/**
 * Chat Store with QueryEngine Integration
 * 
 * This store integrates with the QueryEngine running in Electron Main process.
 * Supports project-specific chat sessions.
 */

import { defineStore } from 'pinia'
import { ref, computed, nextTick, watch } from 'vue'
import type { Session, Message, ToolCall } from '@/types'
import { useSettingsStore } from './settings'
import { useAppStore } from './app'

const electronAPI = (window as any).electronAPI

const STORAGE_KEY_PREFIX = 'chat_sessions_'

function getStorageKey(projectRoot: string): string {
  if (!projectRoot) {
    return `${STORAGE_KEY_PREFIX}default`
  }
  // 将路径中的特殊字符替换，确保键名合法
  const safePath = projectRoot.replace(/[\\/:*?"<>|]/g, '_')
  return `${STORAGE_KEY_PREFIX}${safePath}`
}

function loadSessionsFromStorage(projectRoot: string): { sessions: Session[]; currentId: string | null } {
  try {
    const key = getStorageKey(projectRoot)
    const saved = localStorage.getItem(key)
    if (saved) {
      const data = JSON.parse(saved)
      return {
        sessions: data.sessions || [],
        currentId: data.currentId || null
      }
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load sessions from storage:', e)
  }
  return { sessions: [], currentId: null }
}

function saveSessionsToStorage(projectRoot: string, sessions: Session[], currentId: string | null) {
  try {
    const key = getStorageKey(projectRoot)
    localStorage.setItem(key, JSON.stringify({
      sessions,
      currentId
    }))
  } catch (e) {
    console.error('[ChatStore] Failed to save sessions to storage:', e)
  }
}

export const useChatStore = defineStore('chat', () => {
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()
  
  // 当前项目路径
  const currentProjectRoot = ref<string>('')
  
  const sessions = ref<Session[]>([])
  const currentSessionId = ref<string | null>(null)
  const isLoading = ref(false)
  const streamingContent = ref('')
  const queryEngineSessions = ref<Map<string, string>>(new Map())
  
  // Track config changes to invalidate stale QueryEngine sessions
  let lastConfigKey = ''
  function getConfigKey(): string {
    const c = settingsStore.config
    return `${c.provider}|${c.apiKey}|${c.model}|${c.apiUrl}`
  }
  
  // When config changes, clear all QueryEngine session mappings so they get recreated with new config
  watch(() => settingsStore.config, () => {
    const newKey = getConfigKey()
    if (lastConfigKey && newKey !== lastConfigKey) {
      console.log('[ChatStore] Config changed, clearing QueryEngine sessions. Old:', lastConfigKey, 'New:', newKey)
      queryEngineSessions.value.clear()
    }
    lastConfigKey = newKey
  }, { deep: true })
  
  const currentSession = computed(() => 
    sessions.value.find(s => s.id === currentSessionId.value) || null
  )
  
  const currentMessages = computed(() => 
    currentSession.value?.messages || []
  )

  // Get current API config for passing to CLI terminal
  function getCurrentConfig() {
    return settingsStore.config
  }

  function saveToStorage() {
    // 使用 != null 检查同时排除 null 和 undefined
    // 空字符串是有效的（表示默认项目）
    if (currentProjectRoot.value != null) {
      saveSessionsToStorage(currentProjectRoot.value, sessions.value, currentSessionId.value)
    }
  }

  // 是否已经初始化过（用于判断是否需要保存当前会话）
  let isInitialized = false

  // 加载指定项目的会话
  function loadProjectSessions(projectRoot: string) {
    console.log('[ChatStore] Loading project sessions for:', projectRoot || '(default)')
    // Initialize config tracking
    lastConfigKey = getConfigKey()
    
    // 先保存当前项目的会话（如果已经初始化过且有数据）
    if (isInitialized && sessions.value.length > 0) {
      console.log('[ChatStore] Saving current project sessions:', currentProjectRoot.value || '(default)')
      saveToStorage()
    }
    
    // 标记为已初始化
    isInitialized = true
    
    // 切换到新项目
    currentProjectRoot.value = projectRoot
    const storageKey = getStorageKey(projectRoot)
    console.log('[ChatStore] Storage key:', storageKey)
    
    const { sessions: newSessions, currentId: newCurrentId } = loadSessionsFromStorage(projectRoot)
    console.log('[ChatStore] Loaded sessions count:', newSessions.length)
    
    sessions.value = newSessions
    currentSessionId.value = newCurrentId
    
    // 如果没有会话，自动创建一个
    if (sessions.value.length === 0) {
      console.log('[ChatStore] No sessions found, creating new one')
      createSession('New Chat')
    }
  }

  watch(
    () => [sessions.value, currentSessionId.value],
    () => {
      saveToStorage()
    },
    { deep: true }
  )
  
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
    saveToStorage()
    
    return session
  }

  async function initQueryEngineSession(sessionId: string) {
    if (!electronAPI?.queryEngine) {
      console.warn('[ChatStore] QueryEngine not available')
      return
    }

    try {
      const config = settingsStore.config
      const cwd = await electronAPI.getCwd?.() || '/'
      console.log('[ChatStore] Creating QueryEngine session with config:', {
        provider: config.provider,
        model: config.model,
        hasApiKey: !!config.apiKey,
        baseUrl: config.apiUrl
      })
      const result = await electronAPI.queryEngine.createSession({
        cwd,
        apiKey: config.apiKey,
        provider: config.provider,
        model: config.model,
        baseUrl: config.apiUrl
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
      saveToStorage()
    }
    
    return newMessage
  }

  async function sendMessage(content: string): Promise<void> {
    if (!currentSessionId.value) {
      createSession()
    }

    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (!session) return

    addMessage({
      role: 'user',
      content
    })

    if (!electronAPI?.queryEngine) {
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

    // CRITICAL FIX: Clean up any previous streaming listeners BEFORE setting up new ones
    // This prevents the "second message updates first message" bug where old listeners
    // were still active and receiving chunks for the new sessionId (since both share the same queryEngineSessionId)
    electronAPI.queryEngine.offChunk(() => {})
    electronAPI.queryEngine.offComplete(() => {})
    electronAPI.queryEngine.onError(() => {})

    isLoading.value = true
    streamingContent.value = ''

    const assistantMessageId = crypto.randomUUID()
    const requestId = crypto.randomUUID() // Unique request ID to isolate this response

    addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    })

    await new Promise<void>((resolve, reject) => {
      let accumulatedContent = ''

      const handleChunk = (data: { sessionId: string; chunk: string; requestId?: string }) => {
        // Double-filter by both sessionId AND requestId to ensure isolation
        if (data.sessionId !== queryEngineSessionId) return
        if (data.requestId && data.requestId !== requestId) return
        
        accumulatedContent += data.chunk
        streamingContent.value = accumulatedContent
        
        nextTick(() => {
          updateMessage(assistantMessageId, { content: accumulatedContent })
        })
      }

      const handleComplete = (data: { sessionId: string; requestId?: string }) => {
        if (data.sessionId !== queryEngineSessionId) return
        if (data.requestId && data.requestId !== requestId) return
        
        streamingContent.value = ''
        isLoading.value = false
        
        updateMessage(assistantMessageId, { content: accumulatedContent })
        saveToStorage()
        
        resolve()
      }

      const handleError = (data: { sessionId: string; error: string; requestId?: string }) => {
        if (data.sessionId !== queryEngineSessionId) return
        if (data.requestId && data.requestId !== requestId) return
        
        isLoading.value = false
        streamingContent.value = ''
        
        updateMessage(assistantMessageId, { 
          content: `Error: ${data.error}` 
        })
        saveToStorage()
        
        reject(new Error(data.error))
      }

      const cleanup = () => {
        electronAPI.queryEngine.offChunk(handleChunk)
        electronAPI.queryEngine.offComplete(handleComplete)
        electronAPI.queryEngine.offError(handleError)
      }

      electronAPI.queryEngine.onChunk(handleChunk)
      electronAPI.queryEngine.onComplete(handleComplete)
      electronAPI.queryEngine.onError(handleError)

      try {
        electronAPI.queryEngine.streamMessage({
          sessionId: queryEngineSessionId,
          content,
          options: {},
          requestId
        })
      } catch (error) {
        cleanup()
        reject(error)
      }
    }).catch((error) => {
      console.error('[ChatStore] Error sending message:', error)
      isLoading.value = false
      streamingContent.value = ''
      
      updateMessage(assistantMessageId, {
        content: `Error: ${error instanceof Error ? error.message : String(error)}`
      })
    })
  }
  
  function updateToolCall(messageId: string, toolCallId: string, status: ToolCall['status']) {
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session) {
      const message = session.messages.find(m => m.id === messageId)
      if (message?.toolCalls) {
        const toolCall = message.toolCalls.find(tc => tc.id === toolCallId)
        if (toolCall) {
          toolCall.status = status
          saveToStorage()
        }
      }
    }
  }

  function updateMessage(messageId: string, updates: Partial<Message>) {
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session) {
      const index = session.messages.findIndex(m => m.id === messageId)
      if (index >= 0) {
        const updatedMessage = { ...session.messages[index], ...updates }
        session.messages = [
          ...session.messages.slice(0, index),
          updatedMessage,
          ...session.messages.slice(index + 1)
        ]
        saveToStorage()
      }
    }
  }
  
  function selectSession(sessionId: string) {
    currentSessionId.value = sessionId
    saveToStorage()
  }
  
  async function deleteSession(sessionId: string) {
    const index = sessions.value.findIndex(s => s.id === sessionId)
    if (index > -1) {
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
      saveToStorage()
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
    deleteSession,
    getCurrentConfig,
    loadProjectSessions
  }
})
