/**
 * MessageBuffer — Streaming throttle with dual-trigger flush
 *
 * Accumulates text deltas and flushes them at regular intervals OR when
 * a character threshold is reached, whichever comes first.
 *
 * Triggers:
 * 1. Timer: flush every intervalMs (default 500ms) if buffer has content
 * 2. Character threshold: flush immediately when buffer reaches charThreshold (default 200)
 *
 * Edge case: if complete() is called while a flush is in progress,
 * pendingComplete flag ensures the final flush happens after the current one.
 */

export interface MessageBufferOptions {
  intervalMs?: number
  charThreshold?: number
}

export interface MessageBufferCallbacks {
  onFlush: (text: string, isComplete: boolean) => void | Promise<void>
}

export class MessageBuffer {
  private buffer: string = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: boolean = false
  private pendingComplete: boolean = false

  private readonly intervalMs: number
  private readonly charThreshold: number
  private readonly callbacks: MessageBufferCallbacks

  constructor(callbacks: MessageBufferCallbacks, opts: MessageBufferOptions = {}) {
    this.callbacks = callbacks
    this.intervalMs = opts.intervalMs ?? 500
    this.charThreshold = opts.charThreshold ?? 200
  }

  /**
   * Append text to the buffer. Triggers immediate flush if buffer reaches
   * charThreshold, otherwise schedules a timer-based flush.
   */
  append(text: string): void {
    if (!text) return

    this.buffer += text

    if (this.buffer.length >= this.charThreshold) {
      // Character threshold reached — flush immediately
      this.cancelTimer()
      this.scheduleFlush()
    } else if (!this.timer && !this.flushing) {
      // Start timer if not already running
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush(false)
      }, this.intervalMs)
    }
  }

  /**
   * Signal that the message is complete. Flushes remaining buffer.
   * If a flush is in progress, sets pendingComplete to ensure final flush.
   */
  async complete(): Promise<void> {
    this.cancelTimer()

    if (this.flushing) {
      this.pendingComplete = true
      return
    }

    await this.flush(true)
  }

  /** Reset the buffer to initial state. */
  reset(): void {
    this.cancelTimer()
    this.buffer = ''
    this.flushing = false
    this.pendingComplete = false
  }

  /** Whether the buffer currently has pending content. */
  get hasContent(): boolean {
    return this.buffer.length > 0
  }

  /** Current buffered text length. */
  get length(): number {
    return this.buffer.length
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    // Use queueMicrotask for immediate flush (char threshold case)
    queueMicrotask(() => this.flush(false))
  }

  private async flush(isComplete: boolean): Promise<void> {
    if (this.flushing) {
      // Already flushing; if this is a complete call, defer it
      if (isComplete) {
        this.pendingComplete = true
      }
      return
    }

    const text = this.buffer
    this.buffer = ''
    this.flushing = true

    try {
      if (text || isComplete) {
        await this.callbacks.onFlush(text, isComplete)
      }
    } catch (err) {
      console.error('[MessageBuffer] Flush error:', err)
    } finally {
      this.flushing = false

      // If complete was called during flush, do a final flush
      if (this.pendingComplete) {
        this.pendingComplete = false
        await this.flush(true)
      }
    }
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
