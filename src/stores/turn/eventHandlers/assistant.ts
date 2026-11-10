// src/stores/turn/eventHandlers/assistant.ts
// 助手消息域：assistant 完整帧的消费与卡片/时间线投影。

import type { TurnState } from '../types'
import { createUuid } from '@/utils/uuid'
import { recordAgentToolCall } from '@/services/teamTranscriptService'
import { isSyntheticApiErrorAssistant } from './helpers'
import type { EventHandlerContext } from './types'

export function createAssistantHandlers(ctx: EventHandlerContext) {
  const {
    sink,
    timeline,
    streamingContents,
    logger,
    contextUsage,
    syncCardProjection,
    visibleBlock,
    scheduleContentPatch,
  } = ctx
  const {
    getAssistantMessage,
    addTimelineEvent,
    updateTimelineEvent,
    ensureTextTimelineEvent,
    completeCurrentTextEvent,
    addToolTimelineEvent,
  } = timeline

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
              // 上一个 text 事件已在上面收口，ensure 拿到的是新事件：本块从 block.text 起算，
              // 累计只用于整条消息的投影，不能跨块继承。
              ts.currentTextContent = block.text
              updateTimelineEvent(sessionId, ts, textEventId, {
                content: visibleBlock(ts, block.text),
                status: 'running'
              })
              if (msg) syncCardProjection(sessionId, ts, msg, false)
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
            const message = getAssistantMessage(sessionId, ts)
            const view = message
              ? syncCardProjection(sessionId, ts, message, false)
              : { content: ts.accumulatedContent, blockText: '' }
            sink.patchMessage(sessionId, ts.assistantMessageId, { content: view.content })
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
            const previousEventId = ts.currentTextEventId
            const textEventId = ensureTextTimelineEvent(sessionId, ts)
            const msg = getAssistantMessage(sessionId, ts)
            // ensure 可能另起一个新事件（上一块已收口）：那种情况下本块原始文本只有增量
            ts.currentTextContent = textEventId === previousEventId
              ? `${ts.currentTextContent}${deltaText}`
              : deltaText
            const view = msg ? syncCardProjection(sessionId, ts, msg, false) : null
            updateTimelineEvent(sessionId, ts, textEventId, {
              content: view ? view.blockText : deltaText,
              status: 'running'
            })
            sink.patchMessage(sessionId, ts.assistantMessageId, { content: view ? view.content : textContent })
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

  return { handleAssistant }
}
