import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageDedup } from '@electron/im/adapters/common/message-dedup'

describe('MessageDedup', () => {
  let dedup: MessageDedup

  beforeEach(() => {
    vi.useFakeTimers()
    dedup = new MessageDedup({ ttlMs: 1000, maxEntries: 5000 })
  })

  afterEach(() => {
    dedup.stopSweep()
    vi.useRealTimers()
  })

  it('should record new IDs and return true', () => {
    expect(dedup.tryRecord('a')).toBe(true)
    expect(dedup.tryRecord('b')).toBe(true)
  })

  it('should return false for duplicate IDs within TTL', () => {
    dedup.tryRecord('a')
    expect(dedup.tryRecord('a')).toBe(false)
  })

  it('should return true for IDs after TTL expires', () => {
    dedup.tryRecord('a')
    vi.advanceTimersByTime(1100)
    expect(dedup.tryRecord('a')).toBe(true)
  })

  it('should evict oldest entry when maxEntries is reached', () => {
    const small = new MessageDedup({ ttlMs: 60000, maxEntries: 3 })
    small.tryRecord('a')
    small.tryRecord('b')
    small.tryRecord('c')
    small.tryRecord('d') // should evict 'a'
    expect(small.has('a')).toBe(false)
    expect(small.has('b')).toBe(true)
    expect(small.has('c')).toBe(true)
    expect(small.has('d')).toBe(true)
  })

  it('should clean up expired entries on sweep (full scan)', () => {
    dedup.tryRecord('a')
    dedup.tryRecord('b')
    dedup.tryRecord('c')

    vi.advanceTimersByTime(1100)

    dedup.sweep()

    expect(dedup.has('a')).toBe(false)
    expect(dedup.has('b')).toBe(false)
    expect(dedup.has('c')).toBe(false)
  })

  it('should handle re-record + sweep correctly (S2 regression)', () => {
    const t0 = Date.now()
    dedup.tryRecord('a') // t0
    dedup.tryRecord('b') // t0
    dedup.tryRecord('c') // t0

    // Wait for 'a' to expire
    vi.advanceTimersByTime(1100)
    dedup.tryRecord('a') // re-record 'a' with fresh timestamp

    // Wait more: 'a' is fresh (900ms since re-record), 'b'/'c' are expired (2000ms since original)
    vi.advanceTimersByTime(900)

    dedup.sweep()

    // cc-haha original: sweep encounters 'a' (fresh) and breaks, 'b'/'c' never cleaned ❌
    // Fixed implementation: full scan, 'b'/'c' correctly deleted ✅
    expect(dedup.has('a')).toBe(true)
    expect(dedup.has('b')).toBe(false)
    expect(dedup.has('c')).toBe(false)
  })

  it('has() should return false for non-existent IDs', () => {
    expect(dedup.has('nonexistent')).toBe(false)
  })

  it('has() should clean up expired entry on access', () => {
    dedup.tryRecord('a')
    vi.advanceTimersByTime(1100)
    expect(dedup.has('a')).toBe(false)
  })

  it('clear() should remove all entries', () => {
    dedup.tryRecord('a')
    dedup.tryRecord('b')
    dedup.clear()
    expect(dedup.size).toBe(0)
  })

  it('startSweep/stopSweep should manage periodic sweep', () => {
    dedup = new MessageDedup({ ttlMs: 100, maxEntries: 5000, sweepIntervalMs: 50 })
    dedup.startSweep()

    dedup.tryRecord('a')
    // Advance past TTL (100ms) and sweep interval (50ms)
    vi.advanceTimersByTime(200)

    expect(dedup.has('a')).toBe(false)
    dedup.stopSweep()
  })
})
