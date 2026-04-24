/**
 * Chat Store with Claude Code CLI Integration
 *
 * This store integrates with the Claude Code CLI running in Electron Main process
 * via ClaudeCodeProcessManager. Supports project-specific chat sessions.
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

  // 项目列表
  const projects = ref<string[]>(loadProjectsFromStorage())
  // 当前选中的项目（空字符串表示没有特定项目）
  const currentProjectRoot = ref<string>('')

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

  async function initClaudeCodeSession() {
    const claudeCode = electronAPI?.claudeCode
    if (!claudeCode) {
      // ClaudeCode 不可用
      return
    }

    try {
      // 检查是否已经有活跃的会话
      const isActive = await claudeCode.isSessionActive()
      if (isActive) {
        // 复用已存在的会话
        return
      }

      const config = settingsStore.config
      const cwd = workingDirectory.value || await electronAPI.getCwd?.() || '/'
      // 启动 ClaudeCode 会话
      await claudeCode.startSession({
        cwd,
        apiKey: config.apiKey,
        model: config.model,
        permissionMode: 'bypassPermissions' // 自动批准所有权限请求
      })
    } catch (error) {
      console.error('[ChatStore] Failed to start ClaudeCode session:', error)
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

    const claudeCode = electronAPI?.claudeCode
    if (!claudeCode) {
      isLoading.value = true
      setTimeout(() => {
        addMessage({
          role: 'assistant',
          content: 'Claude Code CLI is not available. Please check your configuration.'
        })
        isLoading.value = false
      }, 500)
      return
    }

    // Ensure session is started
    await initClaudeCodeSession()

    isLoading.value = true
    streamingContent.value = ''

    const assistantMessageId = crypto.randomUUID()

    addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    })

    await new Promise<void>((resolve, reject) => {
      let accumulatedContent = ''
      let isCompleted = false

      const handleStreamEvent = (streamEvent: any) => {
        if (isCompleted) return
        // stream_event 格式: { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '...' } } }
        const event = streamEvent.event || streamEvent
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta?.text) {
          accumulatedContent += event.delta.text
          streamingContent.value = accumulatedContent
          nextTick(() => {
            updateMessage(assistantMessageId, { content: accumulatedContent })
          })
        }
      }

      const handleAssistant = (assistant: any) => {
        if (isCompleted) return
        // 从 assistant.message.content 中提取文本
        if (assistant.message?.content) {
          const content = assistant.message.content
          if (Array.isArray(content)) {
            // content 是数组，提取所有 text 类型的文本
            const text = content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('')
            accumulatedContent = text
          } else if (typeof content === 'string') {
            accumulatedContent = content
          }
          streamingContent.value = accumulatedContent
          nextTick(() => {
            updateMessage(assistantMessageId, { content: accumulatedContent })
          })
        }
      }

      const handleToolUse = (toolUse: any) => {
        const session = sessions.value.find(s => s.id === currentSessionId.value)
        if (session) {
          const msg = session.messages.find(m => m.id === assistantMessageId)
          if (msg) {
            if (!msg.toolCalls) msg.toolCalls = []
            msg.toolCalls.push({
              id: toolUse.id || crypto.randomUUID(),
              name: toolUse.name,
              input: toolUse.input,
              status: 'running'
            })
            saveToStorage()
          }
        }
      }

      const handleToolResult = (toolResult: any) => {
        const session = sessions.value.find(s => s.id === currentSessionId.value)
        if (session) {
          const msg = session.messages.find(m => m.id === assistantMessageId)
          if (msg?.toolCalls) {
            const toolCall = msg.toolCalls.find(tc => tc.id === toolResult.tool_use_id)
            if (toolCall) {
              toolCall.status = 'completed'
              toolCall.output = toolResult.output
              saveToStorage()
            }
          }
        }
      }

      const handleResult = (result: any) => {
        if (isCompleted) return
        isCompleted = true
        streamingContent.value = ''
        isLoading.value = false
        // result 事件只用于标记完成，不更新内容（避免重复）
        // 内容已经在 handleAssistant 中更新
        saveToStorage()
        cleanup()
        resolve()
      }

      const handleLog = (log: string) => {
        // 可选：将 CLI 日志输出到控制台
        // console.log('[ClaudeCode]', log)
      }

      const handleError = (error: any) => {
        if (isCompleted) return
        isCompleted = true
        isLoading.value = false
        streamingContent.value = ''
        updateMessage(assistantMessageId, {
          content: `Error: ${error instanceof Error ? error.message : String(error)}`
        })
        cleanup()
        reject(error)
      }

      // Set up listeners and store unsubscribe functions
      const unsubscribeAssistant = claudeCode.onAssistant(handleAssistant)
      const unsubscribeStreamEvent = claudeCode.onStreamEvent(handleStreamEvent)
      const unsubscribeToolUse = claudeCode.onToolUse(handleToolUse)
      const unsubscribeToolResult = claudeCode.onToolResult(handleToolResult)
      const unsubscribeResult = claudeCode.onResult(handleResult)
      const unsubscribeLog = claudeCode.onLog(handleLog)
      const unsubscribeExit = claudeCode.onExit((code: number | null) => {
        if (code !== null && code !== 0) {
          handleError(new Error(`Process exited with code ${code}`))
        } else {
          handleResult({})
        }
      })

      const cleanup = () => {
        unsubscribeAssistant?.()
        unsubscribeStreamEvent?.()
        unsubscribeToolUse?.()
        unsubscribeToolResult?.()
        unsubscribeResult?.()
        unsubscribeLog?.()
        unsubscribeExit?.()
      }

      // Send message
      claudeCode.sendMessage(content).catch((error: any) => {
        cleanup()
        handleError(error)
      })
    }).catch((error) => {
      console.error('[ChatStore] Error sending message:', error)
      isLoading.value = false
      streamingContent.value = ''
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
        for (const key of oldKeys) {
          try {
            const oldSessions = JSON.parse(localStorage.getItem(key) || '[]')
            sessions.value = [...sessions.value, ...oldSessions]
            localStorage.removeItem(key)
          } catch {
            // 迁移失败时继续处理下一个 key
          }
        }
      }
    } catch {
      // 迁移失败时静默处理
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
    initClaudeCodeSession,
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
