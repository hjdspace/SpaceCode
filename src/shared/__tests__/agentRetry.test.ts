import { describe, it, expect } from 'vitest'
import {
  computeRetryDelayMs,
  extractRetryAfterMs,
  isRetryableAgentFailure,
  readHttpStatus,
} from '../agentRetry'

describe('readHttpStatus', () => {
  it('reads the status from the prefixed API error form', () => {
    expect(readHttpStatus('API Error: 429 {"error":{"message":"slow down"}}')).toBe(429)
    expect(readHttpStatus('status code 503')).toBe(503)
  })

  it('ignores digit runs that are not status codes', () => {
    expect(readHttpStatus('model foo-429 responded')).toBeUndefined()
    expect(readHttpStatus('input tokens 15000')).toBeUndefined()
  })
})

describe('extractRetryAfterMs', () => {
  it('reads Retry-After from the message text', () => {
    expect(extractRetryAfterMs('API Error: 429 retry-after: 12')).toBe(12_000)
  })
})

describe('isRetryableAgentFailure', () => {
  it('retries the tpm/rpm rate limit from the issue', () => {
    expect(isRetryableAgentFailure(
      'API Error: 429 {"error":{"message":"inference exceeds tpm/rpm limit"}}',
    )).toBe(true)
  })

  it('retries 5xx, network and timeout failures', () => {
    expect(isRetryableAgentFailure('API Error: 503 service unavailable')).toBe(true)
    expect(isRetryableAgentFailure('fetch failed: ECONNREFUSED 127.0.0.1:443')).toBe(true)
    expect(isRetryableAgentFailure('Request timed out')).toBe(true)
  })

  it('does not retry rejected request bodies', () => {
    expect(isRetryableAgentFailure('API Error: 400 invalid_request_error')).toBe(false)
    expect(isRetryableAgentFailure('UnsupportedParamsError: openai does not support parameters: [\'thinking\']')).toBe(false)
  })

  it('retries context overflow 400s because the next attempt can compact first', () => {
    expect(isRetryableAgentFailure('API Error: 400 prompt is too long')).toBe(true)
  })

  it('does not retry auth, config, data or unknown failures', () => {
    expect(isRetryableAgentFailure('API Error: 401 Unauthorized')).toBe(false)
    expect(isRetryableAgentFailure('API key not configured')).toBe(false)
    expect(isRetryableAgentFailure('invalid json in response')).toBe(false)
    expect(isRetryableAgentFailure('boom')).toBe(false)
  })

  it('does not retry a dead engine process (no resume id for stage sessions)', () => {
    expect(isRetryableAgentFailure('Engine process exited before result')).toBe(false)
  })
})

describe('computeRetryDelayMs', () => {
  it('honours Retry-After but caps it', () => {
    expect(computeRetryDelayMs(0, { hintMs: 12_000 })).toBe(12_000)
    expect(computeRetryDelayMs(0, { hintMs: 90_000 })).toBe(60_000)
  })

  it('doubles the delay per attempt and adds jitter', () => {
    expect(computeRetryDelayMs(0, { random: () => 0 })).toBe(2_000)
    expect(computeRetryDelayMs(1, { random: () => 0 })).toBe(4_000)
    expect(computeRetryDelayMs(0, { random: () => 0.5 })).toBe(2_500)
  })

  it('caps the exponential growth at one minute', () => {
    expect(computeRetryDelayMs(10, { random: () => 0 })).toBe(60_000)
  })
})
