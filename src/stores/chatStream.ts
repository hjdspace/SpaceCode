import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message } from '@/types'
import { ErrorCategory } from '@/types'
import { useSettingsStore } from './settings'
import { useContextUsageStore } from './contextUsage'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import {
  isTeammateRawMessage,
  isSidechainMessage,
  recordAgentToolCall,
} from '@/services/teamTranscriptService'
import { useChatSessionStore } from './chatSession'
import { useAutoRetry } from '@/composables/useAutoRetry'

const FILE_TOOLS = new Set(['Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit'])
const COMMAND_TOOLS = new Set(['Bash'])
const VERIFICATION_PATTERNS = [/^\s*(npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|jest|vitest|mocha|npx\s+playwright|ruff|eslint|biome|prettier|tsc|vue-tsc|npm\s+run\s+(test|lint|check|build|typecheck))/i]

const REQUEST_TIMEOUT = 5 * 60 * 1000               // 用户发起 turn 的空闲超时（硬超时报错）
const AUTONOMOUS_REQUEST_TIMEOUT = 45 * 60 * 1000   // 后台 agent 自动续跑可长跑（软收尾）

// ── 内存防护配置 ──
// 工具输出在内存中的最大长度（字符数）。
// 长时间运行的 agent 任务会产生大量工具调用，单个工具输出（如 Read 大文件、Bash 长输出）
// 可能高达数百 KB。这些输出完整保存在响应式 session.messages 中，导致内存持续增长，
// 最终 saveToStorage 的 JSON.stringify 会尝试分配超大字符串，触发 V8 OOM。
// 引擎自身持有完整的对话上下文，前端仅用于 UI 展示，截断到 30KB 足够用户查看。
const MAX_INMEMORY_TOOL_OUTPUT = 30_000

// 单个会话当前进行中的 turn 状态。turnStates 中无此 sessionId 条目 === 该会话 idle。
interface TurnState {
  assistantMessageId: string
  accumulatedContent: string
  currentTextEventId: string | null
  currentReasoningEventId: string | null
  streamingHandledThinking: boolean
  sendStartTime: number
  timeoutId: ReturnType<typeof setTimeout> | null
  isAutonomous: boolean            // 由后台 agent 完成自动触发（无对应 sendMessage）
  settled: boolean                 // 取代旧的闭包 isCompleted，防止 result/error/timeout 竞态
  resolve?: () => void             // 结算等待中的 sendMessage（autonomous turn 无）
  reject?: (e: any) => void
}

export const useChatStreamStore = defineStore('chatStream', () => {
  const sessionStore = useChatSessionStore()
  const settingsStore = useSettingsStore()

  const streamingContents = ref<Map<string, string>>(new Map())
  const loadingSessions = ref<Map<string, boolean>>(new Map())
  const turnStates = new Map<string, TurnState>()

  // ── 自动重试状态机 ──
  const autoRetry = useAutoRetry({
    maxRetries: 5,
    initialDelayMs: 2_000,
    maxDelayMs: 60_000,
    jitterMs: 1_000,
  })

  // ── sendMessage 进行中标记 ──
  // 防止 ensureTurn 在 sendMessage 的 addMessage → beginTurn 窗口期
  // 因 session.messages.length > 0 而自动创建 autonomous turn，
  // 导致事件被消费、turn 被提前结算，用户看到的响应延迟或丢失。
  const pendingSendMessages = new Set<string>()

  // ── 用户主动 abort 标记 ──
  // 用户点击停止按钮后，abort() 仅向引擎发送 interrupt 控制信号，
  // 并不杀死引擎进程。当任务中启动了子代理（Task tool）时，子代理
  // 可能仍在运行并继续发出 stream_event / assistant / tool_use 事件。
  // 这些事件会触发 ensureTurn 创建新的 autonomous turn，使会话看起来
  // 「自动恢复运行」。更严重的是，当子代理以 is_error 结束时，
  // handleError 会将其分类为可重试错误并触发 initiateAutoRetry，
  // 自动重发上一条用户消息，导致会话彻底重启。
  // 通过此 Set 标记用户主动中止的会话，在 ensureTurn 和 handleError
  // 中拦截残留事件，直到用户主动发新消息或重试时清除标记。
  const userAbortedSessions = new Set<string>()

  const isLoading = computed(() =>
    sessionStore.currentSessionId ? (loadingSessions.value.get(sessionStore.currentSessionId) ?? false) : false
  )
  const streamingContent = computed(() =>
    sessionStore.currentSessionId ? (streamingContents.value.get(sessionStore.currentSessionId) ?? '') : ''
  )

  // ── By-id selectors（分屏多 pane 场景按 sessionId 直接读取，不依赖全局 current）──
  function getIsLoading(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false
    return loadingSessions.value.get(sessionId) ?? false
  }

  function getStreamingContent(sessionId: string | null | undefined): string {
    if (!sessionId) return ''
    return streamingContents.value.get(sessionId) ?? ''
  }

  // ────────────────────────────────────────────────────────────────────
  // Pending Messages
  // ────────────────────────────────────────────────────────────────────
  interface PendingMessage {
    id: string
    content: string
    attachments: { name: string; path: string; isFolder: boolean }[]
    images: { id: string; name: string; type: 'image'; mimeType: string; previewUrl: string; data: string }[]
    displayLabel?: string
    priority: 'now' | 'later'
    createdAt: number
  }
  const pendingMessages = ref<Map<string, PendingMessage[]>>(new Map())

  function addPendingMessage(sessionId: string, msg: PendingMessage) {
    const queue = pendingMessages.value.get(sessionId) || []
    queue.push(msg)
    pendingMessages.value.set(sessionId, [...queue])
  }

  function removePendingMessage(sessionId: string, msgId: string) {
    const queue = pendingMessages.value.get(sessionId) || []
    const idx = queue.findIndex(m => m.id === msgId)
    if (idx >= 0) queue.splice(idx, 1)
    pendingMessages.value.set(sessionId, [...queue])
  }

  function recallPendingMessage(sessionId: string, msgId: string): PendingMessage | undefined {
    const queue = pendingMessages.value.get(sessionId) || []
    const idx = queue.findIndex(m => m.id === msgId)
    if (idx < 0) return undefined
    const [msg] = queue.splice(idx, 1)
    pendingMessages.value.set(sessionId, [...queue])
    return msg
  }

  function getPendingMessages(sessionId: string): PendingMessage[] {
    return pendingMessages.value.get(sessionId) || []
  }

  function clearPendingMessages(sessionId: string) {
    pendingMessages.value.delete(sessionId)
  }

  // ────────────────────────────────────────────────────────────────────
  // Timeline / message helpers（按 sessionId + TurnState 操作，不再依赖闭包）
  // ────────────────────────────────────────────────────────────────────
  const getAssistantMessage = (sessionId: string, ts: TurnState): Message | undefined => {
    const s = sessionStore.sessions.find(s => s.id === sessionId)
    return s?.messages.find(m => m.id === ts.assistantMessageId)
  }

  const addTimelineEvent = (sessionId: string, ts: TurnState, event: NonNullable<Message['timelineEvents']>[number]) => {
    const msg = getAssistantMessage(sessionId, ts)
    if (!msg) return
    if (msg.timelineEvents?.some(e => e.id === event.id)) return
    msg.timelineEvents = [...(msg.timelineEvents || []), event]
  }

  const updateTimelineEvent = (sessionId: string, ts: TurnState, eventId: string, updates: Partial<NonNullable<Message['timelineEvents']>[number]>) => {
    const msg = getAssistantMessage(sessionId, ts)
    if (!msg?.timelineEvents) return
    // 直接修改 event 属性，不创建新数组。
    // 流式期间每个 text_delta/thinking_delta 都会调用此方法，
    // 使用 map 创建新数组会导致 O(n) 复制 + 触发大量响应式更新。
    // Vue 3 的 reactive 代理会正确追踪属性修改。
    const event = msg.timelineEvents.find(e => e.id === eventId)
    if (event) {
      Object.assign(event, updates)
    }
  }

  const ensureTextTimelineEvent = (sessionId: string, ts: TurnState): string => {
    if (ts.currentTextEventId) return ts.currentTextEventId
    ts.currentTextEventId = crypto.randomUUID()
    addTimelineEvent(sessionId, ts, {
      id: ts.currentTextEventId,
      type: 'text',
      timestamp: Date.now(),
      status: 'running',
      content: ''
    })
    return ts.currentTextEventId
  }

  const completeCurrentTextEvent = (sessionId: string, ts: TurnState) => {
    if (!ts.currentTextEventId) return
    updateTimelineEvent(sessionId, ts, ts.currentTextEventId, { status: 'completed' })
    ts.currentTextEventId = null
  }

  const addToolTimelineEvent = (sessionId: string, ts: TurnState, toolCallId: string) => {
    completeCurrentTextEvent(sessionId, ts)
    addTimelineEvent(sessionId, ts, {
      id: `tool-${toolCallId}`,
      type: 'tool_call',
      timestamp: Date.now(),
      status: 'running',
      toolCallId
    })
  }

  // ────────────────────────────────────────────────────────────────────
  // Turn 生命周期
  // ────────────────────────────────────────────────────────────────────
  const resetTimeout = (sessionId: string, ts: TurnState) => {
    if (ts.timeoutId) clearTimeout(ts.timeoutId)
    const limit = ts.isAutonomous ? AUTONOMOUS_REQUEST_TIMEOUT : REQUEST_TIMEOUT
    ts.timeoutId = setTimeout(() => {
      const cur = turnStates.get(sessionId)
      if (!cur || cur !== ts || cur.settled) return
      if (ts.isAutonomous) {
        // 后台续跑长跑属正常，软收尾：清 spinner、不报错
        handleResult(sessionId, ts, {})
      } else {
        handleError(sessionId, ts, new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
      }
    }, limit)
  }

  const beginTurn = (sessionId: string, opts: { isAutonomous: boolean; resolve?: () => void; reject?: (e: any) => void }): TurnState => {
    const assistantMessageId = crypto.randomUUID()
    const ts: TurnState = {
      assistantMessageId,
      accumulatedContent: '',
      currentTextEventId: null,
      currentReasoningEventId: null,
      streamingHandledThinking: false,
      sendStartTime: Date.now(),
      timeoutId: null,
      isAutonomous: opts.isAutonomous,
      settled: false,
      resolve: opts.resolve,
      reject: opts.reject,
    }
    turnStates.set(sessionId, ts)

    loadingSessions.value.set(sessionId, true)
    streamingContents.value.set(sessionId, '')
    const s = sessionStore.sessions.find(s => s.id === sessionId)
    if (s) s.processStatus = 'active'

    sessionStore.traceEvent({
      sessionId,
      messageId: assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'started',
      title: opts.isAutonomous ? 'Assistant turn started (autonomous)' : 'Assistant turn started',
    })

    sessionStore.addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    }, sessionId)

    resetTimeout(sessionId, ts)
    return ts
  }

  const endTurn = (sessionId: string, ts: TurnState) => {
    if (ts.timeoutId) { clearTimeout(ts.timeoutId); ts.timeoutId = null }
    turnStates.delete(sessionId)
    // 注意：绝不退订持久监听器
  }

  // idle 时收到流式事件 → 视为新 turn 开始（后台 agent 自动续跑的关键路径）
  const ensureTurn = (sessionId: string): TurnState => {
    const existing = turnStates.get(sessionId)
    if (existing) return existing

    // sendMessage 正在进行中（addMessage 已执行、beginTurn 尚未执行）：
    // 此时 session.messages.length > 0，但不应该创建 autonomous turn，
    // 因为用户发起的 turn 即将由 beginTurn 创建。
    // 丢弃此窗口期内的流式事件，防止 autonomous turn 消费事件或被提前结算。
    if (pendingSendMessages.has(sessionId)) {
      return { settled: true } as TurnState
    }

    // ★ 用户主动 abort 后，丢弃引擎残留事件（子代理输出等），
    // 不创建 autonomous turn，防止会话「自动恢复运行」。
    // 标记在 sendMessage / retryLastMessage / resendForRetry 中清除。
    if (userAbortedSessions.has(sessionId)) {
      return { settled: true } as TurnState
    }

    // 新建会话尚未有任何消息时，不因 CLI 初始化事件自动创建 turn，
    // 避免会话在用户发送消息前就显示转圈。
    // 后台 agent 自动续跑仅对已有消息的会话生效，不影响该路径。
    const session = sessionStore.sessions.find(s => s.id === sessionId)
    if (!session || session.messages.length === 0) {
      // 返回一个已结算的空 turn，使调用方因 ts.settled 提前返回
      return { settled: true } as TurnState
    }

    return beginTurn(sessionId, { isAutonomous: true })
  }

  // ────────────────────────────────────────────────────────────────────
  // Handlers（store 作用域；wrapper 已完成 sessionId 路由与 settled/turn 守卫）
  // ────────────────────────────────────────────────────────────────────
  const handleStreamEvent = (sessionId: string, ts: TurnState, streamEvent: any) => {
    const ev = streamEvent.event || streamEvent

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      sessionStore.logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(text) | accLen=${ts.accumulatedContent.length}`)
      ts.currentTextEventId = null
      ensureTextTimelineEvent(sessionId, ts)
      if (ts.accumulatedContent.length > 0 && !ts.accumulatedContent.endsWith('\n')) {
        ts.accumulatedContent += '\n\n'
        streamingContents.value.set(sessionId, ts.accumulatedContent)
        nextTick(() => {
          sessionStore.updateMessage(ts.assistantMessageId, { content: ts.accumulatedContent }, sessionId)
        })
      }
    }

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
      sessionStore.logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(thinking)`)
      if (ts.currentReasoningEventId) {
        updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, { status: 'completed' })
      }
      const s = sessionStore.sessions.find(s => s.id === sessionId)
      if (s) {
        const msg = s.messages.find(m => m.id === ts.assistantMessageId)
        if (msg) {
          if (!msg.reasoning) {
            msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
          }
          ts.currentReasoningEventId = crypto.randomUUID()
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
      const textEventId = ensureTextTimelineEvent(sessionId, ts)
      ts.accumulatedContent += ev.delta.text
      streamingContents.value.set(sessionId, ts.accumulatedContent)
      const msg = getAssistantMessage(sessionId, ts)
      const textEvent = msg?.timelineEvents?.find(event => event.id === textEventId)
      updateTimelineEvent(sessionId, ts, textEventId, {
        content: `${textEvent?.content || ''}${ev.delta.text}`,
        status: 'running'
      })
      nextTick(() => {
        sessionStore.updateMessage(ts.assistantMessageId, { content: ts.accumulatedContent }, sessionId)
      })
    }

    if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta?.thinking) {
      ts.streamingHandledThinking = true
      const s = sessionStore.sessions.find(s => s.id === sessionId)
      if (s) {
        const msg = s.messages.find(m => m.id === ts.assistantMessageId)
        if (msg) {
          if (!msg.reasoning) {
            msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
          }
          msg.reasoning.content += ev.delta.thinking
          if (!ts.currentReasoningEventId) {
            ts.currentReasoningEventId = crypto.randomUUID()
            addTimelineEvent(sessionId, ts, {
              id: ts.currentReasoningEventId,
              type: 'reasoning',
              timestamp: Date.now(),
              status: 'running',
              content: ''
            })
          }
          const reasoningEvent = msg.timelineEvents?.find(event => event.id === ts.currentReasoningEventId)
          updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, {
            content: `${reasoningEvent?.content || ''}${ev.delta.thinking}`,
            status: 'running'
          })
          // 不在此处调用 saveToStorage()：thinking_delta 每秒可达数十次，
          // 频繁持久化会阻塞主线程。thinking 内容会在 turn 结束时
          // 由 handleResult 中的 saveToStorage() 统一持久化。
        }
      }
    }
  }

  const handleAssistant = (sessionId: string, ts: TurnState, assistant: any) => {
    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] assistant event received`)

    const apiUsage = assistant.message?.usage
    if (apiUsage) {
      const s = sessionStore.sessions.find(sess => sess.id === sessionId)
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
          useContextUsageStore().applyFallback(sessionId)
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
              updateTimelineEvent(sessionId, ts, textEventId, {
                content: `${textEvent?.content || ''}${block.text}`,
                status: 'running'
              })
            } else if (block.type === 'thinking') {
              if (ts.streamingHandledThinking) continue
              const thinkingText = block.thinking || block.text || ''
              if (thinkingText) {
                completeCurrentTextEvent(sessionId, ts)
                const s = sessionStore.sessions.find(s => s.id === sessionId)
                if (s) {
                  const msg = s.messages.find(m => m.id === ts.assistantMessageId)
                  if (msg) {
                    if (!msg.reasoning) {
                      msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                    }
                    msg.reasoning.content += thinkingText
                    if (!ts.currentReasoningEventId) {
                      ts.currentReasoningEventId = crypto.randomUUID()
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
                      content: `${reasoningEvent?.content || ''}${thinkingText}`,
                      status: 'completed'
                    })
                    ts.streamingHandledThinking = true
                  }
                }
              }
            } else if (block.type === 'tool_use' && block.id) {
              addToolTimelineEvent(sessionId, ts, block.id)
            }
          }

          if (ts.accumulatedContent) {
            sessionStore.updateMessage(ts.assistantMessageId, { content: ts.accumulatedContent }, sessionId)
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
            updateTimelineEvent(sessionId, ts, textEventId, {
              content: `${textEvent?.content || ''}${deltaText}`,
              status: 'running'
            })
            sessionStore.updateMessage(ts.assistantMessageId, { content: ts.accumulatedContent }, sessionId)
          }

          const reasoningContent = content
            .filter((c: any) => c.type === 'thinking')
            .map((c: any) => c.thinking || c.text || '')
            .join('')

          if (reasoningContent && !ts.streamingHandledThinking) {
            const s = sessionStore.sessions.find(s => s.id === sessionId)
            if (s) {
              const msg = s.messages.find(m => m.id === ts.assistantMessageId)
              if (msg) {
                if (!msg.reasoning) {
                  msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
                }
                msg.reasoning.content += reasoningContent
                if (!ts.currentReasoningEventId) {
                  ts.currentReasoningEventId = crypto.randomUUID()
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
                ts.streamingHandledThinking = true
                sessionStore.saveToStorage()
              }
            }
          }
        }

        const toolUses = content.filter((c: any) => c.type === 'tool_use')
        for (const toolUse of toolUses) {
          const s = sessionStore.sessions.find(s => s.id === sessionId)
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
                sessionStore.saveToStorage()
              }
            }
          }
        }
      }
    }
  }

  const handleToolUse = (sessionId: string, ts: TurnState, toolUse: any) => {
    const toolNameLog = toolUse.name || toolUse.tool_use?.name || 'Unknown Tool'
    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_use event | name=${toolNameLog}`)
    const s = sessionStore.sessions.find(s => s.id === sessionId)
    if (s) {
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
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

          sessionStore.traceEvent({
            sessionId,
            actor: 'tool',
            type: traceType,
            status: 'started',
            title: toolName,
            input: toolInput,
            metadata: { toolId, assistantMessageId: ts.assistantMessageId },
          })
          addToolTimelineEvent(sessionId, ts, toolId)
          sessionStore.saveToStorage()
        }
      }
    }
  }

  const handleToolResult = (sessionId: string, ts: TurnState, toolResult: any) => {
    const resultToolUseIdLog = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
    const resultIsErrorLog = toolResult.is_error || toolResult.tool_result?.is_error
    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_result event | toolUseId=${resultToolUseIdLog?.slice(0, 8)} | error=${!!resultIsErrorLog}`)
    const s = sessionStore.sessions.find(s => s.id === sessionId)
    if (s) {
      const msg = s.messages.find(m => m.id === ts.assistantMessageId)
      if (msg?.toolCalls) {
        const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
        const rawResultOutput = toolResult.output ?? toolResult.content ?? toolResult.tool_result?.output ?? toolResult.tool_result?.content
        let resultOutput = typeof rawResultOutput === 'string' ? rawResultOutput : JSON.stringify(rawResultOutput)
        // 截断过长的工具输出，防止内存累积导致 OOM
        if (resultOutput.length > MAX_INMEMORY_TOOL_OUTPUT) {
          resultOutput = resultOutput.slice(0, MAX_INMEMORY_TOOL_OUTPUT) + '\n\n[Output truncated to prevent memory overflow]'
        }
        const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error

        sessionStore.updateTaskStateFromToolResult(msg.toolCalls, resultToolUseId, resultOutput)

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

          sessionStore.traceEvent({
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
          sessionStore.saveToStorage()

          // After file-modifying tools complete, refresh SCM and file tree so
          // that newly created/edited files appear immediately in the source
          // control panel and environment card — without waiting for the
          // (possibly non-recursive) fs watcher to notice the change.
          if (FILE_TOOLS.has(toolName) || COMMAND_TOOLS.has(toolName)) {
            window.dispatchEvent(new CustomEvent('scm:refresh'))
            window.dispatchEvent(new CustomEvent('refresh-file-tree'))
          }

          // ★ 子智能体（Agent 工具）遇到可恢复错误（429 / 5xx 等）时触发自动重试。
          // 引擎在子智能体 LLM 调用遭遇 429 后，若内部重试耗尽，会将错误以
          // tool_result(is_error=true) 形式返回给主会话。主会话 LLM 看到错误后
          // 通常直接报告给用户而非重试，导致子智能体任务被直接结束。
          // 此处检测 Agent 工具的可恢复错误，路由到 handleError 触发自动重试，
          // 使主会话重新发送用户消息（从而重新调用子智能体）。
          if (resultIsError && (toolName === 'Agent' || toolName === 'Task')) {
            const lowerOutput = resultOutput.toLowerCase()
            const isRetryableError = lowerOutput.includes('429')
              || lowerOutput.includes('rate_limit')
              || lowerOutput.includes('rate limit')
              || lowerOutput.includes('overloaded')
              || lowerOutput.includes('529')
              || /5\d{2}/.test(lowerOutput)
              || lowerOutput.includes('server error')
              || lowerOutput.includes('internal server')
            if (isRetryableError && !autoRetry.retryStates.value.has(sessionId) && !ts.settled) {
              sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] Agent tool result has retryable error, routing to handleError | toolName=${toolName} | output=${resultOutput.slice(0, 120)}`)
              handleError(sessionId, ts, new Error(resultOutput))
            }
          }
        }
      }
    }
  }

  const handleUser = (sessionId: string, ts: TurnState, userMsg: any) => {
    if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
      const toolResults = userMsg.message.content.filter((c: any) => c.type === 'tool_result')
      for (const toolResult of toolResults) {
        const s = sessionStore.sessions.find(s => s.id === sessionId)
        if (s) {
          const msg = s.messages.find(m => m.id === ts.assistantMessageId)
          if (msg?.toolCalls) {
            const toolCallIndex = msg.toolCalls.findIndex(tc => tc.id === toolResult.tool_use_id)
            if (toolCallIndex >= 0) {
              const rawUserToolOutput = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)
              // 截断过长的工具输出，防止内存累积导致 OOM
              const truncatedUserToolOutput = rawUserToolOutput.length > MAX_INMEMORY_TOOL_OUTPUT
                ? rawUserToolOutput.slice(0, MAX_INMEMORY_TOOL_OUTPUT) + '\n\n[Output truncated to prevent memory overflow]'
                : rawUserToolOutput
              // Sync task state (TaskCreate/TaskUpdate/TaskList/TodoWrite) from tool
              // results that arrive embedded in user messages. The engine may send
              // tool results as user messages (containing tool_result content blocks)
              // rather than as separate tool_result SDK messages; without this call
              // the taskManager would never be updated, causing the global task board
              // to stay empty and only the last inline task card to render.
              sessionStore.updateTaskStateFromToolResult(msg.toolCalls, toolResult.tool_use_id, truncatedUserToolOutput)
              const updatedToolCalls = [...msg.toolCalls]
              updatedToolCalls[toolCallIndex] = {
                ...updatedToolCalls[toolCallIndex],
                status: toolResult.is_error ? 'error' : 'completed',
                output: truncatedUserToolOutput,
                endTime: Date.now()
              }
              msg.toolCalls = updatedToolCalls
              recordAgentToolCall(s, updatedToolCalls[toolCallIndex], toolResult.is_error ? 'failed' : 'completed')
              updateTimelineEvent(sessionId, ts, `tool-${toolResult.tool_use_id}`, {
                status: toolResult.is_error ? 'error' : 'completed'
              })
              sessionStore.saveToStorage()

              // ★ 子智能体（Agent/Task 工具）遇到可恢复错误时触发自动重试
              // （与 handleToolResult 中的逻辑一致，此处覆盖 tool_result 嵌入
              // user 消息的另一条路径）
              if (toolResult.is_error) {
                const agentToolName = updatedToolCalls[toolCallIndex].name
                if (agentToolName === 'Agent' || agentToolName === 'Task') {
                  const lowerOutput = truncatedUserToolOutput.toLowerCase()
                  const isRetryableError = lowerOutput.includes('429')
                    || lowerOutput.includes('rate_limit')
                    || lowerOutput.includes('rate limit')
                    || lowerOutput.includes('overloaded')
                    || lowerOutput.includes('529')
                    || /5\d{2}/.test(lowerOutput)
                    || lowerOutput.includes('server error')
                    || lowerOutput.includes('internal server')
                  if (isRetryableError && !autoRetry.retryStates.value.has(sessionId) && !ts.settled) {
                    sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] Agent tool result (via user msg) has retryable error, routing to handleError | toolName=${agentToolName} | output=${truncatedUserToolOutput.slice(0, 120)}`)
                    handleError(sessionId, ts, new Error(truncatedUserToolOutput))
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const handleResult = (sessionId: string, ts: TurnState, result: any) => {
    if (ts.settled) return

    // ★ 检查 CLI 返回的 is_error 标记
    // Claude Code CLI 在遇到 API 错误（如 429 rate limit exceeded on dimension: tpm）
    // 时，会返回 type=result, is_error=true, result="API Error: ..."。
    // 这种情况需要走 handleError 流程（会触发自动重试 + 指数退避），
    // 而非当作正常完成将错误文本显示为助手回复。
    if (result?.is_error) {
      const errorText = typeof result.result === 'string' && result.result
        ? result.result
        : 'API error'
      sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] result event has is_error=true, routing to handleError | errorText=${errorText.slice(0, 120)}`)
      handleError(sessionId, ts, new Error(errorText))
      return
    }

    ts.settled = true
    result = result || {}
    const elapsed = Date.now() - ts.sendStartTime
    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] result event (LLM response complete) | totalElapsed=${elapsed}ms | accContentLen=${ts.accumulatedContent.length} | stopReason=${result.stop_reason || '(none)'}`)
    streamingContents.value.set(sessionId, '')
    loadingSessions.value.set(sessionId, false)

    // 重试成功：清理重试状态，UI 上的 RetryIndicator 消失
    if (autoRetry.retryStates.value.has(sessionId)) {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry succeeded, clearing retry state`)
      autoRetry.clearOnSuccess(sessionId)
    }

    const s = sessionStore.sessions.find(s => s.id === sessionId)
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

        void useContextUsageStore().refresh(sessionId, true)
        sessionStore.traceEvent({
          sessionId,
          messageId: ts.assistantMessageId,
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

        sessionStore.traceEvent({
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

        // 空的自动续跑 turn（开 turn 即 result、无任何内容）→ 摘除占位消息，避免空气泡
        if (ts.isAutonomous && !msg.content && !msg.toolCalls?.length && !msg.reasoning) {
          const idx = s.messages.findIndex(m => m.id === ts.assistantMessageId)
          if (idx >= 0) s.messages.splice(idx, 1)
        }

        sessionStore.saveToStorage()

        // 产物汇总：仅办公模式，回合结束后对 outputs/ 做 mtime 快照对比，
        // 把本回合新生成/修改的产物写入该助手消息元数据并持久化。
        if (s.mode === 'work' && s.workingDirectory) {
          const workingDir = s.workingDirectory
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const { artifacts } = await api.artifacts.list(workingDir)
              // 1s 容差，与 ArtifactsPanel 现有约定一致；mtime>=回合开始即本回合新增/修改
              const produced = (artifacts || []).filter(a => a.mtime >= turnStart - 1000)
              if (produced.length === 0) return
              const sess = sessionStore.sessions.find(x => x.id === sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              target.metadata = { ...(target.metadata || {}), artifacts: produced }
              // 触发 MessageList 重建（其分组缓存按数组引用失效）
              sess.messages = [...sess.messages]
              sessionStore.saveToStorage()
            } catch (err) {
              console.error('[Artifacts] turn summary collect failed:', err)
            }
          })()
        }

        void sessionStore.loadTurnCheckpoints(sessionId, s.workingDirectory, true)
      }
    }

    ts.resolve?.()
    endTurn(sessionId, ts)
  }

  // ────────────────────────────────────────────────────────────────────
  // 自动重试：遇到可恢复错误时不展示技术详情，直接提示"正在重试 (n/m)"
  // ────────────────────────────────────────────────────────────────────

  /** 发起自动重试：更新 UI → 等待退避 → 重新发送用户消息 */
  async function initiateAutoRetry(
    sessionId: string,
    ts: TurnState,
    errorCategory: ErrorCategory,
    errorTitle: string,
    errorMessage: string,
    retryDelayHint?: number,
  ): Promise<void> {
    const state = autoRetry.recordRetryableError(sessionId, errorCategory, errorTitle, errorMessage, retryDelayHint, ts.assistantMessageId)
    const attempt = state.attempt
    const delayMs = state.delayMs

    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry scheduled | attempt=${attempt}/${state.maxRetries} | delay=${delayMs}ms | category=${errorCategory}`)

    // ① 更新助手消息：显示重试状态（不覆盖已有内容，保留 LLM 中断前的输出）
    const sessionForMsg = sessionStore.sessions.find(s => s.id === sessionId)
    const existingMsg = sessionForMsg?.messages.find(m => m.id === ts.assistantMessageId)
    sessionStore.updateMessage(ts.assistantMessageId, {
      metadata: {
        ...(existingMsg?.metadata || {}),
        model: settingsStore.config.model,
        retryState: { ...state },
      }
    }, sessionId)

    // ② 保持 loading 状态，让用户看到转圈
    loadingSessions.value.set(sessionId, true)

    // ③ 等待退避延迟
    await new Promise<void>(resolve => setTimeout(resolve, delayMs))

    // 检查是否被取消
    const cur = autoRetry.retryStates.value.get(sessionId)
    if (!cur || cur.aborted) {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry aborted by user`)
      return
    }

    // ④ 获取上一条用户消息
    const session = sessionStore.sessions.find(s => s.id === sessionId)
    if (!session) {
      autoRetry.removeRetryState(sessionId)
      return
    }

    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    if (!lastUserMsg) {
      autoRetry.removeRetryState(sessionId)
      return
    }

    // ⑤ 移除当前失败的助手占位消息（仅当消息无内容时；有内容则保留，让用户看到中断前的 LLM 输出）
    const failedIdx = session.messages.findIndex(m => m.id === ts.assistantMessageId)
    if (failedIdx >= 0) {
      const failedMsg = session.messages[failedIdx]
      if (!failedMsg.content && !failedMsg.toolCalls?.length && !failedMsg.reasoning) {
        session.messages.splice(failedIdx, 1)
      }
    }

    // ⑥ 结束当前 turn（不报错），为重试腾出位置
    if (ts.timeoutId) { clearTimeout(ts.timeoutId); ts.timeoutId = null }
    turnStates.delete(sessionId)

    // ⑦ 确保引擎进程存活：429 等错误会导致子进程退出
    try {
      const claudeCode = api.claudeCode
      if (claudeCode) {
        const status = await claudeCode.getSessionStatus(sessionId)
        if (!status?.isRunning || status?.status === 'exited') {
          sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry: engine process exited, restarting`)
          try { await claudeCode.stop(sessionId) } catch { /* ignore */ }
          session.processStatus = 'none'
          await sessionStore.initClaudeCodeSession(sessionId)
        }
      }
    } catch (e) {
      sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry: engine restart failed`, { error: String(e) })
    }

    // ⑧ 重新发送用户消息（不创建用户消息气泡，保留重试计数）
    try {
      await resendForRetry(sessionId, lastUserMsg.content)
    } catch (retryError) {
      sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry resendForRetry failed`, { error: String(retryError) })
    }
  }

  /** 自动重试内部：重新发送消息但不创建用户消息气泡 */
  async function resendForRetry(sessionId: string, content: string): Promise<void> {
    const session = sessionStore.sessions.find(s => s.id === sessionId)
    if (!session) return

    // ★ 清除用户中止标记（防御性：正常流程不应走到这里，但避免竞态）
    userAbortedSessions.delete(sessionId)

    const claudeCode = api.claudeCode
    if (!claudeCode) {
      sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] resendForRetry: claudeCode API not available`)
      return
    }

    loadingSessions.value.set(sessionId, true)
    if (session.processStatus !== 'active') {
      session.processStatus = 'active'
    }

    pendingSendMessages.add(sessionId)

    await new Promise<void>((resolve, reject) => {
      const ts = beginTurn(sessionId, { isAutonomous: false, resolve, reject })
      pendingSendMessages.delete(sessionId)

      claudeCode.sendMessage(sessionId, content).catch((error: any) => {
        sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] retry IPC sendMessage rejected`, { error: String(error) })
        const cur = turnStates.get(sessionId)
        if (cur === ts) handleError(sessionId, ts, error)
      })
    }).catch((error) => {
      sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] resendForRetry outer catch`, { error: String(error) })
      loadingSessions.value.set(sessionId, false)
      streamingContents.value.set(sessionId, '')
      pendingSendMessages.delete(sessionId)
    })
  }

  /** 用户手动取消自动重试 */
  async function cancelRetry(): Promise<void> {
    const sid = sessionStore.currentSessionId
    if (!sid) return
    const cancelled = autoRetry.cancelRetry(sid)
    if (!cancelled) return

    // 清理 loading 状态
    loadingSessions.value.set(sid, false)
    streamingContents.value.set(sid, '')

    // 清理 turn
    const ts = turnStates.get(sid)
    if (ts && !ts.settled) {
      if (ts.timeoutId) { clearTimeout(ts.timeoutId); ts.timeoutId = null }
      ts.settled = true
      ts.resolve?.()
      turnStates.delete(sid)
    }

    autoRetry.removeRetryState(sid)

    const s = sessionStore.sessions.find(sx => sx.id === sid)
    if (s) {
      s.processStatus = 'idle'
      sessionStore.saveToStorage()
    }
  }

  const handleError = (sessionId: string, ts: TurnState, error: any) => {
    if (ts.settled) return
    const elapsed = Date.now() - ts.sendStartTime
    sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })

    // ★ 用户主动 abort 后的错误（如 "API Error: Request was abort"）：
    // 不展示错误 toast、不触发自动重试，静默结束 turn。
    // 用户已知道自己点了停止，不需要看到技术错误详情。
    if (userAbortedSessions.has(sessionId)) {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] error suppressed after user abort`) 
      ts.settled = true
      loadingSessions.value.set(sessionId, false)
      streamingContents.value.set(sessionId, '')
      autoRetry.removeRetryState(sessionId)
      const s = sessionStore.sessions.find(sx => sx.id === sessionId)
      if (s) {
        s.processStatus = 'idle'
        sessionStore.saveToStorage()
      }
      endTurn(sessionId, ts)
      return
    }

    // 先分类错误（不触发 toast，仅用于判断是否可重试）
    const classified = errorHandler.classifyError(error, {
      sessionId,
      provider: settingsStore.config.provider,
      model: settingsStore.config.model,
      baseUrl: settingsStore.config.baseUrl,
      phase: 'stream',
    })

    // ★ 拦截可恢复错误：自动重试，不展示技术错误详情
    if (autoRetry.shouldAutoRetry(sessionId, classified.retryable, userAbortedSessions)) {
      // ★ 中断引擎进程：对于子智能体（Agent tool）的 429 等可恢复错误，
      // 错误通过 tool_result 返回主会话后，引擎的主查询循环仍在继续——
      // LLM 会看到错误 tool_result 并生成回复，回复完成后的 result 事件
      // 会触发 handleResult → clearOnSuccess，清除重试状态，导致
      // initiateAutoRetry 的定时器到期时重试已被取消。
      // 通过 abort 中断引擎并设置 ts.settled，阻止后续事件处理，
      // 确保重试定时器不被竞态清除。
      // 对于主 LLM 的 429（引擎已返回 result 并退出），abort 为无操作。
      const claudeCode = api.claudeCode
      if (claudeCode) {
        try { claudeCode.abort(sessionId) } catch { /* ignore */ }
      }

      // 设置 ts.settled 阻止后续事件（引擎中断后的残留 result/assistant 等）
      // 被此 turn 处理。initiateAutoRetry 不依赖 ts.settled，它会自行删除 turn。
      ts.settled = true
      void initiateAutoRetry(sessionId, ts, classified.category, classified.title, classified.message, classified.retryDelay)
      return
    }

    // ── 以下为不可恢复错误或重试耗尽的最终处理 ──
    ts.settled = true
    loadingSessions.value.set(sessionId, false)
    streamingContents.value.set(sessionId, '')

    // 清理重试状态
    const hadRetry = autoRetry.retryStates.value.has(sessionId)
    autoRetry.removeRetryState(sessionId)

    // 触发 toast / 日志 / inlineError
    errorHandler.handleError(error, {
      sessionId,
      provider: settingsStore.config.provider,
      model: settingsStore.config.model,
      baseUrl: settingsStore.config.baseUrl,
      phase: 'stream',
    })

    sessionStore.traceEvent({
      sessionId,
      messageId: ts.assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'failed',
      title: hadRetry ? 'Assistant turn failed (retries exhausted)' : 'Assistant turn failed',
      error: { message: classified.technicalDetail },
    })

    sessionStore.updateMessage(ts.assistantMessageId, {
      content: classified.message,
      metadata: {
        model: settingsStore.config.model,
        duration: Date.now() - ts.sendStartTime,
        error: classified,
      }
    }, sessionId)

    const s = sessionStore.sessions.find(s => s.id === sessionId)
    if (s) {
      s.processStatus = 'exited'
      sessionStore.saveToStorage()
    }

    ts.reject?.(error)
    endTurn(sessionId, ts)
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

    sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] process exit event | code=${exitCode}${signal ? ` | signal=${signal}` : ''}${stderrTail ? ` | stderr=${stderrTail.slice(0, 200)}` : ''}`)

    if (exitCode !== null && exitCode !== 0) {
      const detail = stderrTail
        ? stderrTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
        : undefined
      const msg = detail
        ? `Process exited with code ${exitCode}: ${detail}`
        : `Process exited with code ${exitCode}`
      handleError(sessionId, ts, new Error(msg))
    } else {
      handleResult(sessionId, ts, {})
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 持久订阅（store 初始化时注册一次，按 sessionId 多路复用，永不退订）
  // ────────────────────────────────────────────────────────────────────
  const claudeCodeApi = api.claudeCode
  if (claudeCodeApi) {
    claudeCodeApi.onStreamEvent((event: { sessionId: string; data: any }) => {
      // ★ 不在此处清除重试状态：stream_event 可能是 CLI 初始化 / 系统消息等
      // 非 LLM 事件，过早清除会导致重试计数永远不递增（无限重试 bug）。
      const ts = ensureTurn(event.sessionId)
      if (ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleStreamEvent(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onAssistant((event: { sessionId: string; data: any }) => {
      if (isTeammateRawMessage(event.data)) {
        sessionStore.recordTeammateMessage(event.data, event.sessionId)
        return
      }
      // ★ 拦截子智能体（Agent tool）的 sidechain 消息，路由到子智能体转录。
      // 不创建 teamContext，不干扰主时间线，供 AgentToolCard 读取。
      if (isSidechainMessage(event.data)) {
        sessionStore.recordSubagentMessage(event.data, event.sessionId)
        return
      }
      // ★ 对于纯文本 / reasoning 的 assistant 回复（无 tool_use），
      // 可以认为本轮 LLM 调用已成功完成，立即清除重试状态，避免 handleResult
      // 未到达时 indicator 一直不消失。含 tool_use 的回复需等待 handleResult。
      const content = event.data?.message?.content
      const hasToolUse = Array.isArray(content) && content.some((c: any) => c.type === 'tool_use')
      if (!hasToolUse && autoRetry.retryStates.value.has(event.sessionId)) {
        sessionStore.logger.info('ChatStore', `[${event.sessionId.slice(0, 8)}] onAssistant: text response received, clearing retry state`)
        autoRetry.clearOnSuccess(event.sessionId)
      }

      const ts = ensureTurn(event.sessionId)
      if (ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleAssistant(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onToolUse((event: { sessionId: string; data: any }) => {
      if (isTeammateRawMessage(event.data)) {
        sessionStore.recordTeammateMessage(event.data, event.sessionId)
        return
      }
      if (isSidechainMessage(event.data)) {
        sessionStore.recordSubagentMessage(event.data, event.sessionId)
        return
      }
      // ★ 不在此处清除重试状态：tool_use 只是 assistant 消息的一部分，
      // 并不代表整个请求成功完成。重试状态只在 handleResult 成功时清除。
      const ts = ensureTurn(event.sessionId)
      if (ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleToolUse(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onToolResult((event: { sessionId: string; data: any }) => {
      if (isTeammateRawMessage(event.data)) {
        sessionStore.recordTeammateMessage(event.data, event.sessionId)
        return
      }
      if (isSidechainMessage(event.data)) {
        sessionStore.recordSubagentMessage(event.data, event.sessionId)
        return
      }
      const ts = turnStates.get(event.sessionId)
      if (!ts || ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleToolResult(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onUser((event: { sessionId: string; data: any }) => {
      if (isTeammateRawMessage(event.data)) {
        sessionStore.recordTeammateMessage(event.data, event.sessionId)
        return
      }
      if (isSidechainMessage(event.data)) {
        sessionStore.recordSubagentMessage(event.data, event.sessionId)
        return
      }
      const ts = turnStates.get(event.sessionId)
      if (!ts || ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleUser(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onResult((event: { sessionId: string; data: any }) => {
      // ★ 拦截 sidechain / teammate 的 result 事件，防止子智能体 turn 结束
      // 被当作主会话 result 处理（提前结算主会话 turn）。
      // 注意：不在此处触发 handleError — 429 等可恢复错误应通过 Agent tool 的
      // tool_result 路径触发重试（见 handleToolResult 中的检测），避免
      // sidechain result 与 tool_result 双重触发重试导致竞态。
      if (isTeammateRawMessage(event.data)) {
        sessionStore.recordTeammateMessage(event.data, event.sessionId)
        return
      }
      if (isSidechainMessage(event.data)) {
        sessionStore.recordSubagentMessage(event.data, event.sessionId)
        return
      }

      const ts = turnStates.get(event.sessionId)
      if (!ts) return
      handleResult(event.sessionId, ts, event.data ?? {})
    })
    claudeCodeApi.onExit((event: { sessionId: string; data: number | null | { code?: number | null; signal?: string | null; stderr?: string } }) => {
      const ts = turnStates.get(event.sessionId)
      if (!ts) return
      handleExit(event.sessionId, ts, event.data)
    })
  }

  interface MessageAttachments {
    files?: { name: string; path: string; isFolder: boolean }[]
    images?: { id: string; name: string; type: 'image'; mimeType: string; previewUrl: string; data: string }[]
  }

  async function sendMessage(content: string, userMessageContent?: string, attachments?: MessageAttachments): Promise<void> {
    if (!sessionStore.currentSessionId) {
      sessionStore.createSession()
    }

    const targetSessionId = sessionStore.currentSessionId!
    // ★ 清除用户中止标记：用户主动发新消息时恢复正常运行
    userAbortedSessions.delete(targetSessionId)
    // ★ 新用户消息代表新一轮请求开始，清理可能残留的自动重试状态
    autoRetry.removeRetryState(targetSessionId)
    const session = sessionStore.sessions.find(s => s.id === targetSessionId)
    if (!session) return

    // ── 立即设置 loading 状态，让用户在发送消息的瞬间就看到转圈 ──
    // 避免 initClaudeCodeSession 的异步等待期间用户看到绿点（idle）误以为已完成。
    // beginTurn 会再次设置这些值，此处提前设置仅用于消除 UI 空窗期。
    loadingSessions.value.set(targetSessionId, true)
    if (session.processStatus !== 'active') {
      session.processStatus = 'active'
    }

    // ── 标记 sendMessage 进行中，防止 ensureTurn 在 addMessage → beginTurn 窗口期 ──
    // 创建 autonomous turn 消费事件或被提前结算。
    // beginTurn 执行后 turnStates 中已有 turn，ensureTurn 会直接返回它，标记可清除。
    pendingSendMessages.add(targetSessionId)

    sessionStore.logger.info('ChatStore', `sendMessage: user message | sessionId=${targetSessionId.slice(0, 8)} | contentLen=${content.length} | preview="${content.slice(0, 80)}"`)
    sessionStore.traceEvent({
      sessionId: targetSessionId,
      actor: 'user',
      type: 'user_message',
      status: 'completed',
      title: 'User submitted message',
      input: { content: userMessageContent ?? content },
      metadata: { contentLength: content.length },
    })

    sessionStore.addMessage({
      role: 'user',
      content: userMessageContent ?? content,
      attachments: attachments?.files,
      imageAttachments: attachments?.images
    }, targetSessionId)

    if (attachments?.images?.length) {
      for (const img of attachments.images) {
        if (img.id && img.data) {
          api.image?.save?.(img.id, img.data).catch(() => {})
        }
      }
    }

    const claudeCode = api.claudeCode
    if (!claudeCode) {
      sessionStore.logger.error('ChatStore', `sendMessage: claudeCode API not available | sessionId=${targetSessionId.slice(0, 8)}`)
      const classified = errorHandler.handleError(new Error('Claude Code CLI is not available. Please check your configuration.'), {
        sessionId: targetSessionId,
        phase: 'init',
      })
      setTimeout(() => {
        sessionStore.addMessage({
          role: 'assistant',
          content: classified.message,
          metadata: { error: classified }
        }, targetSessionId)
        loadingSessions.value.set(targetSessionId, false)
        pendingSendMessages.delete(targetSessionId)
      }, 500)
      return
    }

    try {
      await sessionStore.initClaudeCodeSession(targetSessionId)
    } catch (error) {
      pendingSendMessages.delete(targetSessionId)
      loadingSessions.value.set(targetSessionId, false)
      const s = sessionStore.sessions.find(s => s.id === targetSessionId)
      if (s) s.processStatus = 'idle'
      throw error
    }

    sessionStore.logger.info('ChatStore', `sendMessage: calling IPC sendMessage | sessionId=${targetSessionId.slice(0, 8)}`)

    if (turnStates.has(targetSessionId)) {
      sessionStore.logger.warn('ChatStore', `sendMessage: a turn is already in flight for this session, skipping new turn setup | sessionId=${targetSessionId.slice(0, 8)}`)
    }

    await new Promise<void>((resolve, reject) => {
      const ts = beginTurn(targetSessionId, { isAutonomous: false, resolve, reject })
      // beginTurn 已将 turn 写入 turnStates，ensureTurn 后续会直接返回它，
      // 安全清除 sendMessage 进行中标记。
      pendingSendMessages.delete(targetSessionId)

      const plainImages = attachments?.images?.map(img => ({
        id: img.id,
        name: img.name,
        type: img.type,
        mimeType: img.mimeType,
        previewUrl: img.previewUrl,
        data: img.data,
      }))
      claudeCode.sendMessage(targetSessionId, content, plainImages).catch((error: any) => {
        sessionStore.logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] IPC sendMessage rejected`, { error: String(error) })
        const cur = turnStates.get(targetSessionId)
        if (cur === ts) handleError(targetSessionId, ts, error)
      })
    }).catch((error) => {
      sessionStore.logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] sendMessage outer catch`, { error: String(error) })
      loadingSessions.value.set(targetSessionId, false)
      streamingContents.value.set(targetSessionId, '')
      pendingSendMessages.delete(targetSessionId)
    })
  }

  async function abort(): Promise<void> {
    const sid = sessionStore.currentSessionId
    sessionStore.logger.info('ChatStore', `abort | sessionId=${sid?.slice(0, 8) || '(none)'}`)

    // ★ 在 await 之前先标记用户主动中止，防止 await 期间引擎错误事件
    // 到达后通过 handleError → shouldAutoRetry 触发自动重试。
    if (sid) {
      userAbortedSessions.add(sid)
    }

    const claudeCode = api.claudeCode
    if (claudeCode && sid) {
      try {
        await claudeCode.abort(sid)
      } catch (error) {
        sessionStore.logger.error('ChatStore', `abort failed | sessionId=${sid.slice(0, 8)}`, { error: String(error) })
      }
    }
    if (sid) {
      pendingSendMessages.delete(sid)
      loadingSessions.value.set(sid, false)
      streamingContents.value.set(sid, '')

      // 清理自动重试状态
      autoRetry.cancelRetry(sid)
      autoRetry.removeRetryState(sid)

      const ts = turnStates.get(sid)
      if (ts && !ts.settled) {
        ts.settled = true
        ts.resolve?.()
        endTurn(sid, ts)
        const s = sessionStore.sessions.find(s => s.id === sid)
        if (s) {
          s.processStatus = 'idle'
          sessionStore.saveToStorage()
        }
      }
    }
  }

  async function retryLastMessage(): Promise<void> {
    const sid = sessionStore.currentSessionId
    if (!sid) return
    // ★ 清除用户中止标记：用户主动重试时恢复正常运行
    userAbortedSessions.delete(sid)
    errorHandler.clearInlineError(sid)
    const session = sessionStore.sessions.find(s => s.id === sid)
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
        if (claudeCode) {
          sessionStore.logger.info('ChatStore', `retryLastMessage: attempting to suspend and resume session | sessionId=${sid.slice(0, 8)}`)
          try {
            if (session.processStatus === 'active' || session.processStatus === 'idle') {
              claudeCode.suspendSession?.(sid)
              session.processStatus = 'suspended'
              sessionStore.saveToStorage()
              await new Promise(resolve => setTimeout(resolve, 100))
            }
            const status = await claudeCode.getSessionStatus(sid)
            if (!status?.isRunning || status?.status === 'exited') {
              await claudeCode.stop(sid)
              session.processStatus = 'none'
              sessionStore.saveToStorage()
            }
          } catch (e) {
            sessionStore.logger.warn('ChatStore', `retryLastMessage: suspend failed, falling back to stop | sessionId=${sid.slice(0, 8)}`, { error: String(e) })
            try {
              await claudeCode.stop(sid)
            } catch (e2) {
              // 停止失败也不要紧，继续尝试
            }
            session.processStatus = 'none'
            sessionStore.saveToStorage()
          }
        }

        const existingUserMsgIndex = session.messages.findIndex(m => m.role === 'user' && m.content === lastUserMsg.content)
        if (existingUserMsgIndex >= 0) {
          session.messages.splice(existingUserMsgIndex, 1)
          sessionStore.saveToStorage()
        }

        await sendMessage(lastUserMsg.content)
      } catch (error) {
        sessionStore.logger.error('ChatStore', `retryLastMessage: failed | sessionId=${sid.slice(0, 8)}`, { error: String(error) })
      }
    }
  }

  async function submitToolAnswer(messageId: string, toolCallId: string, answers: Record<string, string>): Promise<void> {
    const sid = sessionStore.currentSessionId
    if (!sid) return

    sessionStore.logger.info('ChatStore', `submitToolAnswer: submitting answers | sessionId=${sid.slice(0, 8)} | messageId=${messageId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)

    const claudeCode = api.claudeCode
    if (!claudeCode) {
      sessionStore.logger.error('ChatStore', 'submitToolAnswer: claudeCode API not available')
      return
    }

    try {
      await claudeCode.submitToolAnswer(sid, toolCallId, answers)
      sessionStore.updateToolCall(messageId, toolCallId, 'completed')
      sessionStore.logger.info('ChatStore', `submitToolAnswer: answers submitted successfully`)
    } catch (error) {
      sessionStore.logger.error('ChatStore', 'submitToolAnswer: failed', { error: String(error) })
      throw error
    }
  }

  async function skipToolAnswer(messageId: string, toolCallId: string): Promise<void> {
    const sid = sessionStore.currentSessionId
    if (!sid) return

    sessionStore.logger.info('ChatStore', `skipToolAnswer: skipping tool | sessionId=${sid.slice(0, 8)} | messageId=${messageId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)

    const claudeCode = api.claudeCode
    if (!claudeCode) {
      sessionStore.logger.error('ChatStore', 'skipToolAnswer: claudeCode API not available')
      return
    }

    try {
      await claudeCode.skipToolAnswer(sid, toolCallId)
      sessionStore.updateToolCall(messageId, toolCallId, 'completed')
      sessionStore.logger.info('ChatStore', `skipToolAnswer: tool skipped successfully`)
    } catch (error) {
      sessionStore.logger.error('ChatStore', 'skipToolAnswer: failed', { error: String(error) })
      throw error
    }
  }

  return {
    streamingContents,
    loadingSessions,
    isLoading,
    streamingContent,
    getIsLoading,
    getStreamingContent,
    sendMessage,
    abort,
    retryLastMessage,
    submitToolAnswer,
    skipToolAnswer,
    // Auto Retry
    retryStates: autoRetry.retryStates,
    cancelRetry,
    // Pending Messages
    pendingMessages,
    addPendingMessage,
    removePendingMessage,
    recallPendingMessage,
    getPendingMessages,
    clearPendingMessages,
  }
})
