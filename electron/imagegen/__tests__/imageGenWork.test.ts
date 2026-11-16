// @vitest-environment node
/**
 * 在途生图工作的会话级登记与取消（#114）。
 *
 * 只断言外部可观察行为：给定一次取消动作，哪些调用的信号被中止、原因是什么、
 * 待应答的授权卡有没有关掉。不碰内部字段。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ExtensionDialogClosedEvent, ExtensionDialogRequest } from '@/shared/channels/claudeCode'
import { createImageGenAuthorization, setImageGenAuthorization } from '../imageGenAuthorization'
import { beginImageGenWork, cancelAllImageGenWork, cancelImageGenWork } from '../imageGenWork'

afterEach(() => {
  cancelAllImageGenWork('shutdown')
  setImageGenAuthorization(null)
})

describe('按会话登记在途工作', () => {
  it('一次取消中止该会话的全部在途调用，子请求继承同一信号', () => {
    const first = beginImageGenWork('s1')
    const second = beginImageGenWork('s1')

    expect(first.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(false)

    cancelImageGenWork('s1', 'user')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(first.stopReason).toBe('user')
    expect(second.stopReason).toBe('user')

    first.release()
    second.release()
  })

  it('取消只作用于该会话：别的会话照常跑', () => {
    const mine = beginImageGenWork('s1')
    const theirs = beginImageGenWork('s2')

    cancelImageGenWork('s1', 'user')

    expect(mine.signal.aborted).toBe(true)
    expect(theirs.signal.aborted).toBe(false)
    expect(theirs.stopReason).toBeNull()

    mine.release()
    theirs.release()
  })

  it('已结束的调用不再被后来的取消波及', () => {
    const done = beginImageGenWork('s1')
    done.release()

    cancelImageGenWork('s1', 'user')

    expect(done.signal.aborted).toBe(false)
    expect(done.stopReason).toBeNull()
  })

  it('没有会话 id 的调用不进登记表，但仍能自我止血', () => {
    const orphan = beginImageGenWork(null)

    cancelImageGenWork('s1', 'user')
    expect(orphan.signal.aborted).toBe(false)

    orphan.stop('auth')
    expect(orphan.signal.aborted).toBe(true)
    expect(orphan.stopReason).toBe('auth')
    orphan.release()
  })

  it('应用退出序列一次取消所有会话的在途工作', () => {
    const a = beginImageGenWork('s1')
    const b = beginImageGenWork('s2')

    cancelAllImageGenWork('shutdown')

    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(a.stopReason).toBe('shutdown')
    expect(b.stopReason).toBe('shutdown')

    a.release()
    b.release()
  })
})

describe('中止原因', () => {
  it('鉴权止血与用户取消共用中止机制、原因不同', () => {
    const work = beginImageGenWork('s1')

    work.stop('auth')

    expect(work.signal.aborted).toBe(true)
    expect(work.stopReason).toBe('auth')
    work.release()
  })

  it('第一个原因说了算：止血之后用户再点停止也不改写原因', () => {
    const work = beginImageGenWork('s1')

    work.stop('auth')
    cancelImageGenWork('s1', 'user')

    expect(work.stopReason).toBe('auth')
    work.release()
  })

  it('重复取消幂等，不抛也不改原因', () => {
    const work = beginImageGenWork('s1')

    cancelImageGenWork('s1', 'user')
    cancelImageGenWork('s1', 'user')
    work.stop('shutdown')

    expect(work.stopReason).toBe('user')
    work.release()
  })

  it('取消一个没有在途工作的会话不抛', () => {
    expect(() => cancelImageGenWork('nobody', 'user')).not.toThrow()
  })
})

describe('取消关掉待应答的授权卡', () => {
  function harness() {
    const dialogs: ExtensionDialogRequest[] = []
    const closed: Array<{ sessionId: string; event: ExtensionDialogClosedEvent }> = []
    const authorization = createImageGenAuthorization({
      sendDialog: (_sessionId, request) => { dialogs.push(request) },
      sendClosed: (sessionId, event) => { closed.push({ sessionId, event }) },
      permissionMode: () => 'default',
      locale: () => 'zh-CN',
    })
    setImageGenAuthorization(authorization)
    return { authorization, dialogs, closed }
  }

  const REQUEST = { sessionId: 's1', provider: 'OpenAI', model: 'gpt-image-1', count: 3, prompt: 'three heroes' }

  it('取消把待应答的卡关掉，授权决议是 cancelled 而不是 deny', async () => {
    const h = harness()
    const decision = h.authorization.authorize(REQUEST)

    cancelImageGenWork('s1', 'user')

    await expect(decision).resolves.toBe('cancelled')
    expect(h.closed).toHaveLength(1)
    expect(h.closed[0].event.dialogId).toBe(h.dialogs[0].dialogId)
    // 卡已经关了，迟到的应答不该再被当成宿主的卡结算。
    expect(h.authorization.respond(h.dialogs[0].dialogId, { kind: 'value', value: '允许一次' })).toBe(false)
  })

  it('只关该会话的卡，别的会话那张仍然可答', async () => {
    const h = harness()
    const mine = h.authorization.authorize(REQUEST)
    const theirs = h.authorization.authorize({ ...REQUEST, sessionId: 's2' })

    cancelImageGenWork('s1', 'user')

    await expect(mine).resolves.toBe('cancelled')
    expect(h.authorization.respond(h.dialogs[1].dialogId, { kind: 'value', value: '允许一次' })).toBe(true)
    await expect(theirs).resolves.toBe('allow')
  })

  it('应用退出关掉所有会话的待应答卡', async () => {
    const h = harness()
    const a = h.authorization.authorize(REQUEST)
    const b = h.authorization.authorize({ ...REQUEST, sessionId: 's2' })

    cancelAllImageGenWork('shutdown')

    await expect(a).resolves.toBe('cancelled')
    await expect(b).resolves.toBe('cancelled')
  })

  it('没有待应答卡时取消不抛，也不影响后续授权', async () => {
    const h = harness()

    cancelImageGenWork('s1', 'user')

    const decision = h.authorization.authorize(REQUEST)
    expect(h.authorization.respond(h.dialogs[0].dialogId, { kind: 'value', value: '允许一次' })).toBe(true)
    await expect(decision).resolves.toBe('allow')
  })
})