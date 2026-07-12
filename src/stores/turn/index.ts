import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { useChatSessionStore } from '../chatSession'
import { useSettingsStore } from '../settings'
import { useContextUsageStore } from '../contextUsage'
import type { SessionSink } from '../turnSink'
import { ErrorCategory } from '@/types'
import { permissionService, type PermissionRequest } from '@/services/permissionService'
import {
  isTeammateRawMessage,
  isSidechainMessage,
} from '@/services/teamTranscriptService'
import { useAutoRetry } from '@/composables/useAutoRetry'
import type { TurnState } from './types'
import { REQUEST_TIMEOUT } from './types'
import { createTimelineAssembler } from './timelineAssembler'
import { createTurnStateMachine } from './turnStateMachine'
import { createEventHandlers, type EventReducer } from './eventHandlers'

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
    const timelineAssembler = createTimelineAssembler(sink)

    // ────────────────────────────────────────────────────────────────────
    // Turn 深模块编排：状态机 → 事件处理器。
    // onTimeout 回调通过 handlers 前向引用打破循环依赖：
    // 状态机先创建（需要 onTimeout），事件处理器后创建（需要 stateMachine）。
    // 运行时安全：onTimeout 仅由 setTimeout 触发，而 setTimeout 在 beginTurn
    // 中注册——beginTurn 只在用户交互或事件订阅中被调用，绝不会在同步初始化
    // 期间执行，故 handlers 在 onTimeout 首次触发前必然已赋值。
    // ────────────────────────────────────────────────────────────────────
    let handlers: EventReducer | undefined

    const stateMachine = createTurnStateMachine({
      sink,
      traceEvent: sessionStore.traceEvent.bind(sessionStore),
      loadingSessions,
      streamingContents,
      pendingSendMessages,
      userAbortedSessions,
      onTimeout: (sessionId, ts) => {
        if (ts.isAutonomous) {
          handlers?.handleResult(sessionId, ts, {})
        } else {
          handlers?.handleError(sessionId, ts, new Error(`请求超时（${REQUEST_TIMEOUT / 1000}秒无响应）`))
        }
      },
    })

    handlers = createEventHandlers({
      sink,
      stateMachine,
      timeline: timelineAssembler,
      streamingContents,
      loadingSessions,
      pendingSendMessages,
      userAbortedSessions,
      logger: sessionStore.logger,
      traceEvent: sessionStore.traceEvent.bind(sessionStore),
      selectSession: (sid: string) => { void sessionStore.selectSession(sid) },
      getCurrentSessionId: () => sessionStore.currentSessionId ?? undefined,
      updateTaskStateFromToolResult: sessionStore.updateTaskStateFromToolResult,
      loadTurnCheckpoints: (sid: string, projectPathOverride?: string, force?: boolean) => {
        void sessionStore.loadTurnCheckpoints(sid, projectPathOverride, force)
      },
      getModel: () => settingsStore.config.model,
      getProvider: () => settingsStore.config.provider,
      getBaseUrl: () => settingsStore.config.baseUrl,
      autoRetry,
      initiateAutoRetry,
      contextUsage: useContextUsageStore(),
      errorHandler,
      getClaudeCode: () => resolvedApi.claudeCode ?? null,
      getArtifactsApi: () => resolvedApi.artifacts ?? null,
    })

    const {
      turnStates,
      resetTimeout,
      beginTurn,
      endTurn,
      ensureTurn,
    } = stateMachine

    const {
      handleRemoteUserMessage,
      handleStreamEvent,
      handleAssistant,
      handleToolUse,
      handleToolResult,
      handleUser,
      handleResult,
      handleError,
      handleExit,
    } = handlers

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
