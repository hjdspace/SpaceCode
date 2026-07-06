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
    }
  })()
}
