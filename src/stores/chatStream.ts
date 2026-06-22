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

export const useChatStreamStore = defineStore('chatStream', () => {
  const sessionStore = useChatSessionStore()

  const streamingContents = ref<Map<string, string>>(new Map())
  const loadingSessions = ref<Map<string, boolean>>(new Map())

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

    loadingSessions.value.set(targetSessionId, true)
    streamingContents.value.set(targetSessionId, '')
    session.processStatus = 'active'

    const assistantMessageId = crypto.randomUUID()
    const sendStartTime = Date.now()

    sessionStore.logger.info('ChatStore', `sendMessage: calling IPC sendMessage | sessionId=${targetSessionId.slice(0, 8)} | assistantMsgId=${assistantMessageId.slice(0, 8)}`)
    sessionStore.traceEvent({
      sessionId: targetSessionId,
      messageId: assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'started',
      title: 'Assistant turn started',
    })

    sessionStore.addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    }, targetSessionId)

    const settingsStore = useSettingsStore()

    await new Promise<void>((resolve, reject) => {
      let accumulatedContent = ''
      let isCompleted = false
      let currentTextEventId: string | null = null
      let currentReasoningEventId: string | null = null
      let streamingHandledThinking = false

      const getAssistantMessage = () => {
        const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
          sessionStore.logger.debug('ChatStore', `[${targetSessionId.slice(0, 8)}] stream_event: content_block_start(text) | accLen=${accumulatedContent.length}`)
          currentTextEventId = null
          ensureTextTimelineEvent()
          if (accumulatedContent.length > 0 && !accumulatedContent.endsWith('\n')) {
            accumulatedContent += '\n\n'
            streamingContents.value.set(targetSessionId, accumulatedContent)
            nextTick(() => {
              sessionStore.updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
            })
          }
        }

        if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
          sessionStore.logger.debug('ChatStore', `[${targetSessionId.slice(0, 8)}] stream_event: content_block_start(thinking)`)
          if (currentReasoningEventId) {
            updateTimelineEvent(currentReasoningEventId, { status: 'completed' })
          }
          const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
            sessionStore.updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
          })
        }

        if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta?.thinking) {
          streamingHandledThinking = true
          const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
              sessionStore.saveToStorage()
            }
          }
        }
      }

      const handleAssistant = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId || isCompleted) return
        const assistant = event.data

        if (isTeammateRawMessage(assistant)) {
          sessionStore.recordTeammateMessage(assistant, targetSessionId)
          return
        }

        sessionStore.logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] assistant event received`)

        const apiUsage = assistant.message?.usage
        if (apiUsage) {
          const s = sessionStore.sessions.find(sess => sess.id === targetSessionId)
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
              apiCallUsage: {
                input_tokens: apiUsage.input_tokens ?? 0,
                output_tokens: apiUsage.output_tokens ?? 0,
                cache_read_input_tokens: cacheRead,
                cache_creation_input_tokens: cacheCreate,
              },
            }
            try {
              useContextUsageStore().applyFallback(targetSessionId)
            } catch {
              // Non-fatal
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
                    const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
                sessionStore.updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
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
                sessionStore.updateMessage(assistantMessageId, { content: accumulatedContent }, targetSessionId)
              }

              const reasoningContent = content
                .filter((c: any) => c.type === 'thinking')
                .map((c: any) => c.thinking || c.text || '')
                .join('')

              if (reasoningContent && !streamingHandledThinking) {
                const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
                    sessionStore.saveToStorage()
                  }
                }
              }
            }

            const toolUses = content.filter((c: any) => c.type === 'tool_use')
            for (const toolUse of toolUses) {
              const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
                    sessionStore.saveToStorage()
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
        sessionStore.logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] tool_use event | name=${toolName}`)
        const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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

              sessionStore.traceEvent({
                sessionId: targetSessionId,
                actor: 'tool',
                type: traceType,
                status: 'started',
                title: toolName,
                input: toolInput,
                metadata: { toolId, assistantMessageId },
              })
              addToolTimelineEvent(toolId)
              sessionStore.saveToStorage()
            }
          }
        }
      }

      const handleToolResult = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId) return
        const toolResult = event.data
        const resultToolUseId = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
        const resultIsError = toolResult.is_error || toolResult.tool_result?.is_error
        sessionStore.logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] tool_result event | toolUseId=${resultToolUseId?.slice(0, 8)} | error=${!!resultIsError}`)
        const s = sessionStore.sessions.find(s => s.id === targetSessionId)
        if (s) {
          const msg = s.messages.find(m => m.id === assistantMessageId)
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
              sessionStore.saveToStorage()
            }
          }
        }
      }

      const handleResult = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId || isCompleted) return
        isCompleted = true
        const result = event.data || {}
        const elapsed = Date.now() - sendStartTime
        sessionStore.logger.info('ChatStore', `[${targetSessionId.slice(0, 8)}] result event (LLM response complete) | totalElapsed=${elapsed}ms | accContentLen=${accumulatedContent.length} | stopReason=${result.stop_reason || '(none)'}`)
        streamingContents.value.set(targetSessionId, '')
        loadingSessions.value.set(targetSessionId, false)

        const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
            sessionStore.traceEvent({
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

            sessionStore.traceEvent({
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

            sessionStore.saveToStorage()

            void sessionStore.loadTurnCheckpoints(targetSessionId)
          }
        }

        cleanup()
        resolve()
      }

      const handleUser = (event: { sessionId: string; data: any }) => {
        if (event.sessionId !== targetSessionId) return
        const userMsg = event.data

        if (isTeammateRawMessage(userMsg)) {
          sessionStore.recordTeammateMessage(userMsg, targetSessionId)
          return
        }

        if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
          const toolResults = userMsg.message.content.filter((c: any) => c.type === 'tool_result')
          for (const toolResult of toolResults) {
            const s = sessionStore.sessions.find(s => s.id === targetSessionId)
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
                  sessionStore.saveToStorage()
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
        sessionStore.logger.error('ChatStore', `[${targetSessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })
        loadingSessions.value.set(targetSessionId, false)
        streamingContents.value.set(targetSessionId, '')

        const errorMsg = String(error).toLowerCase()
        const isTimeoutError = errorMsg.includes('超时') || errorMsg.includes('timeout')
        if (isTimeoutError && claudeCode) {
          try {
            sessionStore.logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] timeout detected, attempting to abort engine process`)
            claudeCode.abort(targetSessionId)
          } catch (e) {
            sessionStore.logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] abort failed`, { error: String(e) })
          }
        }

        const classified = errorHandler.handleError(error, {
          sessionId: targetSessionId,
          provider: settingsStore.config.provider,
          model: settingsStore.config.model,
          baseUrl: settingsStore.config.baseUrl,
          phase: 'stream',
        })

        sessionStore.traceEvent({
          sessionId: targetSessionId,
          messageId: assistantMessageId,
          actor: 'assistant',
          type: 'assistant_turn',
          status: 'failed',
          title: 'Assistant turn failed',
          error: { message: classified.technicalDetail },
        })

        sessionStore.updateMessage(assistantMessageId, {
          content: classified.message,
          metadata: {
            model: settingsStore.config.model,
            duration: Date.now() - sendStartTime,
            error: classified,
          }
        }, targetSessionId)

        const s = sessionStore.sessions.find(s => s.id === targetSessionId)
        if (s) {
          s.processStatus = 'exited'
          sessionStore.saveToStorage()
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

        sessionStore.logger.warn('ChatStore', `[${targetSessionId.slice(0, 8)}] process exit event | code=${exitCode}${signal ? ` | signal=${signal}` : ''}${stderrTail ? ` | stderr=${stderrTail.slice(0, 200)}` : ''}`)

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
        cleanup()
        handleError(error)
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
