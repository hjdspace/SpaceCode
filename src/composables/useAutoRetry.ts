import { ref } from 'vue'
import type { Ref } from 'vue'
import type { RetryState } from '@/types'
import { ErrorCategory } from '@/types'
import {
  computeRetryDelayMs,
  INITIAL_RETRY_DELAY_MS as DEFAULT_INITIAL_RETRY_DELAY_MS,
  MAX_RETRIES as DEFAULT_MAX_RETRIES,
  MAX_RETRY_DELAY_MS as DEFAULT_MAX_RETRY_DELAY_MS,
  RETRY_JITTER_MS as DEFAULT_RETRY_JITTER_MS,
} from '@/shared/agentRetry'

export interface UseAutoRetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  jitterMs?: number
}

export interface UseAutoRetryReturn {
  retryStates: Ref<Map<string, RetryState>>
  shouldAutoRetry: (sessionId: string, retryable: boolean, userAbortedSessions: Set<string>) => boolean
  recordRetryableError: (
    sessionId: string,
    errorCategory: ErrorCategory,
    errorTitle: string,
    errorMessage: string,
    retryDelayHint?: number,
    assistantMessageId?: string,
    errorCode?: string,
  ) => RetryState
  clearOnSuccess: (sessionId: string) => void
  cancelRetry: (sessionId: string) => boolean
  removeRetryState: (sessionId: string) => void
  computeRetryDelay: (retryDelayHint?: number, attempt?: number) => number
}

/**
 * 从错误详情中提取用于 UI 展示的错误码/标签。
 * 优先匹配 HTTP 状态码（4xx/5xx），否则按错误类别返回 i18n key 后缀（errors.{suffix}）。
 */
export function extractErrorCode(technicalDetail: string, category: ErrorCategory): string {
  const codeMatch = technicalDetail.match(/\b([45]\d{2})\b/)
  if (codeMatch) return codeMatch[1]
  switch (category) {
    case ErrorCategory.NETWORK_ERROR: return 'networkError'
    case ErrorCategory.TIMEOUT: return 'timeoutError'
    case ErrorCategory.PROCESS_ERROR: return 'processError'
    default: return 'unknownError'
  }
}

/**
 * 自动重试状态机。
 *
 * 遇到可恢复错误（429 / 5xx / 网络错误 / 超时 / 进程退出）时，
 * 不展示技术错误详情，直接在聊天页显示"API Error：xxx... 正在重连 (n/m)"并自动重发用户消息。
 *
 * 重要：重试状态只能在请求**真正成功完成**后清除（通过 clearOnSuccess）。
 * 在 LLM 开始响应的 onAssistant / stream_event 事件中清除状态会导致重试计数
 * 被过早归零，界面永远停留在 (1/5)。
 */
export function useAutoRetry(options: UseAutoRetryOptions = {}): UseAutoRetryReturn {
  const MAX_RETRIES = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const INITIAL_RETRY_DELAY_MS = options.initialDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS
  const MAX_RETRY_DELAY_MS = options.maxDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
  const RETRY_JITTER_MS = options.jitterMs ?? DEFAULT_RETRY_JITTER_MS

  const retryStates = ref<Map<string, RetryState>>(new Map())

  function computeRetryDelay(retryDelayHint?: number, attempt: number = 0): number {
    return computeRetryDelayMs(attempt, {
      ...(retryDelayHint !== undefined ? { hintMs: retryDelayHint } : {}),
      initialDelayMs: INITIAL_RETRY_DELAY_MS,
      maxDelayMs: MAX_RETRY_DELAY_MS,
      jitterMs: RETRY_JITTER_MS,
    })
  }

  function shouldAutoRetry(sessionId: string, retryable: boolean, userAbortedSessions: Set<string>): boolean {
    if (!retryable) return false
    if (userAbortedSessions.has(sessionId)) return false
    const state = retryStates.value.get(sessionId)
    const attempt = state?.attempt ?? 0
    return attempt < MAX_RETRIES
  }

  function recordRetryableError(
    sessionId: string,
    errorCategory: ErrorCategory,
    errorTitle: string,
    errorMessage: string,
    retryDelayHint?: number,
    assistantMessageId?: string,
    errorCode?: string,
  ): RetryState {
    const prev = retryStates.value.get(sessionId)
    const attempt = (prev?.attempt ?? 0) + 1
    const delayMs = computeRetryDelay(retryDelayHint, attempt - 1)
    const state: RetryState = {
      attempt,
      maxRetries: MAX_RETRIES,
      errorCategory,
      errorTitle,
      errorMessage,
      errorCode,
      delayMs,
      startedAt: Date.now(),
      aborted: false,
      assistantMessageId,
    }
    retryStates.value.set(sessionId, state)
    retryStates.value = new Map(retryStates.value)
    return state
  }

  function clearOnSuccess(sessionId: string): void {
    if (retryStates.value.has(sessionId)) {
      retryStates.value.delete(sessionId)
      retryStates.value = new Map(retryStates.value)
    }
  }

  function cancelRetry(sessionId: string): boolean {
    const state = retryStates.value.get(sessionId)
    if (!state) return false
    state.aborted = true
    retryStates.value = new Map(retryStates.value)
    return true
  }

  function removeRetryState(sessionId: string): void {
    retryStates.value.delete(sessionId)
    retryStates.value = new Map(retryStates.value)
  }

  return {
    retryStates,
    shouldAutoRetry,
    recordRetryableError,
    clearOnSuccess,
    cancelRetry,
    removeRetryState,
    computeRetryDelay,
  }
}
