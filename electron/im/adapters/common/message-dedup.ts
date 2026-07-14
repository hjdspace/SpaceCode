/**
 * MessageDedup — LRU + TTL deduplication
 *
 * Prevents duplicate message processing using a Map with:
 * - TTL: entries expire after ttlMs (default 10 minutes)
 * - LRU: when maxEntries is reached, oldest entry is evicted
 * - Full scan sweep: iterates all entries (not short-circuit) to ensure
 *   expired entries are always cleaned up.
 *
 * Bug fix (cc-haha S2): The original implementation's sweep short-circuited
 * on the first non-expired entry, relying on Map insertion order. But
 * re-recording an existing key via Map.set() does NOT move it to the end
 * of insertion order in JS. This caused entries after a re-recorded key
 * to never be cleaned up. This implementation uses full scan.
 */

interface DedupEntry {
  timestamp: number
}

export interface MessageDedupOptions {
  ttlMs?: number
  maxEntries?: number
  sweepIntervalMs?: number
}

export class MessageDedup {
  private store: Map<string, DedupEntry> = new Map()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly sweepIntervalMs: number
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: MessageDedupOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000 // 10 minutes
    this.maxEntries = opts.maxEntries ?? 5000
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 60 * 1000 // 1 minute
  }

  /**
   * Try to record a message ID. Returns false if the ID was already seen
   * within the TTL window, true if it's a new (or expired) ID.
   */
  tryRecord(id: string): boolean {
    const now = Date.now()
    const existing = this.store.get(id)

    if (existing && now - existing.timestamp < this.ttlMs) {
      return false // duplicate within TTL
    }

    // LRU eviction
    if (this.store.size >= this.maxEntries && !this.store.has(id)) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey)
      }
    }

    this.store.set(id, { timestamp: now })
    return true
  }

  /** Check if an ID is currently recorded and not expired. */
  has(id: string): boolean {
    const entry = this.store.get(id)
    if (!entry) return false
    if (Date.now() - entry.timestamp >= this.ttlMs) {
      this.store.delete(id)
      return false
    }
    return true
  }

  /**
   * Sweep all expired entries. Uses full scan (not short-circuit) to fix
   * the cc-haha S2 bug where re-recorded keys could shield later expired
   * entries from cleanup.
   *
   * With 5000 entries, full scan takes < 1ms.
   */
  sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp >= this.ttlMs) {
        this.store.delete(key)
      }
    }
  }

  /** Start periodic sweep. */
  startSweep(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs)
    // Don't keep the process alive just for sweeping
    if (this.sweepTimer.unref) {
      this.sweepTimer.unref()
    }
  }

  /** Stop periodic sweep. */
  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /** Current number of stored entries. */
  get size(): number {
    return this.store.size
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear()
  }
}
