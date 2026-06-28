import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message } from '@/types'
import { ErrorCategory } from '@/types'
import type { RetryState } from '@/types'
import { useSettingsStore } from './settings'
import { useContextUsageStore } from './contextUsage'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import {
  isTeammateRawMessage,
  recordAgentToolCall,
} from '@/services/teamTranscriptService'
import { useChatSessionStore } from './chatSession'

const FILE_TOOLS = new Set(['Write', 'FileWrite', 'Edit', 'FileEdit', 'MultiEdit'])
const COMMAND_TOOLS = new Set(['Bash'])
const VERIFICATION_PATTERNS = [/^\s*(npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test|jest|vitest|mocha|npx\s+playwright|ruff|eslint|biome|prettier|tsc|vue-tsc|npm\s+run\s+(test|lint|check|build|typecheck))/i]

const REQUEST_TIMEOUT = 5 * 60 * 1000               // 用户发起 turn 的空闲超时（硬超时报错）
const AUTONOMOUS_REQUEST_TIMEOUT = 45 * 60 * 1000   // 后台 agent 自动续跑可长跑（软收尾）

// ── 自动重试配置 ──
// 遇到可恢复错误（429 / 5xx / 网络错误 / 超时 / 进程退出）时，
// 不展示技术错误详情，直接在聊天页显示"正在重试 (n/m)"并自动重发用户消息。
const MAX_AUTO_RETRIES = 5                            // 最大重试次数
const INITIAL_RETRY_DELAY_MS = 2_000                  // 首次退避 2s
const MAX_RETRY_DELAY_MS = 60_000                     // 最大退避 60s
const RETRY_JITTER_MS = 1_000                         // 随机抖动上限

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

  // ── sendMessage 进行中标记 ──
  // 防止 ensureTurn 在 sendMessage 的 addMessage → beginTurn 窗口期
  // 因 session.messages.length > 0 而自动创建 autonomous turn，
  // 导致事件被消费、turn 被提前结算，用户看到的响应延迟或丢失。
  const pendingSendMessages = new Set<string>()

  // ── 自动重试状态（响应式，供 UI 读取）──
  // sessionId → RetryState。非空时 UI 渲染 RetryIndicator 组件。
  const retryStates = ref<Map<string, RetryState>>(new Map())

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
    if (retryStates.value.has(sessionId)) {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry succeeded, clearing retry state`)
      retryStates.value.delete(sessionId)
      retryStates.value = new Map(retryStates.value)
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

        void sessionStore.loadTurnCheckpoints(sessionId)
      }
    }

    ts.resolve?.()
    endTurn(sessionId, ts)
  }

  // ────────────────────────────────────────────────────────────────────
  // 自动重试：遇到可恢复错误时不展示技术详情，直接提示"正在重试 (n/m)"
  // ────────────────────────────────────────────────────────────────────

  /** 判断当前错误是否应该自动重试 */
  function shouldAutoRetry(sessionId: string, retryable: boolean): boolean {
    if (!retryable) return false
    const state = retryStates.value.get(sessionId)
    const attempt = state?.attempt ?? 0
    return attempt < MAX_AUTO_RETRIES
  }

  /** 计算退避延迟：指数退避 + 随机抖动，尊重 Retry-After header */
  function computeRetryDelay(retryDelayHint?: number, attempt: number = 0): number {
    if (retryDelayHint && retryDelayHint > 0) {
      return Math.min(retryDelayHint, MAX_RETRY_DELAY_MS)
    }
    const exponential = Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS)
    const jitter = Math.random() * RETRY_JITTER_MS
    return Math.round(exponential + jitter)
  }

  /** LLM 开始响应时清除重试状态，复位重试计数 */
  function clearRetryStateOnResponse(sessionId: string): void {
    if (retryStates.value.has(sessionId)) {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] LLM responding after retry, resetting retry count`)
      retryStates.value.delete(sessionId)
      retryStates.value = new Map(retryStates.value)
    }
  }

  /** 发起自动重试：更新 UI → 等待退避 → 重新发送用户消息 */
  async function initiateAutoRetry(
    sessionId: string,
    ts: TurnState,
    errorCategory: ErrorCategory,
    errorTitle: string,
    errorMessage: string,
    retryDelayHint?: number,
  ): Promise<void> {
    const prev = retryStates.value.get(sessionId)
    const attempt = (prev?.attempt ?? 0) + 1
    const delayMs = computeRetryDelay(retryDelayHint, attempt - 1)
    const state: RetryState = {
      attempt,
      maxRetries: MAX_AUTO_RETRIES,
      errorCategory,
      errorTitle,
      errorMessage,
      delayMs,
      startedAt: Date.now(),
      aborted: false,
    }
    retryStates.value.set(sessionId, state)
    // 触发响应式更新
    retryStates.value = new Map(retryStates.value)

    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry scheduled | attempt=${attempt}/${MAX_AUTO_RETRIES} | delay=${delayMs}ms | category=${errorCategory}`)

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
    const cur = retryStates.value.get(sessionId)
    if (!cur || cur.aborted) {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry aborted by user`)
      return
    }

    // ④ 获取上一条用户消息
    const session = sessionStore.sessions.find(s => s.id === sessionId)
    if (!session) {
      retryStates.value.delete(sessionId)
      retryStates.value = new Map(retryStates.value)
      return
    }

    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    if (!lastUserMsg) {
      retryStates.value.delete(sessionId)
      retryStates.value = new Map(retryStates.value)
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
    const state = retryStates.value.get(sid)
    if (!state) return
    state.aborted = true
    retryStates.value = new Map(retryStates.value)

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

    retryStates.value.delete(sid)
    retryStates.value = new Map(retryStates.value)

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

    // 先分类错误（不触发 toast，仅用于判断是否可重试）
    const classified = errorHandler.classifyError(error, {
      sessionId,
      provider: settingsStore.config.provider,
      model: settingsStore.config.model,
      baseUrl: settingsStore.config.baseUrl,
      phase: 'stream',
    })

    // ★ 拦截可恢复错误：自动重试，不展示技术错误详情
    if (shouldAutoRetry(sessionId, classified.retryable)) {
      // 超时错误需要先 abort 引擎进程
      const claudeCode = api.claudeCode
      const errorMsg = String(error).toLowerCase()
      const isTimeoutError = errorMsg.includes('超时') || errorMsg.includes('timeout')
      if (isTimeoutError && claudeCode) {
        try { claudeCode.abort(sessionId) } catch { /* ignore */ }
      }

      // 不设置 ts.settled，保持 turn 存活；异步发起重试
      void initiateAutoRetry(sessionId, ts, classified.category, classified.title, classified.message, classified.retryDelay)
      return
    }

    // ── 以下为不可恢复错误或重试耗尽的最终处理 ──
    ts.settled = true
    loadingSessions.value.set(sessionId, false)
    streamingContents.value.set(sessionId, '')

    // 清理重试状态
    const hadRetry = retryStates.value.has(sessionId)
    retryStates.value.delete(sessionId)
    if (hadRetry) retryStates.value = new Map(retryStates.value)

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
      clearRetryStateOnResponse(event.sessionId)
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
      clearRetryStateOnResponse(event.sessionId)
      const ts = ensureTurn(event.sessionId)
      if (ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleAssistant(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onToolUse((event: { sessionId: string; data: any }) => {
      clearRetryStateOnResponse(event.sessionId)
      const ts = ensureTurn(event.sessionId)
      if (ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleToolUse(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onToolResult((event: { sessionId: string; data: any }) => {
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
      const ts = turnStates.get(event.sessionId)
      if (!ts || ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleUser(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onResult((event: { sessionId: string; data: any }) => {
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
      const retryState = retryStates.value.get(sid)
      if (retryState) {
        retryState.aborted = true
        retryStates.value.delete(sid)
        retryStates.value = new Map(retryStates.value)
      }

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
    retryStates,
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
