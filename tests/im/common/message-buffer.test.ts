import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageBuffer } from '@electron/im/adapters/common/message-buffer'

describe('MessageBuffer', () => {
  let flushes: Array<{ text: string; isComplete: boolean }>
  let buffer: MessageBuffer

  beforeEach(() => {
    vi.useFakeTimers()
    flushes = []
    buffer = new MessageBuffer(
      {
        onFlush: (text, isComplete) => {
          flushes.push({ text, isComplete })
        },
      },
      { intervalMs: 500, charThreshold: 200 }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should buffer small messages and flush on timer', async () => {
    buffer.append('hello')
    expect(flushes).toHaveLength(0)

    vi.advanceTimersByTime(500)
    await vi.waitFor(() => expect(flushes).toHaveLength(1))
    expect(flushes[0]).toEqual({ text: 'hello', isComplete: false })
  })

  it('should flush immediately when char threshold is reached', async () => {
    const longText = 'a'.repeat(200)
    buffer.append(longText)

    // char threshold triggers queueMicrotask
    await vi.waitFor(() => expect(flushes).toHaveLength(1))
    expect(flushes[0].text).toBe(longText)
    expect(flushes[0].isComplete).toBe(false)
  })

  it('should flush on complete()', async () => {
    buffer.append('hello')
    await buffer.complete()
    expect(flushes).toHaveLength(1)
    expect(flushes[0]).toEqual({ text: 'hello', isComplete: true })
  })

  it('should handle complete() while flushing (pendingComplete)', async () => {
    let resolveFlush: () => void
    const slowFlushes: string[] = []
    const slowBuffer = new MessageBuffer(
      {
        onFlush: (text, isComplete) =>
          new Promise<void>((resolve) => {
            resolveFlush = resolve
            slowFlushes.push(`${text}:${isComplete}`)
          }),
      },
      { intervalMs: 500, charThreshold: 200 }
    )

    slowBuffer.append('first')

    // Start a timer flush
    vi.advanceTimersByTime(500)

    // While the first flush is pending, call complete()
    const completePromise = slowBuffer.complete()
    slowBuffer.append('second')

    // Resolve the first flush
    await vi.waitFor(() => expect(slowFlushes.length).toBeGreaterThanOrEqual(1))
    resolveFlush!()

    await completePromise

    // Should have flushed twice: first (incomplete) and then second (complete)
    expect(slowFlushes.length).toBe(2)
  })

  it('should accumulate text across multiple appends', async () => {
    buffer.append('hello ')
    buffer.append('world')
    await buffer.complete()
    expect(flushes[0].text).toBe('hello world')
  })

  it('reset() should clear buffer and cancel timer', async () => {
    buffer.append('hello')
    buffer.reset()
    await buffer.complete()
    // complete() with empty buffer should still trigger a flush with isComplete=true
    expect(flushes).toHaveLength(1)
    expect(flushes[0].text).toBe('')
    expect(flushes[0].isComplete).toBe(true)
  })

  it('hasContent should reflect buffer state', async () => {
    expect(buffer.hasContent).toBe(false)
    buffer.append('hello')
    expect(buffer.hasContent).toBe(true)
    await buffer.complete()
    expect(buffer.hasContent).toBe(false)
  })
})
