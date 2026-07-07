import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { useChatSessionStore } from './chatSession'
import type { SessionSink } from './turnSink'
import type { Message, ToolCall } from '@/types'
import { permissionService, type PermissionRequest } from '@/services/permissionService'

// 单个会话当前进行中的 turn 状态。turnStates 中无此 sessionId 条目 === 该会话 idle。
export interface TurnState {
  assistantMessageId: string
  accumulatedContent: string
  currentTextEventId: string | null
  currentReasoningEventId: string | null
  streamingHandledThinking: boolean
  sendStartTime: number
  timeoutId: ReturnType<typeof setTimeout> | null
  isAutonomous: boolean
  settled: boolean
  resolve?: () => void
  reject?: (e: any) => void
}

export const REQUEST_TIMEOUT = 5 * 60 * 1000
export const AUTONOMOUS_REQUEST_TIMEOUT = 45 * 60 * 1000
export const MAX_INMEMORY_TOOL_OUTPUT = 30_000

// 测试可注入 fake api；生产用真实 api
export function useTurnStore(injectedApi?: any) {
  return defineStore('turn', () => {
    const resolvedApi = injectedApi ?? api
    const sessionStore = useChatSessionStore()

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
    const turnStates = new Map<string, TurnState>()
    const pendingSendMessages = new Set<string>()
    const userAbortedSessions = new Set<string>()

    // ── forward stubs：任务 4 迁移 handler 时替换为真实实现 ──
    // resetTimeout 在超时时引用 handleResult/handleError，但真实 handler 在任务 4 才迁移。
    // 此处放 no-op stub 使 turn 状态机闭环可独立测试；任务 4 替换为真实实现时直接覆盖。
    // 签名与原 chatStream.ts 保持一致（第 3 参数：result: any / error: any），便于任务 4 平滑替换。
    function handleResult(_sessionId: string, _ts: TurnState, _result: any): void {}
    function handleError(_sessionId: string, _ts: TurnState, _error: any): void {}

    // ────────────────────────────────────────────────────────────────────
    // Turn 生命周期（从 chatStream.ts 迁移；写回走 sink seam，读会话走 sink.get）
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
      const s = sink.get(sessionId)
      if (s) s.processStatus = 'active'

      sessionStore.traceEvent({
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
        return { settled: true } as TurnState
      }

      // ★ 用户主动 abort 后，丢弃引擎残留事件（子代理输出等），
      // 不创建 autonomous turn，防止会话「自动恢复运行」。
      // 标记在 sendMessage / retryLastMessage / resendForRetry 中清除。
      if (userAbortedSessions.has(sessionId)) {
        return { settled: true } as TurnState
      }

      // 新建会话尚未有任何消息时，不因 CLI 初始化事件自动创建 turn，
      // 避免会话在用户发送消息前就显示转圈。
      // 后台 agent 自动续跑仅对已有消息的会话生效，不影响该路径。
      const session = sink.get(sessionId)
      if (!session || session.messages.length === 0) {
        // 返回一个已结算的空 turn，使调用方因 ts.settled 提前返回
        return { settled: true } as TurnState
      }

      return beginTurn(sessionId, { isAutonomous: true })
    }

    // ── 骨架 stub：本任务只建结构，行为在任务 5/7 实现 ──
    async function sendMessage(_content: string, _userMessageContent?: string, _attachments?: any): Promise<void> {}
    async function abort(): Promise<void> {}
    async function allowPermission(_messageId: string, _toolUseId: string, _updatedInput: Record<string, unknown>, _decisionClassification?: 'user_temporary' | 'user_permanent'): Promise<void> {}
    async function denyPermission(_messageId: string, _toolUseId: string, _message = 'User denied', _options: { interrupt?: boolean } = {}): Promise<void> {}
    function getIsLoading(sessionId: string | null | undefined): boolean {
      if (!sessionId) return false
      return loadingSessions.value.get(sessionId) ?? false
    }
    function getStreamingContent(sessionId: string | null | undefined): string {
      if (!sessionId) return ''
      return streamingContents.value.get(sessionId) ?? ''
    }

    return {
      streamingContents,
      loadingSessions,
      sendMessage,
      abort,
      allowPermission,
      denyPermission,
      getIsLoading,
      getStreamingContent,
      // ── 测试用导出：beginTurn/ensureTurn/endTurn 是内部函数，
      // 仅因任务 2 需独立验证状态机而临时暴露；任务 10 删除整个 chatStream.ts
      // 并完成消费方迁移后可移除此导出。 ──
      beginTurn,
      ensureTurn,
      endTurn,
    }
  })()
}
