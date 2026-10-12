import { describe, it, expect, vi } from 'vitest'
import {
  isRetryableError,
  calculateRetryDelay,
  withRetryAndTimeout,
  createRetryableError,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from '@/utils/retry'

function makeError(overrides: Record<string, unknown> = {}): Error & Record<string, unknown> {
  return Object.assign(new Error('boom'), overrides)
}

describe('isRetryableError', () => {
  it('按错误名识别网络错误', () => {
    expect(isRetryableError(makeError({ name: 'NetworkError' }))).toBe(true)
    expect(isRetryableError(makeError({ name: 'FetchError' }))).toBe(true)
  })

  it('识别超时错误（名称或消息）', () => {
    expect(isRetryableError(makeError({ name: 'TimeoutError' }))).toBe(true)
    expect(isRetryableError(new Error('request timeout exceeded'))).toBe(true)
  })

  it('识别连接类错误码', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      expect(isRetryableError(new Error(`connect ${code}`))).toBe(true)
    }
  })

  it('5xx 与 429 状态码可重试', () => {
    expect(isRetryableError(makeError({ status: 500 }))).toBe(true)
    expect(isRetryableError(makeError({ status: 599 }))).toBe(true)
    expect(isRetryableError(makeError({ status: 429 }))).toBe(true)
  })

  it('4xx 非限流错误不可重试', () => {
    expect(isRetryableError(makeError({ status: 400 }))).toBe(false)
    expect(isRetryableError(makeError({ status: 404 }))).toBe(false)
  })

  it('识别 Anthropic API 错误类型', () => {
    expect(isRetryableError(makeError({ error: { type: 'api_error' } }))).toBe(true)
    expect(isRetryableError(makeError({ error: { type: 'overloaded_error' } }))).toBe(true)
  })

  it('自定义 isRetryable 标志在其他启发式都不命中时生效', () => {
    // 注意：标志位于判定链末尾，status 500 等启发式会先于它命中
    expect(isRetryableError(makeError({ isRetryable: false }))).toBe(false)
    expect(isRetryableError(makeError({ isRetryable: true, status: 400 }))).toBe(true)
  })

  it('普通业务错误不可重试', () => {
    expect(isRetryableError(new Error('validation failed'))).toBe(false)
  })
})

describe('calculateRetryDelay', () => {
  it('指数退避：2^attempt * initialDelayMs', () => {
    expect(calculateRetryDelay(0, 1000, 30000, 0)).toBe(1000)
    expect(calculateRetryDelay(1, 1000, 30000, 0)).toBe(2000)
    expect(calculateRetryDelay(3, 1000, 30000, 0)).toBe(8000)
  })

  it('延迟被 maxDelayMs 封顶', () => {
    expect(calculateRetryDelay(10, 1000, 5000, 0)).toBe(5000)
  })

  it('抖动落在 [0, jitterMs) 区间', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(calculateRetryDelay(0, 1000, 30000, 500)).toBe(1250)
    vi.restoreAllMocks()
  })

  it('使用默认常量时结果不小于指数退避值', () => {
    const delay = calculateRetryDelay(0)
    expect(delay).toBeGreaterThanOrEqual(INITIAL_RETRY_DELAY_MS)
    expect(delay).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS + 500)
  })
})

describe('withRetryAndTimeout', () => {
  const fast = { initialDelayMs: 1, maxDelayMs: 2, jitterMs: 0 }

  it('首次成功直接返回结果', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetryAndTimeout(fn, fast)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('可重试错误触发重试直至成功', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeError({ status: 500 }))
      .mockResolvedValue('recovered')
    await expect(withRetryAndTimeout(fn, fast)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('不可重试错误立即抛出，不再重试', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('bad request'))
    await expect(withRetryAndTimeout(fn, fast)).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('重试次数用完后抛出最后一次错误', async () => {
    const fn = vi.fn().mockRejectedValue(makeError({ status: 503 }))
    await expect(
      withRetryAndTimeout(fn, { ...fast, maxRetries: 2 })
    ).rejects.toMatchObject({ status: 503 })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('每次重试前调用 onRetry 回调', async () => {
    const onRetry = vi.fn()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeError({ status: 500 }))
      .mockResolvedValue('ok')
    await withRetryAndTimeout(fn, { ...fast, onRetry })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number))
  })

  it('超过 timeoutMs 触发 TimeoutError（可重试）', async () => {
    const never = () => new Promise<string>(() => {})
    await expect(
      withRetryAndTimeout(never, { ...fast, maxRetries: 0, timeoutMs: 10 })
    ).rejects.toMatchObject({ name: 'TimeoutError', isRetryable: true })
  })
})

describe('createRetryableError', () => {
  it('创建带 isRetryable 标志的错误', () => {
    const err = createRetryableError('retry me')
    expect(err.message).toBe('retry me')
    expect(err.isRetryable).toBe(true)
  })

  it('附带原始错误引用', () => {
    const original = new Error('root cause')
    const err = createRetryableError('wrapped', original)
    expect((err as unknown as { originalError: Error }).originalError).toBe(original)
  })
})
