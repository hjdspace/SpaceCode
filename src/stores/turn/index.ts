import { defineStore } from 'pinia'
import { ref, computed, nextTick } from 'vue'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { useChatSessionStore } from '../chatSession'
import { createUuid } from '@/utils/uuid'
import { useSettingsStore } from '../settings'
import { useContextUsageStore } from '../contextUsage'
import type { SessionSink } from '../turnSink'
import type { Message, ToolCall } from '@/types'
import { ErrorCategory } from '@/types'
import { permissionService, type PermissionRequest } from '@/services/permissionService'
import {
  isTeammateRawMessage,
  isSidechainMessage,
  recordAgentToolCall,
  isAgentLaunchResult,
} from '@/services/teamTranscriptService'
import { useAutoRetry, extractErrorCode } from '@/composables/useAutoRetry'
import type { TurnState } from './types'
import {
  FILE_TOOLS,
  COMMAND_TOOLS,
  VERIFICATION_PATTERNS,
  REQUEST_TIMEOUT,
  MAX_INMEMORY_TOOL_OUTPUT,
} from './types'
import { createTimelineAssembler } from './timelineAssembler'
import { createTurnStateMachine } from './turnStateMachine'

// Re-export — 外部模块通过 @/stores/turn 导入这些符号
export type { TurnState } from './types'
export { REQUEST_TIMEOUT, AUTONOMOUS_REQUEST_TIMEOUT, MAX_INMEMORY_TOOL_OUTPUT } from './types'

// ADR-0003: Turn store 必须在 WebSocket 连接前完成订阅注册。
// 模块级 initialized 标记：store 工厂首次实例化时记录一次初始化日志，
// 用于在启动日志中验证 bootstrap 顺序（事件订阅先于 WS 连接）。
let initialized = false

// 测试可注入 fake api；生产用真实 api
export function useTurnStore(injectedApi?: any) {
  return defineStore('turn', () => {
    if (!initialized) {
      initialized = true
      console.log('[Turn] Turn store initialized — event subscriptions registered')
    }
    const resolvedApi = injectedApi ?? api
    const sessionStore = useChatSessionStore()
    const settingsStore = useSettingsStore()

    // sink：chatSession 实现 SessionSink。生产中直接绑定到 sessionStore 的方法。
    const sink: SessionSink = {
      get: (sid) => sessionStore.sessions.find(s => s.id === sid),
      appendMessage: (sid, msg) => sessionStore.addMessage(msg, sid),
      patchMessage: (sid, mid, patch) => sessionStore.updateMessage(mid, patch, sid),
      patchToolCall: (sid, mid, tid, status) => sessionStore.updateToolCallForSession(sid, mid, tid, status),
      persist: (sid) => sessionStore.saveToStorageForSession(sid),
      ensureSession: (sid, hint) => sessionStore.ensureSession(sid, hint),
    }

    const streamingContents = ref<Map<string, string>>(new Map())
    const loadingSessions = ref<Map<string, boolean>>(new Map())
    // 基于 currentSessionId 的便利 computed（从 chatStream.ts 迁移）
    const isLoading = computed(() =>
      sessionStore.currentSessionId ? (loadingSessions.value.get(sessionStore.currentSessionId) ?? false) : false
    )
    const streamingContent = computed(() =>
      sessionStore.currentSessionId ? (streamingContents.value.get(sessionStore.currentSessionId) ?? '') : ''
    )
    const pendingSendMessages = new Set<string>()
    const userAbortedSessions = new Set<string>()

    // ── 权限请求状态 ──
    // 单一数据源：permissionService。turn store 不再维护本地副本，避免同步不一致。
    const pendingPermissions = computed(() => permissionService.getPendingPermissions())

    // ────────────────────────────────────────────────────────────────────
    // Pending Messages（任务 9 从 chatStream.ts 迁移）
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
      pendingMessages.value.set(sessionId, queue)
    }

    function removePendingMessage(sessionId: string, msgId: string) {
      const queue = pendingMessages.value.get(sessionId) || []
      const idx = queue.findIndex(m => m.id === msgId)
      if (idx >= 0) queue.splice(idx, 1)
      pendingMessages.value.set(sessionId, queue)
    }

    function recallPendingMessage(sessionId: string, msgId: string): PendingMessage | undefined {
      const queue = pendingMessages.value.get(sessionId) || []
      const idx = queue.findIndex(m => m.id === msgId)
      if (idx < 0) return undefined
      const [msg] = queue.splice(idx, 1)
      pendingMessages.value.set(sessionId, queue)
      return msg
    }

    function getPendingMessages(sessionId: string): PendingMessage[] {
      return pendingMessages.value.get(sessionId) || []
    }

    function clearPendingMessages(sessionId: string) {
      pendingMessages.value.delete(sessionId)
    }

    // ────────────────────────────────────────────────────────────────────
    // auto-retry 状态机（任务 9 从 chatStream.ts 迁移）
    // ────────────────────────────────────────────────────────────────────
    const autoRetry = useAutoRetry({
      maxRetries: 5,
      initialDelayMs: 2_000,
      maxDelayMs: 60_000,
      jitterMs: 1_000,
    })

    async function initiateAutoRetry(
      sessionId: string,
      ts: TurnState,
      errorCategory: ErrorCategory,
      errorTitle: string,
      errorMessage: string,
      retryDelayHint?: number,
      errorCode?: string,
    ): Promise<void> {
      const state = autoRetry.recordRetryableError(sessionId, errorCategory, errorTitle, errorMessage, retryDelayHint, ts.assistantMessageId, errorCode)
      const attempt = state.attempt
      const delayMs = state.delayMs

      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] auto-retry scheduled | attempt=${attempt}/${state.maxRetries} | delay=${delayMs}ms | category=${errorCategory}`)

      // ① 更新助手消息：显示重试状态（不覆盖已有内容，保留 LLM 中断前的输出）
      const existingMsg = sink.get(sessionId)?.messages.find(m => m.id === ts.assistantMessageId)
      sink.patchMessage(sessionId, ts.assistantMessageId, {
        metadata: {
          ...(existingMsg?.metadata || {}),
          model: settingsStore.config.model,
          retryState: { ...state },
        },
      })

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
      const session = sink.get(sessionId)
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
        const claudeCode = resolvedApi.claudeCode
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

    // resendForRetry：被 initiateAutoRetry 调用，重新发送用户消息以触发重试。
    // 不创建用户消息气泡（已有用户消息），仅重启引擎 IPC。
    async function resendForRetry(sessionId: string, content: string): Promise<void> {
      const session = sink.get(sessionId)
      if (!session) return

      // ★ 清除用户中止标记（防御性：正常流程不应走到这里，但避免竞态）
      userAbortedSessions.delete(sessionId)

      const claudeCode = resolvedApi.claudeCode
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

    // cancelRetry：用户主动取消正在进行的自动重试。
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

      const s = sink.get(sid)
      if (s) {
        s.processStatus = 'idle'
        sink.persist(sid)
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Timeline / message helpers — 委托给 timelineAssembler 深模块
    const {
      getAssistantMessage,
      addTimelineEvent,
      updateTimelineEvent,
      ensureTextTimelineEvent,
      completeCurrentTextEvent,
      addToolTimelineEvent,
    } = createTimelineAssembler(sink)

    // ────────────────────────────────────────────────────────────────────
    // Handlers（store 作用域；wrapper 已完成 sessionId 路由与 settled/turn 守卫）
    // ────────────────────────────────────────────────────────────────────
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
        if (sessionStore.currentSessionId !== sessionId) {
          void sessionStore.selectSession(sessionId)
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
        sessionStore.logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(text) | accLen=${ts.accumulatedContent.length}`)
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
        sessionStore.logger.debug('ChatStore', `[${sessionId.slice(0, 8)}] stream_event: content_block_start(thinking)`)
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
            // 不在此处调用 persist：thinking_delta 每秒可达数十次，
            // 频繁持久化会阻塞主线程。thinking 内容会在 turn 结束时
            // 由 handleResult 中的 persist 统一持久化。
          }
        }
      }
    }

    const handleAssistant = (sessionId: string, ts: TurnState, assistant: any) => {
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] assistant event received`)

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
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_use event | name=${toolNameLog}`)
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
            sink.persist(sessionId)
          }
        }
      }
    }

    const handleToolResult = (sessionId: string, ts: TurnState, toolResult: any) => {
      const resultToolUseIdLog = toolResult.tool_use_id || toolResult.tool_result?.tool_use_id
      const resultIsErrorLog = toolResult.is_error || toolResult.tool_result?.is_error
      sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] tool_result event | toolUseId=${resultToolUseIdLog?.slice(0, 8)} | error=${!!resultIsErrorLog}`)
      const s = sink.get(sessionId)
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
            const toolName = msg.toolCalls[toolCallIndex].name

            // ★ 异步子代理检测：Agent/Task 工具返回 "async_launched" 等占位结果时，
            // 子代理仍在后台运行，不应标记为 'completed'。
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
              // 异步启动时不设置 endTime——子代理仍在运行
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
            sink.persist(sessionId)

            // After file-modifying tools complete, refresh SCM and file tree so
            // that newly created/edited files appear immediately in the source
            // control panel and environment card — without waiting for the
            // (possibly non-recursive) fs watcher to notice the change.
            if (FILE_TOOLS.has(toolName) || COMMAND_TOOLS.has(toolName)) {
              window.dispatchEvent(new CustomEvent('scm:refresh'))
              window.dispatchEvent(new CustomEvent('refresh-file-tree'))
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
                // 截断过长的工具输出，防止内存累积导致 OOM
                const truncatedUserToolOutput = rawUserToolOutput.length > MAX_INMEMORY_TOOL_OUTPUT
                  ? rawUserToolOutput.slice(0, MAX_INMEMORY_TOOL_OUTPUT) + '\n\n[Output truncated to prevent memory overflow]'
                  : rawUserToolOutput
                // Sync task state (TaskCreate/TaskUpdate/TaskList/TodoWrite) from tool
                // results that arrive embedded in user messages.
                sessionStore.updateTaskStateFromToolResult(msg.toolCalls, toolResult.tool_use_id, truncatedUserToolOutput)
                const updatedToolCalls = [...msg.toolCalls]
                const toolName = updatedToolCalls[toolCallIndex].name
                // ★ 异步子代理检测（与 handleToolResult 中的逻辑一致）
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

      // ★ 检查 CLI 返回的 is_error 标记
      // Claude Code CLI 在遇到 API 错误（如 429 rate limit exceeded on dimension: tpm）
      // 时，会返回 type=result, is_error=true, result="API Error: ..."。
      // 这种情况需要走 handleError 流程（会触发自动重试 + 指数退避），
      // 而非当作正常完成将错误文本显示为助手回复。
      //
      // 防御性检查：如果 result 文本以 "API Error:" 开头，即使没有 is_error 标记也当作错误处理
      const isError = !!result?.is_error
      const resultText = typeof result?.result === 'string' ? result.result : ''
      const looksLikeApiError = /^API Error:/i.test(resultText)
      if (isError || looksLikeApiError) {
        const errorText = resultText || 'API error'
        sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] result event has error, routing to handleError | isError=${isError} | looksLikeApiError=${looksLikeApiError} | errorText=${errorText.slice(0, 120)}`)
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

          sink.persist(sessionId)

          // 产物汇总：仅办公模式，回合结束后对 outputs/ 做 mtime 快照对比，
          // 把本回合新生成/修改的产物写入该助手消息元数据并持久化。
          if (s.mode === 'work' && s.workingDirectory) {
            const workingDir = s.workingDirectory
            const turnStart = ts.sendStartTime
            const targetMsgId = ts.assistantMessageId
            void (async () => {
              try {
                if (!resolvedApi.artifacts?.list) return
                const { artifacts } = await resolvedApi.artifacts.list(workingDir)
                // 1s 容差，与 ArtifactsPanel 现有约定一致；mtime>=回合开始即本回合新增/修改
                const produced = (artifacts || []).filter((a: any) => a.mtime >= turnStart - 1000)
                if (produced.length === 0) return
                const sess = sink.get(sessionId)
                const target = sess?.messages.find(m => m.id === targetMsgId)
                if (!sess || !target) return
                target.metadata = { ...(target.metadata || {}), artifacts: produced }
                // 触发 MessageList 重建（其分组缓存按数组引用失效）
                sess.messages = [...sess.messages]
                sink.persist(sessionId)
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

    const handleError = (sessionId: string, ts: TurnState, error: any) => {
      if (ts.settled) return
      const elapsed = Date.now() - ts.sendStartTime
      sessionStore.logger.error('ChatStore', `[${sessionId.slice(0, 8)}] error in message flow | elapsed=${elapsed}ms`, { error: String(error) })

      // ★ 用户主动 abort 后的错误（如 "API Error: Request was abort"）：
      // 不展示错误 toast、不触发自动重试，静默结束 turn。
      if (userAbortedSessions.has(sessionId)) {
        sessionStore.logger.info('ChatStore', `[${sessionId.slice(0, 8)}] error suppressed after user abort`)
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
        // 中断引擎进程：主 LLM 的 429 等可恢复错误发生时，引擎可能已返回
        // result 并退出（abort 为无操作），也可能仍在运行（需要中断以阻止
        // 后续事件干扰重试定时器）。
        const claudeCode = resolvedApi.claudeCode
        if (claudeCode) {
          try { claudeCode.abort(sessionId) } catch { /* ignore */ }
        }

        // 设置 ts.settled 阻止后续事件（引擎中断后的残留 result/assistant 等）
        // 被此 turn 处理。initiateAutoRetry 不依赖 ts.settled，它会自行删除 turn。
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

      sink.patchMessage(sessionId, ts.assistantMessageId, {
        content: classified.message,
        metadata: {
          model: settingsStore.config.model,
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

      sessionStore.logger.warn('ChatStore', `[${sessionId.slice(0, 8)}] process exit event | code=${exitCode}${signal ? ` | signal=${signal}` : ''}${stderrTail ? ` | stderr=${stderrTail.slice(0, 200)}` : ''}`)

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

      // A clean process exit is only a process-lifecycle signal. The successful
      // turn must settle on the engine's result event; otherwise an early/stale
      // exit can make the UI show "completed" while the assistant is still
      // streaming through the active turn.
    }

    // ────────────────────────────────────────────────────────────────────
    // Turn 生命周期 — 委托给 turnStateMachine 深模块
    // onTimeout 回调打破与 handleResult / handleError 的循环依赖：
    // 状态机只负责"超时了"信号，由 store 决定软收尾还是报错。
    // ────────────────────────────────────────────────────────────────────
    const {
      turnStates,
      resetTimeout,
      beginTurn,
      endTurn,
      ensureTurn,
    } = createTurnStateMachine({
      sink,
      traceEvent: sessionStore.traceEvent.bind(sessionStore),
      loadingSessions,
      streamingContents,
      pendingSendMessages,
      userAbortedSessions,
      onTimeout: (sessionId, ts) => {
        if (ts.isAutonomous) {
          handleResult(sessionId, ts, {})
        } else {
          handleError(sessionId, ts, new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
        }
      },
    })

    // ── 骨架 stub：本任务只建结构，行为在任务 5/7 实现 ──
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
      autoRetry.removeRetryState(targetSessionId)
      const session = sink.get(targetSessionId)
      if (!session) return

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

      const userMessage = sink.appendMessage(targetSessionId, {
        role: 'user',
        content: userMessageContent ?? content,
        attachments: attachments?.files,
        imageAttachments: attachments?.images
      })

      if (attachments?.images?.length) {
        for (const img of attachments.images) {
          if (img.id && img.data) {
            resolvedApi.image?.save?.(img.id, img.data).catch(() => {})
          }
        }
      }

      const claudeCode = resolvedApi.claudeCode
      if (!claudeCode) {
        sessionStore.logger.error('ChatStore', `sendMessage: claudeCode API not available | sessionId=${targetSessionId.slice(0, 8)}`)
        const classified = errorHandler.handleError(new Error('Claude Code CLI is not available. Please check your configuration.'), {
          sessionId: targetSessionId,
          phase: 'init',
        })
        setTimeout(() => {
          sink.appendMessage(targetSessionId, {
            role: 'assistant',
            content: classified.message,
            metadata: { error: classified }
          })
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
        const s = sink.get(targetSessionId)
        if (s) s.processStatus = 'idle'
        throw error
      }

      sessionStore.logger.info('ChatStore', `sendMessage: calling IPC sendMessage | sessionId=${targetSessionId.slice(0, 8)}`)

      if (turnStates.has(targetSessionId)) {
        sessionStore.logger.warn('ChatStore', `sendMessage: a turn is already in flight for this session, skipping new turn setup | sessionId=${targetSessionId.slice(0, 8)}`)
        pendingSendMessages.delete(targetSessionId)
        return
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
        ;(claudeCode.sendMessage as any)(targetSessionId, content, plainImages, {
          clientMessageId: userMessage.id,
          displayContent: userMessageContent ?? content,
        }).catch((error: any) => {
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

      if (sid) {
        // ★ 在 await 之前先标记用户主动中止，防止 await 期间引擎错误事件
        // 到达后通过 handleError → shouldAutoRetry 触发自动重试。
        userAbortedSessions.add(sid)
      }

      const claudeCode = resolvedApi.claudeCode
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

        autoRetry.cancelRetry(sid)
        autoRetry.removeRetryState(sid)

        const ts = turnStates.get(sid)
        if (ts && !ts.settled) {
          ts.settled = true
          ts.resolve?.()
          endTurn(sid, ts)
          const s = sink.get(sid)
          if (s) {
            s.processStatus = 'idle'
            sink.persist(sid)
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
      const session = sink.get(sid)
      if (!session) return

      const claudeCode = resolvedApi.claudeCode
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
                sink.persist(sid)
                await new Promise(resolve => setTimeout(resolve, 100))
              }
              const status = await claudeCode.getSessionStatus(sid)
              if (!status?.isRunning || status?.status === 'exited') {
                await claudeCode.stop(sid)
                session.processStatus = 'none'
                sink.persist(sid)
              }
            } catch (e) {
              sessionStore.logger.warn('ChatStore', `retryLastMessage: suspend failed, falling back to stop | sessionId=${sid.slice(0, 8)}`, { error: String(e) })
              try {
                await claudeCode.stop(sid)
              } catch (e2) {
                // 停止失败也不要紧，继续尝试
              }
              session.processStatus = 'none'
              sink.persist(sid)
            }
          }

          const existingUserMsgIndex = session.messages.findIndex(m => m.role === 'user' && m.content === lastUserMsg.content)
          if (existingUserMsgIndex >= 0) {
            session.messages.splice(existingUserMsgIndex, 1)
            sink.persist(sid)
          }

          await sendMessage(lastUserMsg.content)
        } catch (error) {
          sessionStore.logger.error('ChatStore', `retryLastMessage: failed | sessionId=${sid.slice(0, 8)}`, { error: String(error) })
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 权限裁决（从 chatControl.ts 迁移）
    // 写回走 sink.patchToolCall(sid, ...) 而非 sessionStore.updateToolCall(messageId, ...)：
    // 多 pane 并发场景下，原实现依赖 currentSessionId 会写错会话；迁移后优先使用传入的
    // sessionId，未传入时回退到 currentSessionId。
    // ────────────────────────────────────────────────────────────────────
    function getPendingPermissionForToolUse(toolUseId: string, sessionId?: string): PermissionRequest | undefined {
      const sid = sessionId ?? sessionStore.currentSessionId
      if (!sid) return undefined
      return pendingPermissions.value.get(sid)?.get(toolUseId)
    }

    function hasPendingPermissionForToolUse(toolUseId: string, sessionId?: string): boolean {
      return !!getPendingPermissionForToolUse(toolUseId, sessionId)
    }

    function consumePermissionFor(toolUseId: string, sessionId: string): PermissionRequest | undefined {
      return permissionService.consumePermissionFor(toolUseId, sessionId)
    }

    async function allowPermission(
      messageId: string,
      toolUseId: string,
      updatedInput: Record<string, unknown>,
      decisionClassification?: 'user_temporary' | 'user_permanent',
      sessionId?: string,
    ): Promise<void> {
      const sid = sessionId ?? sessionStore.currentSessionId
      if (!sid) return
      const claudeCode = resolvedApi.claudeCode
      if (!claudeCode?.allowPermission) {
        sessionStore.logger.error('ChatStore', 'allowPermission: claudeCode.allowPermission not available')
        return
      }
      const req = consumePermissionFor(toolUseId, sid)
      if (!req) {
        sessionStore.logger.warn('ChatStore', `allowPermission: no pending request | sessionId=${sid.slice(0, 8)} | toolUseId=${toolUseId.slice(0, 8)}`)
        return
      }
      sessionStore.logger.info('ChatStore', `allowPermission | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)}`)
      try {
        const safeInput = JSON.parse(JSON.stringify(updatedInput)) as Record<string, unknown>
        await claudeCode.allowPermission(sid, req.requestId, safeInput, decisionClassification)
        sink.patchToolCall(sid, messageId, toolUseId, 'completed')
      } catch (error) {
        sessionStore.logger.error('ChatStore', 'allowPermission failed', { error: String(error) })
        throw error
      }
    }

    async function denyPermission(
      messageId: string,
      toolUseId: string,
      message: string = 'User denied',
      options: { interrupt?: boolean } = {},
      sessionId?: string,
    ): Promise<void> {
      const sid = sessionId ?? sessionStore.currentSessionId
      if (!sid) return
      const claudeCode = resolvedApi.claudeCode
      if (!claudeCode?.denyPermission) {
        sessionStore.logger.error('ChatStore', 'denyPermission: claudeCode.denyPermission not available')
        return
      }
      const req = consumePermissionFor(toolUseId, sid)
      if (!req) {
        sessionStore.logger.warn('ChatStore', `denyPermission: no pending request | sessionId=${sid.slice(0, 8)} | toolUseId=${toolUseId.slice(0, 8)}`)
        return
      }
      sessionStore.logger.info('ChatStore', `denyPermission | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)} | interrupt=${!!options.interrupt}`)
      try {
        await claudeCode.denyPermission(sid, req.requestId, message, options)
        sink.patchToolCall(sid, messageId, toolUseId, 'completed')
      } catch (error) {
        sessionStore.logger.error('ChatStore', 'denyPermission failed', { error: String(error) })
        throw error
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 工具答复（从 chatStream.ts 迁移）
    // 写回走 sink.patchToolCall(sid, ...) 而非 sessionStore.updateToolCall(messageId, ...)：
    // 多 pane 并发场景下，原实现依赖 currentSessionId 会写错会话；迁移后用 handler 闭包内的 sid。
    // ────────────────────────────────────────────────────────────────────
    async function submitToolAnswer(sessionId: string, messageId: string, toolCallId: string, answers: Record<string, string>): Promise<void> {
      const sid = sessionId
      if (!sid) return

      sessionStore.logger.info('ChatStore', `submitToolAnswer: submitting answers | sessionId=${sid.slice(0, 8)} | messageId=${messageId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)

      const claudeCode = resolvedApi.claudeCode
      if (!claudeCode) {
        sessionStore.logger.error('ChatStore', 'submitToolAnswer: claudeCode API not available')
        return
      }

      try {
        await claudeCode.submitToolAnswer(sid, toolCallId, answers)
        sink.patchToolCall(sid, messageId, toolCallId, 'completed')
        sessionStore.logger.info('ChatStore', `submitToolAnswer: answers submitted successfully`)
      } catch (error) {
        sessionStore.logger.error('ChatStore', 'submitToolAnswer: failed', { error: String(error) })
        throw error
      }
    }

    async function skipToolAnswer(sessionId: string, messageId: string, toolCallId: string): Promise<void> {
      const sid = sessionId
      if (!sid) return

      sessionStore.logger.info('ChatStore', `skipToolAnswer: skipping tool | sessionId=${sid.slice(0, 8)} | messageId=${messageId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)

      const claudeCode = resolvedApi.claudeCode
      if (!claudeCode) {
        sessionStore.logger.error('ChatStore', 'skipToolAnswer: claudeCode API not available')
        return
      }

      try {
        await claudeCode.skipToolAnswer(sid, toolCallId)
        sink.patchToolCall(sid, messageId, toolCallId, 'completed')
        sessionStore.logger.info('ChatStore', `skipToolAnswer: tool skipped successfully`)
      } catch (error) {
        sessionStore.logger.error('ChatStore', 'skipToolAnswer: failed', { error: String(error) })
        throw error
      }
    }

    function getIsLoading(sessionId: string | null | undefined): boolean {
      if (!sessionId) return false
      return loadingSessions.value.get(sessionId) ?? false
    }
    function getStreamingContent(sessionId: string | null | undefined): string {
      if (!sessionId) return ''
      return streamingContents.value.get(sessionId) ?? ''
    }

    // ────────────────────────────────────────────────────────────────────
    // 持久订阅（store 初始化时注册一次，按 sessionId 多路复用，永不退订）
    // ────────────────────────────────────────────────────────────────────
    const claudeCodeApi = resolvedApi.claudeCode
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
        if (event.data?.__h5RemoteUserMessage) {
          handleRemoteUserMessage(event.sessionId, event.data)
          return
        }
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
      claudeCodeApi.onSystem?.((event: { sessionId: string; data: any }) => {
        if (event.data?.subtype === 'task_notification') {
          sessionStore.handleTaskNotification(event.data, event.sessionId)
        }
      })
      claudeCodeApi.onResult((event: { sessionId: string; data: any }) => {
        // ★ 拦截 sidechain / teammate 的 result 事件，防止子智能体 turn 结束
        // 被当作主会话 result 处理（提前结算主会话 turn）。
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
      if (typeof (claudeCodeApi as any).onError === 'function') {
        ;(claudeCodeApi as any).onError((event: { sessionId: string; data: any }) => {
          const ts = turnStates.get(event.sessionId)
          if (!ts) return
          const msg = typeof event.data?.message === 'string'
            ? event.data.message
            : typeof event.data === 'string'
              ? event.data
              : 'Engine error'
          handleError(event.sessionId, ts, new Error(msg))
        })
      }

      // ── 权限请求订阅（control_request: can_use_tool） ──
      if (typeof (claudeCodeApi as any).onPermissionRequest === 'function') {
        ;(claudeCodeApi as any).onPermissionRequest((evt: { sessionId: string; data: PermissionRequest }) => {
          const sid = evt.sessionId
          const req = evt.data
          if (!req?.toolUseId) {
            sessionStore.logger.warn('ChatStore', `permission_request without toolUseId | sessionId=${sid.slice(0, 8)} | requestId=${req?.requestId}`)
            return
          }
          sessionStore.logger.info('ChatStore', `permission_request | sessionId=${sid.slice(0, 8)} | tool=${req.toolName} | toolUseId=${req.toolUseId.slice(0, 8)} | requestId=${req.requestId.slice(0, 8)}`)
          permissionService.addPermissionRequest(sid, { ...req, sessionId: sid })
        })
      }
      if (typeof (claudeCodeApi as any).onPermissionRequestCancelled === 'function') {
        ;(claudeCodeApi as any).onPermissionRequestCancelled((evt: { sessionId: string; data: { requestId: string; reason?: string } }) => {
          const sid = evt.sessionId
          const cancelledRequestId = evt.data?.requestId
          if (!cancelledRequestId) return
          sessionStore.logger.info('ChatStore', `permission_request_cancelled | sessionId=${sid.slice(0, 8)} | requestId=${cancelledRequestId.slice(0, 8)} | reason=${evt.data?.reason || '(none)'}`)
          permissionService.removePermissionByRequestId(sid, cancelledRequestId)
        })
      }
    }

    return {
      streamingContents,
      loadingSessions,
      isLoading,
      streamingContent,
      pendingPermissions,
      sendMessage,
      abort,
      retryLastMessage,
      submitToolAnswer,
      skipToolAnswer,
      allowPermission,
      denyPermission,
      getPendingPermissionForToolUse,
      hasPendingPermissionForToolUse,
      consumePermissionFor,
      getIsLoading,
      getStreamingContent,
      pendingMessages,
      addPendingMessage,
      removePendingMessage,
      recallPendingMessage,
      getPendingMessages,
      clearPendingMessages,
      // auto-retry 状态机（任务 9 迁移）
      retryStates: autoRetry.retryStates,
      cancelRetry,
      // ── 测试用导出：beginTurn/ensureTurn/endTurn 是内部函数，
      // 仅因任务 2 需独立验证状态机而临时暴露；任务 10 删除整个 chatStream.ts
      // 并完成消费方迁移后可移除此导出。 ──
      beginTurn,
      ensureTurn,
      endTurn,
    }
  })()
}
