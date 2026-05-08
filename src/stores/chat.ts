import { defineStore } from 'pinia'
import { ref, computed, nextTick, watch } from 'vue'
import type { Session, Message, ToolCall, AgentInfo, ProcessStatus } from '@/types'
import { useSettingsStore } from './settings'
import { useAppStore } from './app'
import { useTaskManager } from '@/composables/useTaskManager'
import { errorHandler } from '@/services/errorHandler'

const taskManager = useTaskManager()

const electronAPI = (window as any).electronAPI

// ============================================================
// Renderer Logger — 将日志转发到主进程写入 ~/.claude/debug/
// ============================================================
const logger = {
  debug: (scope: string, message: string, data?: any) => {
    console.debug(`[${scope}] ${message}`, data ?? '')
    electronAPI?.logger?.debug?.(scope, message, data)
  },
  info: (scope: string, message: string, data?: any) => {
    console.log(`[${scope}] ${message}`, data ?? '')
    electronAPI?.logger?.info?.(scope, message, data)
  },
  warn: (scope: string, message: string, data?: any) => {
    console.warn(`[${scope}] ${message}`, data ?? '')
    electronAPI?.logger?.warn?.(scope, message, data)
  },
  error: (scope: string, message: string, data?: any) => {
    console.error(`[${scope}] ${message}`, data ?? '')
    electronAPI?.logger?.error?.(scope, message, data)
  },
}

const FILE_TOOLS = new Set(['Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit'])
const COMMAND_TOOLS = new Set(['Bash'])
const VERIFICATION_PATTERNS = [/^\s*(npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|jest|vitest|mocha|npx\s+playwright|ruff|eslint|biome|prettier|tsc|vue-tsc|npm\s+run\s+(test|lint|check|build|typecheck))/i]

function traceEvent(event: {
  sessionId: string
  messageId?: string
  actor: 'user' | 'assistant' | 'tool' | 'system'
  type: string
  status?: 'started' | 'running' | 'completed' | 'failed'
  title?: string
  input?: unknown
  output?: unknown
  artifacts?: Array<{ kind: string; path?: string; content?: string }>
  evidence?: Array<{ kind: string; result?: string; detail: string }>
  metadata?: Record<string, unknown>
  error?: { message: string; stack?: string }
}) {
  electronAPI?.trace?.event?.({
    source: 'renderer',
    ...event,
  })
}

const STORAGE_KEY = 'chat_sessions_v2'
const PROJECTS_KEY = 'chat_projects_v2'
const STORAGE_VERSION = '2.1'

const STORAGE_QUOTA_LIMIT = 4 * 1024 * 1024
const STORAGE_WARNING_THRESHOLD = 0.8

interface StorageStats {
  totalSize: number
  sessionCount: number
  oldestSessionDate: number
  compressionRatio: number
}

function compressData(data: string): string {
  try {
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
        return match
      })
    } catch {
      return data.slice(2)
    }
  }
  return data
}

function getStorageUsage(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      total += localStorage.getItem(key)?.length || 0
    }
  }
  return total * 2
}

function checkStorageSpace(): { ok: boolean; usage: number; warning: boolean } {
  const usage = getStorageUsage()
  return {
    ok: usage < STORAGE_QUOTA_LIMIT,
    usage,
    warning: usage > STORAGE_QUOTA_LIMIT * STORAGE_WARNING_THRESHOLD
  }
}

function cleanupOldSessions(sessions: Session[], keepCount: number = 50): Session[] {
  if (sessions.length <= keepCount) return sessions
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const kept = sorted.slice(0, keepCount)
  console.log(`[ChatStore] Cleaned up ${sessions.length - keepCount} old sessions`)
  return kept
}

function truncateLongMessages(sessions: Session[], maxLength: number = 10000): Session[] {
  return sessions.map(session => ({
    ...session,
    messages: session.messages.map(msg => {
      if (msg.content && msg.content.length > maxLength) {
        return {
          ...msg,
          content: msg.content.slice(0, maxLength) + '\n\n[Content truncated due to length]',
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
      const data = saved.startsWith('C:') || saved.startsWith('R:')
        ? decompressData(saved)
        : saved
      const sessions = JSON.parse(data)
      return (sessions || []).map((s: any) => ({
        ...s,
        processStatus: s.processStatus || 'none',
        isTabOpen: s.isTabOpen ?? false,
        lastActivityAt: s.lastActivityAt || s.updatedAt || s.createdAt
      }))
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load sessions from storage:', e)
  }
  return []
}

function saveSessionsToStorage(sessions: Session[]): boolean {
  try {
    const spaceCheck = checkStorageSpace()
    let sessionsToSave = sessions
    if (!spaceCheck.ok || spaceCheck.warning) {
      console.warn('[ChatStore] Storage space low, cleaning up old sessions')
      sessionsToSave = cleanupOldSessions(sessions, 30)
      sessionsToSave = truncateLongMessages(sessionsToSave, 5000)
    }
    const jsonData = JSON.stringify(sessionsToSave)
    const compressed = compressData(jsonData)
    const dataToStore = compressed.length < jsonData.length ? compressed : jsonData
    if (dataToStore.length * 2 > STORAGE_QUOTA_LIMIT) {
      console.error('[ChatStore] Data too large to save, truncating further')
      sessionsToSave = cleanupOldSessions(sessionsToSave, 20)
      sessionsToSave = truncateLongMessages(sessionsToSave, 3000)
      const truncatedJson = JSON.stringify(sessionsToSave)
      localStorage.setItem(STORAGE_KEY, truncatedJson)
    } else {
      localStorage.setItem(STORAGE_KEY, dataToStore)
    }
    localStorage.setItem(`${STORAGE_KEY}_meta`, JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: Date.now(),
      count: sessionsToSave.length,
      compressed: dataToStore !== jsonData
    }))
    return true
  } catch (e) {
    console.error('[ChatStore] Failed to save sessions to storage:', e)
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

function updateTaskStateFromToolResult(
  toolCalls: ToolCall[],
  resultToolUseId: string,
  resultOutput: string
) {
  const toolCall = toolCalls.find(tc => tc.id === resultToolUseId)
  if (!toolCall) return
  const toolName = toolCall.name
  if (toolName === 'TaskCreate') {
    const match = resultOutput.match(/^Task #(\d+) created successfully: (.+)$/m)
    if (match) {
      taskManager.createTask(match[1], match[2], toolCall.input?.description)
    }
  } else if (toolName === 'TaskUpdate') {
    const idMatch = resultOutput.match(/^Updated task #(\d+)/)
    if (idMatch) {
      const taskId = idMatch[1]
      const updates: { status?: 'pending' | 'in_progress' | 'completed', owner?: string } = {}
      const statusMatch = resultOutput.match(/status\w*:\s*(\w+)\s*->\s*(\w+)/i)
      if (statusMatch) {
        const newStatus = statusMatch[2]
        if (['pending', 'in_progress', 'completed'].includes(newStatus)) {
          updates.status = newStatus as TaskStatus
        }
      }
      const ownerMatch = resultOutput.match(/owner\w*:\s*([^,\n]+)/i)
      if (ownerMatch) {
        updates.owner = ownerMatch[1].trim()
      }
      taskManager.updateTask(taskId, updates)
    }
  } else if (toolName === 'TaskList') {
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

  const sessions = ref<Session[]>(loadSessionsFromStorage())
  const lastSessionId = sessions.value.length > 0
    ? [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
    : null
  const currentSessionId = ref<string | null>(lastSessionId)

  const streamingContents = ref<Map<string, string>>(new Map())
  const loadingSessions = ref<Map<string, boolean>>(new Map())

  const isLoading = computed(() =>
    currentSessionId.value ? (loadingSessions.value.get(currentSessionId.value) ?? false) : false
  )
  const streamingContent = computed(() =>
    currentSessionId.value ? (streamingContents.value.get(currentSessionId.value) ?? '') : ''
  )

  const currentAgent = ref<string>('')
  const availableAgents = ref<AgentInfo[]>([])

  const projects = ref<string[]>(loadProjectsFromStorage())
  const currentProjectRoot = ref<string>('')

  const currentSession = computed(() =>
    sessions.value.find(s => s.id === currentSessionId.value) || null
  )

  const currentMessages = computed(() =>
    currentSession.value?.messages || []
  )

  const workingDirectory = computed(() =>
    currentSession.value?.workingDirectory || currentProjectRoot.value || ''
  )

  const allProjects = computed(() => {
    const projectSet = new Set<string>()
    for (const session of sessions.value) {
      if (session.workingDirectory) {
        projectSet.add(session.workingDirectory)
      }
    }
    for (const project of projects.value) {
      projectSet.add(project)
    }
    return Array.from(projectSet)
  })

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

  function addProject(projectPath: string) {
    if (!projects.value.includes(projectPath)) {
      projects.value.push(projectPath)
      saveProjects()
    }
    currentProjectRoot.value = projectPath
  }

  function removeProject(projectPath: string) {
    const index = projects.value.indexOf(projectPath)
    if (index > -1) {
      projects.value.splice(index, 1)
      saveProjects()
    }
    if (currentProjectRoot.value === projectPath) {
      currentProjectRoot.value = ''
    }
  }

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
      workingDirectory: workingDirectory || currentProjectRoot.value || undefined,
      processStatus: 'none',
      isTabOpen: true,
      lastActivityAt: Date.now()
    }
    sessions.value.unshift(session)
    currentSessionId.value = session.id
    saveToStorage()
    traceEvent({
      sessionId: session.id,
      actor: 'system',
      type: 'session_created',
      status: 'completed',
      title: 'Chat session created',
      metadata: { title: session.title, workingDirectory: session.workingDirectory },
    })
    return session
  }

  async function initClaudeCodeSession(sessionId: string): Promise<void> {
    const claudeCode = electronAPI?.claudeCode
    if (!claudeCode) {
      logger.warn('ChatStore', `initClaudeCodeSession: claudeCode API not available`)
      return
    }

    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) {
      logger.warn('ChatStore', `initClaudeCodeSession: session not found | id=${sessionId.slice(0, 8)}`)
      return
    }

    const status = await claudeCode.getSessionStatus(sessionId)
    if (status?.isRunning) {
      logger.info('ChatStore', `initClaudeCodeSession: session already running | id=${sessionId.slice(0, 8)}`)
      return
    }

    try {
      const config = settingsStore.config
      const cwd = session.workingDirectory || currentProjectRoot.value || await electronAPI.getCwd?.() || '/'

      session.processStatus = 'starting'
      saveToStorage()

      logger.info('ChatStore', `initClaudeCodeSession: starting session | id=${sessionId.slice(0, 8)} | cwd=${cwd} | provider=${config.provider} | model=${config.model} | baseUrl=${config.baseUrl || '(empty)'} | apiKey=${config.apiKey ? '***set' : '(empty)'} | agent=${currentAgent.value || '(none)'}`)
      traceEvent({
        sessionId,
        actor: 'system',
        type: 'engine_session_start',
        status: 'started',
        title: 'Starting engine session',
        metadata: {
          cwd,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl || '',
          agent: currentAgent.value || '',
        },
      })

      await claudeCode.startSession(sessionId, {
        cwd,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        provider: config.provider,
        model: config.model,
        effortLevel: config.effortLevel,
        permissionMode: 'bypassPermissions',
        agent: currentAgent.value || undefined,
        thinkingEnabled: settingsStore.thinkingEnabled,
        engineType: settingsStore.engineType,
      })

      logger.info('ChatStore', `initClaudeCodeSession: session started successfully | id=${sessionId.slice(0, 8)}`)
      traceEvent({
        sessionId,
        actor: 'system',
        type: 'engine_session_start',
        status: 'completed',
        title: 'Engine session started',
      })

    } catch (error) {
      const classified = errorHandler.handleError(error, {
        sessionId,
        provider: settingsStore.config.provider,
        model: settingsStore.config.model,
        baseUrl: settingsStore.config.baseUrl,
        phase: 'init',
      })
      logger.error('ChatStore', `initClaudeCodeSession: failed to start session | id=${sessionId.slice(0, 8)}`, { error: String(error), category: classified.category })
      traceEvent({
        sessionId,
        actor: 'system',
        type: 'engine_session_start',
        status: 'failed',
        title: 'Engine session failed to start',
        error: { message: classified.technicalDetail },
      })
      session.processStatus = 'exited'
      saveToStorage()
    }
  }

  function addMessage(message: Omit<Message, 'id' | 'timestamp'> & { id?: string }, targetSessionId?: string): Message {
    const sid = targetSessionId || currentSessionId.value
    if (!sid) {
      createSession()
    }

    const sessionId = sid || currentSessionId.value!
    const newMessage: Message = {
      ...message,
      id: message.id || crypto.randomUUID(),
      timestamp: Date.now()
    }

    const session = sessions.value.find(s => s.id === sessionId)
    if (session) {
      const existingIndex = session.messages.findIndex(m => m.id === newMessage.id)
      if (existingIndex >= 0) {
        session.messages[existingIndex] = newMessage
      } else {
        session.messages.push(newMessage)
      }
      session.updatedAt = Date.now()
      session.lastActivityAt = Date.now()

      if (session.messages.length === 1 && newMessage.role === 'user') {
        const newTitle = newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : '')
        session.title = newTitle
        appStore.updateSessionTabTitle(sessionId, newTitle)
      }
      saveToStorage()
    }

    return newMessage
  }

  async function sendMessage(content: string, userMessageContent?: string): Promise<void> {
    if (!currentSessionId.value) {
      createSession()
    }

    const targetSessionId = currentSessionId.value!
    const session = sessions.value.find(s => s.id === targetSessionId)
    if (!session) return

    logger.info('ChatStore', `sendMessage: user message | sessionId=${targetSessionId.slice(0, 8)} | contentLen=${content.length} | preview="${content.slice(0, 80)}"`)
    traceEvent({
      sessionId: targetSessionId,
      actor: 'user',
      type: 'user_message',
      status: 'completed',
      title: 'User submitted message',
      input: { content: userMessageContent ?? content },
      metadata: { contentLength: content.length },
    })

    addMessage({
      role: 'user',
      content: userMessageContent ?? content
    }, targetSessionId)

    const claudeCode = electronAPI?.claudeCode
    if (!claudeCode) {
      logger.error('ChatStore', `sendMessage: claudeCode API not available | sessionId=${targetSessionId.slice(0, 8)}`)
      const classified = errorHandler.handleError(new Error('Claude Code CLI is not available. Please check your configuration.'), {
        sessionId: targetSessionId,
        phase: 'init',
      })
      loadingSessions.value.set(targetSessionId, true)
      setTimeout(() => {
        addMessage({
          role: 'assistant',
          content: classified.message,
          metadata: { error: classified }
        }, targetSessionId)
        loadingSessions.value.set(targetSessionId, false)
      }, 500)
      return
    }

    await initClaudeCodeSession(targetSessionId)

    loadingSessions.value.set(targetSessionId, true)
    streamingContents.value.set(targetSessionId, '')
    session.processStatus = 'active'

    const assistantMessageId = crypto.randomUUID()
    const sendStartTime = Date.now()

    logger.info('ChatStore', `sendMessage: calling IPC sendMessage | sessionId=${targetSessionId.slice(0, 8)} | assistantMsgId=${assistantMessageId.slice(0, 8)}`)
    traceEvent({
      sessionId: targetSessionId,
      messageId: assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'started',
      title: 'Assistant turn started',
    })

    addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    }, targetSessionId)

    await new Promise<void>((resolve, reject) => {
      let accumulatedContent = ''
      let isCompleted = false
      let currentTextEventId: string | null = null
      let currentReasoningEventId: string | null = null

      const getAssistantMessage = () => {
        const s = sessions.value.find(s => s.id === targetSessionId)
        return s?.messages.find(m => m.id === assistantMessageId)
      }

      const addTimelineEvent = (event: NonNullable<Message['timelineEvents']>[number]) => {
        const msg = getAssistantMessage()
        if (!msg) return
        if (msg.timelineEvents?.some(e => e.id === event.id)) return
        msg.timelineEvents = [...(msg.timelineEvents || []), event]
      }

      const updateTimelineEvent = (eventId: string, updates: Partial<NonNullable<Message['timelineEvents']>[number]>) => {
        const msg = getAssistantMessage()
        if (!msg?.timelineEvents) return
        msg.timelineEvents = msg.timelineEvents.map(event =>
          event.id === eventId ? { ...event, ...updates } : event
        )
      }

      const ensureTextTimelineEvent = () => {
        if (currentTextEventId) return currentTextEventId
        currentTextEventId = crypto.randomUUID()
        addTimelineEvent({
          id: currentTextEventId,
          type: 'text',
          timestamp: Date.now(),
          status: 'running',
          content: ''
        })
        return currentTextEventId
      }

      const completeCurrentTextEvent = () => {
        if (!currentTextEventId) return
        updateTimelineEvent(currentTextEventId, { status: 'completed' })
        currentTextEventId = null
      }

      const addToolTimelineEvent = (toolCallId: string) => {
        completeCurrentTextEvent()
        addTimelineEvent({
          id: `tool-${toolCallId}`,
          type: 'tool_call',
          timestamp: Date.now(),
          status: 'running',
          toolCallId
        })
      }

      const handleStreamEvent = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId || isCompleted) return
        resetTimeout()
        const streamEvent = event.data
        const ev = streamEvent.event || streamEvent

        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
          logger.debug('ChatStore', `[${targetSessionId.slice(0, 8)}] stream_event: content_block_start(text) | accLen=${accumulatedContent.length}`)
          currentTextEventId = null
          ensureTextTimelineEvent()
          if (accumulatedContent.length > 0 && !accumulatedContent.endsWith('\n')) {
            accumulatedContent += '\n\n'
            streamingContents.value.set(targetSessionId, accumulatedContent)
            nextTick(() => {
              updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
            })
          }
        }

        if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
          logger.debug('ChatStore', `[${targetSessionId.slice(0, 8)}] stream_event: content_block_start(thinking)`)
          const s = sessions.value.find(s => s.id === targetSessionId)
          if (s) {
            const msg = s.messages.find(m => m.id === assistantMessageId)
            if (msg && !msg.reasoning) {
              msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
              currentReasoningEventId = crypto.randomUUID()
              addTimelineEvent({
                id: currentReasoningEventId,
                type: 'reasoning',
                timestamp: msg.reasoning.startTime,
                status: 'running',
                content: ''
              })
            }
          }
        }

        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta?.text) {
          const textEventId = ensureTextTimelineEvent()
          accumulatedContent += ev.delta.text
          streamingContents.value.set(targetSessionId, accumulatedContent)
          const msg = getAssistantMessage()
          const textEvent = msg?.timelineEvents?.find(event => event.id === textEventId)
          updateTimelineEvent(textEventId, {
            content: `${textEvent?.content || ''}${ev.delta.text}`,
            status: 'running'
          })
          nextTick(() => {
            updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
          })
        }

        if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta?.thinking) {
          const s = sessions.value.find(s => s.id === targetSessionId)
          if (s) {
            const msg = s.messages.find(m => m.id === assistantMessageId)
            if (msg) {
              if (!msg.reasoning) {
                msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
              }
              msg.reasoning.content += ev.delta.thinking
              if (!currentReasoningEventId) {
                currentReasoningEventId = crypto.randomUUID()
                addTimelineEvent({
                  id: currentReasoningEventId,
                  type: 'reasoning',
                  timestamp: msg.reasoning.startTime,
                  status: 'running',
                  content: ''
                })
              }
              const reasoningEvent = msg.timelineEvents?.find(event => event.id === currentReasoningEventId)
              updateTimelineEvent(currentReasoningEventId, {
                content: `${reasoningEvent?.content || ''}${ev.delta.thinking}`,
                status: 'running'
              })
              saveToStorage()
            }
          }
        }
      }

      const handleAssistant = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId || isCompleted) return
        const assistant = event.data
        logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] assistant event received`)
        if (assistant.message?.content) {
          const content = assistant.message.content
          if (Array.isArray(content)) {
            const hasExistingTimeline = !!getAssistantMessage()?.timelineEvents?.length

            if (!hasExistingTimeline) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  completeCurrentTextEvent()
                  const textEventId = ensureTextTimelineEvent()
                  accumulatedContent += block.text
                  streamingContents.value.set(targetSessionId, accumulatedContent)
                  const msg = getAssistantMessage()
                  const textEvent = msg?.timelineEvents?.find(event => event.id === textEventId)
                  updateTimelineEvent(textEventId, {
                    content: `${textEvent?.content || ''}${block.text}`,
                    status: 'running'
                  })
                } else if (block.type === 'thinking') {
                  const thinkingText = block.thinking || block.text || ''
                  if (thinkingText) {
                    completeCurrentTextEvent()
                    const s = sessions.value.find(s => s.id === targetSessionId)
                    if (s) {
                      const msg = s.messages.find(m => m.id === assistantMessageId)
                      if (msg) {
                        if (!msg.reasoning) {
                          msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                        }
                        msg.reasoning.content += thinkingText
                        // 不在此处设置 endTime — thinking 可能仍在进行
                        if (!currentReasoningEventId) {
                          currentReasoningEventId = crypto.randomUUID()
                          addTimelineEvent({
                            id: currentReasoningEventId,
                            type: 'reasoning',
                            timestamp: msg.reasoning.startTime,
                            status: 'running',
                            content: ''
                          })
                        }
                        const reasoningEvent = msg.timelineEvents?.find(event => event.id === currentReasoningEventId)
                        updateTimelineEvent(currentReasoningEventId, {
                          content: `${reasoningEvent?.content || ''}${thinkingText}`,
                          status: 'completed'
                        })
                      }
                    }
                  }
                } else if (block.type === 'tool_use' && block.id) {
                  addToolTimelineEvent(block.id)
                }
              }

              if (accumulatedContent) {
                updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
              }
            } else {
              const textContent = content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text || '')
                .join('')

              if (textContent && textContent.length > accumulatedContent.length) {
                const deltaText = textContent.slice(accumulatedContent.length)
                accumulatedContent = textContent
                streamingContents.value.set(targetSessionId, accumulatedContent)
                const textEventId = ensureTextTimelineEvent()
                const msg = getAssistantMessage()
                const textEvent = msg?.timelineEvents?.find(event => event.id === textEventId)
                updateTimelineEvent(textEventId, {
                  content: `${textEvent?.content || ''}${deltaText}`,
                  status: 'running'
                })
                updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
              }

              const reasoningContent = content
                .filter((c: any) => c.type === 'thinking')
                .map((c: any) => c.thinking || c.text || '')
                .join('')

              if (reasoningContent) {
                const s = sessions.value.find(s => s.id === targetSessionId)
                if (s) {
                  const msg = s.messages.find(m => m.id === assistantMessageId)
                  if (msg) {
                    if (!msg.reasoning) {
                      msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                    }
                    msg.reasoning.content += reasoningContent
                    // 不在此处设置 endTime — thinking 可能仍在进行
                    if (!currentReasoningEventId) {
                      currentReasoningEventId = crypto.randomUUID()
                      addTimelineEvent({
                        id: currentReasoningEventId,
                        type: 'reasoning',
                        timestamp: msg.reasoning.startTime,
                        status: 'running',
                        content: ''
                      })
                    }
                    const reasoningEvent = msg.timelineEvents?.find(event => event.id === currentReasoningEventId)
                    updateTimelineEvent(currentReasoningEventId, {
                      content: `${reasoningEvent?.content || ''}${reasoningContent}`,
                      status: 'completed'
                    })
                    saveToStorage()
                  }
                }
              }
            }

            const toolUses = content.filter((c: any) => c.type === 'tool_use')
            for (const toolUse of toolUses) {
              const s = sessions.value.find(s => s.id === targetSessionId)
              if (s) {
                const msg = s.messages.find(m => m.id === assistantMessageId)
                if (msg) {
                  const existingTool = msg.toolCalls?.find(tc => tc.id === toolUse.id)
                  if (!existingTool) {
                    msg.toolCalls = [...(msg.toolCalls || []), {
                      id: toolUse.id, name: toolUse.name, input: toolUse.input || {},
                      status: 'running', startTime: Date.now()
                    }]
                    addToolTimelineEvent(toolUse.id)
                    saveToStorage()
                  }
                }
              }
            }
          }
        }
      }

      const handleToolUse = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId) return
        const toolUse = event.data
        const toolName = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
        logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] tool_use event | name=${toolName}`)
        const s = sessions.value.find(s => s.id === targetSessionId)
        if (s) {
          const msg = s.messages.find(m => m.id === assistantMessageId)
          if (msg) {
            const toolId = toolUse.id || toolUse.tool_use?.id || crypto.randomUUID()
            const toolName = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
            const toolInput = toolUse.input || toolUse.tool_use?.input || {}
            const existingTool = msg.toolCalls?.find(tc => tc.id === toolId)
            if (!existingTool) {
              msg.toolCalls = [...(msg.toolCalls || []), {
                id: toolId, name: toolName, input: toolInput,
                status: 'running', startTime: Date.now()
              }]
              let traceType: string = 'tool_call'
              if (FILE_TOOLS.has(toolName)) traceType = 'file_change'
              else if (COMMAND_TOOLS.has(toolName)) {
                const cmd = typeof toolInput.command === 'string' ? toolInput.command : ''
                const isVerification = VERIFICATION_PATTERNS.some(p => p.test(cmd))
                traceType = isVerification ? 'verification' : 'command_run'
              }

              traceEvent({
                sessionId: targetSessionId,
                actor: 'tool',
                type: traceType,
                status: 'started',
                title: toolName,
                input: toolInput,
                metadata: { toolId, assistantMessageId },
              })
              addToolTimelineEvent(toolId)
              saveToStorage()
            }
          }
        }
      }

      const handleToolResult = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId) return
        const toolResult = event.data
        const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
        const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error
        logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] tool_result event | toolUseId=${resultToolUseId?.slice(0, 8)} | error=${!!resultIsError}`)
        const s = sessions.value.find(s => s.id === targetSessionId)
        if (s) {
          const msg = s.messages.find(m => m.id === assistantMessageId)
          if (msg?.toolCalls) {
            const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
            const rawResultOutput = toolResult.output ?? toolResult.content ?? toolResult.tool_result?.output ?? toolResult.tool_result?.content
            const resultOutput = typeof rawResultOutput === 'string' ? rawResultOutput : JSON.stringify(rawResultOutput)
            const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error

            updateTaskStateFromToolResult(msg.toolCalls, resultToolUseId, resultOutput)

            const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === resultToolUseId)
            if (toolCallIndex >= 0) {
              const updatedToolCalls = [...msg.toolCalls]
              updatedToolCalls[toolCallIndex] = {
                ...updatedToolCalls[toolCallIndex],
                status: resultIsError ? 'error' : 'completed',
                output: resultOutput,
                endTime: Date.now()
              }
              msg.toolCalls = updatedToolCalls

              const toolName = updatedToolCalls[toolCallIndex].name
              let traceType: string = 'tool_result'
              let evidence: Array<{ kind: string; result?: string; detail: string }> | undefined
              if (FILE_TOOLS.has(toolName)) {
                traceType = 'file_change'
              } else if (COMMAND_TOOLS.has(toolName)) {
                const cmd = typeof updatedToolCalls[toolCallIndex].input?.command === 'string'
                  ? updatedToolCalls[toolCallIndex].input.command : ''
                const isVerification = VERIFICATION_PATTERNS.some(p => p.test(cmd))
                if (isVerification) {
                  traceType = 'verification'
                  const passKeywords = ['passed', 'pass', '0 failures', '0 errors', 'all tests passed', 'success']
                  const failKeywords = ['failed', 'fail', 'error', 'failure', 'failing']
                  const lowerOutput = resultOutput.toLowerCase()
                  const isPass = !resultIsError && passKeywords.some(k => lowerOutput.includes(k))
                  const isFail = resultIsError || failKeywords.some(k => lowerOutput.includes(k))
                  evidence = [{
                    kind: cmd.match(/test/i) ? 'test' : cmd.match(/(lint|eslint|biome|ruff)/i) ? 'lint' : cmd.match(/(build|tsc|typecheck)/i) ? 'build' : 'manual',
                    result: isFail ? 'fail' : isPass ? 'pass' : 'unknown',
                    detail: resultOutput.slice(0, 500),
                  }]
                } else {
                  traceType = 'command_run'
                }
              }

              traceEvent({
                sessionId: targetSessionId,
                actor: 'tool',
                type: traceType,
                status: resultIsError ? 'failed' : 'completed',
                title: toolName,
                output: resultOutput,
                evidence,
                metadata: { toolId: resultToolUseId, assistantMessageId },
              })
              updateTimelineEvent(`tool-${resultToolUseId}`, {
                status: resultIsError ? 'error' : 'completed'
              })
              saveToStorage()
            }
          }
        }
      }

      const handleResult = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId || isCompleted) return
        isCompleted = true
        const result = event.data || {}
        const elapsed = Date.now() - sendStartTime
        logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] result event (LLM response complete) | totalElapsed=${elapsed}ms | accContentLen=${accumulatedContent.length} | stopReason=${result.stop_reason || '(none)'}`)
        streamingContents.value.set(targetSessionId, '')
        loadingSessions.value.set(targetSessionId, false)

        const s = sessions.value.find(s => s.id === targetSessionId)
        if (s) {
          s.processStatus = 'idle'
          s.lastActivityAt = Date.now()
          const msg = s.messages.find(m => m.id === assistantMessageId)
          if (msg) {
            const finalText = typeof result.result === 'string' ? result.result : ''
            if (finalText && finalText.length > msg.content.length) {
              const textEventId = ensureTextTimelineEvent()
              const deltaText = finalText.slice(msg.content.length)
              msg.content = finalText
              const textEvent = msg.timelineEvents?.find(event => event.id === textEventId)
              updateTimelineEvent(textEventId, {
                content: `${textEvent?.content || ''}${deltaText}`,
                status: 'completed'
              })
            }
            completeCurrentTextEvent()
            if (msg.reasoning && !msg.reasoning.endTime) {
              msg.reasoning.endTime = Date.now()
              msg.reasoning.isExpanded = false
            }
            if (currentReasoningEventId) {
              updateTimelineEvent(currentReasoningEventId, { status: 'completed' })
            }
            const hasRunningTools = !!msg.toolCalls?.some(tool => tool.status === 'running' || tool.status === 'pending')
            const suspiciousToolStop = result.stop_reason === 'tool_use'
            msg.metadata = {
              model: settingsStore.config.model,
              duration: Date.now() - msg.timestamp,
              warning: suspiciousToolStop
                ? 'Agent 在工具调用状态下提前结束，当前模型可能没有稳定支持多轮工具调用协议。建议重试或切换为更强的工具调用模型。'
                : hasRunningTools
                  ? 'Agent 已结束，但仍有工具调用未返回结果。'
                  : undefined
            }
            traceEvent({
              sessionId: targetSessionId,
              messageId: assistantMessageId,
              actor: 'assistant',
              type: 'assistant_turn',
              status: 'completed',
              title: 'Assistant turn completed',
              output: { content: msg.content },
              metadata: {
                duration: msg.metadata.duration,
                model: msg.metadata.model,
                stopReason: result.stop_reason || '',
                warning: msg.metadata.warning || '',
              },
            })

            const fileChanges = msg.toolCalls
              ?.filter(tc => ['Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit'].includes(tc.name))
              .map(tc => ({
                kind: tc.name,
                path: tc.input?.file_path || tc.input?.path || '',
              })) || []
            const verifications = msg.toolCalls
              ?.filter(tc => tc.name === 'Bash' && tc.output)
              .filter(tc => {
                const cmd = typeof tc.input?.command === 'string' ? tc.input.command : ''
                return /^\s*(npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|jest|vitest|mocha|ruff|eslint|biome|prettier|tsc|vue-tsc|npm\s+run\s+(test|lint|check|build|typecheck))/i.test(cmd)
              })
              .map(tc => ({
                kind: 'verification',
                result: tc.status === 'completed' ? 'pass' : 'fail',
                detail: (tc.output || '').slice(0, 300),
              })) || []
            const errors = msg.toolCalls
              ?.filter(tc => tc.status === 'error')
              .map(tc => ({ kind: tc.name, detail: (tc.output || '').slice(0, 300) })) || []

            traceEvent({
              sessionId: targetSessionId,
              messageId: assistantMessageId,
              actor: 'system',
              type: 'final_summary',
              status: errors.length > 0 ? 'failed' : 'completed',
              title: 'Session turn summary',
              artifacts: fileChanges.length > 0 ? fileChanges : undefined,
              evidence: verifications.length > 0 ? verifications : undefined,
              error: errors.length > 0 ? { message: errors.map(e => `${e.kind}: ${e.detail}`).join('; ') } : undefined,
              metadata: {
                toolCallCount: msg.toolCalls?.length || 0,
                fileChangeCount: fileChanges.length,
                verificationCount: verifications.length,
                errorCount: errors.length,
                contentLength: msg.content.length,
              },
            })

            saveToStorage()
          }
        }

        cleanup()
        resolve()
      }

      const handleUser = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId) return
        const userMsg = event.data
        if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
          const toolResults = userMsg.message.content.filter((c: any) => c.type === 'tool_result')
          for (const toolResult of toolResults) {
            const s = sessions.value.find(s => s.id === targetSessionId)
            if (s) {
              const msg = s.messages.find(m => m.id === assistantMessageId)
              if (msg?.toolCalls) {
                const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === toolResult.tool_use_id)
                if (toolCallIndex >= 0) {
                  const updatedToolCalls = [...msg.toolCalls]
                  updatedToolCalls[toolCallIndex] = {
                    ...updatedToolCalls[toolCallIndex],
                    status: toolResult.is_error ? 'error' : 'completed',
                    output: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
                    endTime: Date.now()
                  }
                  msg.toolCalls = updatedToolCalls
                  updateTimelineEvent(`tool-${toolResult.tool_use_id}`, {
                    status: toolResult.is_error ? 'error' : 'completed'
                  })
                  saveToStorage()
                }
              }
            }
          }
        }
      }

      const handleError = (error: any) => {
        if (isCompleted) return
        isCompleted = true
        const elapsed = Date.now() - sendStartTime
        logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })
        loadingSessions.value.set(targetSessionId, false)
        streamingContents.value.set(targetSessionId, '')

        const classified = errorHandler.handleError(error, {
          sessionId: targetSessionId,
          provider: settingsStore.config.provider,
          model: settingsStore.config.model,
          baseUrl: settingsStore.config.baseUrl,
          phase: 'stream',
        })

        traceEvent({
          sessionId: targetSessionId,
          messageId: assistantMessageId,
          actor: 'assistant',
          type: 'assistant_turn',
          status: 'failed',
          title: 'Assistant turn failed',
          error: { message: classified.technicalDetail },
        })

        updateMessage(assistantMessageId, {
          content: classified.message,
          metadata: {
            model: settingsStore.config.model,
            duration: Date.now() - sendStartTime,
            error: classified,
          }
        }, targetSessionId)

        const s = sessions.value.find(s => s.id === targetSessionId)
        if (s) {
          s.processStatus = 'exited'
          saveToStorage()
        }

        cleanup()
        reject(error)
      }

      const REQUEST_TIMEOUT = 5 * 60 * 1000
      let requestTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (!isCompleted) {
          handleError(new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
        }
      }, REQUEST_TIMEOUT)

      const resetTimeout = () => {
        if (requestTimeoutId) clearTimeout(requestTimeoutId)
        requestTimeoutId = setTimeout(() => {
          if (!isCompleted) {
            handleError(new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
          }
        }, REQUEST_TIMEOUT)
      }

      const unsubscribeAssistant = claudeCode.onAssistant(handleAssistant)
      const unsubscribeUser = claudeCode.onUser(handleUser)
      const unsubscribeStreamEvent = claudeCode.onStreamEvent(handleStreamEvent)
      const unsubscribeToolUse = claudeCode.onToolUse(handleToolUse)
      const unsubscribeToolResult = claudeCode.onToolResult(handleToolResult)
      const unsubscribeResult = claudeCode.onResult(handleResult)
      const unsubscribeExit = claudeCode.onExit((event: { sessionId: string; data: number | null }) => {
        if (event.sessionId !== targetSessionId) return
        logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] process exit event | code=${event.data}`)
        if (event.data !== null && event.data !== 0) {
          handleError(new Error(`Process exited with code ${event.data}`))
        } else {
          handleResult({ sessionId: targetSessionId, data: {} })
        }
      })

      const cleanup = () => {
        if (requestTimeoutId) clearTimeout(requestTimeoutId)
        unsubscribeAssistant?.()
        unsubscribeUser?.()
        unsubscribeStreamEvent?.()
        unsubscribeToolUse?.()
        unsubscribeToolResult?.()
        unsubscribeResult?.()
        unsubscribeExit?.()
      }

      claudeCode.sendMessage(targetSessionId, content).catch((error: any) => {
        logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] IPC sendMessage rejected`, { error: String(error) })
        cleanup()
        handleError(error)
      })
    }).catch((error) => {
      logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] sendMessage outer catch`, { error: String(error) })
      loadingSessions.value.set(targetSessionId, false)
      streamingContents.value.set(targetSessionId, '')
    })
  }

  async function abort(): Promise<void> {
    const sid = currentSessionId.value
    logger.info('ChatStore', `abort | sessionId=${sid?.slice(0, 8) || '(none)'}`)
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode && sid) {
      try {
        await claudeCode.abort(sid)
      } catch (error) {
        logger.error('ChatStore', `abort failed | sessionId=${sid.slice(0, 8)}`, { error: String(error) })
      }
    }
    if (sid) {
      loadingSessions.value.set(sid, false)
      streamingContents.value.set(sid, '')
    }
  }

  async function retryLastMessage(): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) return
    errorHandler.clearInlineError(sid)
    const session = sessions.value.find(s => s.id === sid)
    if (!session) return
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      const lastAssistantMsg = [...session.messages].reverse().find(m => m.role === 'assistant' && m.metadata?.error)
      if (lastAssistantMsg) {
        const idx = session.messages.findIndex(m => m.id === lastAssistantMsg.id)
        if (idx >= 0) session.messages.splice(idx, 1)
      }
      await sendMessage(lastUserMsg.content)
    }
  }

  function updateToolCall(messageId: string, toolCallId: string, status: ToolCall['status']) {
    const sid = currentSessionId.value
    const session = sessions.value.find(s => s.id === sid)
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

  function updateMessage(messageId: string, updates: Partial<Message>, targetSessionId?: string) {
    const sid = targetSessionId || currentSessionId.value
    const session = sessions.value.find(s => s.id === sid)
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
    const session = sessions.value.find(s => s.id === sessionId)
    if (session?.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }
  }

  async function activateSession(sessionId: string): Promise<void> {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return

    currentSessionId.value = sessionId
    if (session.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }

    if (session.processStatus === 'suspended') {
      const claudeCode = electronAPI?.claudeCode
      if (claudeCode) {
        try {
          session.processStatus = 'starting'
          saveToStorage()
          await claudeCode.resumeSession(sessionId)
          session.processStatus = 'active'
          saveToStorage()
        } catch (error) {
          console.error('[ChatStore] Failed to resume session:', error)
          session.processStatus = 'exited'
          saveToStorage()
        }
      }
    } else if ((session.processStatus === 'none' || session.processStatus === 'exited') && session.messages.length > 0) {
      await initClaudeCodeSession(sessionId)
    }
  }

  function deactivateSession(sessionId: string): void {
    const session = sessions.value.find(s => s.id === sessionId)
    if (session) {
      session.isTabOpen = false
      saveToStorage()
    }
  }

  async function deleteSession(sessionId: string) {
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode) {
      try {
        await claudeCode.stop(sessionId)
      } catch {}
    }
    const index = sessions.value.findIndex(s => s.id === sessionId)
    if (index > -1) {
      sessions.value.splice(index, 1)
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = sessions.value[0]?.id || null
      }
      loadingSessions.value.delete(sessionId)
      streamingContents.value.delete(sessionId)
      saveToStorage()
    }
  }

  function migrateOldData() {
    try {
      const oldKeys = Object.keys(localStorage).filter(k => k.startsWith('chat_sessions_'))
      if (oldKeys.length > 0 && sessions.value.length === 0) {
        for (const key of oldKeys) {
          try {
            const oldSessions = JSON.parse(localStorage.getItem(key) || '[]')
            sessions.value = [...sessions.value, ...oldSessions]
            localStorage.removeItem(key)
          } catch {}
        }
      }
    } catch {}
  }

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

  async function switchAgent(agentType: string) {
    currentAgent.value = agentType
    const sid = currentSessionId.value
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode && sid) {
      const status = await claudeCode.getSessionStatus(sid)
      if (status?.isRunning) {
        await claudeCode.stop(sid)
        await initClaudeCodeSession(sid)
      }
    }
    console.log('[ChatStore] Agent switched to:', agentType || '(default)')
  }

  async function switchModel(model: string) {
    const sid = currentSessionId.value
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode && sid) {
      const status = await claudeCode.getSessionStatus(sid)
      if (status?.isRunning) {
        await claudeCode.stop(sid)
        await initClaudeCodeSession(sid)
      }
    }
    console.log('[ChatStore] Model switched to:', model)
  }

  sessions.value.forEach(s => {
    if (s.processStatus !== 'none' && s.processStatus !== 'exited') {
      s.processStatus = 'none'
    }
  })

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
    retryLastMessage,
    updateToolCall,
    updateMessage,
    selectSession,
    activateSession,
    deactivateSession,
    deleteSession,
    getCurrentConfig,
    saveToStorage,
    addProject,
    removeProject,
    switchProject,
    loadAgents,
    switchAgent,
    switchModel,
  }
})
