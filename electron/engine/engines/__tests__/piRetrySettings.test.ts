import { describe, expect, it } from 'vitest'
import { PI_RETRY_BASE_DELAY_MS, PI_RETRY_MAX_RETRIES, mergeRetrySettings } from '../piRetrySettings'

describe('mergeRetrySettings', () => {
  it('空配置写入引擎级重试预算', () => {
    expect(mergeRetrySettings({})).toMatchObject({
      retry: { enabled: true, maxRetries: PI_RETRY_MAX_RETRIES, baseDelayMs: PI_RETRY_BASE_DELAY_MS },
    })
  })

  it('非对象输入安全起步，其余字段不丢', () => {
    expect(mergeRetrySettings(null)).toMatchObject({ retry: { maxRetries: PI_RETRY_MAX_RETRIES } })
    expect(mergeRetrySettings('junk')).toMatchObject({ retry: { maxRetries: PI_RETRY_MAX_RETRIES } })
    expect(mergeRetrySettings({ theme: 'dark' })).toEqual({
      theme: 'dark',
      retry: { enabled: true, maxRetries: PI_RETRY_MAX_RETRIES, baseDelayMs: PI_RETRY_BASE_DELAY_MS },
    })
  })

  it('用户已配更大 maxRetries 时不降级', () => {
    const merged = mergeRetrySettings({ retry: { maxRetries: 20 } })
    expect(merged.retry).toMatchObject({ maxRetries: 20, enabled: true })
  })

  it('用户配小的 maxRetries 提升到引擎预算（pi 默认 3 就属此类）', () => {
    expect(mergeRetrySettings({ retry: { maxRetries: 3 } }).retry).toMatchObject({
      maxRetries: PI_RETRY_MAX_RETRIES,
    })
  })

  it('用户显式关闭 retry.enabled 时尊重，不动 enabled', () => {
    const merged = mergeRetrySettings({ retry: { enabled: false } })
    expect(merged.retry).toMatchObject({ enabled: false, maxRetries: PI_RETRY_MAX_RETRIES })
  })

  it('用户已配 baseDelayMs 时保留', () => {
    expect(mergeRetrySettings({ retry: { baseDelayMs: 2000 } }).retry).toMatchObject({ baseDelayMs: 2000 })
  })

  it('畸形 retry 段重建而不崩溃', () => {
    expect(mergeRetrySettings({ retry: 'oops', keep: 1 })).toMatchObject({
      keep: 1,
      retry: { enabled: true, maxRetries: PI_RETRY_MAX_RETRIES, baseDelayMs: PI_RETRY_BASE_DELAY_MS },
    })
  })
})
