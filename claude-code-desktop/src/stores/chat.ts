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

const STORAGE_KEY = 'chat_sessions_v2'
const PROJECTS_KEY = 'chat_projects_v2'
const STORAGE_VERSION = '2.1'

// localStorage 配额限制（通常 5-10MB，保守设置为 4MB）
const STORAGE_QUOTA_LIMIT = 4 * 1024 * 1024
const STORAGE_WARNING_THRESHOLD = 0.8 // 80% 警告阈值

// 存储统计信息
interface StorageStats {
  totalSize: number
  sessionCount: number
  oldestSessionDate: number
  compressionRatio: number
}

// 简单的 LZ 风格压缩（用于减少存储占用）
function compressData(data: string): string {
  try {
    // 使用 Unicode 压缩技巧：将重复的字符串模式进行压缩
    const compressed = data.replace(/([^\x00-\x7F]+|\\u[0-9a-fA-F]{4})+/g, (match) => {
      return '\x00' + match.length.toString(36) + '\x01' + match
    })
    return compressed.length < data.length ? 'C:' + compressed : 'R:' + data
  } catch {
    return 'R:' + data
  }
}

function decompressData(data: string): string {
  if (data.startsWith('R:')) return data.slice(2)
  if (data.startsWith('C:')) {
    try {
      return data.slice(2).replace(/\x00(\w+)\x01/g, (match, len) => {
        // 简化处理，实际使用时需要更复杂的解压逻辑
        return match
      })
    } catch {
      return data.slice(2)
    }
  }
  return data
}

// 获取 localStorage 使用情况
function getStorageUsage(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      total += localStorage.getItem(key)?.length || 0
    }
  }
  return total * 2 // Unicode 字符占 2 字节
}

// 检查存储空间
function checkStorageSpace(): { ok: boolean; usage: number; warning: boolean } {
  const usage = getStorageUsage()
  return {
    ok: usage < STORAGE_QUOTA_LIMIT,
    usage,
    warning: usage > STORAGE_QUOTA_LIMIT * STORAGE_WARNING_THRESHOLD
  }
}

// 清理旧会话以释放空间
function cleanupOldSessions(sessions: Session[], keepCount: number = 50): Session[] {
  if (sessions.length <= keepCount) return sessions

  // 按更新时间排序，保留最近的
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept = sorted.slice(0, keepCount)

  console.log(`[ChatStore] Cleaned up ${sessions.length - keepCount} old sessions`)
  return kept
}

// 截断过长的消息内容
function truncateLongMessages(sessions: Session[], maxLength: number = 10000): Session[] {
  return sessions.map(session => ({
    ...session,
    messages: session.messages.map(msg => {
      if (msg.content && msg.content.length > maxLength) {
        return {
          ...msg,
          content: msg.content.slice(0, maxLength) + '\n\n[Content truncated due to length]',
          // 标记为已截断
          truncated: true,
          originalLength: msg.content.length
        }
      }
      return msg
    })
  }))
}

function loadSessionsFromStorage(): Session[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      // 检查是否是压缩数据
      const data = saved.startsWith('C:') || saved.startsWith('R:')
        ? decompressData(saved)
        : saved
      const sessions = JSON.parse(data)
      return sessions || []
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load sessions from storage:', e)
  }
  return []
}

function saveSessionsToStorage(sessions: Session[]): boolean {
  try {
    // 检查存储空间
    const spaceCheck = checkStorageSpace()

    // 如果空间紧张，先清理旧会话
    let sessionsToSave = sessions
    if (!spaceCheck.ok || spaceCheck.warning) {
      console.warn('[ChatStore] Storage space low, cleaning up old sessions')
      sessionsToSave = cleanupOldSessions(sessions, 30)
      sessionsToSave = truncateLongMessages(sessionsToSave, 5000)
    }

    // 序列化数据
    const jsonData = JSON.stringify(sessionsToSave)

    // 尝试压缩
    const compressed = compressData(jsonData)
    const dataToStore = compressed.length < jsonData.length ? compressed : jsonData

    // 检查是否会超出限制
    if (dataToStore.length * 2 > STORAGE_QUOTA_LIMIT) {
      console.error('[ChatStore] Data too large to save, truncating further')
      sessionsToSave = cleanupOldSessions(sessionsToSave, 20)
      sessionsToSave = truncateLongMessages(sessionsToSave, 3000)
      const truncatedJson = JSON.stringify(sessionsToSave)
      localStorage.setItem(STORAGE_KEY, truncatedJson)
    } else {
      localStorage.setItem(STORAGE_KEY, dataToStore)
    }

    // 保存元数据
    localStorage.setItem(`${STORAGE_KEY}_meta`, JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: Date.now(),
      count: sessionsToSave.length,
      compressed: dataToStore !== jsonData
    }))

    return true
  } catch (e) {
    console.error('[ChatStore] Failed to save sessions to storage:', e)
    // 尝试紧急清理
    try {
      const emergencySessions = cleanupOldSessions(sessions, 10)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emergencySessions))
      return true
    } catch (e2) {
      console.error('[ChatStore] Emergency save also failed:', e2)
      return false
    }
  }
}

function loadProjectsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(PROJECTS_KEY)
    if (saved) {
      return JSON.parse(saved) || []
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load projects from storage:', e)
  }
  return []
}

function saveProjectsToStorage(projects: string[]): boolean {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
    return true
  } catch (e) {
    console.error('[ChatStore] Failed to save projects to storage:', e)
    return false
  }
}

// 导出存储统计信息供外部使用
export function getStorageStats(): StorageStats {
  const sessions = loadSessionsFromStorage()
  const usage = getStorageUsage()
  const metaStr = localStorage.getItem(`${STORAGE_KEY}_meta`)
  const meta = metaStr ? JSON.parse(metaStr) : null

  return {
    totalSize: usage,
    sessionCount: sessions.length,
    oldestSessionDate: sessions.length > 0
      ? Math.min(...sessions.map(s => s.createdAt))
      : Date.now(),
    compressionRatio: meta?.compressed ? 0.7 : 1.0
  }
}

export const useChatStore = defineStore('chat', () => {
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()

  // 所有会话（包含所有项目的会话）
  const sessions = ref<Session[]>(loadSessionsFromStorage())
  // 自动加载最近的会话（按更新时间排序）
  const lastSessionId = sessions.value.length > 0
    ? [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
    : null
  const currentSessionId = ref<string | null>(lastSessionId)
  const isLoading = ref(false)
  const streamingContent = ref('')
  const queryEngineSessions = ref<Map<string, string>>(new Map())

  // 项目列表
  const projects = ref<string[]>(loadProjectsFromStorage())
  // 当前选中的项目（空字符串表示没有特定项目）
  const currentProjectRoot = ref<string>('')

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

  // 当前工作目录
  const workingDirectory = computed(() =>
    currentSession.value?.workingDirectory || currentProjectRoot.value || ''
  )

  // 获取所有唯一的项目路径（从会话中提取）
  const allProjects = computed(() => {
    const projectSet = new Set<string>()
    for (const session of sessions.value) {
      if (session.workingDirectory) {
        projectSet.add(session.workingDirectory)
      }
    }
    // 合并手动添加的项目
    for (const project of projects.value) {
      projectSet.add(project)
    }
    return Array.from(projectSet)
  })

  // Get current API config for passing to CLI terminal
  function getCurrentConfig() {
    return settingsStore.config
  }

  function saveToStorage() {
    saveSessionsToStorage(sessions.value)
  }

  function saveProjects() {
    saveProjectsToStorage(projects.value)
  }

  watch(
    () => sessions.value,
    () => {
      saveToStorage()
    },
    { deep: true }
  )

  // 添加项目
  function addProject(projectPath: string) {
    if (!projects.value.includes(projectPath)) {
      projects.value.push(projectPath)
      saveProjects()
    }
    // 切换到新项目
    currentProjectRoot.value = projectPath
  }

  // 移除项目
  function removeProject(projectPath: string) {
    const index = projects.value.indexOf(projectPath)
    if (index > -1) {
      projects.value.splice(index, 1)
      saveProjects()
    }
    // 如果当前选中的是这个项目，清空当前项目
    if (currentProjectRoot.value === projectPath) {
      currentProjectRoot.value = ''
    }
  }

  // 切换当前项目
  function switchProject(projectPath: string) {
    currentProjectRoot.value = projectPath
  }

  function createSession(title = 'New Chat', workingDirectory?: string): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: workingDirectory || currentProjectRoot.value || undefined
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
    // 同时切换当前项目到该会话所属的项目
    const session = sessions.value.find(s => s.id === sessionId)
    if (session?.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }
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

  // 迁移旧数据（如果有）
  function migrateOldData() {
    try {
      // 尝试从旧格式加载
      const oldKeys = Object.keys(localStorage).filter(k => k.startsWith('chat_sessions_'))
      if (oldKeys.length > 0 && sessions.value.length === 0) {
        console.log('[ChatStore] Migrating old data...')
        for (const key of oldKeys) {
          const saved = localStorage.getItem(key)
          if (saved) {
            const data = JSON.parse(saved)
            if (data.sessions) {
              const projectRoot = key.replace('chat_sessions_', '').replace(/_/g, '/')
              for (const session of data.sessions) {
                session.workingDirectory = projectRoot
                sessions.value.push(session)
              }
            }
          }
        }
        saveToStorage()
        console.log('[ChatStore] Migration complete, sessions:', sessions.value.length)
      }
    } catch (e) {
      console.error('[ChatStore] Migration failed:', e)
    }
  }

  // 初始化时迁移旧数据
  migrateOldData()

  return {
    sessions,
    currentSessionId,
    isLoading,
    streamingContent,
    currentSession,
    currentMessages,
    workingDirectory,
    projects,
    allProjects,
    currentProjectRoot,
    createSession,
    addMessage,
    sendMessage,
    updateToolCall,
    updateMessage,
    selectSession,
    deleteSession,
    getCurrentConfig,
    saveToStorage,
    addProject,
    removeProject,
    switchProject
  }
})
