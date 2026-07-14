// src/stores/turn/timelineAssembler.ts
// Timeline 装配深模块 — 管理 assistant 消息上的 text / reasoning / tool 时间线事件。
// 从 index.ts 抽出：6 个函数依赖 sink.get(sessionId) + TurnState，无其他闭包依赖。

import type { Message } from '@/types'
import type { SessionSink } from '../turnSink'
import type { TurnState } from './types'
import { createUuid } from '@/utils/uuid'

export interface TimelineAssembler {
  getAssistantMessage: (sessionId: string, ts: TurnState) => Message | undefined
  addTimelineEvent: (sessionId: string, ts: TurnState, event: NonNullable<Message['timelineEvents']>[number]) => void
  updateTimelineEvent: (sessionId: string, ts: TurnState, eventId: string, updates: Partial<NonNullable<Message['timelineEvents']>[number]>) => void
  ensureTextTimelineEvent: (sessionId: string, ts: TurnState) => string
  completeCurrentTextEvent: (sessionId: string, ts: TurnState) => void
  addToolTimelineEvent: (sessionId: string, ts: TurnState, toolCallId: string) => void
}

export function createTimelineAssembler(sink: SessionSink): TimelineAssembler {
  const getAssistantMessage = (sessionId: string, ts: TurnState): Message | undefined => {
    const s = sink.get(sessionId)
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
    ts.currentTextEventId = createUuid()
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

  return {
    getAssistantMessage,
    addTimelineEvent,
    updateTimelineEvent,
    ensureTextTimelineEvent,
    completeCurrentTextEvent,
    addToolTimelineEvent,
  }
}
