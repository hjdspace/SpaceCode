import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatQueue } from '@electron/im/adapters/common/chat-queue'

describe('ChatQueue', () => {
  let queue: ChatQueue

  beforeEach(() => {
    queue = new ChatQueue()
  })

  it('should execute tasks sequentially for the same chatId', async () => {
    const order: string[] = []

    queue.enqueue('chat1', async () => {
      order.push('start:1')
      await new Promise((r) => setTimeout(r, 50))
      order.push('end:1')
    })

    queue.enqueue('chat1', async () => {
      order.push('start:2')
      await new Promise((r) => setTimeout(r, 10))
      order.push('end:2')
    })

    queue.enqueue('chat1', async () => {
      order.push('start:3')
      await new Promise((r) => setTimeout(r, 10))
      order.push('end:3')
    })

    // Wait for all tasks to complete
    await new Promise((r) => setTimeout(r, 200))

    expect(order).toEqual([
      'start:1', 'end:1',
      'start:2', 'end:2',
      'start:3', 'end:3',
    ])
  })

  it('should run tasks for different chatIds concurrently', async () => {
    const order: string[] = []

    queue.enqueue('chat1', async () => {
      order.push('start:1')
      await new Promise((r) => setTimeout(r, 50))
      order.push('end:1')
    })

    queue.enqueue('chat2', async () => {
      order.push('start:2')
      await new Promise((r) => setTimeout(r, 10))
      order.push('end:2')
    })

    await new Promise((r) => setTimeout(r, 100))

    // chat2 should finish before chat1 because it's shorter
    expect(order).toEqual(['start:1', 'start:2', 'end:2', 'end:1'])
  })

  it('should handle errors without breaking the chain', async () => {
    const order: string[] = []

    queue.enqueue('chat1', async () => {
      order.push('task1')
      throw new Error('test error')
    })

    queue.enqueue('chat1', async () => {
      order.push('task2')
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(order).toEqual(['task1', 'task2'])
  })

  it('hasPending should reflect queue state', async () => {
    expect(queue.hasPending('chat1')).toBe(false)

    const promise = queue.enqueue('chat1', async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(queue.hasPending('chat1')).toBe(true)

    await promise

    // After completion, the chain is cleaned up
    expect(queue.hasPending('chat1')).toBe(false)
  })

  it('clear() should remove pending state', async () => {
    queue.enqueue('chat1', async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(queue.hasPending('chat1')).toBe(true)
    queue.clear('chat1')
    expect(queue.hasPending('chat1')).toBe(false)
  })
})
