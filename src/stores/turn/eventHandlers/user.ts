// src/stores/turn/eventHandlers/user.ts
// 用户消息域：远端推送消息落库与 user 帧里的 tool_result 消费。

import type { TurnState } from '../types'
import { MAX_INMEMORY_TOOL_OUTPUT } from '../types'
import { isAgentLaunchResult, recordAgentToolCall } from '@/services/teamTranscriptService'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import type { PermissionMode } from '@/shared/channels/claudeCode'
import { remoteUserContent } from './helpers'
import type { EventHandlerContext } from './types'

export function createUserHandlers(ctx: EventHandlerContext) {
  const {
    sink,
    timeline,
    selectSession,
    getCurrentSessionId,
    turnStates,
    beginTurn,
    pendingSendMessages,
    userAbortedSessions,
    updateTaskStateFromToolResult,
    isObserved,
    recordWriteToLedger,
    maybeAutoPreviewArtifact,
  } = ctx
  const { updateTimelineEvent } = timeline

  const handleRemoteUserMessage = (sessionId: string, data: any): void => {
    if (!sessionId) return
    const content = remoteUserContent(data)
    const startTurn = data?.startTurn !== false
    if (startTurn && !content.trim()) return

    let session = sink.get(sessionId)
    if (!session) {
      session = sink.ensureSession(sessionId, {
        title: data?.title || content.slice(0, 50) || 'Remote Chat',
        projectPath: data?.projectPath || undefined,
        activate: data?.activate !== false,
        sessionType: data?.sessionType,
      })
    } else {
      if (data?.projectPath && !session.workingDirectory) {
        session.workingDirectory = data.projectPath
      }
      // 归属由推送方说了算：修复前建出来的 Super Agent 会话行没有类型，
      // 不补就一直在侧边栏里当着普通聊天。
      if (data?.sessionType && session.sessionType !== data.sessionType) {
        session.sessionType = data.sessionType
      }
      if (data?.activate !== false && getCurrentSessionId() !== sessionId) {
        void selectSession(sessionId)
      }
    }

    if (!startTurn && session.messages.length === 0 && Array.isArray(data?.history)) {
      session.messages = buildMessagesFromHistory(data.history).map((message, index) => ({
        ...message,
        id: message.id ?? `factory-history-${index}`,
        timestamp: message.timestamp ?? 0,
      }))
    }

    // 后台触发方（定时任务）指定的模型落到会话记录：输入框显示的是它，
    // 用户在该会话续话时 initClaudeCodeSession 也会按它重启引擎，而不是退回全局默认
    if (typeof data?.model === 'string' && data.model && !session.model) {
      session.model = data.model
    }

    // 权限模式同理，但它还多一层责任：引擎已由推送方（流水线接管）按阶段配置起好，
    // 会话记录若不记下同一档，selectSession 的权限对账会拿全局默认值下发，把这条
    // 正在跑的会话就地降级 —— 接管会话被降到 plan 后连 Bash 都要逐次审批。
    if (typeof data?.permissionMode === 'string' && data.permissionMode && !session.permissionMode) {
      session.permissionMode = data.permissionMode as PermissionMode
    }

    // activate:false 的推送方（定时任务、看板接管面板）只要会话落进列表；
    // 切前台由 App.vue 响应这个事件完成，派发与否就是「抢不抢视图」的开关。
    if (data?.activate !== false && typeof window !== 'undefined') {
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

    if (content.trim() && !hasExactMessage && !isRecentDuplicate) {
      sink.appendMessage(sessionId, {
        ...(messageId ? { id: messageId } : {}),
        role: data?.role === 'assistant' ? 'assistant' : 'user',
        content,
        metadata: { source: 'h5' } as any,
      })
    }

    if (!startTurn) return
    const existing = turnStates.get(sessionId)
    if (existing) {
      return
    }
    if (pendingSendMessages.has(sessionId) || userAbortedSessions.has(sessionId)) return

    beginTurn(sessionId, { isAutonomous: true })
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
              if (!toolResult.is_error && !isObserved(sessionId)) {
                recordWriteToLedger(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
                maybeAutoPreviewArtifact(sessionId, toolName, updatedToolCalls[toolCallIndex].input)
              }
            }
          }
        }
      }
    }
  }

  return { handleRemoteUserMessage, handleUser }
}
