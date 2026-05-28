/**
 * 前端重试和超时工具 - 用于处理 LLM API 调用
 * 基于主流 AI IDE 的最佳实践设计
 */

// 超时配置常量
export const DEFAULT_API_TIMEOUT_MS = 300 * 1000 // 5分钟 - 足够处理复杂请求
export const MAX_API_TIMEOUT_MS = 30 * 60 * 1000 // 30分钟 - 最大允许的超时

// 重试配置常量
export const DEFAULT_MAX_RETRIES = 3
export const INITIAL_RETRY_DELAY_MS = 1000 // 1秒初始延迟
export const MAX_RETRY_DELAY_MS = 30000 // 30秒最大延迟
export const RETRY_JITTER_RANGE_MS = 500 // 0-500ms 抖动

// 判断是否是可重试错误
export function isRetryableError(error: any): boolean {
  // 网络错误
  if (error.name === 'NetworkError' || error.name === 'FetchError') {
    return true
  }

  // 超时错误
  if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
    return true
  }

  // 连接错误
  if (
    error.message?.includes('ECONNRESET') ||
    error.message?.includes('ECONNREFUSED') ||
    error.message?.includes('ETIMEDOUT') ||
    error.message?.includes('ENOTFOUND')
  ) {
    return true
  }

  // 5xx 服务器错误
  if (error.status && error.status >= 500 && error.status < 600) {
    return true
  }

  // 429 限流错误
  if (error.status === 429) {
    return true
  }

  // 特定于 API 的错误码
  if (error.error?.type === 'api_error' || error.error?.type === 'overloaded_error') {
    return true
  }

  // 检查自定义重试标志
  if (error.isRetryable !== undefined) {
    return error.isRetryable
  }

  return false
}

// 计算指数退避延迟（带抖动）
export function calculateRetryDelay(
  attempt: number,
  initialDelayMs: number = INITIAL_RETRY_DELAY_MS,
  maxDelayMs: number = MAX_RETRY_DELAY_MS,
  jitterMs: number = RETRY_JITTER_RANGE_MS
): number {
  // 指数退避：2^attempt * initialDelayMs
  const exponentialDelay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)

  // 添加随机抖动
  const jitter = Math.random() * jitterMs

  return exponentialDelay + jitter
}

// 睡眠函数
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 重试选项
export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  jitterMs?: number
  timeoutMs?: number
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
}

// 带重试和超时的执行器
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = INITIAL_RETRY_DELAY_MS,
    maxDelayMs = MAX_RETRY_DELAY_MS,
    jitterMs = RETRY_JITTER_RANGE_MS,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    onRetry,
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 创建超时控制器
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        // 执行函数
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              const timeoutError = new Error(`API 调用超时 (${timeoutMs}ms)`)
              ;(timeoutError as any).name = 'TimeoutError'
              ;(timeoutError as any).isRetryable = true
              reject(timeoutError)
            })
          }),
        ])

        clearTimeout(timeoutId)
        return result
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      lastError = error as Error

      // 检查是否是最后一次尝试
      if (attempt >= maxRetries) {
        break
      }

      // 检查是否应该重试
      if (!isRetryableError(error)) {
        console.warn(`[Retry] 错误不可重试: ${(error as Error).message}`)
        throw error
      }

      // 计算延迟
      const delayMs = calculateRetryDelay(attempt, initialDelayMs, maxDelayMs, jitterMs)

      // 记录重试信息
      console.log(
        `[Retry] 第 ${attempt + 1} 次尝试失败，${delayMs.toFixed(
          0
        )}ms 后重试: ${(error as Error).message}`
      )

      // 调用自定义重试回调
      if (onRetry) {
        onRetry(attempt + 1, error as Error, delayMs)
      }

      // 等待延迟
      await sleep(delayMs)
    }
  }

  // 所有重试都失败
  console.error(`[Retry] 所有 ${maxRetries + 1} 次尝试都失败了`)
  throw lastError
}

// 创建可重试错误
export function createRetryableError(message: string, originalError?: any): Error & { isRetryable: boolean } {
  const error = new Error(message) as Error & { isRetryable: boolean }
  error.isRetryable = true
  if (originalError) {
    ;(error as any).originalError = originalError
  }
  return error
}

// 导出默认配置
export const retryConfig = {
  maxRetries: DEFAULT_MAX_RETRIES,
  initialDelayMs: INITIAL_RETRY_DELAY_MS,
  maxDelayMs: MAX_RETRY_DELAY_MS,
  jitterMs: RETRY_JITTER_RANGE_MS,
  timeoutMs: DEFAULT_API_TIMEOUT_MS,
}
