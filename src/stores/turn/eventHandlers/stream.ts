// src/stores/turn/eventHandlers/stream.ts
// 流式事件域：content_block_* / message_* 的增量消费。

import type { TurnState } from '../types'
import { createUuid } from '@/utils/uuid'
import { partialToolResultText, truncateLiveToolOutput } from './helpers'
import type { EventHandlerContext } from './types'

export function createStreamHandlers(ctx: EventHandlerContext) {
  const {
    sink,
    timeline,
    streamingContents,
    logger,
    flushContentPatch,
    scheduleContentPatch,
    scheduleEarlyInputPatch,
  } = ctx
  const {
    completeCurrentTextEvent,
    completeCurrentReasoningEvent,
    ensureTextTimelineEvent,
    addTimelineEvent,
    addToolTimelineEvent,
  } = timeline

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

    // Pi 的 tool_execution_update：partialResult 是工具到目前为止的输出快照。
    // 不消费它，长命令在 tool_execution_end 之前既没有命令也没有任何输出。
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'tool_execution_delta') {
      const toolId = ev.delta.toolCallId
      if (typeof toolId === 'string' && toolId) {
        const s = sink.get(sessionId)
        const msg = s?.messages.find(m => m.id === ts.assistantMessageId)
        const idx = msg?.toolCalls?.findIndex(tc => tc.id === toolId) ?? -1
        if (msg?.toolCalls && idx >= 0 && msg.toolCalls[idx].status === 'running') {
          const text = partialToolResultText(ev.delta.partialResult)
          const output = truncateLiveToolOutput(text)
          if (msg.toolCalls[idx].output !== output) {
            const updatedToolCalls = [...msg.toolCalls]
            updatedToolCalls[idx] = { ...updatedToolCalls[idx], output }
            msg.toolCalls = updatedToolCalls
          }
        }
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

  return { handleStreamEvent }
}
