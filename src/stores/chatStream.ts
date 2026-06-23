import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import type { Message } from '@/types'
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

  const isLoading = computed(() =>
    sessionStore.currentSessionId ? (loadingSessions.value.get(sessionStore.currentSessionId) ?? false) : false
  )
  const streamingContent = computed(() =>
    sessionStore.currentSessionId ? (streamingContents.value.get(sessionStore.currentSessionId) ?? '') : ''
  )

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
    msg.timelineEvents = msg.timelineEvents.map(event =>
      event.id === eventId ? { ...event, ...updates } : event
    )
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
    return turnStates.get(sessionId) ?? beginTurn(sessionId, { isAutonomous: true })
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
          sessionStore.saveToStorage()
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
        const resultOutput = typeof rawResultOutput === 'string' ? rawResultOutput : JSON.stringify(rawResultOutput)
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
              const updatedToolCalls = [...msg.toolCalls]
              updatedToolCalls[toolCallIndex] = {
                ...updatedToolCalls[toolCallIndex],
                status: toolResult.is_error ? 'error' : 'completed',
                output: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
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
    ts.settled = true
    result = result || {}
    const elapsed = Date.now() - ts.sendStartTime
    sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] result event (LLM response complete) | totalElapsed=${elapsed}ms | accContentLen=${ts.accumulatedContent.length} | stopReason=${result.stop_reason || '(none)'}`)
    streamingContents.value.set(sessionId, '')
    loadingSessions.value.set(sessionId, false)

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

        void sessionStore.loadTurnCheckpoints(sessionId)
      }
    }

    ts.resolve?.()
    endTurn(sessionId, ts)
  }

  const handleError = (sessionId: string, ts: TurnState, error: any) => {
    if (ts.settled) return
    ts.settled = true
    const elapsed = Date.now() - ts.sendStartTime
    sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })
    loadingSessions.value.set(sessionId, false)
    streamingContents.value.set(sessionId, '')

    const claudeCode = api.claudeCode
    const errorMsg = String(error).toLowerCase()
    const isTimeoutError = errorMsg.includes('超时') || errorMsg.includes('timeout')
    if (isTimeoutError && claudeCode) {
      try {
        sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] timeout detected, attempting to abort engine process`)
        claudeCode.abort(sessionId)
      } catch (e) {
        sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] abort failed`, { error: String(e) })
      }
    }

    const classified = errorHandler.handleError(error, {
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
      title: 'Assistant turn failed',
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
      const ts = ensureTurn(event.sessionId)
      if (ts.settled) return
      resetTimeout(event.sessionId, ts)
      handleAssistant(event.sessionId, ts, event.data)
    })
    claudeCodeApi.onToolUse((event: { sessionId: string; data: any }) => {
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
      loadingSessions.value.set(targetSessionId, true)
      setTimeout(() => {
        sessionStore.addMessage({
          role: 'assistant',
          content: classified.message,
          metadata: { error: classified }
        }, targetSessionId)
        loadingSessions.value.set(targetSessionId, false)
      }, 500)
      return
    }

    await sessionStore.initClaudeCodeSession(targetSessionId)

    sessionStore.logger.info('ChatStore', `sendMessage: calling IPC sendMessage | sessionId=${targetSessionId.slice(0, 8)}`)

    if (turnStates.has(targetSessionId)) {
      sessionStore.logger.warn('ChatStore', `sendMessage: a turn is already in flight for this session, skipping new turn setup | sessionId=${targetSessionId.slice(0, 8)}`)
    }

    await new Promise<void>((resolve, reject) => {
      const ts = beginTurn(targetSessionId, { isAutonomous: false, resolve, reject })

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
      loadingSessions.value.set(sid, false)
      streamingContents.value.set(sid, '')
      const ts = turnStates.get(sid)
      if (ts && !ts.settled) {
        ts.settled = true
        ts.resolve?.()
        endTurn(sid, ts)
        const s = sessionStore.sessions.find(s => s.id === sid)
        if (s) s.processStatus = 'idle'
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
    sendMessage,
    abort,
    retryLastMessage,
    submitToolAnswer,
    skipToolAnswer,
    // Pending Messages
    pendingMessages,
    addPendingMessage,
    removePendingMessage,
    recallPendingMessage,
    getPendingMessages,
    clearPendingMessages,
  }
})
