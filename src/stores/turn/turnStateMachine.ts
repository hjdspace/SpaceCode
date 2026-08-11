// src/stores/turn/turnStateMachine.ts
// Turn 状态机深模块 — 拥有 turnStates Map + beginTurn / ensureTurn / endTurn / resetTimeout。
// 从 index.ts 抽出。onTimeout 回调打破与 handleResult / handleError 的循环依赖。

import type { Ref } from 'vue'
import type { SessionSink } from '../turnSink'
import type { TurnState } from './types'
import { createSettledTurn, REQUEST_TIMEOUT, AUTONOMOUS_REQUEST_TIMEOUT } from './types'
import { createUuid } from '@/utils/uuid'

export interface TurnStateMachineOptions {
  sink: SessionSink
  traceEvent: (event: {
    sessionId: string
    messageId?: string
    actor: 'user' | 'assistant' | 'tool' | 'system'
    type: string
    status?: 'started' | 'running' | 'completed' | 'failed'
    title?: string
  }) => void
  loadingSessions: Ref<Map<string, boolean>>
  streamingContents: Ref<Map<string, string>>
  pendingSendMessages: Set<string>
  userAbortedSessions: Set<string>
  /** 超时回调 — store 侧决定调用 handleResult（autonomous）还是 handleError */
  onTimeout: (sessionId: string, ts: TurnState) => void
}

export interface TurnStateMachine {
  turnStates: Map<string, TurnState>
  resetTimeout: (sessionId: string, ts: TurnState) => void
  beginTurn: (sessionId: string, opts: { isAutonomous: boolean; resolve?: () => void; reject?: (e: any) => void }) => TurnState
  endTurn: (sessionId: string, ts: TurnState) => void
  ensureTurn: (sessionId: string) => TurnState
}

export function createTurnStateMachine(opts: TurnStateMachineOptions): TurnStateMachine {
  const {
    sink,
    traceEvent,
    loadingSessions,
    streamingContents,
    pendingSendMessages,
    userAbortedSessions,
    onTimeout,
  } = opts

  const turnStates = new Map<string, TurnState>()

  const resetTimeout = (sessionId: string, ts: TurnState) => {
    if (ts.timeoutId) clearTimeout(ts.timeoutId)
    const limit = ts.isAutonomous ? AUTONOMOUS_REQUEST_TIMEOUT : REQUEST_TIMEOUT
    ts.timeoutId = setTimeout(() => {
      const cur = turnStates.get(sessionId)
      if (!cur || cur !== ts || cur.settled) return
      onTimeout(sessionId, ts)
    }, limit)
  }

  const beginTurn = (sessionId: string, opts: { isAutonomous: boolean; resolve?: () => void; reject?: (e: any) => void }): TurnState => {
    const assistantMessageId = createUuid()
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
      currentStreamingToolId: null,
      streamingToolJson: new Map(),
    }
    turnStates.set(sessionId, ts)

    loadingSessions.value.set(sessionId, true)
    streamingContents.value.set(sessionId, '')
    const s = sink.get(sessionId)
    if (s) s.processStatus = 'active'

    traceEvent({
      sessionId,
      messageId: assistantMessageId,
      actor: 'assistant',
      type: 'assistant_turn',
      status: 'started',
      title: opts.isAutonomous ? 'Assistant turn started (autonomous)' : 'Assistant turn started',
    })

    sink.appendMessage(sessionId, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    })

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
      return createSettledTurn()
    }

    // ★ 用户主动 abort 后，丢弃引擎残留事件（子代理输出等），
    // 不创建 autonomous turn，防止会话「自动恢复运行」。
    // 标记在 sendMessage / retryLastMessage / resendForRetry 中清除。
    if (userAbortedSessions.has(sessionId)) {
      return createSettledTurn()
    }

    // 新建会话尚未有任何消息时，不因 CLI 初始化事件自动创建 turn，
    // 避免会话在用户发送消息前就显示转圈。
    // 后台 agent 自动续跑仅对已有消息的会话生效，不影响该路径。
    const session = sink.get(sessionId)
    if (!session || session.messages.length === 0) {
      // 返回一个已结算的空 turn，使调用方因 ts.settled 提前返回
      return createSettledTurn()
    }

    return beginTurn(sessionId, { isAutonomous: true })
  }

  return { turnStates, resetTimeout, beginTurn, endTurn, ensureTurn }
}
