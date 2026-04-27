/**
 * Chat Store with Claude Code CLI Integration
 *
 * This store integrates with the Claude Code CLI running in Electron Main process
 * via ClaudeCodeProcessManager. Supports project-specific chat sessions.
 */

import { defineStore } from 'pinia'
import { ref, computed, nextTick, watch } from 'vue'
import type { Session, Message, ToolCall, AgentInfo } from '@/types'
import { useSettingsStore } from './settings'
import { useAppStore } from './app'
import { useTaskManager } from '@/composables/useTaskManager'

const taskManager = useTaskManager()

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

/**
 * 从工具调用结果中解析并更新全局任务状态（Todo V2）
 */
function updateTaskStateFromToolResult(
  toolCalls: ToolCall[],
  resultToolUseId: string,
  resultOutput: string
) {
  const toolCall = toolCalls.find(tc => tc.id === resultToolUseId)
  if (!toolCall) return

  const toolName = toolCall.name

  if (toolName === 'TaskCreate') {
    // 解析: "Task #1 created successfully: subject"
    const match = resultOutput.match(/^Task #(\d+) created successfully: (.+)$/m)
    if (match) {
      taskManager.createTask(match[1], match[2], toolCall.input?.description)
    }
  } else if (toolName === 'TaskUpdate') {
    // 解析: "Updated task #1 ..." 或完整输出
    const idMatch = resultOutput.match(/^Updated task #(\d+)/)
    if (idMatch) {
      const taskId = idMatch[1]
      const updates: { status?: 'pending' | 'in_progress' | 'completed', owner?: string } = {}

      // 尝试解析状态变化
      const statusMatch = resultOutput.match(/status\w*:\s*(\w+)\s*->\s*(\w+)/i)
      if (statusMatch) {
        const newStatus = statusMatch[2]
        if (['pending', 'in_progress', 'completed'].includes(newStatus)) {
          updates.status = newStatus as TaskStatus
        }
      }

      // 尝试解析 owner 变化
      const ownerMatch = resultOutput.match(/owner\w*:\s*([^,\n]+)/i)
      if (ownerMatch) {
        updates.owner = ownerMatch[1].trim()
      }

      taskManager.updateTask(taskId, updates)
    }
  } else if (toolName === 'TaskList') {
    // 解析完整列表输出
    if (resultOutput === 'No tasks found') {
      taskManager.clearTasks()
      return
    }

    const tasks: Array<{
      id: string
      content: string
      status: 'pending' | 'in_progress' | 'completed'
      owner?: string
      blockedBy?: string[]
    }> = []

    // 解析每一行: "#1 [pending] subject (owner) [blocked by ...]"
    const lines = resultOutput.split('\n')
    for (const line of lines) {
      const match = line.match(/^#([^\s]+) \[(pending|in_progress|completed)\] (.*?)(?: \(([^)]+)\))?(?: \[blocked by (.+)\])?$/)
      if (!match) continue

      tasks.push({
        id: match[1],
        status: match[2] as TaskStatus,
        content: match[3],
        owner: match[4],
        blockedBy: match[5]?.split(', ').filter(Boolean) || []
      })
    }

    taskManager.syncTasksFromList(tasks)
  }
}

type TaskStatus = 'pending' | 'in_progress' | 'completed'

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
  const activeRequestCancel = ref<null | (() => void)>(null)

  // Agent state
  const currentAgent = ref<string>('')  // empty = default (no --agent flag)
  const availableAgents = ref<AgentInfo[]>([])

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
      const isActive = await claudeCode.isSessionActive()
      if (isActive) {
        return
      }

      const config = settingsStore.config
      const cwd = workingDirectory.value || await electronAPI.getCwd?.() || '/'
      await claudeCode.startSession({
        cwd,
        apiKey: config.apiKey,
        baseUrl: config.apiUrl,
        provider: config.provider,
        model: config.model,
        effortLevel: config.effortLevel,
        permissionMode: 'bypassPermissions',
        agent: currentAgent.value || undefined,
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
    if (activeRequestCancel.value) {
      activeRequestCancel.value()
      activeRequestCancel.value = null
    }

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
      let eventCount = 0
      let lastEventAt = Date.now()
      const startedAt = Date.now()
      const STALL_WARNING_MS = 20000

      const touchEvent = (source: string) => {
        eventCount += 1
        lastEventAt = Date.now()
        if (eventCount <= 5 || eventCount % 50 === 0) {
          console.log('[ChatStore] ClaudeCode event:', source, { eventCount })
        }
      }

      const stallTimer = setInterval(() => {
        if (isCompleted) return
        if (!isLoading.value) {
          clearInterval(stallTimer)
          return
        }
        const idleMs = Date.now() - lastEventAt
        if (idleMs >= STALL_WARNING_MS) {
          console.warn('[ChatStore] Waiting for ClaudeCode response...', {
            idleMs,
            elapsedMs: Date.now() - startedAt,
            assistantMessageId,
          })
        }
      }, 5000)

      const handleStreamEvent = (streamEvent: any) => {
        if (isCompleted) return
        const event = streamEvent.event || streamEvent
        touchEvent(`stream_event:${event?.type || 'unknown'}`)

        if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
          if (accumulatedContent.length > 0 && !accumulatedContent.endsWith('\n')) {
            accumulatedContent += '\n\n'
            streamingContent.value = accumulatedContent
            nextTick(() => {
              updateMessage(assistantMessageId, { content: accumulatedContent })
            })
          }
        }

        // 处理文本增量
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta?.text) {
          accumulatedContent += event.delta.text
          streamingContent.value = accumulatedContent
          nextTick(() => {
            updateMessage(assistantMessageId, { content: accumulatedContent })
          })
        }

        // 处理 reasoning 增量（思考过程）
        if (event.type === 'content_block_delta' && event.delta?.type === 'reasoning_delta' && event.delta?.reasoning) {
          const session = sessions.value.find(s => s.id === currentSessionId.value)
          if (session) {
            const msg = session.messages.find(m => m.id === assistantMessageId)
            if (msg) {
              if (!msg.reasoning) {
                msg.reasoning = {
                  content: '',
                  startTime: Date.now(),
                  isExpanded: true
                }
              }
              msg.reasoning.content += event.delta.reasoning
              saveToStorage()
            }
          }
        }
      }

      const handleAssistant = (assistant: any) => {
        if (isCompleted) return
        touchEvent('assistant')
        if (assistant.message?.content) {
          const content = assistant.message.content
          if (Array.isArray(content)) {
            // 兜底：某些场景下不会推送 text_delta，只在 assistant 完整消息里给出文本
            const textContent = content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .filter((t: any) => typeof t === 'string' && t.length > 0)
              .join('')

            if (textContent && textContent !== accumulatedContent) {
              accumulatedContent = textContent
              streamingContent.value = accumulatedContent
              nextTick(() => {
                updateMessage(assistantMessageId, { content: accumulatedContent })
              })
            }

            // 从 content 中提取 reasoning 类型的内容
            const reasoningContent = content
              .filter((c: any) => c.type === 'reasoning')
              .map((c: any) => c.reasoning || c.text)
              .join('')

            if (reasoningContent) {
              const session = sessions.value.find(s => s.id === currentSessionId.value)
              if (session) {
                const msg = session.messages.find(m => m.id === assistantMessageId)
                if (msg) {
                  if (!msg.reasoning) {
                    msg.reasoning = {
                      content: '',
                      startTime: Date.now(),
                      isExpanded: true
                    }
                  }
                  msg.reasoning.content += reasoningContent
                  msg.reasoning.endTime = Date.now()
                  saveToStorage()
                }
              }
            }

            // 从 content 中提取 tool_use 类型的内容
            const toolUses = content.filter((c: any) => c.type === 'tool_use')
            for (const toolUse of toolUses) {
              const session = sessions.value.find(s => s.id === currentSessionId.value)
              if (session) {
                const msg = session.messages.find(m => m.id === assistantMessageId)
                if (msg) {
                  const existingTool = msg.toolCalls?.find(tc => tc.id === toolUse.id)
                  if (!existingTool) {
                    // 创建新的工具调用数组以触发响应式更新
                    msg.toolCalls = [...(msg.toolCalls || []), {
                      id: toolUse.id,
                      name: toolUse.name,
                      input: toolUse.input || {},
                      status: 'running',
                      startTime: Date.now()
                    }]
                    saveToStorage()
                  }
                }
              }
            }
          } else if (typeof content === 'string' && content && content !== accumulatedContent) {
            accumulatedContent = content
            streamingContent.value = accumulatedContent
            nextTick(() => {
              updateMessage(assistantMessageId, { content: accumulatedContent })
            })
          }
        }
      }

      const handleToolUse = (toolUse: any) => {
        touchEvent('tool_use')
        const session = sessions.value.find(s => s.id === currentSessionId.value)
        if (session) {
          const msg = session.messages.find(m => m.id === assistantMessageId)
          if (msg) {
            // 从 tool_use 事件中提取工具调用信息
            const toolId = toolUse.id || toolUse.tool_use?.id || crypto.randomUUID()
            const toolName = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
            const toolInput = toolUse.input || toolUse.tool_use?.input || {}

            const existingTool = msg.toolCalls?.find(tc => tc.id === toolId)
            if (existingTool) {
              return
            }

            // 创建新的工具调用数组以触发响应式更新
            msg.toolCalls = [...(msg.toolCalls || []), {
              id: toolId,
              name: toolName,
              input: toolInput,
              status: 'running',
              startTime: Date.now()
            }]
            saveToStorage()
          }
        }
      }

      const handleToolResult = (toolResult: any) => {
        touchEvent('tool_result')
        const session = sessions.value.find(s => s.id === currentSessionId.value)
        if (session) {
          const msg = session.messages.find(m => m.id === assistantMessageId)
          if (msg?.toolCalls) {
            // 从 tool_result 事件中提取结果信息
            const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
            const rawResultOutput = toolResult.output ?? toolResult.content ?? toolResult.tool_result?.output ?? toolResult.tool_result?.content
            const resultOutput = typeof rawResultOutput === 'string' ? rawResultOutput : JSON.stringify(rawResultOutput)
            const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error

            // 更新全局任务状态（Todo V2）
            updateTaskStateFromToolResult(msg.toolCalls, resultToolUseId, resultOutput)

            const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === resultToolUseId)
            if (toolCallIndex >= 0) {
              // 创建新的工具调用数组以触发响应式更新
              const updatedToolCalls = [...msg.toolCalls]
              updatedToolCalls[toolCallIndex] = {
                ...updatedToolCalls[toolCallIndex],
                status: resultIsError ? 'error' : 'completed',
                output: resultOutput,
                endTime: Date.now()
              }
              msg.toolCalls = updatedToolCalls
              saveToStorage()
            }
          }
        }
      }

      const handleResult = (result: any) => {
        if (isCompleted) return
        touchEvent('result')
        isCompleted = true
        streamingContent.value = ''
        isLoading.value = false

        // 标记 reasoning 完成并添加元数据
        const session = sessions.value.find(s => s.id === currentSessionId.value)
        if (session) {
          const msg = session.messages.find(m => m.id === assistantMessageId)
          if (msg) {
            if (msg.reasoning && !msg.reasoning.endTime) {
              msg.reasoning.endTime = Date.now()
              msg.reasoning.isExpanded = false
            }
            // 添加元数据
            msg.metadata = {
              model: settingsStore.config.model,
              duration: Date.now() - msg.timestamp
            }
            saveToStorage()
          }
        }

        cleanup()
        resolve()
      }

      const handleUser = (userMsg: any) => {
        touchEvent('user')
        // 处理 user 消息中的 tool_result
        if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
          const toolResults = userMsg.message.content.filter((c: any) => c.type === 'tool_result')
          for (const toolResult of toolResults) {
            const session = sessions.value.find(s => s.id === currentSessionId.value)
            if (session) {
              const msg = session.messages.find(m => m.id === assistantMessageId)
              if (msg?.toolCalls) {
                const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === toolResult.tool_use_id)
                if (toolCallIndex >= 0) {
                  // 创建新的工具调用数组以触发响应式更新
                  const updatedToolCalls = [...msg.toolCalls]
                  updatedToolCalls[toolCallIndex] = {
                    ...updatedToolCalls[toolCallIndex],
                    status: toolResult.is_error ? 'error' : 'completed',
                    output: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
                    endTime: Date.now()
                  }
                  msg.toolCalls = updatedToolCalls
                  saveToStorage()
                }
              }
            }
          }
        }
      }

      const handleLog = (log: string) => {
        touchEvent('log')
        console.log('[ClaudeCode]', log)
      }

      const handleError = (error: any) => {
        if (isCompleted) return
        touchEvent('error')
        isCompleted = true
        isLoading.value = false
        streamingContent.value = ''

        const errorMsg = error instanceof Error ? error.message : String(error)

        let userMessage = `Error: ${errorMsg}`
        if (errorMsg.includes('Process exited with code 1')) {
          userMessage = `❌ 引擎启动失败\n\n可能原因：\n• API Key 无效或未配置\n• API Base URL 无法访问\n• 网络连接问题\n\n请检查设置页面的配置是否正确。`
        }

        updateMessage(assistantMessageId, {
          content: userMessage
        })
        cleanup()
        reject(error)
      }

      // Set up listeners and store unsubscribe functions
      const unsubscribeAssistant = claudeCode.onAssistant(handleAssistant)
      const unsubscribeUser = claudeCode.onUser(handleUser)
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
        clearInterval(stallTimer)
        unsubscribeAssistant?.()
        unsubscribeUser?.()
        unsubscribeStreamEvent?.()
        unsubscribeToolUse?.()
        unsubscribeToolResult?.()
        unsubscribeResult?.()
        unsubscribeLog?.()
        unsubscribeExit?.()
        if (activeRequestCancel.value === cancelCurrentRequest) {
          activeRequestCancel.value = null
        }
      }

      const cancelCurrentRequest = () => {
        if (isCompleted) return
        touchEvent('cancel')
        isCompleted = true
        isLoading.value = false
        streamingContent.value = ''
        cleanup()
        resolve()
      }

      activeRequestCancel.value = cancelCurrentRequest

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

  async function abort(): Promise<void> {
    console.log('[ChatStore] Abort called, isLoading:', isLoading.value)
    activeRequestCancel.value?.()
    activeRequestCancel.value = null
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode) {
      try {
        console.log('[ChatStore] Calling claudeCode.abort()')
        await claudeCode.abort()
        console.log('[ChatStore] claudeCode.abort() completed')
      } catch (error) {
        console.error('[ChatStore] Error aborting:', error)
      }
    } else {
      console.log('[ChatStore] claudeCode not available')
    }
    console.log('[ChatStore] Resetting isLoading and streamingContent')
    isLoading.value = false
    streamingContent.value = ''
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

  // Load available agents from main process
  async function loadAgents() {
    const claudeCode = electronAPI?.claudeCode
    if (!claudeCode?.listAgents) return
    try {
      const cwd = workingDirectory.value || currentProjectRoot.value || undefined
      availableAgents.value = await claudeCode.listAgents(cwd)
    } catch (error) {
      console.error('[ChatStore] Failed to load agents:', error)
    }
  }

  // Switch agent — requires restarting the CLI session
  async function switchAgent(agentType: string) {
    const previousAgent = currentAgent.value
    currentAgent.value = agentType

    // If there's an active session, restart it with the new agent
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode && await claudeCode.isSessionActive()) {
      await claudeCode.stop()
      // Re-init with new agent
      await initClaudeCodeSession()
    }

    console.log('[ChatStore] Agent switched to:', agentType || '(default)')
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
    currentAgent,
    availableAgents,
    createSession,
    initClaudeCodeSession,
    addMessage,
    sendMessage,
    abort,
    updateToolCall,
    updateMessage,
    selectSession,
    deleteSession,
    getCurrentConfig,
    saveToStorage,
    addProject,
    removeProject,
    switchProject,
    loadAgents,
    switchAgent,
  }
})
