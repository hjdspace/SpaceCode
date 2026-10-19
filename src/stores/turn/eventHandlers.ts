// src/stores/turn/eventHandlers.ts
// Turn 事件处理深模块 — 9 个 handle* 函数 + remoteUserContent 辅助。
// 从 index.ts 抽出。通过工厂函数注入所有依赖，handlers 之间可直接互相调用。

import type { Ref } from 'vue'
import type { SessionSink } from '../turnSink'
import type { TurnState } from './types'
import {
  FILE_TOOLS,
  COMMAND_TOOLS,
  VERIFICATION_PATTERNS,
  MAX_INMEMORY_TOOL_OUTPUT,
} from './types'
import type { TurnStateMachine } from './turnStateMachine'
import type { TimelineAssembler } from './timelineAssembler'
import { createUuid } from '@/utils/uuid'
import { TRACE_DURATION_KEY } from '@/lib/trace/duration'
import { needsWorkspaceRootScan } from '@/utils/artifactScope'
import { isAutoPreviewPath } from '@/utils/artifactFormat'
import { normalizeAbsolutePath } from '@/utils/normalizePath'
import type { UseAutoRetryReturn } from '@/composables/useAutoRetry'
import { extractErrorCode } from '@/composables/useAutoRetry'
import { errorHandler as defaultErrorHandler } from '@/services/errorHandler'
import { ErrorCategory, type ToolCall } from '@/types'
import {
  recordAgentToolCall,
  isAgentLaunchResult,
} from '@/services/teamTranscriptService'
import { playTaskCompleteSound } from '@/utils/notificationSound'
import { api } from '@/services/electronAPI'
import { i18n } from '@/i18n'

// ── 收窄的依赖接口（接口隔离：handler 只看到它需要的子集）──

interface Logger {
  debug: (scope: string, message: string, data?: any) => void
  info: (scope: string, message: string, data?: any) => void
  warn: (scope: string, message: string, data?: any) => void
  error: (scope: string, message: string, data?: any) => void
}

interface TraceEventFn {
  (event: {
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
  }): void
}

interface ClaudeCodeApi {
  abort: (sessionId: string) => void
}

interface ArtifactsApi {
  list: (workingDir: string, options?: { scanWorkspaceRoot?: boolean }) => Promise<{ artifacts: any[] }>
}

/** Synthetic assistant records emitted by the engine for retryable API errors. */
export function isSyntheticApiErrorAssistant(assistant: any): boolean {
  if (assistant?.isApiErrorMessage === true) return true
  const content = assistant?.message?.content
  if (typeof content === 'string') return /^\s*API Error:/i.test(content)
  return Array.isArray(content) && content.length > 0 && content.every((block: any) =>
    block?.type === 'text' && typeof block.text === 'string' && /^\s*API Error:/i.test(block.text),
  )
}

export interface EventReducerOptions {
  sink: SessionSink
  stateMachine: TurnStateMachine
  timeline: TimelineAssembler
  streamingContents: Ref<Map<string, string>>
  loadingSessions: Ref<Map<string, boolean>>
  pendingSendMessages: Set<string>
  userAbortedSessions: Set<string>
  logger: Logger
  traceEvent: TraceEventFn
  selectSession: (sessionId: string) => void
  getCurrentSessionId: () => string | undefined
  updateTaskStateFromToolResult: (toolCalls: ToolCall[], resultToolUseId: string, resultOutput: string) => void
  loadTurnCheckpoints: (sessionId: string, projectPathOverride?: string, force?: boolean) => void
  getModel: () => string | undefined
  getProvider: () => string | undefined
  getBaseUrl: () => string | undefined
  autoRetry: UseAutoRetryReturn
  initiateAutoRetry: (
    sessionId: string,
    ts: TurnState,
    errorCategory: ErrorCategory,
    errorTitle: string,
    errorMessage: string,
    retryDelayHint?: number,
    errorCode?: string,
  ) => Promise<void>
  contextUsage: {
    applyFallback: (sessionId: string) => void
    refresh: (sessionId: string) => void
  }
  errorHandler: typeof defaultErrorHandler
  getClaudeCode: () => ClaudeCodeApi | null
  getArtifactsApi: () => ArtifactsApi | null
  /**
   * 仓库根的取值口径 —— 会话工作目录可能是子目录，而 git 侧的所有路径口径
   * （scm.fileStats / getFullDiff）都以项目根为准。回合窗口扫描必须用同一个基准，
   * 否则同一文件会出现两份路径。
   */
  getProjectRoot: () => string | null
  /**
   * 写文件工具落盘后记账，供会话改动的展示层分辨"被其他会话覆盖过"。
   * 与 getProjectRoot 一样走注入：turn store 不直接依赖面板态 store。
   */
  fileWriteLedger: {
    recordToolWrite: (args: {
      projectRoot: string | null
      sessionId: string
      toolName: string
      input: Record<string, any> | undefined
      workingDirectory?: string
    }) => void
  }
  /**
   * 把新生成的交付物送进右侧预览（办公文档走 officecli，HTML 走内置浏览器）。
   * 由调用方注入，因为这住在 turn store 里，而面板状态归 appStore。
   */
  openArtifactPreview?: (filePath: string) => void
  /** Returns true if task-complete notification sound is enabled. */
  isSoundOnTaskComplete: () => boolean
  /** Returns true if desktop system notification on task-complete is enabled. */
  isDesktopNotifyOnTaskComplete: () => boolean
  /** Returns the display title of a session (used in desktop notifications). */
  getSessionTitle: (sessionId: string) => string
  /**
   * Turn 成功结算后的回调（endTurn 之后触发）。
   * 用于 goal 续跑等跨 turn 编排 — 传入本轮最终输出文本。
   */
  onTurnCompleted?: (sessionId: string, finalText: string) => void
  /**
   * Turn 结局订阅点 — 区分 settled / failed / aborted 三种结局。
   * 编排引擎订阅此信号作为节点完成信号源。
   */
  onTurnOutcome?: (sessionId: string, outcome: 'settled' | 'failed' | 'aborted') => void
}

export interface EventReducer {
  handleRemoteUserMessage: (sessionId: string, data: any) => void
  handleStreamEvent: (sessionId: string, ts: TurnState, streamEvent: any) => void
  handleAssistant: (sessionId: string, ts: TurnState, assistant: any) => void
  handleToolUse: (sessionId: string, ts: TurnState, toolUse: any) => void
  handleToolResult: (sessionId: string, ts: TurnState, toolResult: any) => void
  handleUser: (sessionId: string, ts: TurnState, userMsg: any) => void
  handleResult: (sessionId: string, ts: TurnState, result: any) => void
  handleError: (sessionId: string, ts: TurnState, error: any) => void
  handleExit: (sessionId: string, ts: TurnState, data: number | null | { code?: number | null; signal?: string | null; stderr?: string }) => void
}

function remoteUserContent(data: any): string {
  if (typeof data?.content === 'string') return data.content
  const blocks = data?.message?.content
  if (Array.isArray(blocks)) {
    return blocks
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('')
  }
  return ''
}

/**
 * 解码部分 JSON 字符串值（值可能尚未传输完毕）。
 * 优先直接 JSON.parse；仅当值末尾挂着不完整的转义序列（落单的反斜杠、
 * 未满 4 位的 \uXX）导致解析失败时，剪掉后重试。
 * Write 工具的代码以 \n 等转义形式传输，必须完整反转义才能按行流式渲染。
 */
function decodePartialJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    let s = raw
    let end = s.length
    while (end > 0 && s[end - 1] === '\\') end--
    if ((s.length - end) % 2 === 1) {
      s = s.slice(0, -1)
    } else {
      s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '')
    }
    try {
      return JSON.parse(`"${s}"`)
    } catch {
      return s
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
    }
  }
}

/**
 * 从部分 JSON 字符串中尝试提取关键工具输入字段（file_path / path / command / query / pattern / url / content），
 * 让 UI 能在 LLM 流式生成工具参数时就显示工具目标与流式代码块。
 * 支持两种匹配模式：
 * 1. 完整字符串值（引号已闭合）：`"file_path": "/path/to/file.html"`
 * 2. 部分字符串值（引号尚未闭合）：`"file_path": "/path/to/file.ht`
 */
function tryExtractEarlyInput(partialJson: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  let found = false

  // content 为 Write/FileWrite 的代码本体，纳入早期提取驱动逐行流式渲染
  const fields = ['file_path', 'path', 'command', 'query', 'pattern', 'url', 'content']
  for (const field of fields) {
    // 先尝试匹配引号闭合的完整值
    const closedRegex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
    const closedMatch = partialJson.match(closedRegex)
    if (closedMatch) {
      result[field] = decodePartialJsonString(closedMatch[1])
      found = true
      continue
    }

    // 再尝试匹配引号尚未闭合的部分值（值正在流式传输中）。
    // 末尾可选的裸反斜杠容纳「转义序列只传了一半」的瞬间（如 "abc\ ），
    // 由 decodePartialJsonString 剪掉后解码。
    const partialRegex = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*\\\\?)$`)
    const partialMatch = partialJson.match(partialRegex)
    if (partialMatch) {
      result[field] = decodePartialJsonString(partialMatch[1])
      found = true
    }
  }

  return found ? result : null
}

/**
 * 从工具输入里提取值得自动预览的交付物绝对路径（无则 null）。
 *
 * Write/Edit 看 file_path / path；Bash 解析 officecli 命令的目标文档
 * （`officecli <verb> <file>`，路径允许带引号）。相对路径按会话工作目录补全。
 * 只有命中 isAutoPreviewPath（office 四件套 + html）的路径才算交付物。
 */
const OFFICE_CMD_TARGET_RE =
  /officecli(?:\.exe)?\s+[a-z-]+\s+"?([^"\n]+?\.(?:xlsx|docx|pptx|pdf|html?))"?/i

export function extractAutoPreviewTarget(
  toolName: string,
  input: any,
  workingDir?: string
): string | null {
  if (!input) return null
  let raw: string | undefined
  if (FILE_TOOLS.has(toolName)) {
    raw = typeof input.file_path === 'string' ? input.file_path : undefined
    if (!raw && typeof input.path === 'string') raw = input.path
  } else if (COMMAND_TOOLS.has(toolName) && typeof input.command === 'string') {
    raw = input.command.match(OFFICE_CMD_TARGET_RE)?.[1]
  }
  if (!raw) return null

  const target = raw.trim().replace(/^["']|["']$/g, '')
  if (!target || !isAutoPreviewPath(target)) return null

  const isAbsolute = /^[a-zA-Z]:[/\\]/.test(target) || target.startsWith('\\\\') || target.startsWith('/')
  const fullPath = isAbsolute ? target : workingDir ? `${workingDir}/${target}` : null
  if (!fullPath) return null
  return normalizeAbsolutePath(fullPath)
}

export function createEventHandlers(opts: EventReducerOptions): EventReducer {
  const {
    sink,
    stateMachine,
    timeline,
    streamingContents,
    loadingSessions,
    pendingSendMessages,
    userAbortedSessions,
    logger,
    traceEvent,
    selectSession,
    getCurrentSessionId,
    updateTaskStateFromToolResult,
    loadTurnCheckpoints,
    getModel,
    getProvider,
    getBaseUrl,
    autoRetry,
    initiateAutoRetry,
    contextUsage,
    errorHandler,
    getClaudeCode,
    getArtifactsApi,
    getProjectRoot,
    fileWriteLedger,
    openArtifactPreview,
    isSoundOnTaskComplete,
    isDesktopNotifyOnTaskComplete,
    getSessionTitle,
    onTurnCompleted,
    onTurnOutcome,
  } = opts

  const { turnStates, beginTurn, endTurn } = stateMachine
  /** 已经自动预览过的交付物，避免每轮结束都把同一个文件重新弹一次。 */
  const autoPreviewedPaths = new Set<string>()

  /**
   * 写文件工具成功落盘后记入账本。路径口径与会话改动列表必须一致，所以复用
   * store 里的解析（含工作目录补全与仓库相对化）。
   */
  const recordWriteToLedger = (sessionId: string, toolName: string, input: Record<string, any> | undefined) => {
    if (!FILE_TOOLS.has(toolName)) return
    fileWriteLedger.recordToolWrite({
      projectRoot: getProjectRoot(),
      sessionId,
      toolName,
      input,
      workingDirectory: sink.get(sessionId)?.workingDirectory,
    })
  }

  /**
   * 工具成功完成后，若产出值得预览的交付物，立即送右侧预览 —— 不等 turn 结束。
   * officecli 技能没有输出目录约定，且 watch 模式能读到 officecli resident 的
   * 内存态，创建即打开的时机比 turn 结束的产物扫描更贴近"实时预览"。
   * design 模式有自己的预览区，不抢。
   */
  function maybeAutoPreviewArtifact(sessionId: string, toolName: string, toolInput: any): void {
    const s = sink.get(sessionId)
    if (!s || s.mode === 'design' || !openArtifactPreview) return
    const target = extractAutoPreviewTarget(toolName, toolInput, s.workingDirectory)
    if (!target || autoPreviewedPaths.has(target)) return
    autoPreviewedPaths.add(target)
    openArtifactPreview(target)
  }
  const {
    getAssistantMessage,
    addTimelineEvent,
    updateTimelineEvent,
    ensureTextTimelineEvent,
    completeCurrentTextEvent,
    completeCurrentReasoningEvent,
    addToolTimelineEvent,
  } = timeline

  // 桌面通知去重：记录每个 session 最近一次通知的时间戳，
  // 防止同一 turn 周期内因幽灵 turn 或残留事件触发多次通知。
  const notifiedSessions = new Map<string, number>()
  const NOTIFICATION_DEBOUNCE_MS = 5_000

  // Renderer IPC can continue delivering text deltas while the window is hidden.
  // Coalesce message writes so a burst accumulated during background throttling
  // does not turn into one reactive update per delta when the window is restored.
  const pendingContentPatches = new Map<string, { timer: ReturnType<typeof setTimeout>; turn: TurnState }>()
  const CONTENT_PATCH_INTERVAL_MS = 50

  function flushContentPatch(sessionId: string, ts: TurnState): void {
    const pending = pendingContentPatches.get(sessionId)
    if (pending) clearTimeout(pending.timer)
    pendingContentPatches.delete(sessionId)

    const message = getAssistantMessage(sessionId, ts)
    if (!message) return

    const textEvent = ts.currentTextEventId
      ? message.timelineEvents?.find(event => event.id === ts.currentTextEventId)
      : undefined
    // 时间线 text 事件只承载当前块的内容：accumulatedContent 是整轮全文
    // （跨工具调用的所有 text 块拼接），写入会把工具调用前的文本在
    // 工具后的 text 事件里重复渲染一遍。
    if (textEvent && textEvent.content !== ts.currentTextContent) {
      textEvent.content = ts.currentTextContent
    }
    const reasoningEvent = ts.currentReasoningEventId
      ? message.timelineEvents?.find(event => event.id === ts.currentReasoningEventId)
      : undefined
    if (reasoningEvent && reasoningEvent.content !== ts.currentReasoningContent) {
      reasoningEvent.content = ts.currentReasoningContent
    }

    const updates: Partial<typeof message> = {}
    if (message.content !== ts.accumulatedContent) updates.content = ts.accumulatedContent
    if (message.reasoning && message.reasoning.content !== ts.accumulatedReasoning) {
      updates.reasoning = { ...message.reasoning, content: ts.accumulatedReasoning }
    }
    if (Object.keys(updates).length > 0) sink.patchMessage(sessionId, ts.assistantMessageId, updates)
    streamingContents.value.set(sessionId, ts.accumulatedContent)
  }

  function scheduleContentPatch(sessionId: string, ts: TurnState): void {
    const pending = pendingContentPatches.get(sessionId)
    if (pending?.turn === ts) return
    if (pending) clearTimeout(pending.timer)
    const timer = setTimeout(() => {
      pendingContentPatches.delete(sessionId)
      if (ts.settled) return
      flushContentPatch(sessionId, ts)
    }, CONTENT_PATCH_INTERVAL_MS)
    pendingContentPatches.set(sessionId, { timer, turn: ts })
  }

  // 工具输入早期提取节流：input_json_delta 每秒可达数十次，content 字段的每次
  // 更新都会触发 WriteToolCard 全量语法高亮，按 ~10Hz 合并刷新避免卡顿。
  const pendingEarlyInputPatches = new Map<string, { timer: ReturnType<typeof setTimeout>; turn: TurnState; toolId: string }>()
  const EARLY_INPUT_PATCH_INTERVAL_MS = 100

  function scheduleEarlyInputPatch(sessionId: string, ts: TurnState, toolId: string): void {
    const pending = pendingEarlyInputPatches.get(sessionId)
    if (pending) {
      if (pending.turn === ts) {
        pending.toolId = toolId
        return
      }
      clearTimeout(pending.timer)
    }
    const timer = setTimeout(() => {
      pendingEarlyInputPatches.delete(sessionId)
      flushEarlyInputPatch(sessionId, ts, toolId)
    }, EARLY_INPUT_PATCH_INTERVAL_MS)
    pendingEarlyInputPatches.set(sessionId, { timer, turn: ts, toolId })
  }

  function flushEarlyInputPatch(sessionId: string, ts: TurnState, toolId: string): void {
    // content_block_stop 已整体解析并清空分片，勿用迟到的部分提取覆盖完整 input
    const accumulated = ts.streamingToolJson.get(toolId)
    if (accumulated === undefined) return
    const earlyInput = tryExtractEarlyInput(accumulated)
    if (!earlyInput) return
    const s = sink.get(sessionId)
    const msg = s?.messages.find(m => m.id === ts.assistantMessageId)
    if (!msg?.toolCalls) return
    const idx = msg.toolCalls.findIndex(tc => tc.id === toolId)
    if (idx < 0) return
    const updatedToolCalls = [...msg.toolCalls]
    updatedToolCalls[idx] = {
      ...updatedToolCalls[idx],
      input: { ...updatedToolCalls[idx].input, ...earlyInput }
    }
    msg.toolCalls = updatedToolCalls
  }

  function handleRemoteUserMessage(sessionId: string, data: any): void {
    if (!sessionId) return
    const content = remoteUserContent(data)
    if (!content.trim()) return

    let session = sink.get(sessionId)
    if (!session) {
      session = sink.ensureSession(sessionId, {
        title: data?.title || content.slice(0, 50) || 'Remote Chat',
        projectPath: data?.projectPath || undefined,
        activate: data?.activate !== false,
      })
    } else {
      if (data?.projectPath && !session.workingDirectory) {
        session.workingDirectory = data.projectPath
      }
      if (getCurrentSessionId() !== sessionId) {
        void selectSession(sessionId)
      }
    }

    // 后台触发方（定时任务）指定的模型落到会话记录：输入框显示的是它，
    // 用户在该会话续话时 initClaudeCodeSession 也会按它重启引擎，而不是退回全局默认
    if (typeof data?.model === 'string' && data.model && !session.model) {
      session.model = data.model
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('h5-remote-user-message', {
        detail: {
          sessionId,
          title: session.title || data?.title || content.slice(0, 50) || 'Remote Chat',
          projectPath: session.workingDirectory || data?.projectPath || null,
        },
      }))
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : ''
    const hasExactMessage = messageId && session.messages.some(m => m.id === messageId)
    const lastMessage = session.messages[session.messages.length - 1]
    const isRecentDuplicate = !messageId &&
      lastMessage?.role === 'user' &&
      lastMessage.content === content &&
      Date.now() - (lastMessage.timestamp || 0) < 10_000

    if (!hasExactMessage && !isRecentDuplicate) {
      sink.appendMessage(sessionId, {
        ...(messageId ? { id: messageId } : {}),
        role: 'user',
        content,
        metadata: { source: 'h5' } as any,
      })
    }

    const existing = turnStates.get(sessionId)
    if (existing) {
      return
    }
    if (pendingSendMessages.has(sessionId) || userAbortedSessions.has(sessionId)) return

    beginTurn(sessionId, { isAutonomous: true })
  }

  const handleStreamEvent = (sessionId: string, ts: TurnState, streamEvent: any) => {
    const ev = streamEvent.event || streamEvent

    // ── 内容块边界收口 ──
    // 新内容块开始 / 一轮流式消息开始或结束时（message_start / message_delta /
    // message_stop），上一个 text / reasoning 占位事件必然已经结束，统一置为
    // completed。协议只对 tool_use 的 content_block_stop 有消费逻辑，thinking /
    // text 块结束后若不在此收口，事件会以 running 状态跨轮残留 —— 工具结果返回
    // 后等待 LLM 下一轮响应的间隙里，AgentTimeline.isWaitingForLlm 会因残留的
    // running 事件误判为仍有活动进行，导致"正在回复"等待指示不显示。
    if (
      ev.type === 'message_start' ||
      ev.type === 'message_delta' ||
      ev.type === 'message_stop' ||
      ev.type === 'content_block_start'
    ) {
      flushContentPatch(sessionId, ts)
      completeCurrentTextEvent(sessionId, ts)
      completeCurrentReasoningEvent(sessionId, ts)
    }

    if (ev.type === 'message_start' && typeof ev.message?.model === 'string' && ev.message.model.trim()) {
      ts.model = ev.message.model
    }

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(text) | accLen=${ts.accumulatedContent.length}`)
      ts.currentTextEventId = null
      // 新 text 块从零累积：上一块（工具调用前的说明文字）已经写入自己的
      // timeline event，这里若不重置，flushContentPatch 会把整轮全文写进
      // 新事件，造成工具调用前后同一段文本渲染两遍。
      ts.currentTextContent = ''
      ensureTextTimelineEvent(sessionId, ts)
      if (ts.accumulatedContent.length > 0 && !ts.accumulatedContent.endsWith('\n')) {
        ts.accumulatedContent += '\n\n'
        streamingContents.value.set(sessionId, ts.accumulatedContent)
        scheduleContentPatch(sessionId, ts)
      }
    }

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
      logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(thinking)`)
      // 上一段 reasoning 已在边界收口处完成并清空 currentReasoningEventId
      const s = sink.get(sessionId)
      if (s) {
        ts.currentReasoningContent = ''
        const msg = s.messages.find(m => m.id === ts.assistantMessageId)
        if (msg) {
          if (!msg.reasoning) {
            msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
          } else if (msg.reasoning.endTime != null) {
            // 上一段 thinking 已在边界收口（endTime 已写），新块开始须清掉，
            // 否则 msg 级"是否仍在思考"信号在第二段思考期间就已失真
            msg.reasoning.endTime = undefined
            msg.reasoning.isExpanded = true
          }
          ts.currentReasoningEventId = createUuid()
          addTimelineEvent(sessionId, ts, {
            id: ts.currentReasoningEventId,
            type: 'reasoning',
            timestamp: Date.now(),
            status: 'running',
            content: ''
          })
          ts.streamingHandledThinking = true
        }
      }
    }

    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta?.text) {
      ensureTextTimelineEvent(sessionId, ts)
      ts.accumulatedContent += ev.delta.text
      ts.currentTextContent += ev.delta.text
      scheduleContentPatch(sessionId, ts)
    }

    if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta?.thinking) {
      ts.streamingHandledThinking = true
      const s = sink.get(sessionId)
      if (s) {
        const msg = s.messages.find(m => m.id === ts.assistantMessageId)
        if (msg) {
          if (!msg.reasoning) {
            msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
          }
          ts.accumulatedReasoning += ev.delta.thinking
          ts.currentReasoningContent += ev.delta.thinking
          if (!ts.currentReasoningEventId) {
            // 指针为空说明上一段已收口；此时又来 thinking_delta = 新块开始
            // （引擎适配层可能不发 content_block_start），与块开始事件同样要清 endTime
            if (msg.reasoning.endTime != null) {
              msg.reasoning.endTime = undefined
              msg.reasoning.isExpanded = true
            }
            ts.currentReasoningEventId = createUuid()
            addTimelineEvent(sessionId, ts, {
              id: ts.currentReasoningEventId,
              type: 'reasoning',
              timestamp: Date.now(),
              status: 'running',
              content: ''
            })
          }
          scheduleContentPatch(sessionId, ts)
        }
      }
    }

    // ── tool_use 流式处理：在 LLM 生成工具调用时就立即创建 toolCall，
    // 让 UI 即时渲染工具卡片（无需等待完整 assistant 消息）──
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      const toolId: string = ev.content_block.id || createUuid()
      const toolName: string = ev.content_block.name || 'Unknown Tool'
      logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(tool_use) | name=${toolName} | id=${toolId.slice(0, 8)}`)

      ts.currentStreamingToolId = toolId
      ts.streamingToolJson.set(toolId, '')

      const s = sink.get(sessionId)
      if (s) {
        const msg = s.messages.find(m => m.id === ts.assistantMessageId)
        if (msg) {
          const existingTool = msg.toolCalls?.find(tc => tc.id === toolId)
          if (!existingTool) {
            msg.toolCalls = [...(msg.toolCalls || []), {
              id: toolId, name: toolName, input: {},
              status: 'running', startTime: Date.now()
            }]
            addToolTimelineEvent(sessionId, ts, toolId)
            sink.persist(sessionId)
          }
        }
      }
    }

    if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta' && ev.delta?.partial_json) {
      const toolId = ts.currentStreamingToolId
      if (toolId) {
        const prev = ts.streamingToolJson.get(toolId) || ''
        ts.streamingToolJson.set(toolId, prev + ev.delta.partial_json)

        // 节流提取关键信息（file_path / content 等），让 UI 尽早显示工具目标
        // 并驱动 Write 卡片逐行流式渲染代码
        scheduleEarlyInputPatch(sessionId, ts, toolId)
      }
    }

    if (ev.type === 'content_block_stop' && ts.currentStreamingToolId) {
      const toolId = ts.currentStreamingToolId
      const accumulated = ts.streamingToolJson.get(toolId) || ''
      ts.currentStreamingToolId = null
      ts.streamingToolJson.delete(toolId)

      // 解析完整的工具输入 JSON
      if (accumulated) {
        try {
          const parsed = JSON.parse(accumulated)
          const s = sink.get(sessionId)
          if (s) {
            const msg = s.messages.find(m => m.id === ts.assistantMessageId)
            if (msg?.toolCalls) {
              const idx = msg.toolCalls.findIndex(tc => tc.id === toolId)
              if (idx >= 0) {
                const updatedToolCalls = [...msg.toolCalls]
                updatedToolCalls[idx] = {
                  ...updatedToolCalls[idx],
                  input: parsed
                }
                msg.toolCalls = updatedToolCalls
                sink.persist(sessionId)
              }
            }
          }
        } catch {
          logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: failed to parse accumulated tool JSON for ${toolId.slice(0, 8)}`)
        }
      }
    }
  }

  const handleAssistant = (sessionId: string, ts: TurnState, assistant: any) => {
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] assistant event received`)

    // Claude engine writes retry failures as synthetic assistant messages. They
    // are represented by the system api_retry event and must not become chat
    // content (the payload can contain the raw provider JSON error).
    if (isSyntheticApiErrorAssistant(assistant)) {
      logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] ignored synthetic API error assistant message`)
      return
    }

    if (typeof assistant.message?.model === 'string' && assistant.message.model.trim()) {
      ts.model = assistant.message.model
    }

    const apiUsage = assistant.message?.usage
    if (apiUsage) {
      const s = sink.get(sessionId)
      const msg = s?.messages.find(m => m.id === ts.assistantMessageId)
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
          apiCallUsage: {
            input_tokens: apiUsage.input_tokens ?? 0,
            output_tokens: apiUsage.output_tokens ?? 0,
            cache_read_input_tokens: cacheRead,
            cache_creation_input_tokens: cacheCreate,
          },
        }
        try {
          contextUsage.applyFallback(sessionId)
        } catch {
          // Non-fatal
        }
      }
    }

    if (assistant.message?.content) {
      const content = assistant.message.content
      if (Array.isArray(content)) {
        const hasExistingTimeline = !!getAssistantMessage(sessionId, ts)?.timelineEvents?.length

        if (!hasExistingTimeline) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              completeCurrentTextEvent(sessionId, ts)
              const textEventId = ensureTextTimelineEvent(sessionId, ts)
              ts.accumulatedContent += block.text
              streamingContents.value.set(sessionId, ts.accumulatedContent)
              const msg = getAssistantMessage(sessionId, ts)
              const textEvent = msg?.timelineEvents?.find(event => event.id === textEventId)
              const blockEventContent = `${textEvent?.content || ''}${block.text}`
              ts.currentTextContent = blockEventContent
              updateTimelineEvent(sessionId, ts, textEventId, {
                content: blockEventContent,
                status: 'running'
              })
            } else if (block.type === 'thinking') {
              if (ts.streamingHandledThinking) continue
              const thinkingText = block.thinking || block.text || ''
              if (thinkingText) {
                completeCurrentTextEvent(sessionId, ts)
                const s = sink.get(sessionId)
                if (s) {
                  const msg = s.messages.find(m => m.id === ts.assistantMessageId)
                  if (msg) {
                    if (!msg.reasoning) {
                      msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                    }
                    ts.accumulatedReasoning += thinkingText
                    ts.currentReasoningContent += thinkingText
                    if (!ts.currentReasoningEventId) {
                      ts.currentReasoningEventId = createUuid()
                      addTimelineEvent(sessionId, ts, {
                        id: ts.currentReasoningEventId,
                        type: 'reasoning',
                        timestamp: msg.reasoning.startTime,
                        status: 'running',
                        content: ''
                      })
                    }
                    const reasoningEvent = msg.timelineEvents?.find(event => event.id === ts.currentReasoningEventId)
                    updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, {
                      content: reasoningEvent?.content || '',
                      status: 'completed'
                    })
                    if (!msg.reasoning.endTime) {
                      msg.reasoning.endTime = Date.now()
                      msg.reasoning.isExpanded = false
                    }
                    scheduleContentPatch(sessionId, ts)
                    ts.streamingHandledThinking = true
                  }
                }
              }
            } else if (block.type === 'tool_use' && block.id) {
              addToolTimelineEvent(sessionId, ts, block.id)
            }
          }

          if (ts.accumulatedContent) {
            sink.patchMessage(sessionId, ts.assistantMessageId, { content: ts.accumulatedContent })
          }
        } else {
          const textContent = content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '')
            .join('')

          if (textContent && textContent.length > ts.accumulatedContent.length) {
            const deltaText = textContent.slice(ts.accumulatedContent.length)
            ts.accumulatedContent = textContent
            streamingContents.value.set(sessionId, ts.accumulatedContent)
            const textEventId = ensureTextTimelineEvent(sessionId, ts)
            const msg = getAssistantMessage(sessionId, ts)
            const textEvent = msg?.timelineEvents?.find(event => event.id === textEventId)
            const patchEventContent = `${textEvent?.content || ''}${deltaText}`
            ts.currentTextContent = patchEventContent
            updateTimelineEvent(sessionId, ts, textEventId, {
              content: patchEventContent,
              status: 'running'
            })
            sink.patchMessage(sessionId, ts.assistantMessageId, { content: ts.accumulatedContent })
          }

          const reasoningContent = content
            .filter((c: any) => c.type === 'thinking')
            .map((c: any) => c.thinking || c.text || '')
            .join('')

          if (reasoningContent && !ts.streamingHandledThinking) {
            const s = sink.get(sessionId)
            if (s) {
              const msg = s.messages.find(m => m.id === ts.assistantMessageId)
              if (msg) {
                if (!msg.reasoning) {
                  msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                }
                msg.reasoning.content += reasoningContent
                if (!ts.currentReasoningEventId) {
                  ts.currentReasoningEventId = createUuid()
                  addTimelineEvent(sessionId, ts, {
                    id: ts.currentReasoningEventId,
                    type: 'reasoning',
                    timestamp: msg.reasoning.startTime,
                    status: 'running',
                    content: ''
                  })
                }
                const reasoningEvent = msg.timelineEvents?.find(event => event.id === ts.currentReasoningEventId)
                updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, {
                  content: `${reasoningEvent?.content || ''}${reasoningContent}`,
                  status: 'completed'
                })
                if (!msg.reasoning.endTime) {
                  msg.reasoning.endTime = Date.now()
                  msg.reasoning.isExpanded = false
                }
                ts.streamingHandledThinking = true
                sink.persist(sessionId)
              }
            }
          }
        }

        const toolUses = content.filter((c: any) => c.type === 'tool_use')
        for (const toolUse of toolUses) {
          const s = sink.get(sessionId)
          if (s) {
            const msg = s.messages.find(m => m.id === ts.assistantMessageId)
            if (msg) {
              const existingTool = msg.toolCalls?.find(tc => tc.id === toolUse.id)
              if (!existingTool) {
                msg.toolCalls = [...(msg.toolCalls || []), {
                  id: toolUse.id, name: toolUse.name, input: toolUse.input || {},
                  status: 'running', startTime: Date.now()
                }]
                recordAgentToolCall(s, msg.toolCalls[msg.toolCalls.length - 1])
                addToolTimelineEvent(sessionId, ts, toolUse.id)
                sink.persist(sessionId)
              } else if (toolUse.input && Object.keys(toolUse.input).length > 0 && msg.toolCalls) {
                // 流式期间可能只填充了部分 input，用完整数据覆盖
                const idx = msg.toolCalls.findIndex(tc => tc.id === toolUse.id)
                if (idx >= 0) {
                  const updatedToolCalls = [...msg.toolCalls]
                  updatedToolCalls[idx] = {
                    ...updatedToolCalls[idx],
                    input: toolUse.input
                  }
                  msg.toolCalls = updatedToolCalls
                  sink.persist(sessionId)
                }
              }
            }
          }
        }
      }
    }
  }

  const handleToolUse = (sessionId: string, ts: TurnState, toolUse: any) => {
    const toolNameLog = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_use event | name=${toolNameLog}`)
    const s = sink.get(sessionId)
    if (s) {
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg) {
        const toolId = toolUse.id || toolUse.tool_use?.id || createUuid()
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
            sessionId,
            actor: 'tool',
            type: traceType,
            status: 'started',
            title: toolName,
            input: toolInput,
            metadata: { toolId, assistantMessageId: ts.assistantMessageId },
          })
          addToolTimelineEvent(sessionId, ts, toolId)
          sink.persist(sessionId)
        } else if (msg.toolCalls) {
          // 流式期间已创建的 toolCall，用完整数据补充 input
          const idx = msg.toolCalls.findIndex(tc => tc.id === toolId)
          if (idx >= 0) {
            const hasFullInput = toolInput && Object.keys(toolInput).length > 0
            const currentInput = msg.toolCalls[idx].input || {}
            const currentInputKeys = Object.keys(currentInput)
            // 仅当当前 input 为空或不完整时才覆盖
            if (hasFullInput && currentInputKeys.length < Object.keys(toolInput).length) {
              const updatedToolCalls = [...msg.toolCalls]
              updatedToolCalls[idx] = {
                ...updatedToolCalls[idx],
                input: toolInput
              }
              msg.toolCalls = updatedToolCalls
              sink.persist(sessionId)
            }
          }
        }
      }
    }
  }

  const handleToolResult = (sessionId: string, ts: TurnState, toolResult: any) => {
    const resultToolUseIdLog = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
    const resultIsErrorLog = toolResult.is_error || toolResult.tool_result?.is_error
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_result event | toolUseId=${resultToolUseIdLog?.slice(0, 8)} | error=${!!resultIsErrorLog}`)
    const s = sink.get(sessionId)
    if (s) {
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg?.toolCalls) {
        const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
        const rawResultOutput = toolResult.output ?? toolResult.content ?? toolResult.tool_result?.output ?? toolResult.tool_result?.content
        let resultOutput = typeof rawResultOutput === 'string' ? rawResultOutput : JSON.stringify(rawResultOutput)
        if (resultOutput.length > MAX_INMEMORY_TOOL_OUTPUT) {
          resultOutput = resultOutput.slice(0, MAX_INMEMORY_TOOL_OUTPUT) + '\n\n[Output truncated to prevent memory overflow]'
        }
        const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error

        updateTaskStateFromToolResult(msg.toolCalls, resultToolUseId, resultOutput)

        const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === resultToolUseId)
        if (toolCallIndex >= 0) {
          const toolName = msg.toolCalls[toolCallIndex].name

          const isAsyncLaunch = !resultIsError &&
            (toolName === 'Agent' || toolName === 'Task') &&
            isAgentLaunchResult(resultOutput)

          const updatedToolCalls = [...msg.toolCalls]
          updatedToolCalls[toolCallIndex] = {
            ...updatedToolCalls[toolCallIndex],
            status: isAsyncLaunch
              ? 'running'
              : (resultIsError ? 'error' : 'completed'),
            output: resultOutput,
            ...(isAsyncLaunch ? {} : { endTime: Date.now() })
          }
          msg.toolCalls = updatedToolCalls
          recordAgentToolCall(s, updatedToolCalls[toolCallIndex], isAsyncLaunch ? 'running' : (resultIsError ? 'failed' : 'completed'))

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
            sessionId,
            actor: 'tool',
            type: traceType,
            status: resultIsError ? 'failed' : 'completed',
            title: toolName,
            output: resultOutput,
            evidence,
            metadata: { toolId: resultToolUseId, assistantMessageId: ts.assistantMessageId },
          })
          updateTimelineEvent(sessionId, ts, `tool-${resultToolUseId}`, {
            status: resultIsError ? 'error' : 'completed'
          })
          sink.persist(sessionId)

          if (FILE_TOOLS.has(toolName) || COMMAND_TOOLS.has(toolName)) {
            if (!resultIsError) recordWriteToLedger(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
            window.dispatchEvent(new CustomEvent('scm:refresh'))
            window.dispatchEvent(new CustomEvent('refresh-file-tree'))
          }

          // 工具刚产出交付物（Write 了 xlsx / 跑了 officecli 命令）→ 创建即打开预览
          if (!resultIsError && toolCallIndex >= 0) {
            maybeAutoPreviewArtifact(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
          }
        }
      }
    }
  }

  const handleUser = (sessionId: string, ts: TurnState, userMsg: any) => {
    if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
      const toolResults = userMsg.message.content.filter((c: any) => c.type === 'tool_result')
      for (const toolResult of toolResults) {
        const s = sink.get(sessionId)
        if (s) {
          const msg = s.messages.find(m => m.id === ts.assistantMessageId)
          if (msg?.toolCalls) {
            const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === toolResult.tool_use_id)
            if (toolCallIndex >= 0) {
              const rawUserToolOutput = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)
              const truncatedUserToolOutput = rawUserToolOutput.length > MAX_INMEMORY_TOOL_OUTPUT
                ? rawUserToolOutput.slice(0, MAX_INMEMORY_TOOL_OUTPUT) + '\n\n[Output truncated to prevent memory overflow]'
                : rawUserToolOutput
              updateTaskStateFromToolResult(msg.toolCalls, toolResult.tool_use_id, truncatedUserToolOutput)
              const updatedToolCalls = [...msg.toolCalls]
              const toolName = updatedToolCalls[toolCallIndex].name
              const isAsyncLaunch = !toolResult.is_error &&
                (toolName === 'Agent' || toolName === 'Task') &&
                isAgentLaunchResult(truncatedUserToolOutput)
              updatedToolCalls[toolCallIndex] = {
                ...updatedToolCalls[toolCallIndex],
                status: isAsyncLaunch
                  ? 'running'
                  : (toolResult.is_error ? 'error' : 'completed'),
                output: truncatedUserToolOutput,
                ...(isAsyncLaunch ? {} : { endTime: Date.now() })
              }
              msg.toolCalls = updatedToolCalls
              recordAgentToolCall(s, updatedToolCalls[toolCallIndex], isAsyncLaunch ? 'running' : (toolResult.is_error ? 'failed' : 'completed'))
              updateTimelineEvent(sessionId, ts, `tool-${toolResult.tool_use_id}`, {
                status: isAsyncLaunch ? 'running' : (toolResult.is_error ? 'error' : 'completed')
              })
              sink.persist(sessionId)

              // 工具刚产出交付物（Write 了 xlsx / 跑了 officecli 命令）→ 创建即打开预览
              if (!toolResult.is_error) {
                recordWriteToLedger(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
                maybeAutoPreviewArtifact(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
              }
            }
          }
        }
      }
    }
  }

  const handleResult = (sessionId: string, ts: TurnState, result: any) => {
    const isError = !!result?.is_error
    const resultText = typeof result?.result === 'string' ? result.result : ''
    const looksLikeApiError = /^API Error:/i.test(resultText)

    // Engine 内部 retry 可能在旧 turn 已 settled 后才发出成功 result。
    // 清理必须先于 settled guard，避免晚到事件被丢弃后重试状态残留。
    if (!isError && !looksLikeApiError && autoRetry.retryStates.value.has(sessionId)) {
      logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry succeeded, clearing retry state`)
      autoRetry.clearOnSuccess(sessionId)
    }

    if (ts.settled) return

    if (typeof result?.model === 'string' && result.model.trim()) {
      ts.model = result.model
    }

    flushContentPatch(sessionId, ts)

    // A successful CLI result can still contain no model output when the
    // upstream API exhausted retries (for example 429/500 responses). Treat
    // that protocol-level success as a visible failure instead of silently
    // settling an empty assistant message.
    const sessionForEmptyCheck = sink.get(sessionId)
    const assistantMessageForEmptyCheck = sessionForEmptyCheck?.messages.find(m => m.id === ts.assistantMessageId)
    const hasVisibleOutput = Boolean(
      resultText.trim() ||
      ts.accumulatedContent.trim() ||
      assistantMessageForEmptyCheck?.content?.trim() ||
      assistantMessageForEmptyCheck?.toolCalls?.length ||
      assistantMessageForEmptyCheck?.reasoning,
    )
    if (!isError && !looksLikeApiError && typeof result?.result === 'string' && !hasVisibleOutput) {
      // 上游请求失败后引擎回了个"成功"的空结果。重发同一份历史只会再失败一次，
      // 所以标成不可重试 —— 否则按文本分类会落到 UNKNOWN，自动重发 5 次。
      const emptyResponseError = Object.assign(
        new Error(
          'LLM returned an empty response after the upstream request failed. Please check the API configuration and try again.',
        ),
        { retryable: false },
      )
      logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] empty successful result treated as error`)
      handleError(sessionId, ts, emptyResponseError)
      return
    }

    if (isError || looksLikeApiError) {
      const errorText = resultText || 'API error'
      logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] result event has error, routing to handleError | isError=${isError} | looksLikeApiError=${looksLikeApiError} | errorText=${errorText.slice(0, 120)}`)
      handleError(sessionId, ts, new Error(errorText))
      return
    }

    ts.settled = true
    result = result || {}
    const elapsed = Date.now() - ts.sendStartTime
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] result event (LLM response complete) | totalElapsed=${elapsed}ms | accContentLen=${ts.accumulatedContent.length} | stopReason=${result.stop_reason || '(none)'}`)
    streamingContents.value.set(sessionId, '')
    loadingSessions.value.set(sessionId, false)

    const s = sink.get(sessionId)
    if (s) {
      s.processStatus = 'idle'
      s.lastActivityAt = Date.now()
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg) {
        const finalText = typeof result.result === 'string' ? result.result : ''
        if (finalText && finalText.length > msg.content.length) {
          const textEventId = ensureTextTimelineEvent(sessionId, ts)
          const deltaText = finalText.slice(msg.content.length)
          msg.content = finalText
          const textEvent = msg.timelineEvents?.find(event => event.id === textEventId)
          updateTimelineEvent(sessionId, ts, textEventId, {
            content: `${textEvent?.content || ''}${deltaText}`,
            status: 'completed'
          })
        }
        completeCurrentTextEvent(sessionId, ts)
        if (msg.reasoning && !msg.reasoning.endTime) {
          msg.reasoning.endTime = Date.now()
          msg.reasoning.isExpanded = false
        }
        if (ts.currentReasoningEventId) {
          updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, { status: 'completed' })
        }
        const hasRunningTools = !!msg.toolCalls?.some(tool => tool.status === 'running' || tool.status === 'pending')
        const suspiciousToolStop = result.stop_reason === 'tool_use'
        const resultUsage = result.usage
        const previousApiCallUsage = msg.metadata?.apiCallUsage
        msg.metadata = {
          model: ts.model || getModel(),
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

        contextUsage.refresh(sessionId)
        traceEvent({
          sessionId,
          messageId: ts.assistantMessageId,
          actor: 'assistant',
          type: 'assistant_turn',
          status: 'completed',
          title: 'Assistant turn completed',
          output: { content: msg.content },
          metadata: {
            [TRACE_DURATION_KEY]: msg.metadata?.duration,
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
          sessionId,
          messageId: ts.assistantMessageId,
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

        if (ts.isAutonomous && !msg.content && !msg.toolCalls?.length && !msg.reasoning) {
          const idx = s.messages.findIndex(m => m.id === ts.assistantMessageId)
          if (idx >= 0) s.messages.splice(idx, 1)
        }

        sink.persist(sessionId)

        if (s.workingDirectory) {
          const workingDir = s.workingDirectory
          const scanWorkspaceRoot = needsWorkspaceRootScan(s.mode)
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const artifactsApi = getArtifactsApi()
              if (!artifactsApi?.list) return
              const { artifacts } = await artifactsApi.list(workingDir, { scanWorkspaceRoot })
              const produced = (artifacts || []).filter((a: any) => a.mtime >= turnStart - 1000)
              if (produced.length === 0) return
              const sess = sink.get(sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              target.metadata = { ...(target.metadata || {}), artifacts: produced }
              sess.messages = [...sess.messages]
              sink.persist(sessionId)

              // 交付物一出现就送进右侧预览。这段逻辑过去住在 ArtifactsPanel 里，
              // 而那个组件只有产物 tab 挂着时才存在 —— 没挂载就永远不自动预览，
              // 正是 issue #40 问题 4 报的"生成的 Excel 看不到实时预览"。
              // design 模式跳过：它有 DesignFileWorkspace 自己的预览区，不去抢。
              if (s.mode !== 'design' && openArtifactPreview) {
                const previewable = produced
                  .filter((a: any) => isAutoPreviewPath(a.path) && !autoPreviewedPaths.has(a.path))
                  .sort((a: any, b: any) => b.mtime - a.mtime)
                if (previewable.length > 0) {
                  autoPreviewedPaths.add(previewable[0].path)
                  openArtifactPreview(previewable[0].path)
                }
              }
            } catch (err) {
              console.error('[Artifacts] turn summary collect failed:', err)
            }
          })()
        }

        // 回合窗口内被改过、但没有 Write/Edit 事件点名的文件（Bash、格式化、子代理写入）。
        // 判据用 mtime 而不是"前后两次快照求差"：原地编辑行数不变时 numstat 求差会漏，
        // 而 mtime 一定跟着写盘动。只在回合真的跑过命令或子代理时才花这次采样。
        const hasExternalWriter = msg.toolCalls?.some(tc =>
          COMMAND_TOOLS.has(tc.name) || tc.name === 'Agent' || tc.name === 'Task')
        const projectRoot = hasExternalWriter ? getProjectRoot() : null
        if (hasExternalWriter && projectRoot && !msg.metadata?.commandFiles) {
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const stats = await api.git.getChangeStats(projectRoot)
              if (!stats) return
              const hits = stats.files
                .filter(file => file.mtimeMs >= turnStart - 1000)
                .map(file => ({ path: file.path, at: file.mtimeMs }))
              if (hits.length === 0) return

              const sess = sink.get(sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              // 与工具事件重名的文件不在这里判重：collect 侧按 direct 优先合并
              target.metadata = { ...(target.metadata || {}), commandFiles: hits }
              sess.messages = [...sess.messages]
              sink.persist(sessionId)
            } catch (err) {
              console.warn('[SessionChanges] turn window scan failed:', err)
            }
          })()
        }

        void loadTurnCheckpoints(sessionId, s.workingDirectory, true)
      }
    }

    ts.resolve?.()
    endTurn(sessionId, ts)

    // ── Goal 续跑等跨 turn 编排钩子（仅成功结算时触发）──
    // finalText 优先取 result.result，为空时回退到消息累积内容。
    if (onTurnCompleted) {
      const s = sink.get(sessionId)
      const fallbackText = s?.messages.find(m => m.id === ts.assistantMessageId)?.content || ''
      try {
        onTurnCompleted(sessionId, resultText || fallbackText)
      } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnCompleted callback failed`, { error: String(e) })
      }
    }

    // ── Turn 结局订阅点 — settled ──
    if (onTurnOutcome) {
      try { onTurnOutcome(sessionId, 'settled') } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnOutcome(settled) failed`, { error: String(e) })
      }
    }

    // ── Play notification sound when a task completes successfully ──
    const soundEnabled = isSoundOnTaskComplete()
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] task complete, soundOnTaskComplete=${soundEnabled}`)
    if (soundEnabled) {
      try { playTaskCompleteSound() } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] failed to play task complete sound`, { error: String(e) })
      }
    }

    // ── Show desktop system notification when a task completes successfully ──
    // 去重：同一 session 在 NOTIFICATION_DEBOUNCE_MS 内只通知一次，
    // 防止残留事件创建幽灵 turn 后再次触发 handleResult 导致重复通知。
    const desktopNotifyEnabled = isDesktopNotifyOnTaskComplete()
    if (desktopNotifyEnabled) {
      const lastNotified = notifiedSessions.get(sessionId)
      const now = Date.now()
      if (!lastNotified || now - lastNotified > NOTIFICATION_DEBOUNCE_MS) {
        notifiedSessions.set(sessionId, now)
        try {
          api.showNotification({
            title: i18n.global.t('chat.taskCompleteNotificationTitle', { session: getSessionTitle(sessionId) }) as string,
            message: i18n.global.t('chat.taskCompleteNotificationBody') as string,
          })
        } catch (e) {
          logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] failed to show task complete notification`, { error: String(e) })
        }
      } else {
        logger.info('ChatStore', `[${sessionId.slice(0, 8)}] task complete notification suppressed (debounced)`)
      }
    }
  }

  const handleError = (sessionId: string, ts: TurnState, error: any) => {
    if (ts.settled) return
    flushContentPatch(sessionId, ts)
    // 回合以任何非 result 方式终结（报错 / 自动重试挂起 / 中止后错误压制）都要
    // 收口未结束的 thinking：否则 timeline 事件停在 running、
    // msg.reasoning.endTime 永远为空，思考卡片一直转"思考中"。
    completeCurrentReasoningEvent(sessionId, ts)
    const elapsed = Date.now() - ts.sendStartTime
    logger.error('ChatStore', `[${sessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })

    if (userAbortedSessions.has(sessionId)) {
      logger.info('ChatStore', `[${sessionId.slice(0, 8)}] error suppressed after user abort`)
      ts.settled = true
      loadingSessions.value.set(sessionId, false)
      streamingContents.value.set(sessionId, '')
      autoRetry.removeRetryState(sessionId)
      const s = sink.get(sessionId)
      if (s) {
        s.processStatus = 'idle'
        sink.persist(sessionId)
      }
      endTurn(sessionId, ts)
      // ── Turn 结局订阅点 — aborted ──
      if (onTurnOutcome) {
        try { onTurnOutcome(sessionId, 'aborted') } catch (e) {
          logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnOutcome(aborted) failed`, { error: String(e) })
        }
      }
      return
    }

    const classified = errorHandler.classifyError(error, {
      sessionId,
      provider: getProvider(),
      model: ts.model || getModel(),
      baseUrl: getBaseUrl(),
      phase: 'stream',
    })

    if (autoRetry.shouldAutoRetry(sessionId, classified.retryable, userAbortedSessions)) {
      const claudeCode = getClaudeCode()
      if (claudeCode) {
        try { claudeCode.abort(sessionId) } catch { /* ignore */ }
      }

      ts.settled = true
      void initiateAutoRetry(
        sessionId,
        ts,
        classified.category,
        classified.title,
        classified.message,
        classified.retryDelay,
        extractErrorCode(classified.technicalDetail, classified.category),
      )
      return
    }

    ts.settled = true
    loadingSessions.value.set(sessionId, false)
    streamingContents.value.set(sessionId, '')

    const hadRetry = autoRetry.retryStates.value.has(sessionId)
    autoRetry.removeRetryState(sessionId)

    errorHandler.handleError(error, {
      sessionId,
      provider: getProvider(),
      model: ts.model || getModel(),
      baseUrl: getBaseUrl(),
      phase: 'stream',
    })

    const failedDurationMs = Date.now() - ts.sendStartTime

    traceEvent({
      sessionId,
      messageId: ts.assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'failed',
      title: hadRetry ? 'Assistant turn failed (retries exhausted)' : 'Assistant turn failed',
      error: { message: classified.technicalDetail },
      metadata: { [TRACE_DURATION_KEY]: failedDurationMs },
    })

    sink.patchMessage(sessionId, ts.assistantMessageId, {
      content: classified.message,
      metadata: {
        model: ts.model || getModel(),
        duration: failedDurationMs,
        error: classified,
      }
    })

    const s = sink.get(sessionId)
    if (s) {
      s.processStatus = 'exited'
      sink.persist(sessionId)
    }

    ts.reject?.(error)
    endTurn(sessionId, ts)

    // ── Turn 结局订阅点 — failed ──
    if (onTurnOutcome) {
      try { onTurnOutcome(sessionId, 'failed') } catch (e) {
        logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] onTurnOutcome(failed) failed`, { error: String(e) })
      }
    }
  }

  const handleExit = (sessionId: string, ts: TurnState, data: number | null | { code?: number | null; signal?: string | null; stderr?: string }) => {
    let exitCode: number | null = null
    let stderrTail: string | undefined
    let signal: string | null | undefined
    if (typeof data === 'number' || data === null) {
      exitCode = data
    } else if (data && typeof data === 'object') {
      exitCode = data.code ?? null
      stderrTail = data.stderr || undefined
      signal = data.signal ?? undefined
    }

    logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] process exit event | code=${exitCode}${signal ? ` | signal=${signal}` : ''}${stderrTail ? ` | stderr=${stderrTail.slice(0, 200)}` : ''}`)

    if (exitCode !== null && exitCode !== 0) {
      const detail = stderrTail
        ? stderrTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
        : undefined
      const msg = detail
        ? `Process exited with code ${exitCode}: ${detail}`
        : `Process exited with code ${exitCode}`
      handleError(sessionId, ts, new Error(msg))
      return
    }
  }

  return {
    handleRemoteUserMessage,
    handleStreamEvent,
    handleAssistant,
    handleToolUse,
    handleToolResult,
    handleUser,
    handleResult,
    handleError,
    handleExit,
  }
}
