// @vitest-environment node
/**
 * 引擎会话 id 的稳定性（T21，设计 §5.3）。
 *
 * 这两条 id 是「重启后还能接上同一段对话」的全部依据，因此契约只有两条：
 * 形状必须是 CLI 认的 UUID，取值必须由可读标签稳定派生。
 */
import { describe, expect, it } from 'vitest'
import {
  superAgentRouterEngineSessionId,
  superAgentWorkerEngineSessionId,
} from '../sessionId'

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('superAgentWorkerEngineSessionId', () => {
  it('is a CLI-acceptable UUID', () => {
    expect(superAgentWorkerEngineSessionId('ticket-1')).toMatch(UUID_V5)
  })

  it('is stable across retries and restarts, and unique per ticket', () => {
    expect(superAgentWorkerEngineSessionId('ticket-1')).toBe(
      superAgentWorkerEngineSessionId('ticket-1'),
    )
    expect(superAgentWorkerEngineSessionId('ticket-1')).not.toBe(
      superAgentWorkerEngineSessionId('ticket-2'),
    )
  })
})

describe('superAgentRouterEngineSessionId', () => {
  it('is derived from the project root, not from a fresh random id', () => {
    expect(superAgentRouterEngineSessionId('/repo/a')).toMatch(UUID_V5)
    expect(superAgentRouterEngineSessionId('/repo/a')).toBe(
      superAgentRouterEngineSessionId('/repo/a'),
    )
    expect(superAgentRouterEngineSessionId('/repo/a')).not.toBe(
      superAgentRouterEngineSessionId('/repo/b'),
    )
  })

  it('ignores separator and trailing-slash differences of the same root', () => {
    expect(superAgentRouterEngineSessionId('D:\\repo\\a\\')).toBe(
      superAgentRouterEngineSessionId('D:/repo/a'),
    )
  })

  it('does not collide with the worker namespace', () => {
    const label = 'ticket-1'
    expect(superAgentRouterEngineSessionId(label)).not.toBe(
      superAgentWorkerEngineSessionId(label),
    )
  })
})
