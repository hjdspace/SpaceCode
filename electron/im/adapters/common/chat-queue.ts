/**
 * ChatQueue — Inbound event serialization per chatId
 *
 * Ensures that messages from the same chatId are processed sequentially,
 * preventing race conditions between slow and fast handlers.
 *
 * This is the inbound counterpart to WsBridge.handlerChains (which serializes
 * outbound WS messages). ChatQueue serializes IM platform → adapter events;
 * handlerChains serializes adapter → server WS messages. They cannot be merged
 * because inbound and outbound are independent pipelines.
 */

type Task = () => Promise<void>

export class ChatQueue {
  private chains: Map<string, Promise<void>> = new Map()

  /**
   * Enqueue a task for a given chatId. Tasks with the same chatId execute
   * sequentially in FIFO order; different chatIds run concurrently.
   */
  enqueue(chatId: string, fn: Task): Promise<void> {
    const prev = this.chains.get(chatId) ?? Promise.resolve()
    const next = prev
      .catch(() => {}) // upstream error doesn't propagate
      .then(() => fn())
      .catch((err) => {
        console.error(`[ChatQueue] Handler error on ${chatId}:`, err)
      })
      .finally(() => {
        // Clean up if this is the last task in the chain
        if (this.chains.get(chatId) === next) {
          this.chains.delete(chatId)
        }
      })
    this.chains.set(chatId, next)
    return next
  }

  /** Whether a chatId currently has pending tasks. */
  hasPending(chatId: string): boolean {
    return this.chains.has(chatId)
  }

  /** Clear all pending tasks for a chatId. */
  clear(chatId: string): void {
    this.chains.delete(chatId)
  }
}
