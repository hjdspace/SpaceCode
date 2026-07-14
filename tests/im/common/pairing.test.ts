import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Pairing } from '@electron/im/adapters/common/pairing'
import type { PairingConfig } from '@electron/im/adapters/common/pairing'

describe('Pairing', () => {
  let pairing: Pairing
  let config: PairingConfig

  beforeEach(() => {
    vi.useFakeTimers()
    pairing = new Pairing()
    config = {
      pairing: { code: null, expiresAt: null, createdAt: null },
      pairedUsers: [],
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should generate a 6-character code from safe alphabet', () => {
    const { code } = pairing.generateCode()
    expect(code).toHaveLength(6)
    const safeAlpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    for (const ch of code) {
      expect(safeAlpha).toContain(ch)
    }
  })

  it('should set expiry time', () => {
    const { expiresAt, createdAt } = pairing.generateCode()
    expect(expiresAt).toBeGreaterThan(createdAt)
    expect(expiresAt - createdAt).toBe(60 * 60 * 1000) // 60 minutes
  })

  it('should succeed with correct code', () => {
    const { code, expiresAt } = pairing.generateCode()
    config.pairing.code = code
    config.pairing.expiresAt = expiresAt

    const result = pairing.tryPair(code, 'user1', config)
    expect(result.success).toBe(true)
  })

  it('should fail with mismatched code', () => {
    config.pairing.code = 'ABC234'
    config.pairing.expiresAt = Date.now() + 60000

    const result = pairing.tryPair('WRONG1', 'user1', config)
    expect(result.success).toBe(false)
    expect(result.reason).toBe('mismatch')
  })

  it('should fail when no code is set', () => {
    const result = pairing.tryPair('ABC234', 'user1', config)
    expect(result.success).toBe(false)
    expect(result.reason).toBe('no_code')
  })

  it('should fail when code is expired', () => {
    config.pairing.code = 'ABC234'
    config.pairing.expiresAt = Date.now() - 1000 // expired 1 second ago

    const result = pairing.tryPair('ABC234', 'user1', config)
    expect(result.success).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('should rate limit after 5 failed attempts in 5 minutes', () => {
    config.pairing.code = 'ABC234'
    config.pairing.expiresAt = Date.now() + 60000

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      pairing.tryPair('WRONG1', 'user1', config)
    }

    // 6th attempt should be rate limited
    const result = pairing.tryPair('ABC234', 'user1', config)
    expect(result.success).toBe(false)
    expect(result.reason).toBe('rate_limited')
  })

  it('should clear rate limit after window expires', () => {
    config.pairing.code = 'ABC234'
    config.pairing.expiresAt = Date.now() + 600000 // 10 minutes

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      pairing.tryPair('WRONG1', 'user1', config)
    }

    // Advance past rate limit window (5 minutes)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000)

    // Should be able to try again
    const result = pairing.tryPair('ABC234', 'user1', config)
    expect(result.success).toBe(true)
  })

  it('addPairedUser should dedup by userId', () => {
    pairing.addPairedUser(config, 'user1', 'Alice')
    pairing.addPairedUser(config, 'user1', 'Alice2') // duplicate
    expect(config.pairedUsers).toHaveLength(1)
    expect(config.pairedUsers[0].displayName).toBe('Alice')
  })

  it('isPaired should default to false when both lists empty', () => {
    expect(pairing.isPaired('user1', config)).toBe(false)
  })

  it('isPaired should check pairedUsers', () => {
    pairing.addPairedUser(config, 'user1')
    expect(pairing.isPaired('user1', config)).toBe(true)
    expect(pairing.isPaired('user2', config)).toBe(false)
  })

  it('isPaired should check allowedUsers whitelist', () => {
    expect(pairing.isPaired('user1', config, ['user1', 'user2'])).toBe(true)
    expect(pairing.isPaired('user3', config, ['user1', 'user2'])).toBe(false)
  })

  it('clearCode should reset pairing state', () => {
    config.pairing.code = 'ABC234'
    config.pairing.expiresAt = Date.now() + 60000
    config.pairing.createdAt = Date.now()

    pairing.clearCode(config)

    expect(config.pairing.code).toBeNull()
    expect(config.pairing.expiresAt).toBeNull()
    expect(config.pairing.createdAt).toBeNull()
  })
})
