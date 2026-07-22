// src/stores/turn/eventHandlers.ts
// Turn 事件处理深模块 — 9 个 handle* 函数 + remoteUserContent 辅助。
// 从 index.ts 抽出。通过工厂函数注入所有依赖，handlers 之间可直接互相调用。

import type { Ref } from 'vue'
import { nextTick } from 'vue'
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
import type { UseAutoRetryReturn } from '@/composables/useAutoRetry'
import { extractErrorCode } from '@/composables/useAutoRetry'
import { errorHandler as defaultErrorHandler } from '@/services/errorHandler'
import { ErrorCategory, type ToolCall } from '@/types'
import {
  recordAgentToolCall,
  isAgentLaunchResult,
} from '@/services/teamTranscriptService'
import { triggerPetReaction } from '@/composables/usePetReaction'

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
  list: (workingDir: string) => Promise<{ artifacts: any[] }>
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
    refresh: (sessionId: string, force: boolean) => void
  }
  errorHandler: typeof defaultErrorHandler
  getClaudeCode: () => ClaudeCodeApi | null
  getArtifactsApi: () => ArtifactsApi | null
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
  } = opts

  const { turnStates, resetTimeout, beginTurn, endTurn } = stateMachine
  const {
    getAssistantMessage,
    addTimelineEvent,
    updateTimelineEvent,
    ensureTextTimelineEvent,
    completeCurrentTextEvent,
    addToolTimelineEvent,
  } = timeline

  function handleRemoteUserMessage(sessionId: string, data: any): void {
    if (!sessionId) return
    const content = remoteUserContent(data)
    if (!content.trim()) return

    let session = sink.get(sessionId)
    if (!session) {
      session = sink.ensureSession(sessionId, {
        title: data?.title || content.slice(0, 50) || 'Remote Chat',
        projectPath: data?.projectPath || undefined,
      })
    } else {
      if (data?.projectPath && !session.workingDirectory) {
        session.workingDirectory = data.projectPath
      }
      if (getCurrentSessionId() !== sessionId) {
        void selectSession(sessionId)
      }
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
      resetTimeout(sessionId, existing)
      return
    }
    if (pendingSendMessages.has(sessionId) || userAbortedSessions.has(sessionId)) return

    const ts = beginTurn(sessionId, { isAutonomous: true })
    resetTimeout(sessionId, ts)
  }

  const handleStreamEvent = (sessionId: string, ts: TurnState, streamEvent: any) => {
    const ev = streamEvent.event || streamEvent

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(text) | accLen=${ts.accumulatedContent.length}`)
      ts.currentTextEventId = null
      ensureTextTimelineEvent(sessionId, ts)
      if (ts.accumulatedContent.length > 0 && !ts.accumulatedContent.endsWith('\n')) {
        ts.accumulatedContent += '\n\n'
        streamingContents.value.set(sessionId, ts.accumulatedContent)
        nextTick(() => {
          sink.patchMessage(sessionId, ts.assistantMessageId, { content: ts.accumulatedContent })
        })
      }
    }

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
      logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(thinking)`)
      if (ts.currentReasoningEventId) {
        updateTimelineEvent(sessionId, ts, ts.currentReasoningEventId, { status: 'completed' })
      }
      const s = sink.get(sessionId)
      if (s) {
        const msg = s.messages.find(m => m.id === ts.assistantMessageId)
        if (msg) {
          if (!msg.reasoning) {
            msg.reasoning = { content: '', startTime: Date.now(), isExpanded: true }
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
        sink.patchMessage(sessionId, ts.assistantMessageId, { content: ts.accumulatedContent })
      })
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
          msg.reasoning.content += ev.delta.thinking
          if (!ts.currentReasoningEventId) {
            ts.currentReasoningEventId = createUuid()
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
        }
      }
    }
  }

  const handleAssistant = (sessionId: string, ts: TurnState, assistant: any) => {
    logger.info('ChatStore', `[${sessionId.slice(0, 8)}] assistant event received`)

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
              updateTimelineEvent(sessionId, ts, textEventId, {
                content: `${textEvent?.content || ''}${block.text}`,
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
                    msg.reasoning.content += thinkingText
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
            updateTimelineEvent(sessionId, ts, textEventId, {
              content: `${textEvent?.content || ''}${deltaText}`,
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
            window.dispatchEvent(new CustomEvent('scm:refresh'))
            window.dispatchEvent(new CustomEvent('refresh-file-tree'))
          }

          if (resultIsError) {
            triggerPetReaction('error')
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
            }
          }
        }
      }
    }
  }

  const handleResult = (sessionId: string, ts: TurnState, result: any) => {
    if (ts.settled) return

    const isError = !!result?.is_error
    const resultText = typeof result?.result === 'string' ? result.result : ''
    const looksLikeApiError = /^API Error:/i.test(resultText)
    // 429 限流错误：底层 engine 自带重试机制，前端无需感知。
    // 不结算 turn、不显示错误 UI、不触发自动重试，保持 turn 活跃等待 engine 内部重试后的正常 result 事件。
    if ((isError || looksLikeApiError) && /429|rate.?limit/i.test(resultText)) {
      logger.info('ChatStore', `[${sessionId.slice(0, 8)}] 429 rate limit detected in result, engine will retry internally | errorText=${resultText.slice(0, 120)}`)
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

    if (autoRetry.retryStates.value.has(sessionId)) {
      logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry succeeded, clearing retry state`)
      autoRetry.clearOnSuccess(sessionId)
    }

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
          model: getModel(),
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

        void contextUsage.refresh(sessionId, true)
        traceEvent({
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

        if (s.mode === 'work' && s.workingDirectory) {
          const workingDir = s.workingDirectory
          const turnStart = ts.sendStartTime
          const targetMsgId = ts.assistantMessageId
          void (async () => {
            try {
              const artifactsApi = getArtifactsApi()
              if (!artifactsApi?.list) return
              const { artifacts } = await artifactsApi.list(workingDir)
              const produced = (artifacts || []).filter((a: any) => a.mtime >= turnStart - 1000)
              if (produced.length === 0) return
              const sess = sink.get(sessionId)
              const target = sess?.messages.find(m => m.id === targetMsgId)
              if (!sess || !target) return
              target.metadata = { ...(target.metadata || {}), artifacts: produced }
              sess.messages = [...sess.messages]
              sink.persist(sessionId)
            } catch (err) {
              console.error('[Artifacts] turn summary collect failed:', err)
            }
          })()
        }

        void loadTurnCheckpoints(sessionId, s.workingDirectory, true)
      }
    }

    triggerPetReaction('success')
    ts.resolve?.()
    endTurn(sessionId, ts)
  }

  const handleError = (sessionId: string, ts: TurnState, error: any) => {
    if (ts.settled) return
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
      return
    }

    const classified = errorHandler.classifyError(error, {
      sessionId,
      provider: getProvider(),
      model: getModel(),
      baseUrl: getBaseUrl(),
      phase: 'stream',
    })

    // 429 限流错误（非进程退出场景）：底层 engine 自带重试机制，前端无需感知。
    // 保持 turn 活跃等待 engine 内部重试。进程退出场景（errorMsg 含 "Process exited"）
    // 说明 engine 已死亡，仍需走 auto-retry 重启流程。
    if (classified.category === ErrorCategory.RATE_LIMIT) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (!/Process exited/i.test(errorMsg)) {
        logger.info('ChatStore', `[${sessionId.slice(0, 8)}] 429 rate limit detected in handleError, engine will retry internally | error=${errorMsg.slice(0, 120)}`)
        return
      }
    }

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
      model: getModel(),
      baseUrl: getBaseUrl(),
      phase: 'stream',
    })

    traceEvent({
      sessionId,
      messageId: ts.assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'failed',
      title: hadRetry ? 'Assistant turn failed (retries exhausted)' : 'Assistant turn failed',
      error: { message: classified.technicalDetail },
    })

    sink.patchMessage(sessionId, ts.assistantMessageId, {
      content: classified.message,
      metadata: {
        model: getModel(),
        duration: Date.now() - ts.sendStartTime,
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
