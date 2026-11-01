// @vitest-environment node
/**
 * 阶段回合重试：可恢复错误续发、预算耗尽落回错误、不可恢复不重试、中止立即收场。
 */
import { describe, it, expect } from 'vitest'
import { runTurnWithRetry, type AgentRetryNotice } from '../turnRetry'
import type { AgentTurn } from '../agentEngineGateway'

function turn(text: string, isError = false): AgentTurn {
  return { text, isError, inputTokens: 1, outputTokens: 0 }
}

function rateLimited(): AgentTurn {
  return turn('API Error: 429 {"error":{"message":"inference exceeds tpm/rpm limit"}}', true)
}

describe('runTurnWithRetry', () => {
  it('retries a rate-limited turn and reports the notice', async () => {
    let calls = 0
    const notices: AgentRetryNotice[] = []
    const recovered: number[] = []

    const result = await runTurnWithRetry({
      run: async () => (++calls === 1 ? rateLimited() : turn('done')),
      signal: new AbortController().signal,
      onRetry: (notice) => notices.push(notice),
      onRecovered: (attempts) => recovered.push(attempts),
      wait: async () => {},
      random: () => 0,
    })

    expect(result).toMatchObject({ retries: 1, stopped: false })
    expect(result.turn.text).toBe('done')
    expect(notices).toEqual([
      expect.objectContaining({ attempt: 1, max: 5, delayMs: 2_000 }),
    ])
    expect(recovered).toEqual([1])
  })

  it('returns the last error turn after the retry budget is exhausted', async () => {
    let calls = 0
    const result = await runTurnWithRetry({
      run: async () => {
        calls += 1
        return rateLimited()
      },
      signal: new AbortController().signal,
      wait: async () => {},
      random: () => 0,
    })

    expect(calls).toBe(6)
    expect(result).toMatchObject({ retries: 5, stopped: false })
    expect(result.turn.isError).toBe(true)
  })

  it('does not retry non-retryable failures', async () => {
    let calls = 0
    const result = await runTurnWithRetry({
      run: async () => {
        calls += 1
        return turn('API Error: 401 Unauthorized', true)
      },
      signal: new AbortController().signal,
      wait: async () => {},
    })

    expect(calls).toBe(1)
    expect(result).toMatchObject({ retries: 0, stopped: false })
  })

  it('stops instead of waiting when the signal aborts during backoff', async () => {
    const controller = new AbortController()
    const result = await runTurnWithRetry({
      run: async () => rateLimited(),
      signal: controller.signal,
      wait: async () => {
        controller.abort()
      },
    })

    expect(result).toMatchObject({ retries: 1, stopped: true })
  })

  it('does not start a retry when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const result = await runTurnWithRetry({
      run: async () => {
        calls += 1
        return rateLimited()
      },
      signal: controller.signal,
      wait: async () => {},
    })

    expect(calls).toBe(1)
    expect(result.stopped).toBe(true)
  })
})
