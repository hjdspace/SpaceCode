// @vitest-environment node
/**
 * 工厂会话 id 必须能直接交给引擎：claude-code CLI 对 --session-id 的校验是
 * `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`，
 * 非法值会让进程以 code=1 退出（Error: Invalid session ID）。
 */
import { describe, expect, it } from 'vitest'
import { factorySessionId } from '../sessionId'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('factorySessionId', () => {
  it('maps a readable factory label to a valid engine session UUID', () => {
    expect(factorySessionId('fac-run-1-bl-1-impl')).toMatch(UUID)
  })

  it('is stable for the same label so retries resume the same transcript', () => {
    expect(factorySessionId('fac-run-1-bl-1-impl')).toBe(factorySessionId('fac-run-1-bl-1-impl'))
  })

  it('keeps stages of the same task apart', () => {
    const impl = factorySessionId('fac-run-1-bl-1-impl')
    const retry = factorySessionId('fac-run-1-bl-1-retry')
    const review = factorySessionId('fac-run-1-bl-1-review-1')
    expect(new Set([impl, retry, review]).size).toBe(3)
  })
})
