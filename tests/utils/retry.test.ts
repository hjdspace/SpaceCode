import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isRetryableError,
  calculateRetryDelay,
  sleep,
  withRetryAndTimeout,
  createRetryableError,
  retryConfig,
  DEFAULT_MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  RETRY_JITTER_RANGE_MS,
} from '@/utils/retry'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('retry — isRetryableError', () => {
  it('网络错误名称可重试', () => {
    expect(isRetryableError({ name: 'NetworkError' })).toBe(true)
    expect(isRetryableError({ name: 'FetchError' })).toBe(true)
  })

  it('超时错误（名称或消息）可重试', () => {
    expect(isRetryableError({ name: 'TimeoutError' })).toBe(true)
    expect(isRetryableError({ message: 'request timeout' })).toBe(true)
  })

  it('连接错误码（ECONN*）可重试', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      expect(isRetryableError({ message: `connect ${code}` })).toBe(true)
    }
  })

  it('5xx 服务器错误可重试，边界 500/599', () => {
    expect(isRetryableError({ status: 500 })).toBe(true)
    expect(isRetryableError({ status: 599 })).toBe(true)
    expect(isRetryableError({ status: 600 })).toBe(false)
    expect(isRetryableError({ status: 404 })).toBe(false)
  })

  it('429 限流可重试', () => {
    expect(isRetryableError({ status: 429 })).toBe(true)
  })

  it('API 错误类型 api_error / overloaded_error 可重试', () => {
    expect(isRetryableError({ error: { type: 'api_error' } })).toBe(true)
    expect(isRetryableError({ error: { type: 'overloaded_error' } })).toBe(true)
    expect(isRetryableError({ error: { type: 'invalid_request_error' } })).toBe(false)
  })

  it('自定义 isRetryable 标志优先（显式 false 不可重试）', () => {
    expect(isRetryableError({ isRetryable: true })).toBe(true)
    // 即便消息像超时，显式 isRetryable=false 会经前面分支命中
    expect(isRetryableError({ isRetryable: false })).toBe(false)
  })

  it('普通错误不可重试', () => {
    expect(isRetryableError(new Error('普通错误'))).toBe(false)
    expect(isRetryableError({})).toBe(false)
  })
})

describe('retry — calculateRetryDelay', () => {
  it('指数退避：attempt 增大延迟翻倍（不含抖动）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(calculateRetryDelay(0, 1000, 30000, 0)).toBe(1000)
    expect(calculateRetryDelay(1, 1000, 30000, 0)).toBe(2000)
    expect(calculateRetryDelay(2, 1000, 30000, 0)).toBe(4000)
  })

  it('延迟被封顶到 maxDelay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(calculateRetryDelay(10, 1000, 30000, 0)).toBe(30000)
  })

  it('抖动落在 [0, jitterMs) 区间', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const delay = calculateRetryDelay(0, 1000, 30000, 500)
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThan(1000 + 500)
  })
})

describe('retry — sleep', () => {
  it('按指定毫秒后 resolve', async () => {
    vi.useFakeTimers()
    const promise = sleep(100)
    let resolved = false
    void promise.then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(99)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })
})

describe('retry — withRetryAndTimeout', () => {
  it('首次成功直接返回结果', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetryAndTimeout(fn, { initialDelayMs: 1, jitterMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('可重试错误会重试并最终成功', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ name: 'NetworkError', message: 'net' })
      .mockResolvedValue('recovered')
    const onRetry = vi.fn()
    const result = await withRetryAndTimeout(fn, {
      initialDelayMs: 1,
      jitterMs: 0,
      onRetry,
    })
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0][0]).toBe(1) // attempt 从 1 开始
  })

  it('不可重试错误立即抛出，不重试', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('不可重试'))
    await expect(
      withRetryAndTimeout(fn, { initialDelayMs: 1, jitterMs: 0 })
    ).rejects.toThrow('不可重试')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('所有重试失败后抛出最后一次错误', async () => {
    const err = { name: 'NetworkError', message: '持续失败' }
    const fn = vi.fn().mockRejectedValue(err)
    await expect(
      withRetryAndTimeout(fn, { maxRetries: 2, initialDelayMs: 1, jitterMs: 0 })
    ).rejects.toBe(err)
    // maxRetries=2 → 共 3 次尝试
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('超时错误被标记为可重试并触发重试', async () => {
    vi.useFakeTimers()
    const onRetry = vi.fn()
    // fn 永不 resolve，触发超时；随后第二次成功
    let call = 0
    const fn = vi.fn(() => {
      call++
      return call === 1 ? new Promise(() => {}) : Promise.resolve('done')
    })
    const promise = withRetryAndTimeout(fn, {
      timeoutMs: 100,
      initialDelayMs: 1,
      jitterMs: 0,
      onRetry,
    })
    const assertion = expect(promise).resolves.toBe('done')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('retry — createRetryableError / retryConfig', () => {
  it('创建的错误带 isRetryable=true，可携带原始错误', () => {
    const err = createRetryableError('包装错误', { code: 'X' })
    expect(err.message).toBe('包装错误')
    expect(err.isRetryable).toBe(true)
    expect((err as unknown as { originalError: unknown }).originalError).toEqual({ code: 'X' })
    expect(isRetryableError(err)).toBe(true)
  })

  it('retryConfig 与常量一致', () => {
    expect(retryConfig).toEqual({
      maxRetries: DEFAULT_MAX_RETRIES,
      initialDelayMs: INITIAL_RETRY_DELAY_MS,
      maxDelayMs: MAX_RETRY_DELAY_MS,
      jitterMs: RETRY_JITTER_RANGE_MS,
      timeoutMs: retryConfig.timeoutMs,
    })
  })
})
