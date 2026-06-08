import { defineStore } from 'pinia'
import { ref, computed, nextTick, watch, readonly } from 'vue'
import type { Session, Message, ToolCall, AgentInfo, ProcessStatus, SessionTurnCheckpoint, TurnChangeCardData, AgentColor, TeammateStatus } from '@/types'
import type { RewindOption, RewindState } from '@/types/rewind'

// 权限模式类型定义
type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
import { useSettingsStore } from './settings'
import { useContextUsageStore } from './contextUsage'
import { useAppStore } from './app'
import { useTaskManager } from '@/composables/useTaskManager'
import { getCompletedTurnTargets } from '@/utils/turnCheckpointUtils'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import {
  loadSessionsFromStorage,
  saveSessionsToStorage,
  loadProjectsFromStorage,
  saveProjectsToStorage,
  getStorageStats as _getStorageStats,
  setPersistenceLogger,
  stripLargeAttachmentData,
} from '@/services/sessionPersistence'
import {
  stableTeammateId,
  getRawTeammateName,
  getRawTeamName,
  isTeammateRawMessage,
  inferTeammateStatus,
  stringifyRawContent,
  parseAgentToolOutput,
  ensureTeamContext,
  recordAgentToolCall,
  AGENT_COLORS,
} from '@/services/teamTranscriptService'
import {
  permissionService,
  type PermissionRequest,
} from '@/services/permissionService'

const taskManager = useTaskManager()

// ============================================================
// Renderer Logger — 将日志转发到主进程写入 ~/.claude/debug/
// ============================================================
const logger = {
  debug: (scope: string, message: string, data?: any) => {
    console.debug(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'debug', data } })
  },
  info: (scope: string, message: string, data?: any) => {
    console.log(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'info', data } })
  },
  warn: (scope: string, message: string, data?: any) => {
    console.warn(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'warn', data } })
  },
  error: (scope: string, message: string, data?: any) => {
    console.error(`[${scope}] ${message}`, data ?? '')
    api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'error', data } })
  },
}

// 注入 logger 到 sessionPersistence service
setPersistenceLogger(logger)

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
  api.trace.event({
    source: 'renderer',
    ...event,
  })
}

// Storage constants are now in sessionPersistence.ts
// STORAGE_KEY, PROJECTS_KEY etc. are imported from there


// 从磁盘恢复历史消息中缺失 previewUrl 的图片（stripLargeAttachmentData 丢弃了 base64）
async function hydrateImageAttachments(sessions: Session[]): Promise<void> {
  // Use the centralized api for image loading
  const imageLoad = api.image?.load
  if (!imageLoad) return

  for (const session of sessions) {
    for (const msg of session.messages) {
      // 恢复 imageAttachments
      if (msg.imageAttachments?.length) {
        for (let i = 0; i < msg.imageAttachments.length; i++) {
          const img = msg.imageAttachments[i]
          if (img.id && !img.previewUrl && !img.data) {
            try {
              const dataUrl = await imageLoad(img.id)
              if (dataUrl) {
                msg.imageAttachments[i] = { ...img, previewUrl: dataUrl, data: dataUrl }
              }
            } catch {
              // 磁盘文件不存在（修复前已存的旧图片），保持占位状态
            }
          }
        }
      }
      // 恢复 attachments 中的图片类型
      if (Array.isArray(msg.attachments)) {
        for (let i = 0; i < msg.attachments.length; i++) {
          const att = msg.attachments[i] as any
          if (att?.type === 'image' && att.id && !att.previewUrl && !att.data) {
            try {
              const dataUrl = await imageLoad(att.id)
              if (dataUrl) {
                msg.attachments[i] = { ...att, previewUrl: dataUrl, data: dataUrl }
              }
            } catch {
              // 同上
            }
          }
        }
      }
    }
  }
}


// loadSessionsFromStorage, stripLargeAttachmentData, saveSessionsToStorage,
// loadProjectsFromStorage, saveProjectsToStorage, getStorageStats
// are now imported from @/services/sessionPersistence


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


// stableTeammateId, getRawTeammateName, getRawTeamName, isTeammateRawMessage,
// inferTeammateStatus, stringifyRawContent, parseAgentToolOutput,
// ensureTeamContext, recordAgentToolCall, AGENT_COLORS
// are now imported from @/services/teamTranscriptService


export const useChatStore = defineStore('chat', () => {
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()

  const sessions = ref<Session[]>(loadSessionsFromStorage())

  // 异步恢复历史消息中的图片数据（stripLargeAttachmentData 丢弃的 base64 从磁盘补回）
  void hydrateImageAttachments(sessions.value)
  const lastSessionId = sessions.value.length > 0
    ? [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
    : null
  const currentSessionId = ref<string | null>(lastSessionId)

  const streamingContents = ref<Map<string, string>>(new Map())
  const loadingSessions = ref<Map<string, boolean>>(new Map())

  // Diff 面板触发（TitleBar → ChatPanel 通信）
  const diffPanelTrigger = ref(0)
  function triggerDiffPanel() {
    diffPanelTrigger.value++
  }

  // ────────────────────────────────────────────────────────────────────
  // 权限请求（can_use_tool control_request）
  //
  // engine 通过 control_request 发出 can_use_tool 请求时，preload 会经
  // claude-code:permission_request 频道把它推送过来。我们按 sessionId 维护
  // 一张 toolUseId → PermissionRequest 的索引表，UI 在渲染 AskUserQuestion /
  // EnterPlanMode / ExitPlanMode / 任何 behavior:'ask' 工具的卡片时，依据
  // toolCall.id（= engine 的 tool_use_id）查找对应的 requestId，再调用
  // allowPermission / denyPermission 回写 control_response。
  // ────────────────────────────────────────────────────────────────────
  interface PermissionRequest {
    sessionId: string
    requestId: string
    toolName: string
    toolUseId: string
    input: Record<string, unknown>
    agentId?: string
    description?: string
    title?: string
    displayName?: string
    blockedPath?: string
    decisionReason?: string
    permissionSuggestions?: unknown[]
  }
  // outer key = sessionId, inner key = toolUseId
  const pendingPermissions = ref<Map<string, Map<string, PermissionRequest>>>(new Map())

  // ── 权限模式状态 ──
  // 以 settings store 中的持久化偏好为真值，跨会话/重启保持不变
  const currentPermissionMode = ref<PermissionMode>(
    (settingsStore.permissionMode as PermissionMode) || 'default'
  )

  // ── Turn Change Card 状态 ──
  
  const turnCheckpoints = ref<SessionTurnCheckpoint[]>([])
  const isLoadingTurnCards = ref(false)
  const turnCardsError = ref<string | null>(null)
  const rewindingTurnId = ref<string | null>(null)

  // ── Rewind 状态 ──
  const rewindState = ref<RewindState>({
    showDialog: false,
    selectedMessageId: null,
    selectedOption: 'both',
    summarizeFeedback: '',
    isRewinding: false,
    error: null,
    showCodeConfirm: false,    // 是否显示代码回滚确认弹窗
    filesToRewind: [],         // 将要回滚的文件路径列表
  })

  // 待恢复到输入框的用户消息内容（用于回滚时恢复用户输入）
  const pendingInputText = ref<string>('')

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

  const currentTeamContext = computed(() => currentSession.value?.teamContext || null)

  const currentViewedAgentTaskId = computed(() => currentSession.value?.viewingAgentTaskId)

  const viewedTeammate = computed(() => {
    const taskId = currentViewedAgentTaskId.value
    if (!taskId) return null
    return currentTeamContext.value?.teammates[taskId] || null
  })

  const displayMessages = computed(() => {
    const session = currentSession.value
    const teammateId = session?.viewingAgentTaskId
    if (!session || !teammateId) return session?.messages || []
    return session.teammateTranscripts?.[teammateId] || []
  })

  const isViewingTeammate = computed(() => !!currentSession.value?.viewingAgentTaskId)

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

  // 节流持久化：流式回调里每条 chunk 都会调用 saveToStorage，
  // 而 JSON.stringify + LZ 压缩 + localStorage.setItem 是重量级同步操作。
  // 不节流会冻结渲染进程（黑屏 / Render frame disposed）。
  // 600ms 既能保证崩溃恢复时丢失数据极少，又把同步成本平摊到合理频率。
  let _saveScheduled = false
  let _saveTrailing = false
  let _lastSaveAt = 0
  const SAVE_INTERVAL_MS = 600

  function flushSaveNow() {
    _saveScheduled = false
    _saveTrailing = false
    _lastSaveAt = Date.now()
    saveSessionsToStorage(sessions.value)
  }

  function saveToStorage() {
    const now = Date.now()
    const elapsed = now - _lastSaveAt
    if (elapsed >= SAVE_INTERVAL_MS && !_saveScheduled) {
      _lastSaveAt = now
      saveSessionsToStorage(sessions.value)
      return
    }
    // 在窗口期内：标记 trailing，到期后再保存一次最新状态
    _saveTrailing = true
    if (_saveScheduled) return
    _saveScheduled = true
    const wait = Math.max(0, SAVE_INTERVAL_MS - elapsed)
    setTimeout(() => {
      _saveScheduled = false
      if (_saveTrailing) {
        _saveTrailing = false
        _lastSaveAt = Date.now()
        saveSessionsToStorage(sessions.value)
      }
    }, wait)
  }

  // 关闭窗口前确保最后一次状态落盘
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushSaveNow)
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

  function createSession(title = 'New Chat', workingDirectory?: string, sessionId?: string): Session {
    const id = sessionId || crypto.randomUUID()
    
    const session: Session = {
      id,
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
    clearTurnCheckpoints()
    saveToStorage()
    traceEvent({
      sessionId: session.id,
      actor: 'system',
      type: sessionId ? 'session_restored' : 'session_created',
      status: 'completed',
      title: sessionId ? 'Chat session restored from history' : 'Chat session created',
      metadata: { title: session.title, workingDirectory: session.workingDirectory },
    })
    return session
  }

  async function initClaudeCodeSession(sessionId: string): Promise<void> {
    const claudeCode = api.claudeCode
    if (!claudeCode) {
      logger.warn('ChatStore', `initClaudeCodeSession: claudeCode API not available`)
      return
    }

    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) {
      logger.warn('ChatStore', `initClaudeCodeSession: session not found | id=${sessionId.slice(0, 8)}`)
      return
    }

    const desiredEngine = settingsStore.engineType
    const status = await claudeCode.getSessionStatus(sessionId)
    if (status?.isRunning) {
      const currentEngine = session.engineType
      if (currentEngine && currentEngine !== desiredEngine) {
        logger.info('ChatStore', `initClaudeCodeSession: engine changed (${currentEngine} → ${desiredEngine}), restarting | id=${sessionId.slice(0, 8)}`)
        const resumeId = status.engineSessionId || session.engineSessionId
        try {
          await claudeCode.stop(sessionId)
        } catch (e) {
          logger.warn('ChatStore', `initClaudeCodeSession: stop failed before engine switch | id=${sessionId.slice(0, 8)}`, { error: String(e) })
        }
        session._resumeSessionId = resumeId || undefined
        // Fall through to start with the new engine
      } else {
        logger.info('ChatStore', `initClaudeCodeSession: session already running | id=${sessionId.slice(0, 8)}`)
        // 已在运行的会话：若后端模式与用户偏好不一致，则下发用户偏好
        if (status?.permissionMode && status.permissionMode !== currentPermissionMode.value) {
          try {
            await claudeCode.setPermissionMode?.(sessionId, currentPermissionMode.value)
          } catch (e) {
            logger.warn('ChatStore', `initClaudeCodeSession: failed to apply preferred mode | id=${sessionId.slice(0, 8)}`, { error: String(e) })
          }
        }
        return
      }
    }

    try {
      const config = settingsStore.config
      const cwd = session.workingDirectory || currentProjectRoot.value || await api.getCwd() || '/'

      session.processStatus = 'starting'
      saveToStorage()

      logger.info('ChatStore', `initClaudeCodeSession: starting session | id=${sessionId.slice(0, 8)} | engine=${desiredEngine} | cwd=${cwd} | provider=${config.provider} | model=${config.model} | baseUrl=${config.baseUrl || '(empty)'} | apiKey=${config.apiKey ? '***set' : '(empty)'} | agent=${currentAgent.value || '(none)'}`)
      traceEvent({
        sessionId,
        actor: 'system',
        type: 'engine_session_start',
        status: 'started',
        title: 'Starting engine session',
        metadata: {
          cwd,
          engineType: desiredEngine,
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
        permissionMode: currentPermissionMode.value,
        agent: currentAgent.value || undefined,
        thinkingEnabled: settingsStore.thinkingEnabled,
        engineType: desiredEngine,
        engineSource: settingsStore.engineSource,
        installedCliPath: settingsStore.installedCliPath ?? undefined,
        resumeSessionId: session._resumeSessionId,
      })

      delete session._resumeSessionId

      // Record which engine owns this session's live process so subsequent
      // engine switches in settings can be detected and force a restart.
      session.engineType = desiredEngine
      saveToStorage()

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

  // ensureTeamContext is now imported from @/services/teamTranscriptService

  function recordTeammateMessage(raw: any, targetSessionId: string): Message | null {
    if (!isTeammateRawMessage(raw)) return null
    const session = sessions.value.find(s => s.id === targetSessionId)
    if (!session) return null

    const teammateId = stableTeammateId(raw)
    const name = getRawTeammateName(raw)
    const teamName = getRawTeamName(raw)
    const status = inferTeammateStatus(raw)
    const text = stringifyRawContent(raw)
    ensureTeamContext(session, teamName)

    const existing = session.teamContext!.teammates[teammateId]
    const color = existing?.color || AGENT_COLORS[Object.keys(session.teamContext!.teammates).length % AGENT_COLORS.length]
    const transcript = session.teammateTranscripts![teammateId] || []
    const messageId = raw?.uuid || raw?.message?.id || raw?.id || crypto.randomUUID()
    const message: Message = {
      id: String(messageId),
      role: raw?.role === 'user' ? 'user' : 'assistant',
      content: text,
      timestamp: raw?.timestamp ? Date.parse(raw.timestamp) || Date.now() : Date.now(),
      metadata: {
        agentTaskId: teammateId,
        agentName: name,
        teamName,
        status,
      }
    }

    if (text.trim() && !transcript.some(m => m.id === message.id)) {
      session.teammateTranscripts![teammateId] = [...transcript, message]
    }

    session.teamContext!.teammates[teammateId] = {
      name,
      agentType: raw?.agentType || raw?.subagent_type,
      status,
      color,
      messageCount: session.teammateTranscripts![teammateId]?.length || transcript.length
    }

    if ((status === 'completed' || status === 'failed') && !session.messages.some(m => m.metadata?.kind === 'task-notification' && m.metadata.agentTaskId === teammateId && m.metadata.status === status)) {
      session.messages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `${name} ${status === 'completed' ? 'completed' : 'failed'}.`,
        timestamp: Date.now(),
        metadata: {
          kind: 'task-notification',
          agentTaskId: teammateId,
          agentName: name,
          teamName,
          status,
        }
      })
    }

    session.updatedAt = Date.now()
    session.lastActivityAt = Date.now()
    saveToStorage()
    return message
  }

  // parseAgentToolOutput is now imported from @/services/teamTranscriptService

  // hydrateAgentTranscriptFromFile is now in @/services/teamTranscriptService

  // recordAgentToolCall is now imported from @/services/teamTranscriptService
  function viewTeammateTranscript(taskId: string) {
    const session = currentSession.value
    if (!session?.teamContext?.teammates[taskId]) return
    session.viewingAgentTaskId = taskId
    session.expandedView = 'teammates'
    saveToStorage()
  }

  function backToLeaderView() {
    const session = currentSession.value
    if (!session) return
    session.viewingAgentTaskId = undefined
    session.expandedView = session.teamContext ? 'teammates' : 'none'
    saveToStorage()
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

      for (const toolCall of newMessage.toolCalls || []) {
        recordAgentToolCall(session, toolCall, toolCall.status === 'completed' ? 'completed' : toolCall.status === 'error' ? 'failed' : 'running')
      }

      if (session.messages.length === 1 && newMessage.role === 'user') {
        const newTitle = newMessage.content.slice(0, 50) + (newMessage.content.length > 50 ? '...' : '')
        session.title = newTitle
        appStore.updateSessionTabTitle(sessionId, newTitle)
      }
      saveToStorage()
    }

    return newMessage
  }

  interface MessageAttachments {
    files?: { name: string; path: string; isFolder: boolean }[]
    images?: { id: string; name: string; type: 'image'; mimeType: string; previewUrl: string; data: string }[]
  }

  async function sendMessage(content: string, userMessageContent?: string, attachments?: MessageAttachments): Promise<void> {
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
      content: userMessageContent ?? content,
      attachments: attachments?.files,
      imageAttachments: attachments?.images
    }, targetSessionId)

    // 将图片 dataURL 落盘到 Electron userData（fire-and-forget，不阻塞发送）
    if (attachments?.images?.length) {
      for (const img of attachments.images) {
        if (img.id && img.data) {
          api.image?.save?.(img.id, img.data).catch(() => {})
        }
      }
    }

    const claudeCode = api.claudeCode
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
      let streamingHandledThinking = false

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
          if (currentReasoningEventId) {
            updateTimelineEvent(currentReasoningEventId, { status: 'completed' })
          }
          const s = sessions.value.find(s => s.id === targetSessionId)
          if (s) {
            const msg = s.messages.find(m => m.id === assistantMessageId)
            if (msg) {
              if (!msg.reasoning) {
                msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
              }
              currentReasoningEventId = crypto.randomUUID()
              addTimelineEvent({
                id: currentReasoningEventId,
                type: 'reasoning',
                timestamp: Date.now(),
                status: 'running',
                content: ''
              })
              streamingHandledThinking = true
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
          streamingHandledThinking = true
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
                  timestamp: Date.now(),
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

        const apiUsage = assistant.message?.usage
        if (apiUsage) {
          const s = sessions.value.find(sess => sess.id === targetSessionId)
          const msg = s?.messages.find(m => m.id === assistantMessageId)
          if (msg) {
            const cacheRead = typeof apiUsage.cache_read_input_tokens === 'number'
              ? apiUsage.cache_read_input_tokens
              : 0
            const cacheCreate = typeof apiUsage.cache_creation_input_tokens === 'number'
              ? apiUsage.cache_creation_input_tokens
              : 0
            msg.metadata = {
              ...msg.metadata,
              inputTokens: apiUsage.input_tokens,
              outputTokens: apiUsage.output_tokens,
              ...(typeof apiUsage.cache_read_input_tokens === 'number'
                ? { cacheReadInputTokens: apiUsage.cache_read_input_tokens }
                : {}),
              ...(typeof apiUsage.cache_creation_input_tokens === 'number'
                ? { cacheCreationInputTokens: apiUsage.cache_creation_input_tokens }
                : {}),
              // Per-API-call usage (the LAST iteration's view of context size).
              // This is what claude-code's `getCurrentUsage` returns and is
              // the correct source for context-fill calculation. The SDK's
              // `result.usage` (written in handleResult) is the cumulative
              // sum across iterations within this turn and would inflate
              // cache_read by N×, so we keep it separate.
              apiCallUsage: {
                input_tokens: apiUsage.input_tokens ?? 0,
                output_tokens: apiUsage.output_tokens ?? 0,
                cache_read_input_tokens: cacheRead,
                cache_creation_input_tokens: cacheCreate,
              },
            }
            // Push a live snapshot update so the context chip/modal track
            // the assistant during a turn instead of jumping at the end.
            try {
              useContextUsageStore().applyFallback(targetSessionId)
            } catch {
              // Non-fatal; the authoritative refresh on `result` will fix it.
            }
          }
        }

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
                  if (streamingHandledThinking) continue
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
                        streamingHandledThinking = true
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

              if (reasoningContent && !streamingHandledThinking) {
                const s = sessions.value.find(s => s.id === targetSessionId)
                if (s) {
                  const msg = s.messages.find(m => m.id === assistantMessageId)
                  if (msg) {
                    if (!msg.reasoning) {
                      msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                    }
                    msg.reasoning.content += reasoningContent
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
                    streamingHandledThinking = true
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
                    recordAgentToolCall(s, msg.toolCalls[msg.toolCalls.length - 1])
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
              recordAgentToolCall(s, updatedToolCalls[toolCallIndex], resultIsError ? 'failed' : 'completed')

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
            const resultUsage = result.usage
            // Preserve `apiCallUsage` (last per-API-call usage) so the
            // context-fill calculation keeps using claude-code's
            // `getCurrentUsage`-equivalent value. The cumulative
            // per-turn `result.usage` only feeds session totals and the
            // top-level token fields below.
            const previousApiCallUsage = msg.metadata?.apiCallUsage
            msg.metadata = {
              model: settingsStore.config.model,
              duration: Date.now() - msg.timestamp,
              ...(resultUsage && {
                inputTokens: resultUsage.input_tokens,
                outputTokens: resultUsage.output_tokens,
                ...(typeof resultUsage.cache_read_input_tokens === 'number'
                  ? { cacheReadInputTokens: resultUsage.cache_read_input_tokens }
                  : {}),
                ...(typeof resultUsage.cache_creation_input_tokens === 'number'
                  ? { cacheCreationInputTokens: resultUsage.cache_creation_input_tokens }
                  : {}),
              }),
              ...(previousApiCallUsage ? { apiCallUsage: previousApiCallUsage } : {}),
              warning: suspiciousToolStop
                ? 'Agent 在工具调用状态下提前结束，当前模型可能没有稳定支持多轮工具调用协议。建议重试或切换为更强的工具调用模型。'
                : hasRunningTools
                  ? 'Agent 已结束，但仍有工具调用未返回结果。'
                  : undefined
            }

            void useContextUsageStore().refresh(targetSessionId, true)
            traceEvent({
              sessionId: targetSessionId,
              messageId: assistantMessageId,
              actor: 'assistant',
              type: 'assistant_turn',
              status: 'completed',
              title: 'Assistant turn completed',
              output: { content: msg.content },
              metadata: {
                duration: msg.metadata?.duration,
                model: msg.metadata?.model,
                stopReason: result.stop_reason || '',
                warning: msg.metadata?.warning || '',
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

            void loadTurnCheckpoints(targetSessionId)
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
                  recordAgentToolCall(s, updatedToolCalls[toolCallIndex], toolResult.is_error ? 'failed' : 'completed')
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

        // 如果是超时错误，先尝试 abort 引擎
        const errorMsg = String(error).toLowerCase()
        const isTimeoutError = errorMsg.includes('超时') || errorMsg.includes('timeout')
        if (isTimeoutError && claudeCode) {
          try {
            logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] timeout detected, attempting to abort engine process`)
            claudeCode.abort(targetSessionId)
          } catch (e) {
            logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] abort failed`, { error: String(e) })
          }
        }

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
          // 不清除 engineType！它记录的是用户选择的引擎类型
          // 下次启动时会用同样的引擎继续工作
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
      const unsubscribeExit = claudeCode.onExit((event: { sessionId: string; data: number | null | { code?: number | null; signal?: string | null; stderr?: string } }) => {
        if (event.sessionId !== targetSessionId) return

        // Normalize exit payload across engines:
        //  - claude-code engine: data = number | null (the exit code)
        //  - pi engine:          data = { code, signal, stderr }
        let exitCode: number | null = null
        let stderrTail: string | undefined
        let signal: string | null | undefined
        if (typeof event.data === 'number' || event.data === null) {
          exitCode = event.data
        } else if (event.data && typeof event.data === 'object') {
          exitCode = event.data.code ?? null
          stderrTail = event.data.stderr || undefined
          signal = event.data.signal ?? undefined
        }

        logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] process exit event | code=${exitCode}${signal ? ` | signal=${signal}` : ''}${stderrTail ? ` | stderr=${stderrTail.slice(0, 200)}` : ''}`)

        if (exitCode !== null && exitCode !== 0) {
          const detail = stderrTail
            ? stderrTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
            : undefined
          const msg = detail
            ? `Process exited with code ${exitCode}: ${detail}`
            : `Process exited with code ${exitCode}`
          handleError(new Error(msg))
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

      // 通过 IPC 传递前剥离 Vue 响应式 Proxy（structuredClone 无法克隆 Proxy / Symbol 键）
      const plainImages = attachments?.images?.map(img => ({
        id: img.id,
        name: img.name,
        type: img.type,
        mimeType: img.mimeType,
        previewUrl: img.previewUrl,
        data: img.data,
      }))
      claudeCode.sendMessage(targetSessionId, content, plainImages).catch((error: any) => {
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
    const claudeCode = api.claudeCode
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
    
    const claudeCode = api.claudeCode
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      const lastAssistantMsg = [...session.messages].reverse().find(m => m.role === 'assistant' && m.metadata?.error)
      if (lastAssistantMsg) {
        const idx = session.messages.findIndex(m => m.id === lastAssistantMsg.id)
        if (idx >= 0) session.messages.splice(idx, 1)
      }
      
      try {
        // 先尝试挂起会话（而不是直接停止），这样引擎可以用 --resume 恢复完整历史
        if (claudeCode) {
          logger.info('ChatStore', `retryLastMessage: attempting to suspend and resume session | sessionId=${sid.slice(0, 8)}`)
          try {
            // 先尝试挂起
            if (session.processStatus === 'active' || session.processStatus === 'idle') {
              claudeCode.suspendSession?.(sid)
              session.processStatus = 'suspended'
              saveToStorage()
              // 给一点时间让挂起完成
              await new Promise(resolve => setTimeout(resolve, 100))
            }
            // 如果挂起后还是有问题，或者状态不是 suspended，那就停止它
            const status = await claudeCode.getSessionStatus(sid)
            if (!status?.isRunning || status?.status === 'exited') {
              await claudeCode.stop(sid)
              session.processStatus = 'none'
              // 不清除 engineType！用户没有切换引擎，保持原来的选择
              saveToStorage()
            }
          } catch (e) {
            // 挂起失败的话，就停止进程
            logger.warn('ChatStore', `retryLastMessage: suspend failed, falling back to stop | sessionId=${sid.slice(0, 8)}`, { error: String(e) })
            try {
              await claudeCode.stop(sid)
            } catch (e2) {
              // 停止失败也不要紧，继续尝试
            }
            session.processStatus = 'none'
            // 不清除 engineType！用户没有切换引擎，保持原来的选择
            saveToStorage()
          }
        }
        
        // 重新发送消息（会自动重新初始化引擎）
        // 注意：sendMessage 内部会把这条消息先加到 session.messages 里，所以我们先临时移除这条
        // 用户消息，等 sendMessage 再加回来，避免重复
        const existingUserMsgIndex = session.messages.findIndex(m => m.role === 'user' && m.content === lastUserMsg.content)
        if (existingUserMsgIndex >= 0) {
          session.messages.splice(existingUserMsgIndex, 1)
          saveToStorage()
        }
        
        await sendMessage(lastUserMsg.content)
      } catch (error) {
        logger.error('ChatStore', `retryLastMessage: failed | sessionId=${sid.slice(0, 8)}`, { error: String(error) })
      }
    }
  }

  function updateToolCall(messageId: string, toolCallId: string, status: ToolCall['status']) {
    const sid = currentSessionId.value
    const session = sessions.value.find(s => s.id === sid)
    if (!session) return

    // 优先按调用方传入的 messageId 命中。AssistantTimeline / MessageList 把
    // 同一段 assistant 输出按"连续 assistant 消息"打成 group，外层 emit 时
    // 用的是 `group.id`（即第一条消息的 id）；但 toolCall 可能挂在 group 内
    // 任意一条后续 assistant 消息上（每个 LLM turn 都会新建一条 assistantMessage）。
    // 严格按 messageId 命中就会静默 no-op，导致 AskUserQuestion 卡片提交后
    // 视觉上不变化（仍然 running）。
    // 因此当 messageId 找不到时，fallback 全表扫描——toolCallId 在会话内是
    // 全局唯一的（engine 颁发的 tool_use_id），不会误命中。
    const primary = session.messages.find(m => m.id === messageId)
    const tc = primary?.toolCalls?.find(t => t.id === toolCallId)
    if (tc) {
      tc.status = status
      saveToStorage()
      return
    }

    for (const message of session.messages) {
      const fallback = message.toolCalls?.find(t => t.id === toolCallId)
      if (fallback) {
        fallback.status = status
        saveToStorage()
        return
      }
    }
  }

  async function submitToolAnswer(messageId: string, toolCallId: string, answers: Record<string, string>): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) return

    logger.info('ChatStore', `submitToolAnswer: submitting answers | sessionId=${sid.slice(0, 8)} | messageId=${messageId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)
    
    const claudeCode = api.claudeCode
    if (!claudeCode) {
      logger.error('ChatStore', 'submitToolAnswer: claudeCode API not available')
      return
    }

    try {
      // 通过 IPC 发送答案到后端
      await claudeCode.submitToolAnswer(sid, toolCallId, answers)
      
      // 更新工具调用状态为已完成
      updateToolCall(messageId, toolCallId, 'completed')
      
      logger.info('ChatStore', `submitToolAnswer: answers submitted successfully`)
    } catch (error) {
      logger.error('ChatStore', 'submitToolAnswer: failed', { error: String(error) })
      throw error
    }
  }

  async function skipToolAnswer(messageId: string, toolCallId: string): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) return

    logger.info('ChatStore', `skipToolAnswer: skipping tool | sessionId=${sid.slice(0, 8)} | messageId=${messageId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)
    
    const claudeCode = api.claudeCode
    if (!claudeCode) {
      logger.error('ChatStore', 'skipToolAnswer: claudeCode API not available')
      return
    }

    try {
      // 通过 IPC 通知后端跳过
      await claudeCode.skipToolAnswer(sid, toolCallId)
      
      // 更新工具调用状态为已完成（跳过也算完成）
      updateToolCall(messageId, toolCallId, 'completed')
      
      logger.info('ChatStore', `skipToolAnswer: tool skipped successfully`)
    } catch (error) {
      logger.error('ChatStore', 'skipToolAnswer: failed', { error: String(error) })
      throw error
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

  // ========== 优化: 即时UI反馈 + 异步数据加载 ==========
  const sessionLoadingStates = ref<Map<string, boolean>>(new Map())

  function setSessionLoading(sessionId: string, loading: boolean) {
    const newMap = new Map(sessionLoadingStates.value)
    if (loading) {
      newMap.set(sessionId, true)
    } else {
      newMap.delete(sessionId)
    }
    sessionLoadingStates.value = newMap
  }

  function isSessionLoading(sessionId: string): boolean {
    return sessionLoadingStates.value.get(sessionId) ?? false
  }

  async function selectSession(sessionId: string) {
    // 1. 立即更新当前会话ID（同步操作，<1ms）
    currentSessionId.value = sessionId

    const session = sessions.value.find(s => s.id === sessionId)
    if (session?.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }

    // 2. 切换会话时先清除旧会话的轮次追踪数据，再异步加载新会话的数据
    clearTurnCheckpoints()

    // 3. 异步获取会话状态（后台操作，不阻塞UI）
    const claudeCode = api.claudeCode
    if (claudeCode) {
      try {
        // 使用 Promise.race 添加超时，避免长时间阻塞
        const statusPromise = claudeCode.getSessionStatus(sessionId)
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 2000)
        )
        const status = await Promise.race([statusPromise, timeoutPromise]).catch(() => null)

        // 切换会话不应重置用户的权限模式偏好。
        // 若后端会话已运行且模式与偏好不一致，则把偏好下发给后端，保持 UI 与后端一致。
        if (status?.isRunning && status.permissionMode && status.permissionMode !== currentPermissionMode.value) {
          try {
            await claudeCode.setPermissionMode?.(sessionId, currentPermissionMode.value)
          } catch (e) {
            logger.warn('ChatStore', `selectSession: failed to apply preferred mode | id=${sessionId.slice(0, 8)}`, { error: String(e) })
          }
        }
      } catch {
        // 忽略：保留用户偏好不变
      }
    }

    // 4. 异步加载新会话的轮次追踪数据（不阻塞UI，强制加载确保切换后数据正确）
    void loadTurnCheckpoints(sessionId, undefined, true)
  }

  async function activateSession(sessionId: string): Promise<void> {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return

    currentSessionId.value = sessionId
    if (session.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }

    // 切换会话时清除旧数据并异步加载新会话的轮次追踪
    clearTurnCheckpoints()

    if (session.processStatus === 'suspended') {
      const claudeCode = api.claudeCode
      if (claudeCode) {
        // If the user switched engines while this session was suspended, the
        // old engine's snapshot is no longer usable. Throw it away and start
        // fresh under the current engine instead of trying to resume.
        const desiredEngine = settingsStore.engineType
        if (session.engineType && session.engineType !== desiredEngine) {
          logger.info('ChatStore', `activateSession: suspended session uses engine=${session.engineType}, current=${desiredEngine} — restarting fresh | id=${sessionId.slice(0, 8)}`)
          try {
            await claudeCode.stop(sessionId)
          } catch {}
          session.processStatus = 'none'
          saveToStorage()
          if (session.messages.length > 0) {
            await initClaudeCodeSession(sessionId)
          }
          return
        }

        try {
          session.processStatus = 'starting'
          saveToStorage()
          await claudeCode.resumeSession(sessionId)
          session.processStatus = 'active'
          saveToStorage()
          // 恢复挂起会话后，把用户偏好下发给后端，避免后端旧状态覆盖偏好
          const status = await claudeCode.getSessionStatus(sessionId)
          if (status?.permissionMode && status.permissionMode !== currentPermissionMode.value) {
            try {
              await claudeCode.setPermissionMode?.(sessionId, currentPermissionMode.value)
            } catch (e) {
              logger.warn('ChatStore', `activateSession: failed to apply preferred mode | id=${sessionId.slice(0, 8)}`, { error: String(e) })
            }
          }
        } catch (error) {
          console.error('[ChatStore] Failed to resume session:', error)
          session.processStatus = 'exited'
          saveToStorage()
        }
      }
    } else if ((session.processStatus === 'none' || session.processStatus === 'exited') && session.messages.length > 0) {
      await initClaudeCodeSession(sessionId)
    }

    // 异步加载新会话的轮次追踪数据
    void loadTurnCheckpoints(sessionId, undefined, true)
  }

  function deactivateSession(sessionId: string): void {
    const session = sessions.value.find(s => s.id === sessionId)
    if (session) {
      session.isTabOpen = false
      saveToStorage()
    }
  }

  async function deleteSession(sessionId: string) {
    const claudeCode = api.claudeCode
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

  // ── Turn Checkpoint Actions & Getters ──
  
  async function loadTurnCheckpoints(sessionId: string, projectPathOverride?: string, force?: boolean) {
    if (!sessionId || (isLoadingTurnCards.value && !force)) return
    
    isLoadingTurnCards.value = true
    turnCardsError.value = null
    
    try {
      const projectPath = projectPathOverride
        || sessions.value.find(s => s.id === sessionId)?.workingDirectory
        || workingDirectory.value
      const result = await api.session.getTurnCheckpoints(sessionId, projectPath)
      if (result.ok) {
        turnCheckpoints.value = result.checkpoints
      } else {
        turnCardsError.value = result.error || 'Failed to load turn checkpoints'
        turnCheckpoints.value = []
      }
    } catch (err) {
      turnCardsError.value = err instanceof Error ? err.message : 'Unknown error'
      turnCheckpoints.value = []
    } finally {
      isLoadingTurnCards.value = false
    }
  }

  async function undoTurn(sessionId: string, targetUserMessageId: string, userMessageIndex?: number) {
    if (!sessionId || rewindingTurnId.value) return
    
    rewindingTurnId.value = targetUserMessageId
    
    try {
      const projectPath = workingDirectory.value
      const result = await api.session.rewindTurn(sessionId, {
        targetUserMessageId,
        userMessageIndex
      }, projectPath)
      
      if (!result.ok) {
        throw new Error(result.error || 'Failed to rewind turn')
      }
      
      await loadTurnCheckpoints(sessionId)
    } catch (err) {
      logger.error('ChatStore', 'Failed to undo turn', { error: err })
      throw err
    } finally {
      rewindingTurnId.value = null
    }
  }

  function clearTurnCheckpoints() {
    turnCheckpoints.value = []
    turnCardsError.value = null
  }

  // ── Rewind 状态管理方法 ──

  function setShowRewindDialog(show: boolean) {
    rewindState.value.showDialog = show
  }

  function setRewindSelectedMessage(messageId: string | null) {
    rewindState.value.selectedMessageId = messageId
  }

  function setRewindSelectedOption(option: RewindOption) {
    rewindState.value.selectedOption = option
  }

  function setRewindSummarizeFeedback(feedback: string) {
    rewindState.value.summarizeFeedback = feedback
  }

  function resetRewindState() {
    rewindState.value = {
      showDialog: false,
      selectedMessageId: null,
      selectedOption: 'both',
      summarizeFeedback: '',
      isRewinding: false,
      error: null,
      showCodeConfirm: false,
      filesToRewind: [],
    }
  }

  function setRewindError(error: string | null) {
    rewindState.value.error = error
  }

  function setShowCodeConfirm(show: boolean) {
    rewindState.value.showCodeConfirm = show
  }

  function setFilesToRewind(files: string[]) {
    rewindState.value.filesToRewind = files
  }

  function setPendingInputText(text: string) {
    pendingInputText.value = text
  }

  function clearPendingInputText() {
    pendingInputText.value = ''
  }

  async function loadFilesToRewind(sessionId: string, messageId: string): Promise<string[]> {
    try {
      const projectPath = sessions.value.find(s => s.id === sessionId)?.workingDirectory
        || workingDirectory.value
      const session = sessions.value.find(s => s.id === sessionId)
      const userMessageIndex = session
        ? session.messages.filter(m => m.role === 'user').findIndex(m => m.id === messageId)
        : -1

      const result = await api.session.getTurnRewindPreviewFiles(
        sessionId,
        messageId,
        userMessageIndex >= 0 ? userMessageIndex : undefined,
        projectPath
      )

      if (result.ok && result.files.length > 0) {
        return result.files
      }

      if (session && turnCheckpoints.value.length > 0) {
        const completedTurns = getCompletedTurnTargets(session.messages)
        const turnIndex = completedTurns.findIndex(turn => turn.messageId === messageId)
        if (turnIndex >= 0 && completedTurns.length === turnCheckpoints.value.length) {
          const checkpoint = turnCheckpoints.value[turnIndex]
          if (checkpoint?.code?.filesChanged?.length) {
            return checkpoint.code.filesChanged.map(file => file.path)
          }
        }
      }

      if (!result.ok) {
        logger.warn('ChatStore', 'Failed to load rewind preview files', { error: result.error })
      }

      return result.ok ? result.files : []
    } catch (err) {
      logger.error('ChatStore', 'Failed to load files to rewind', { error: err })
      return []
    }
  }

  async function rewindSession(
    sessionId: string,
    targetUserMessageId: string,
    mode: 'both' | 'conversation' | 'code'
  ): Promise<void> {
    if (!sessionId) {
      rewindState.value.error = 'Session ID is required'
      return
    }

    if (rewindState.value.isRewinding) {
      return
    }

    rewindState.value.isRewinding = true
    rewindState.value.error = null

    let codeError: string | null = null
    let conversationError: string | null = null

    try {
      // Step 1: Restore code (if needed)
      if (mode === 'both' || mode === 'code') {
        try {
          const projectPath = workingDirectory.value
          const session = sessions.value.find(s => s.id === sessionId)
          const userMessageIndex = session
            ? session.messages.filter(m => m.role === 'user').findIndex(m => m.id === targetUserMessageId)
            : -1

          logger.info('ChatStore', 'Rewinding code', { sessionId, targetUserMessageId, userMessageIndex, projectPath })
          const result = await api.session.rewindTurn(sessionId, {
            targetUserMessageId,
            userMessageIndex: userMessageIndex >= 0 ? userMessageIndex : undefined,
          }, projectPath)

          if (!result.ok) {
            codeError = result.error || 'Failed to rewind code'
            logger.error('ChatStore', 'Code rewind failed', { error: codeError })
          } else {
            logger.info('ChatStore', 'Code rewind succeeded')
          }
        } catch (err) {
          codeError = err instanceof Error ? err.message : 'Unknown error during code rewind'
          logger.error('ChatStore', 'Code rewind exception', { error: codeError })
        }

        // FIX: If mode='both' and code rewind failed, don't proceed with conversation rewind
        // This prevents inconsistent state where messages are deleted but code changes remain
        if (mode === 'both' && codeError) {
          logger.warn('ChatStore', 'Skipping conversation rewind due to code rewind failure', { error: codeError })
        }
      }

      // Step 2: Restore conversation (if needed)
      // Only execute if:
      // - mode is 'conversation' (code rewind not involved), OR
      // - mode is 'both' AND code rewind succeeded (no codeError)
      if (mode === 'conversation' || (mode === 'both' && !codeError)) {
        try {
          const session = sessions.value.find(s => s.id === sessionId)
          if (session) {
            const targetIndex = session.messages.findIndex(m => m.id === targetUserMessageId)
            if (targetIndex >= 0) {
              const messagesToRemove = session.messages.slice(targetIndex)
              const targetMessage = session.messages[targetIndex]
              const lastUserMessage = [...messagesToRemove].reverse().find(m => m.role === 'user')

              if (lastUserMessage) {
                pendingInputText.value = lastUserMessage.content || ''
                logger.info('ChatStore', 'Stored user message for input restoration', {
                  messageId: lastUserMessage.id,
                  contentLength: pendingInputText.value.length
                })
              } else if (targetMessage?.role === 'user') {
                pendingInputText.value = targetMessage.content || ''
                logger.info('ChatStore', 'Stored target user message for input restoration', {
                  messageId: targetMessage.id,
                  contentLength: pendingInputText.value.length
                })
              } else {
                pendingInputText.value = ''
              }

              session.messages = session.messages.slice(0, targetIndex)
              saveToStorage()
              logger.info('ChatStore', 'Conversation rewind succeeded', { targetIndex, remainingMessages: session.messages.length })
            } else {
              conversationError = 'Target message not found in session'
              logger.error('ChatStore', conversationError)
            }
          } else {
            conversationError = 'Session not found'
            logger.error('ChatStore', conversationError)
          }
        } catch (err) {
          conversationError = err instanceof Error ? err.message : 'Unknown error during conversation rewind'
          logger.error('ChatStore', 'Conversation rewind exception', { error: conversationError })
        }
      }
    } catch (err) {
      rewindState.value.error = err instanceof Error ? err.message : 'Unknown error during rewind'
      rewindState.value.isRewinding = false
      return
    }

    // Handle errors
    if (codeError && conversationError) {
      rewindState.value.error = `Code: ${codeError}\nConversation: ${conversationError}`
    } else if (codeError) {
      rewindState.value.error = codeError
    } else if (conversationError) {
      rewindState.value.error = conversationError
    }

    rewindState.value.isRewinding = false

    // Throw error so caller can handle it (e.g., keep dialog open to show error)
    if (codeError || conversationError) {
      throw new Error(rewindState.value.error || 'Rewind failed')
    }
  }

  async function summarizeTurn(
    _sessionId: string,
    _targetUserMessageId: string,
    _feedback: string
  ): Promise<void> {
    // Placeholder implementation
    return Promise.resolve()
  }

  const turnChangeCards = computed<TurnChangeCardData[]>(() => {
    if (turnCheckpoints.value.length === 0) return []
    
    const latestIndex = turnCheckpoints.value.length - 1
    
    return turnCheckpoints.value.map((checkpoint, index) => ({
      checkpoint,
      workDir: checkpoint.workDir ?? null,
      isLatest: index === latestIndex,
      targetUserMessageId: checkpoint.target.targetUserMessageId
    })).filter(card => 
      card.checkpoint.code.available && 
      card.checkpoint.code.filesChanged.length > 0
    )
  })

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
    const claudeCode = api.claudeCode
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
    const claudeCode = api.claudeCode
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
    const claudeCode = api.claudeCode
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

  // ────────────────────────────────────────────────────────────────────
  // 权限请求订阅（control_request: can_use_tool）
  //
  // 这条订阅是会话无关 / turn 无关的——一旦 store 创建就长期生效，因为
  // engine 可能在任何时刻（比如 background turn 或者后台 hook）发起授权请求。
  // 单元测试 / SSR 场景下 onPermissionRequest 不存在时安全地降级为 no-op。
  // ────────────────────────────────────────────────────────────────────
  if (api.claudeCode?.onPermissionRequest) {
    api.claudeCode.onPermissionRequest((evt: { sessionId: string; data: PermissionRequest }) => {
      const sid = evt.sessionId
      const req = evt.data
      if (!req?.toolUseId) {
        logger.warn('ChatStore', `permission_request without toolUseId | sessionId=${sid.slice(0, 8)} | requestId=${req?.requestId}`)
        return
      }
      logger.info('ChatStore', `permission_request | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | toolUseId=${req.toolUseId.slice(0, 8)} | requestId=${req.requestId.slice(0, 8)}`)
      // Delegate to permissionService and sync reactivity
      permissionService.addPermissionRequest(sid, { ...req, sessionId: sid })
      pendingPermissions.value = new Map(permissionService.getPendingPermissions())
    })
  }
  if (api.claudeCode?.onPermissionRequestCancelled) {
    api.claudeCode.onPermissionRequestCancelled((evt: { sessionId: string; data: { requestId: string; reason?: string } }) => {
      const sid = evt.sessionId
      const cancelledRequestId = evt.data?.requestId
      if (!cancelledRequestId) return
      logger.info('ChatStore', `permission_request_cancelled | sessionId=${sid.slice(0, 8)} | requestId=${cancelledRequestId.slice(0, 8)} | reason=${evt.data?.reason || '(none)'}`)
      // Delegate to permissionService and sync reactivity
      permissionService.removePermissionByRequestId(sid, cancelledRequestId)
      pendingPermissions.value = new Map(permissionService.getPendingPermissions())
    })
  }

  function getPendingPermissionForToolUse(toolUseId: string, sessionId?: string): PermissionRequest | undefined {
    const sid = sessionId ?? currentSessionId.value
    if (!sid) return undefined
    return pendingPermissions.value.get(sid)?.get(toolUseId)
  }

  function hasPendingPermissionForToolUse(toolUseId: string, sessionId?: string): boolean {
    return !!getPendingPermissionForToolUse(toolUseId, sessionId)
  }

  function consumePermissionFor(toolUseId: string, sessionId: string): PermissionRequest | undefined {
    const req = permissionService.consumePermissionFor(toolUseId, sessionId)
    // Sync reactivity
    pendingPermissions.value = new Map(permissionService.getPendingPermissions())
    return req
  }

  /**
   * Approve a pending permission request keyed by tool_use_id.
   *
   * `updatedInput` is the new input fed to the underlying tool. For most
   * "yes/no" prompts (e.g. Bash, Edit) it equals the original input. For
   * AskUserQuestion / EnterPlanMode etc. it carries the answers / plan as
   * extra fields, exactly as engine/src/components/permissions/.../onAllow
   * does in TUI mode.
   */
  async function allowPermission(
    messageId: string,
    toolUseId: string,
    updatedInput: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) return
    const claudeCode = api.claudeCode
    if (!claudeCode?.allowPermission) {
      logger.error('ChatStore', 'allowPermission: claudeCode.allowPermission not available')
      return
    }
    const req = consumePermissionFor(toolUseId, sid)
    if (!req) {
      logger.warn('ChatStore', `allowPermission: no pending request | sessionId=${sid.slice(0, 8)} | toolUseId=${toolUseId.slice(0, 8)}`)
      return
    }
    logger.info('ChatStore', `allowPermission | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)}`)
    try {
      const safeInput = JSON.parse(JSON.stringify(updatedInput)) as Record<string, unknown>
      await claudeCode.allowPermission(sid, req.requestId, safeInput, decisionClassification)
      // Mark the matching tool call as completed so the card collapses.
      updateToolCall(messageId, toolUseId, 'completed')
    } catch (error) {
      logger.error('ChatStore', 'allowPermission failed', { error: String(error) })
      throw error
    }
  }

  /**
   * Deny a pending permission request. By default the engine treats deny as
   * the user explicitly rejecting the tool call (decisionClassification:
   * user_reject is set inside the IPC layer).
   */
  async function denyPermission(
    messageId: string,
    toolUseId: string,
    message: string = 'User denied',
    options: { interrupt?: boolean } = {},
  ): Promise<void> {
    const sid = currentSessionId.value
    if (!sid) return
    const claudeCode = api.claudeCode
    if (!claudeCode?.denyPermission) {
      logger.error('ChatStore', 'denyPermission: claudeCode.denyPermission not available')
      return
    }
    const req = consumePermissionFor(toolUseId, sid)
    if (!req) {
      logger.warn('ChatStore', `denyPermission: no pending request | sessionId=${sid.slice(0, 8)} | toolUseId=${toolUseId.slice(0, 8)}`)
      return
    }
    logger.info('ChatStore', `denyPermission | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)} | interrupt=${!!options.interrupt}`)
    try {
      await claudeCode.denyPermission(sid, req.requestId, message, options)
      updateToolCall(messageId, toolUseId, 'completed')
    } catch (error) {
      logger.error('ChatStore', 'denyPermission failed', { error: String(error) })
      throw error
    }
  }

  /**
   * 切换当前会话的权限模式
   * @param mode - 目标模式（default/plan/acceptEdits/bypassPermissions）
   */
  async function setPermissionMode(mode: PermissionMode): Promise<void> {
    const claudeCode = api.claudeCode
    const sid = currentSessionId.value
    const previousMode = currentPermissionMode.value

    currentPermissionMode.value = mode

    try {
      settingsStore.permissionMode = mode
      settingsStore.saveSettings()
    } catch (e) {
      logger.warn('ChatStore', 'setPermissionMode: failed to persist preference', { error: String(e) })
    }

    try {
      await api.injectGuiModelsToSettings({
        primaryModel: settingsStore.getPrimaryModel() || '',
        haikuModel: settingsStore.getHaikuModel(),
        sonnetModel: settingsStore.getSonnetModel(),
        opusModel: settingsStore.getOpusModel(),
        permissionMode: mode,
      })
    } catch (e) {
      logger.warn('ChatStore', 'setPermissionMode: failed to write defaultMode to settings.json', { error: String(e) })
    }

    if (sid && claudeCode?.setPermissionMode) {
      try {
        logger.info('ChatStore', `setPermissionMode | sessionId=${sid.slice(0, 8)} | mode=${mode}`)
        await claudeCode.setPermissionMode(sid, mode)
      } catch (error) {
        logger.error('ChatStore', 'setPermissionMode: backend rejected mode switch, reverting UI', { error, previousMode })
        currentPermissionMode.value = previousMode
        try {
          settingsStore.permissionMode = previousMode
          settingsStore.saveSettings()
        } catch {}
      }
    } else if (sid) {
      logger.warn('ChatStore', `setPermissionMode: IPC not available, updating local state only | mode=${mode}`)
    }
  }

  migrateOldData()

  return {
    sessions,
    currentSessionId,
    isLoading,
    streamingContent,
    currentSession,
    currentMessages,
    displayMessages,
    currentTeamContext,
    currentViewedAgentTaskId,
    viewedTeammate,
    isViewingTeammate,
    workingDirectory,
    projects,
    allProjects,
    currentProjectRoot,
    currentAgent,
    availableAgents,
    createSession,
    initClaudeCodeSession,
    addMessage,
    viewTeammateTranscript,
    backToLeaderView,
    recordTeammateMessage,
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
    submitToolAnswer,
    skipToolAnswer,
    // can_use_tool / control_request
    pendingPermissions,
    getPendingPermissionForToolUse,
    hasPendingPermissionForToolUse,
    allowPermission,
    denyPermission,
    // 权限模式（新增）
    currentPermissionMode: readonly(currentPermissionMode),
    setPermissionMode,
    // Turn Checkpoints
    turnCheckpoints: readonly(turnCheckpoints),
    turnChangeCards,
    isLoadingTurnCards,
    turnCardsError,
    rewindingTurnId: readonly(rewindingTurnId),
    loadTurnCheckpoints,
    undoTurn,
    clearTurnCheckpoints,
    // Rewind
    rewindState: readonly(rewindState),
    pendingInputText: readonly(pendingInputText),
    setShowRewindDialog,
    setRewindSelectedMessage,
    setRewindSelectedOption,
    setRewindSummarizeFeedback,
    resetRewindState,
    setRewindError,
    setShowCodeConfirm,
    setFilesToRewind,
    setPendingInputText,
    clearPendingInputText,
    loadFilesToRewind,
    rewindSession,
    summarizeTurn,
    // ========== 优化: 会话加载状态 ==========
    sessionLoadingStates: readonly(sessionLoadingStates),
    isSessionLoading,
    // Diff 面板触发
    diffPanelTrigger: readonly(diffPanelTrigger),
    triggerDiffPanel,
  }
})
