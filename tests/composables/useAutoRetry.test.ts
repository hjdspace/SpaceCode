/**
 * useAutoRetry composable tests
 *
 * Tests the automatic retry state machine used by chatStream.ts:
 * - retryable errors increment the attempt counter
 * - success clears the retry state and hides the RetryIndicator
 * - max retries limit is respected
 * - user abort prevents retry
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAutoRetry, extractErrorCode } from '@/composables/useAutoRetry'
import { ErrorCategory } from '@/types'

describe('useAutoRetry - attempt counting', () => {
  it('should increment attempt across consecutive retryable errors', () => {
    const { retryStates, recordRetryableError } = useAutoRetry()
    const sid = 'session-1'

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    expect(retryStates.value.get(sid)?.attempt).toBe(1)

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    expect(retryStates.value.get(sid)?.attempt).toBe(2)

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    expect(retryStates.value.get(sid)?.attempt).toBe(3)

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    expect(retryStates.value.get(sid)?.attempt).toBe(4)
  })

  it('should record assistantMessageId when provided', () => {
    const { retryStates, recordRetryableError } = useAutoRetry()
    const sid = 'session-1'
    const assistantMessageId = 'msg-abc'

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429', undefined, assistantMessageId)
    expect(retryStates.value.get(sid)?.assistantMessageId).toBe(assistantMessageId)
  })

  it('should reset attempt back to 1 after a successful response clears the state', () => {
    const { retryStates, recordRetryableError, clearOnSuccess } = useAutoRetry()
    const sid = 'session-1'

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    expect(retryStates.value.get(sid)?.attempt).toBe(2)

    clearOnSuccess(sid)
    expect(retryStates.value.has(sid)).toBe(false)

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, '请求过于频繁', 'API 返回 429')
    expect(retryStates.value.get(sid)?.attempt).toBe(1)
  })
})

describe('useAutoRetry - retry eligibility', () => {
  it('should allow retry when attempt is below maxRetries', () => {
    const { shouldAutoRetry } = useAutoRetry({ maxRetries: 5 })
    expect(shouldAutoRetry('sid', true, new Set())).toBe(true)
  })

  it('should deny retry when max retries exhausted', () => {
    const { shouldAutoRetry, recordRetryableError } = useAutoRetry({ maxRetries: 2 })
    const sid = 'sid'

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, 'title', 'msg')
    expect(shouldAutoRetry(sid, true, new Set())).toBe(true)

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, 'title', 'msg')
    expect(shouldAutoRetry(sid, true, new Set())).toBe(false)
  })

  it('should deny retry for non-retryable errors', () => {
    const { shouldAutoRetry } = useAutoRetry()
    expect(shouldAutoRetry('sid', false, new Set())).toBe(false)
  })

  it('should deny retry when user aborted the session', () => {
    const { shouldAutoRetry } = useAutoRetry()
    const aborted = new Set(['sid'])
    expect(shouldAutoRetry('sid', true, aborted)).toBe(false)
  })
})

describe('useAutoRetry - delay calculation', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  it('should use Retry-After hint when provided', () => {
    const { computeRetryDelay } = useAutoRetry({ maxDelayMs: 60_000 })
    expect(computeRetryDelay(5000, 2)).toBe(5000)
  })

  it('should cap Retry-After hint to maxDelayMs', () => {
    const { computeRetryDelay } = useAutoRetry({ maxDelayMs: 60_000 })
    expect(computeRetryDelay(120_000, 0)).toBe(60_000)
  })

  it('should calculate exponential backoff with jitter', () => {
    const { computeRetryDelay } = useAutoRetry({ initialDelayMs: 2000, jitterMs: 1000 })
    // attempt 0: 2000 * 2^0 + 0.5 * 1000 = 2500
    expect(computeRetryDelay(undefined, 0)).toBe(2500)
    // attempt 1: 2000 * 2^1 + 500 = 4500
    expect(computeRetryDelay(undefined, 1)).toBe(4500)
    // attempt 2: 2000 * 2^2 + 500 = 8500
    expect(computeRetryDelay(undefined, 2)).toBe(8500)
  })
})

describe('useAutoRetry - cancellation', () => {
  it('should mark retry as aborted and allow removal', () => {
    const { retryStates, recordRetryableError, cancelRetry, removeRetryState } = useAutoRetry()
    const sid = 'sid'

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, 'title', 'msg')
    expect(cancelRetry(sid)).toBe(true)
    expect(retryStates.value.get(sid)?.aborted).toBe(true)

    removeRetryState(sid)
    expect(retryStates.value.has(sid)).toBe(false)
    expect(cancelRetry(sid)).toBe(false)
  })
})

describe('extractErrorCode - 从实际错误中提取错误码', () => {
  it('应从 429 错误消息中提取状态码', () => {
    expect(extractErrorCode('API Error: 429 rate limit exceeded', ErrorCategory.RATE_LIMIT)).toBe('429')
  })

  it('应从 5xx 服务器错误中提取状态码', () => {
    expect(extractErrorCode('API Error: 502 Bad Gateway', ErrorCategory.SERVER_ERROR)).toBe('502')
    expect(extractErrorCode('Request failed with 500', ErrorCategory.SERVER_ERROR)).toBe('500')
    expect(extractErrorCode('503 Service Unavailable', ErrorCategory.SERVER_ERROR)).toBe('503')
  })

  it('网络错误应返回 i18n key 后缀', () => {
    expect(extractErrorCode('fetch failed: ECONNREFUSED', ErrorCategory.NETWORK_ERROR)).toBe('networkError')
  })

  it('超时错误应返回 i18n key 后缀', () => {
    expect(extractErrorCode('Request timeout after 30000ms', ErrorCategory.TIMEOUT)).toBe('timeoutError')
  })

  it('进程退出错误应返回 i18n key 后缀', () => {
    expect(extractErrorCode('Process exited with code 1', ErrorCategory.PROCESS_ERROR)).toBe('processError')
  })

  it('未知错误且无状态码时应返回通用 i18n key 后缀', () => {
    expect(extractErrorCode('something went wrong', ErrorCategory.UNKNOWN)).toBe('unknownError')
  })

  it('应优先提取 HTTP 状态码而非类别标签', () => {
    // 即使类别是 NETWORK_ERROR，如果消息里有状态码也应优先返回状态码
    expect(extractErrorCode('Network error 502', ErrorCategory.NETWORK_ERROR)).toBe('502')
  })
})

describe('useAutoRetry - errorCode 存储', () => {
  it('recordRetryableError 应将 errorCode 存入 RetryState', () => {
    const { retryStates, recordRetryableError } = useAutoRetry()
    const sid = 'sid-err'

    recordRetryableError(
      sid,
      ErrorCategory.RATE_LIMIT,
      '请求过于频繁',
      'API 返回 429',
      undefined,
      undefined,
      '429',
    )
    expect(retryStates.value.get(sid)?.errorCode).toBe('429')
  })

  it('未提供 errorCode 时字段应为 undefined', () => {
    const { retryStates, recordRetryableError } = useAutoRetry()
    const sid = 'sid-noerr'

    recordRetryableError(sid, ErrorCategory.RATE_LIMIT, 'title', 'msg')
    expect(retryStates.value.get(sid)?.errorCode).toBeUndefined()
  })
})
