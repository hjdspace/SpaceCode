import { defineStore } from 'pinia'
import { ref, computed, readonly } from 'vue'
import type { Session, Message, ToolCall, AgentInfo, SessionTurnCheckpoint, TurnChangeCardData, TeammateStatus, ArtifactSummaryEntry } from '@/types'
import type { RewindOption, RewindState } from '@/types/rewind'
import { useSettingsStore } from './settings'
import { useAppStore } from './app'
import { useTaskManager } from '@/composables/useTaskManager'
import { getCompletedTurnTargets } from '@/utils/turnCheckpointUtils'
import { syncTaskStateFromToolCall } from '@/utils/taskToolSync'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import {
  loadSessionsFromStorage,
  saveSessionsToStorage,
  loadProjectsFromStorage,
  saveProjectsToStorage,
  setPersistenceLogger,
} from '@/services/sessionPersistence'
import {
  getRawTeammateName,
  getRawTeamName,
  isTeammateRawMessage,
  inferTeammateStatus,
  stringifyRawContent,
  ensureTeamContext,
  ensureSubagentTranscripts,
  recordAgentToolCall,
  isFileBackedTeammate,
  rekickAgentTranscriptPoll,
  resolveTeammateId,
  teammateIdForParentToolUse,
  registerTeammateForToolUse,
  clearSessionToolUseMappings,
  normalizeTeammateId,
  AGENT_COLORS,
} from '@/services/teamTranscriptService'

const taskManager = useTaskManager()

// 单会话在内存中保留的最大消息数。
// 长时间运行的 agent 任务会不断追加消息（每轮 LLM 调用 + 工具调用 + 工具结果），
// 没有上限时 session.messages 会无限增长，导致响应式系统遍历开销增大、
// saveToStorage 的 JSON.stringify 分配超大字符串触发 V8 OOM。
// 引擎自身持有完整对话历史，前端仅保留最近消息用于 UI 展示。
const MAX_MESSAGES_PER_SESSION = 500

// 从 JSONL 恢复历史时，工具输出的最大长度。
// 与 chatStream.ts 的 MAX_INMEMORY_TOOL_OUTPUT 保持一致，
// 防止超长会话恢复时将数十 MB 的工具输出加载到内存。
const MAX_INMEMORY_TOOL_OUTPUT_HYDRATE = 30_000

// ============================================================
// Renderer Logger
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

setPersistenceLogger(logger)

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

async function hydrateImageAttachments(sessions: Session[]): Promise<void> {
  const imageLoad = api.image?.load
  if (!imageLoad) return

  for (const session of sessions) {
    for (const msg of session.messages) {
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
              // 磁盘文件不存在，保持占位状态
            }
          }
        }
      }
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

async function hydrateSessionsFromJsonl(sessions: Session[]): Promise<void> {
  const claudeCode = api.claudeCode
  if (!claudeCode?.getFullSession) return

  for (const session of sessions) {
    const projectPath = session.workingDirectory
    if (!projectPath) continue

    const hasTruncated = session.messages.some(
      msg => typeof msg.content === 'string' && msg.content.includes('[Truncated for storage]')
    )
    try {
      const fullSession = await claudeCode.getFullSession(projectPath, session.id)
      if (!(fullSession?.messages as unknown[] | undefined)?.length) continue

      const restoredMessages = buildMessagesFromHistory(fullSession.messages as any[])
      if (restoredMessages.length === 0) continue

      // ── 保留办公模式产物汇总数据 ──
      // JSONL 转录文件由引擎写入，不包含 SpaceCode 特有的 metadata.artifacts 字段。
      // buildMessagesFromHistory 从 JSONL 重建消息时会丢失该字段，导致重开后产物汇总
      // 卡片消失。此处从 localStorage 保存的旧消息中按助手消息位置提取 artifacts，
      // 重建后按位置合并回去（旧/新消息的 SpaceCode UUID 与引擎 UUID 不同，无法按 id 匹配）。
      const oldArtifactsByAssistantIdx = new Map<number, ArtifactSummaryEntry[]>()
      let oldAssistantIdx = 0
      for (const oldMsg of session.messages) {
        if (oldMsg.role !== 'assistant') continue
        if (oldMsg.metadata?.artifacts?.length) {
          oldArtifactsByAssistantIdx.set(oldAssistantIdx, oldMsg.metadata.artifacts)
        }
        oldAssistantIdx++
      }

      session.messages = restoredMessages.map(msg => ({
        ...msg,
        id: msg.id || crypto.randomUUID(),
        timestamp: Date.now(),
        // 截断从 JSONL 加载的历史工具输出，与流式期间 MAX_INMEMORY_TOOL_OUTPUT 保持一致
        ...(msg.toolCalls?.length ? {
          toolCalls: msg.toolCalls.map(tc => ({
            ...tc,
            output: typeof tc.output === 'string' && tc.output.length > MAX_INMEMORY_TOOL_OUTPUT_HYDRATE
              ? tc.output.slice(0, MAX_INMEMORY_TOOL_OUTPUT_HYDRATE) + '\n\n[Output truncated to prevent memory overflow]'
              : tc.output,
          }))
        } : {}),
      })) as Message[]

      // 将旧消息中保存的产物汇总数据按助手消息位置合并回重建后的消息
      if (oldArtifactsByAssistantIdx.size > 0) {
        let newAssistantIdx = 0
        for (const newMsg of session.messages) {
          if (newMsg.role !== 'assistant') continue
          const savedArtifacts = oldArtifactsByAssistantIdx.get(newAssistantIdx)
          if (savedArtifacts) {
            newMsg.metadata = {
              ...(newMsg.metadata || {}),
              artifacts: savedArtifacts,
            }
          }
          newAssistantIdx++
        }
      }

      session.teamContext = undefined
      session.teammateTranscripts = {}

      for (const msg of session.messages) {
        if (msg.toolCalls) {
          for (const toolCall of msg.toolCalls) {
            if (toolCall.name === 'Agent') {
              recordAgentToolCall(session, toolCall, toolCall.status === 'completed' ? 'completed' : toolCall.status === 'error' ? 'failed' : 'running')
            }
          }
        }
      }

      const teammateMsgIndices: number[] = []
      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]
        if (msg.role === 'system' && msg.metadata?.kind === 'teammate-message') {
          const teammateId = msg.metadata.agentTaskId!
          const agentName = msg.metadata.agentName || 'teammate'
          const teamName = msg.metadata.teamName || 'Agent Team'
          const status = (msg.metadata.status || 'running') as TeammateStatus

          ensureTeamContext(session, teamName)

          const transcript = session.teammateTranscripts![teammateId] || []
          const cleanContent = msg.content.replace(/^\[.*?\]\s*/, '')
          const transcriptMsg: Message = {
            id: msg.id || crypto.randomUUID(),
            role: 'assistant',
            content: cleanContent,
            timestamp: msg.timestamp || Date.now(),
            metadata: {
              agentTaskId: teammateId,
              agentName,
              teamName,
              status,
            },
          }

          if (!transcript.some(m => m.id === transcriptMsg.id)) {
            session.teammateTranscripts![teammateId] = [...transcript, transcriptMsg]
          }

          if (session.teamContext?.teammates[teammateId]) {
            session.teamContext.teammates[teammateId].status = status
            session.teamContext.teammates[teammateId].messageCount = session.teammateTranscripts![teammateId]?.length || 0
          } else {
            const color = AGENT_COLORS[Object.keys(session.teamContext?.teammates || {}).length % AGENT_COLORS.length]
            if (!session.teamContext) {
              session.teamContext = { teamName: '', isLeader: false, teammates: {} }
            }
            session.teamContext.teammates[teammateId] = {
              name: agentName,
              status,
              color,
              messageCount: session.teammateTranscripts![teammateId]?.length || 0,
            }
          }

          teammateMsgIndices.push(i)
        }
      }

      if (teammateMsgIndices.length > 0) {
        session.messages = session.messages.filter((_, i) => !teammateMsgIndices.includes(i))
      }

      if (session.teammateTranscripts) {
        for (const teammateId of Object.keys(session.teammateTranscripts)) {
          session.teammateTranscripts[teammateId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        }
      }

      if (hasTruncated) {
        console.log(`[ChatStore] Hydrated truncated session ${session.id} from JSONL (${restoredMessages.length} messages)`)
      }
    } catch {
      // JSONL 文件不存在或解析失败，保持 localStorage 数据
    }
  }
}

function updateTaskStateFromToolResult(
  toolCalls: ToolCall[],
  resultToolUseId: string,
  resultOutput: string
) {
  const toolCall = toolCalls.find(tc => tc.id === resultToolUseId)
  if (!toolCall) return
  syncTaskStateFromToolCall(taskManager, toolCall, resultOutput)
}

function taskNotificationStatus(value: unknown): { toolStatus: ToolCall['status'], teammateStatus: TeammateStatus } | null {
  if (value === 'completed') return { toolStatus: 'completed', teammateStatus: 'completed' }
  if (value === 'failed' || value === 'stopped' || value === 'killed') return { toolStatus: 'error', teammateStatus: 'failed' }
  return null
}

export const useChatSessionStore = defineStore('chatSession', () => {
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()

  const sessions = ref<Session[]>(loadSessionsFromStorage())

  void hydrateImageAttachments(sessions.value)
  void hydrateSessionsFromJsonl(sessions.value)
  const lastSessionId = sessions.value.length > 0
    ? [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
    : null
  const currentSessionId = ref<string | null>(lastSessionId)

  // ────────────────────────────────────────────────────────────────────
  // Prompt Stash
  // ────────────────────────────────────────────────────────────────────
  interface PromptStashData {
    text: string
    attachments: { name: string; path: string; isFolder: boolean }[]
    images: { id: string; name: string; type: 'image'; mimeType: string; previewUrl: string; data: string }[]
    editorHtml: string
  }
  const sessionStash = ref<Map<string, PromptStashData>>(new Map())

  function stashPrompt(sessionId: string, data: PromptStashData) {
    sessionStash.value.set(sessionId, data)
  }

  function getStash(sessionId: string): PromptStashData | undefined {
    return sessionStash.value.get(sessionId)
  }

  function clearStash(sessionId: string) {
    sessionStash.value.delete(sessionId)
  }

  function hasStash(sessionId: string): boolean {
    return sessionStash.value.has(sessionId)
  }

  // Diff 面板触发
  const diffPanelTrigger = ref(0)
  function triggerDiffPanel() {
    diffPanelTrigger.value++
  }

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
    showCodeConfirm: false,
    filesToRewind: [],
  })

  const pendingInputText = ref<string>('')

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

  // ── By-id selectors（供分屏多 pane 场景按 sessionId 直接读取，不依赖全局 current）──
  // 这些函数都是「响应式安全」的：内部读取 sessions.value，包在 computed 里使用即可。
  function getSession(sessionId: string | null | undefined): Session | null {
    if (!sessionId) return null
    return sessions.value.find(s => s.id === sessionId) || null
  }

  function getSessionMessages(sessionId: string | null | undefined): Message[] {
    return getSession(sessionId)?.messages || []
  }

  /** 等价于 displayMessages，但作用于任意 sessionId（包括队友转录回退） */
  function getDisplayMessages(sessionId: string | null | undefined): Message[] {
    const s = getSession(sessionId)
    if (!s) return []
    const teammateId = s.viewingAgentTaskId
    if (!teammateId) return s.messages || []
    return s.teammateTranscripts?.[teammateId] || []
  }

  function getWorkingDirectory(sessionId: string | null | undefined): string {
    return getSession(sessionId)?.workingDirectory || currentProjectRoot.value || ''
  }

  function getTeamContext(sessionId: string | null | undefined) {
    return getSession(sessionId)?.teamContext || null
  }

  function getViewedAgentTaskId(sessionId: string | null | undefined): string | undefined {
    return getSession(sessionId)?.viewingAgentTaskId
  }

  function getViewedTeammate(sessionId: string | null | undefined) {
    const taskId = getViewedAgentTaskId(sessionId)
    if (!taskId) return null
    return getTeamContext(sessionId)?.teammates[taskId] || null
  }

  function getIsViewingTeammate(sessionId: string | null | undefined): boolean {
    return !!getViewedAgentTaskId(sessionId)
  }

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

  // 节流持久化
  let _saveScheduled = false
  let _saveTrailing = false
  let _lastSaveAt = 0
  // 流式响应期间（text_delta/thinking_delta）会频繁调用 saveToStorage，
  // 每次 saveSessionsToStorage 都会同步遍历所有会话+消息、JSON.stringify、
  // 压缩并 localStorage.setItem（同步阻塞主线程）。
  // 600ms 节流在长会话中仍会导致明显卡顿，提升到 2000ms 可将写入频率降低 3 倍。
  const SAVE_INTERVAL_MS = 2000

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

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushSaveNow)
  }

  function saveProjects() {
    saveProjectsToStorage(projects.value)
  }

  // 注意：不使用 deep watch 监听 sessions 变化来触发持久化。
  // deep watch 会在每次响应式变化时深度遍历整个 sessions 树（所有会话的所有消息的所有属性），
  // 在流式响应期间（每秒数十次 delta），这会导致 O(n×m) 的遍历开销，严重卡死 UI。
  // 所有修改 sessions 的方法（addMessage、updateMessage、handleResult 等）都已显式调用 saveToStorage，
  // 因此这个 deep watch 是冗余的，移除它可消除流式期间最大的性能瓶颈。

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
      lastActivityAt: Date.now(),
      mode: appStore.mode
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

  async function initClaudeCodeSession(
    sessionId: string,
    overrides?: { systemPrompt?: string; agent?: string; cwd?: string }
  ): Promise<void> {
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
        const resumeId = (status.engineSessionId as string) || session.engineSessionId
        try {
          await claudeCode.stop(sessionId)
        } catch (e) {
          logger.warn('ChatStore', `initClaudeCodeSession: stop failed before engine switch | id=${sessionId.slice(0, 8)}`, { error: String(e) })
        }
        session._resumeSessionId = resumeId || undefined
      } else {
        logger.info('ChatStore', `initClaudeCodeSession: session already running | id=${sessionId.slice(0, 8)}`)
        // 已在运行的会话：若后端模式与用户偏好不一致，则下发用户偏好
        // 需要获取 controlStore 的 currentPermissionMode，通过延迟导入避免循环依赖
        const { useChatControlStore } = await import('./chatControl')
        const controlStore = useChatControlStore()
        if (status?.permissionMode && status.permissionMode !== controlStore.currentPermissionMode) {
          try {
            await claudeCode.setPermissionMode?.(sessionId, controlStore.currentPermissionMode)
          } catch (e) {
            logger.warn('ChatStore', `initClaudeCodeSession: failed to apply preferred mode | id=${sessionId.slice(0, 8)}`, { error: String(e) })
          }
        }
        return
      }
    }

    try {
      const config = settingsStore.config
      const cwd = overrides?.cwd || session.workingDirectory || currentProjectRoot.value || await api.getCwd() || '/'

      session.processStatus = 'starting'
      saveToStorage()

      // 延迟导入获取 currentPermissionMode
      const { useChatControlStore } = await import('./chatControl')
      const controlStore = useChatControlStore()

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
        permissionMode: controlStore.currentPermissionMode,
        agent: overrides?.agent || currentAgent.value || undefined,
        thinkingEnabled: settingsStore.thinkingEnabled,
        engineType: desiredEngine,
        engineSource: settingsStore.engineSource,
        installedCliPath: settingsStore.installedCliPath ?? undefined,
        resumeSessionId: session._resumeSessionId,
        systemPrompt: overrides?.systemPrompt,
        // 展开为普通对象，避免 Vue 响应式 Proxy 无法通过 Electron IPC 结构化克隆
        modelContextWindows: { ...settingsStore.modelContextWindows },
      })

      delete session._resumeSessionId

      session.engineType = desiredEngine
      // CLI 进程启动成功后会话处于等待输入状态，标记为 idle 而非 starting，
      // 避免新创建的助手会话在用户尚未发送消息时一直显示转圈。
      session.processStatus = 'idle'
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

  function recordTeammateMessage(raw: any, targetSessionId: string): Message | null {
    if (!isTeammateRawMessage(raw)) return null
    const session = sessions.value.find(s => s.id === targetSessionId)
    if (!session) return null

    const teammateId = resolveTeammateId(targetSessionId, raw)
    const teamName = getRawTeamName(raw)
    const status = inferTeammateStatus(raw)
    const text = stringifyRawContent(raw)
    ensureTeamContext(session, teamName)

    const existing = session.teamContext!.teammates[teammateId]
    const name = existing?.name || getRawTeammateName(raw)
    const color = existing?.color || AGENT_COLORS[Object.keys(session.teamContext!.teammates).length % AGENT_COLORS.length]
    const transcript = session.teammateTranscripts![teammateId] || []
    const messageId = raw?.uuid || raw?.message?.id || raw?.id || crypto.randomUUID()
    const message: Message = {
      id: String(messageId),
      role: (raw?.role === 'user' || raw?.type === 'user' || raw?.message?.role === 'user') ? 'user' : 'assistant',
      content: text,
      timestamp: raw?.timestamp ? Date.parse(raw.timestamp) || Date.now() : Date.now(),
      metadata: {
        agentTaskId: teammateId,
        agentName: name,
        teamName,
        status,
      }
    }

    if (isFileBackedTeammate(targetSessionId, teammateId)) {
      session.teamContext!.teammates[teammateId] = {
        name,
        agentType: existing?.agentType || raw?.agentType || raw?.subagent_type,
        status,
        color,
        messageCount: session.teammateTranscripts![teammateId]?.length || transcript.length,
      }
      rekickAgentTranscriptPoll(session, targetSessionId, teammateId)
      session.updatedAt = Date.now()
      session.lastActivityAt = Date.now()
      saveToStorage()
      return null
    }

    if (text.trim()) {
      const idx = transcript.findIndex(m => m.id === message.id)
      if (idx >= 0) {
        const next = [...transcript]
        next[idx] = { ...next[idx], content: text, metadata: { ...next[idx].metadata, status } }
        session.teammateTranscripts![teammateId] = next
      } else {
        session.teammateTranscripts![teammateId] = [...transcript, message]
      }
    }

    session.teamContext!.teammates[teammateId] = {
      name,
      agentType: existing?.agentType || raw?.agentType || raw?.subagent_type,
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

  /**
   * 记录子智能体（Agent tool）的 sidechain 消息到转录存储。
   * 与 recordTeammateMessage 的关键区别：
   *   - 不创建 teamContext（子智能体不属于 agent team）
   *   - 不向 session.messages 推送系统通知（不干扰主时间线）
   *   - 仍写入 teammateTranscripts 供 AgentToolCard 读取
   */
  function recordSubagentMessage(raw: any, targetSessionId: string): Message | null {
    const session = sessions.value.find(s => s.id === targetSessionId)
    if (!session) return null

    // ★ 桥接 parent_tool_use_id 不匹配问题
    // 引擎的 sync Agent tool 进度消息使用 `agent_<assistant_message_id>` 作为
    // parent_tool_use_id，而非 Agent 工具的 tool_use ID。这导致 resolveTeammateId
    // 无法通过映射找到正确的 teammateId，消息被存储在不同的键下，
    // AgentToolCard 读取不到流式输出。
    // 此处检测未注册的 parent_tool_use_id，尝试匹配当前运行的 Agent/Task 工具调用，
    // 注册映射使后续消息（及 AgentToolCard）能归并到同一 teammateId。
    const parentId = raw?.parent_tool_use_id || raw?.parentToolUseId
    if (parentId && !teammateIdForParentToolUse(targetSessionId, parentId)) {
      for (const msg of session.messages) {
        if (!msg.toolCalls) continue
        for (const tc of msg.toolCalls) {
          if ((tc.name === 'Agent' || tc.name === 'Task') &&
              (tc.status === 'running' || tc.status === 'pending')) {
            const registeredId = teammateIdForParentToolUse(targetSessionId, tc.id)
            if (registeredId) {
              registerTeammateForToolUse(targetSessionId, parentId, registeredId)
            }
          }
        }
      }
    }

    const subagentId = resolveTeammateId(targetSessionId, raw)
    const name = getRawTeammateName(raw)
    const status = inferTeammateStatus(raw)
    const text = stringifyRawContent(raw)
    ensureSubagentTranscripts(session)

    const transcript = session.teammateTranscripts![subagentId] || []
    const messageId = raw?.uuid || raw?.message?.id || raw?.id || crypto.randomUUID()
    const message: Message = {
      id: String(messageId),
      role: (raw?.role === 'user' || raw?.type === 'user' || raw?.message?.role === 'user') ? 'user' : 'assistant',
      content: text,
      timestamp: raw?.timestamp ? Date.parse(raw.timestamp) || Date.now() : Date.now(),
      metadata: {
        agentTaskId: subagentId,
        agentName: name,
        teamName: 'Agent Team',
        status,
      }
    }

    if (isFileBackedTeammate(targetSessionId, subagentId)) {
      let changed = false
      if (status === 'completed' || status === 'failed') {
        changed = applySubagentTerminalStatus(session, subagentId, status, text)
      }
      rekickAgentTranscriptPoll(session, targetSessionId, subagentId)
      session.updatedAt = Date.now()
      session.lastActivityAt = Date.now()
      if (changed) saveToStorage()
      return null
    }

    if (text.trim()) {
      const idx = transcript.findIndex(m => m.id === message.id)
      if (idx >= 0) {
        const next = [...transcript]
        next[idx] = { ...next[idx], content: text, metadata: { ...next[idx].metadata, status } }
        session.teammateTranscripts![subagentId] = next
      } else {
        session.teammateTranscripts![subagentId] = [...transcript, message]
      }
    }

    if (status === 'completed' || status === 'failed') {
      applySubagentTerminalStatus(session, subagentId, status, text)
    }

    session.updatedAt = Date.now()
    session.lastActivityAt = Date.now()
    return message
  }

  function applySubagentTerminalStatus(
    session: Session,
    subagentId: string,
    status: TeammateStatus,
    text?: string
  ): boolean {
    let updated = false
    for (const msg of session.messages) {
      const toolCalls = msg.toolCalls
      if (!toolCalls) continue
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]
        if ((tc.name === 'Agent' || tc.name === 'Task') &&
            tc.status === 'running') {
          const mappedTeammateId = teammateIdForParentToolUse(session.id, tc.id)
          const outputAgentId = (tc.output || '').match(/agentId:\s*([^\s]+)/)?.[1]
          if (mappedTeammateId === subagentId ||
              normalizeTeammateId(tc.id) === subagentId ||
              (!!outputAgentId && normalizeTeammateId(outputAgentId) === subagentId)) {
            const updatedToolCalls: ToolCall[] = [...toolCalls]
            updatedToolCalls[i] = {
              ...tc,
              status: status === 'failed' ? 'error' : 'completed',
              endTime: Date.now(),
              ...(text?.trim() ? { output: text.slice(0, 30000) } : {})
            }
            msg.toolCalls = updatedToolCalls
            recordAgentToolCall(session, updatedToolCalls[i], status)
            updated = true
            break
          }
        }
      }
    }

    const transcript = session.teammateTranscripts?.[subagentId]
    if (transcript?.length) {
      session.teammateTranscripts![subagentId] = transcript.map(m => ({
        ...m,
        metadata: { ...m.metadata, status }
      }))
      updated = true
    }

    if (session.teamContext?.teammates[subagentId]) {
      session.teamContext.teammates[subagentId].status = status
      updated = true
    }

    return updated
  }

  function handleTaskNotification(raw: any, targetSessionId: string): void {
    if (!raw || raw.subtype !== 'task_notification') return
    const normalized = taskNotificationStatus(raw.status)
    if (!normalized) return
    const session = sessions.value.find(s => s.id === targetSessionId)
    if (!session) return

    const taskId = typeof raw.task_id === 'string' ? raw.task_id : ''
    const toolUseId = typeof raw.tool_use_id === 'string' ? raw.tool_use_id : ''
    const outputFile = typeof raw.output_file === 'string' ? raw.output_file : ''
    const summary = typeof raw.summary === 'string' ? raw.summary : ''
    const finalText = [summary, outputFile ? `output_file: ${outputFile}` : ''].filter(Boolean).join('\n')
    let changed = false

    for (const msg of session.messages) {
      const toolCalls = msg.toolCalls
      if (!toolCalls) continue
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]
        if (tc.name !== 'Agent' && tc.name !== 'Task') continue
        const outputAgentId = typeof tc.output === 'string'
          ? tc.output.match(/agentId:\s*([^\s]+)/)?.[1]
          : undefined
        const matches = (!!toolUseId && tc.id === toolUseId) ||
          (!!taskId && !!outputAgentId && normalizeTeammateId(taskId) === normalizeTeammateId(outputAgentId)) ||
          (!!taskId && normalizeTeammateId(taskId) === normalizeTeammateId(tc.id))
        if (!matches) continue

        const nextOutput = finalText
          ? `${tc.output || ''}${tc.output ? '\n\n' : ''}${finalText}`.slice(0, 30000)
          : tc.output
        const updatedToolCalls: ToolCall[] = [...toolCalls]
        updatedToolCalls[i] = {
          ...tc,
          status: normalized.toolStatus,
          output: nextOutput,
          endTime: Date.now(),
        }
        msg.toolCalls = updatedToolCalls
        recordAgentToolCall(session, updatedToolCalls[i], normalized.teammateStatus)
        changed = true

        const mappedTeammateId = teammateIdForParentToolUse(targetSessionId, tc.id)
        const subagentId = mappedTeammateId ||
          (taskId ? normalizeTeammateId(taskId) : normalizeTeammateId(tc.id))
        applySubagentTerminalStatus(session, subagentId, normalized.teammateStatus, finalText)
      }
    }

    if (!changed && taskId) {
      changed = applySubagentTerminalStatus(session, normalizeTeammateId(taskId), normalized.teammateStatus, finalText)
    }

    if (changed) {
      session.updatedAt = Date.now()
      session.lastActivityAt = Date.now()
      saveToStorage()
    }
  }

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

      // 限制单会话内存中的消息数量，防止长时间运行任务导致消息无限堆积 → OOM
      // 从头部移除最旧的消息（保留最近的消息，确保 retryLastMessage 能找到最后一条用户消息）
      if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
        const removeCount = session.messages.length - MAX_MESSAGES_PER_SESSION
        session.messages.splice(0, removeCount)
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

  function updateMessage(messageId: string, updates: Partial<Message>, targetSessionId?: string) {
    const sid = targetSessionId || currentSessionId.value
    const session = sessions.value.find(s => s.id === sid)
    if (session) {
      const msg = session.messages.find(m => m.id === messageId)
      if (msg) {
        // 直接修改属性，不创建新数组。
        // 流式期间每个 text_delta 都会调用 updateMessage，
        // 使用 spread + slice 创建新数组会导致 O(n) 复制 + 触发下游所有 computed 重建。
        // Vue 3 的 reactive 代理会正确追踪属性修改，下游组件通过属性访问建立响应式依赖。
        Object.assign(msg, updates)
        saveToStorage()
      }
    }
  }

  function updateToolCall(messageId: string, toolCallId: string, status: ToolCall['status']) {
    const sid = currentSessionId.value
    const session = sessions.value.find(s => s.id === sid)
    if (!session) return

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
    currentSessionId.value = sessionId

    const session = sessions.value.find(s => s.id === sessionId)
    if (session?.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }

    clearTurnCheckpoints()

    const claudeCode = api.claudeCode
    if (claudeCode) {
      try {
        const statusPromise = claudeCode.getSessionStatus(sessionId)
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 2000)
        )
        const status = await Promise.race([statusPromise, timeoutPromise]).catch(() => null)

        if (status?.isRunning && status.permissionMode) {
          const { useChatControlStore } = await import('./chatControl')
          const controlStore = useChatControlStore()
          if (status.permissionMode !== controlStore.currentPermissionMode) {
            try {
              await claudeCode.setPermissionMode?.(sessionId, controlStore.currentPermissionMode)
            } catch (e) {
              logger.warn('ChatStore', `selectSession: failed to apply preferred mode | id=${sessionId.slice(0, 8)}`, { error: String(e) })
            }
          }
        }
      } catch {
        // 忽略：保留用户偏好不变
      }
    }

    void loadTurnCheckpoints(sessionId, undefined, true)
  }

  async function activateSession(sessionId: string): Promise<void> {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return

    currentSessionId.value = sessionId
    if (session.workingDirectory) {
      currentProjectRoot.value = session.workingDirectory
    }

    clearTurnCheckpoints()

    if (session.processStatus === 'suspended') {
      const claudeCode = api.claudeCode
      if (claudeCode) {
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
          const status = await claudeCode.getSessionStatus(sessionId)
          if (status?.permissionMode) {
            const { useChatControlStore } = await import('./chatControl')
            const controlStore = useChatControlStore()
            if (status.permissionMode !== controlStore.currentPermissionMode) {
              try {
                await claudeCode.setPermissionMode?.(sessionId, controlStore.currentPermissionMode)
              } catch (e) {
                logger.warn('ChatStore', `activateSession: failed to apply preferred mode | id=${sessionId.slice(0, 8)}`, { error: String(e) })
              }
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
      clearSessionToolUseMappings(sessionId)
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

        if (mode === 'both' && codeError) {
          logger.warn('ChatStore', 'Skipping conversation rewind due to code rewind failure', { error: codeError })
        }
      }

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

    if (codeError && conversationError) {
      rewindState.value.error = `Code: ${codeError}\nConversation: ${conversationError}`
    } else if (codeError) {
      rewindState.value.error = codeError
    } else if (conversationError) {
      rewindState.value.error = conversationError
    }

    rewindState.value.isRewinding = false

    if (codeError || conversationError) {
      throw new Error(rewindState.value.error || 'Rewind failed')
    }
  }

  async function summarizeTurn(
    _sessionId: string,
    _targetUserMessageId: string,
    _feedback: string
  ): Promise<void> {
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
      availableAgents.value = await claudeCode.listAgents(cwd) as typeof availableAgents.value
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

  async function startWorkAssistantSession(assistant: {
    name: string
    skills?: string[]
    permission?: string
    skillRuntime?: 'officecli' | 'node' | 'none'
    skillsRequired?: boolean
  }): Promise<Session> {
    const cwd = appStore.workWorkspace || appStore.projectRoot || undefined

    // Phase 4: 技能可用性校验 + 降级回退
    let effectiveSkills = assistant.skills ? [...assistant.skills] : undefined
    if (assistant.skillRuntime === 'officecli' && effectiveSkills?.length) {
      let officeCliAvailable = false
      try {
        officeCliAvailable = await api.officecli.checkInstalled()
      } catch { /* ignore */ }

      if (!officeCliAvailable) {
        // 降级：officecli-* / morph-* → Node 等价技能
        const fallbackMap: Record<string, string> = {
          // 基础技能
          'officecli-pptx': 'pptx',
          'officecli-docx': 'docx',
          'officecli-xlsx': 'xlsx',
          // 场景层技能 → 对应的 Node 基础技能
          'officecli-academic-paper': 'docx',
          'officecli-data-dashboard': 'xlsx',
          'officecli-financial-model': 'xlsx',
          'officecli-pitch-deck': 'pptx',
          'officecli-word-form': 'docx',
          'morph-ppt': 'pptx',
          'morph-ppt-3d': 'pptx',
        }
        effectiveSkills = effectiveSkills.map(s => fallbackMap[s] || s)
        console.warn(`[ChatStore] OfficeCLI not available, falling back to Node skills for "${assistant.name}"`)
      }
    }

    try {
      await api.agents.install(assistant.name, 'global', cwd)
    } catch { /* already installed or unavailable */ }

    if (api.skills && cwd) {
      for (const skill of effectiveSkills || []) {
        try {
          await api.skills.installLocal(skill, 'project', cwd)
        } catch { /* already installed or unavailable */ }
      }
    }

    currentAgent.value = assistant.name
    if (assistant.permission) {
      const { useChatControlStore } = await import('./chatControl')
      const controlStore = useChatControlStore()
      controlStore.setPermissionMode(assistant.permission as any)
    }

    const session = createSession(assistant.name, cwd)
    session.assistantId = assistant.name
    saveToStorage()

    // 不在此处立即展开 Artifacts 面板：用户尚未发送消息、LLM 尚未生成产物。
    // 改为在 ChatPanel.handleSend 中，用户首次发送消息时再展开。
    await initClaudeCodeSession(session.id)
    return session
  }

  /**
   * 在当前空会话上切换 Work 助手（不新建会话）。
   * 用于输入框上方常用助手快捷选择场景：
   * 当前会话是空的 work 会话且未选助手时，直接绑定助手到当前会话。
   */
  async function switchWorkAssistant(assistant: {
    name: string
    skills?: string[]
    permission?: string
    skillRuntime?: 'officecli' | 'node' | 'none'
    skillsRequired?: boolean
  }): Promise<void> {
    const session = currentSession.value
    if (!session) return

    const cwd = appStore.workWorkspace || appStore.projectRoot || undefined

    // 技能可用性校验 + 降级回退（与 startWorkAssistantSession 一致）
    let effectiveSkills = assistant.skills ? [...assistant.skills] : undefined
    if (assistant.skillRuntime === 'officecli' && effectiveSkills?.length) {
      let officeCliAvailable = false
      try {
        officeCliAvailable = await api.officecli.checkInstalled()
      } catch { /* ignore */ }

      if (!officeCliAvailable) {
        const fallbackMap: Record<string, string> = {
          'officecli-pptx': 'pptx',
          'officecli-docx': 'docx',
          'officecli-xlsx': 'xlsx',
          'officecli-academic-paper': 'docx',
          'officecli-data-dashboard': 'xlsx',
          'officecli-financial-model': 'xlsx',
          'officecli-pitch-deck': 'pptx',
          'officecli-word-form': 'docx',
          'morph-ppt': 'pptx',
          'morph-ppt-3d': 'pptx',
        }
        effectiveSkills = effectiveSkills.map(s => fallbackMap[s] || s)
        console.warn(`[ChatStore] OfficeCLI not available, falling back to Node skills for "${assistant.name}"`)
      }
    }

    try {
      await api.agents.install(assistant.name, 'global', cwd)
    } catch { /* already installed or unavailable */ }

    if (api.skills && cwd) {
      for (const skill of effectiveSkills || []) {
        try {
          await api.skills.installLocal(skill, 'project', cwd)
        } catch { /* already installed or unavailable */ }
      }
    }

    currentAgent.value = assistant.name
    if (assistant.permission) {
      const { useChatControlStore } = await import('./chatControl')
      const controlStore = useChatControlStore()
      controlStore.setPermissionMode(assistant.permission as any)
    }

    // 绑定助手到当前会话
    session.assistantId = assistant.name
    session.title = assistant.name
    saveToStorage()

    // 如果已有 CLI 进程在运行，需要停止后用新 agent 重新初始化
    const claudeCode = api.claudeCode
    if (claudeCode) {
      try {
        const status = await claudeCode.getSessionStatus(session.id)
        if (status?.isRunning) {
          await claudeCode.stop(session.id)
        }
      } catch { /* ignore */ }
      await initClaudeCodeSession(session.id)
    }
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
    currentSession,
    currentMessages,
    displayMessages,
    currentTeamContext,
    currentViewedAgentTaskId,
    viewedTeammate,
    isViewingTeammate,
    workingDirectory,
    // By-id selectors（分屏多 pane 用）
    getSession,
    getSessionMessages,
    getDisplayMessages,
    getWorkingDirectory,
    getTeamContext,
    getViewedAgentTaskId,
    getViewedTeammate,
    getIsViewingTeammate,
    projects,
    allProjects,
    currentProjectRoot,
    currentAgent,
    availableAgents,
    createSession,
    initClaudeCodeSession,
    addMessage,
    updateMessage,
    updateToolCall,
    viewTeammateTranscript,
    backToLeaderView,
    recordTeammateMessage,
    recordSubagentMessage,
    handleTaskNotification,
    selectSession,
    activateSession,
    deactivateSession,
    deleteSession,
    getCurrentConfig,
    saveToStorage,
    flushSaveNow,
    addProject,
    removeProject,
    switchProject,
    loadAgents,
    switchAgent,
    switchModel,
    startWorkAssistantSession,
    switchWorkAssistant,
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
    // 会话加载状态
    sessionLoadingStates: readonly(sessionLoadingStates),
    isSessionLoading,
    setSessionLoading,
    // Diff 面板触发
    diffPanelTrigger: readonly(diffPanelTrigger),
    triggerDiffPanel,
    // Prompt Stash
    sessionStash: readonly(sessionStash),
    stashPrompt,
    getStash,
    clearStash,
    hasStash,
    // Expose for sub-stores
    logger,
    traceEvent,
    updateTaskStateFromToolResult,
  }
})
