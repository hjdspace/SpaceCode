/**
 * Tests for createPreloadBridge（含 send 类 channel）与 createEventBridge。
 *
 * - invoke channel：转发 ipcRenderer.invoke，返回 Promise
 * - send channel（kind: 'send'）：转发 ipcRenderer.send，无返回值
 * - event bridge：订阅 prefix+channel，payload 参数透传给 callback，
 *   返回的 unsubscribe 必须移除同一个 wrapper
 */
import { describe, it, expect, vi } from 'vitest'
import { createPreloadBridge, createEventBridge } from './preloadBridge'
import { defineNamespace } from './channelMap'

function fakeIpcRenderer() {
  return {
    invoke: vi.fn(() => Promise.resolve('ok')),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
}

describe('createPreloadBridge — invoke channel', () => {
  it('forwards to ipcRenderer.invoke with prefix + method name', () => {
    const ipc = fakeIpcRenderer()
    const { channels } = defineNamespace({
      channels: {
        getStatus: { req: [] as unknown as [cwd: string], res: null as unknown as boolean },
      },
      events: {},
    })
    const bridge = createPreloadBridge(channels, ipc, 'git:')
    void bridge.getStatus('/repo')
    expect(ipc.invoke).toHaveBeenCalledWith('git:getStatus', '/repo')
  })
})

describe('createPreloadBridge — send channel (kind: send)', () => {
  it('forwards to ipcRenderer.send, not invoke', () => {
    const ipc = fakeIpcRenderer()
    const { channels } = defineNamespace({
      channels: {
        write: { kind: 'send', req: [] as unknown as [id: string, data: string] },
      },
      events: {},
    })
    const bridge = createPreloadBridge(channels, ipc, 'terminal:')
    bridge.write('t1', 'ls')
    expect(ipc.send).toHaveBeenCalledWith('terminal:write', 't1', 'ls')
    expect(ipc.invoke).not.toHaveBeenCalled()
  })
})

describe('createEventBridge', () => {
  const { events } = defineNamespace({
    channels: {},
    events: {
      onData: { channel: 'data', args: [] as unknown as [id: string, data: string] },
    },
  })

  it('subscribes on prefix + declared channel name', () => {
    const ipc = fakeIpcRenderer()
    const bridge = createEventBridge(events, ipc, 'terminal:')
    const cb = vi.fn()
    bridge.onData(cb)
    expect(ipc.on).toHaveBeenCalledTimes(1)
    expect(ipc.on.mock.calls[0][0]).toBe('terminal:data')
  })

  it('forwards payload args to the callback', () => {
    const ipc = fakeIpcRenderer()
    const bridge = createEventBridge(events, ipc, 'terminal:')
    const cb = vi.fn()
    bridge.onData(cb)
    const wrapper = ipc.on.mock.calls[0][1] as (...a: unknown[]) => void
    wrapper(null, 't1', 'hello')
    expect(cb).toHaveBeenCalledWith('t1', 'hello')
  })

  it('unsubscribe removes the exact wrapper registered', () => {
    const ipc = fakeIpcRenderer()
    const bridge = createEventBridge(events, ipc, 'terminal:')
    const cb = vi.fn()
    const off = bridge.onData(cb)
    const wrapper = ipc.on.mock.calls[0][1]
    off()
    expect(ipc.removeListener).toHaveBeenCalledWith('terminal:data', wrapper)
  })

  it('forwards zero-payload events as callback() with no args', () => {
    const ipc = fakeIpcRenderer()
    const { events: evs } = defineNamespace({
      channels: {},
      events: {
        onStatusChanged: { channel: 'statusChanged', args: [] as unknown as [] },
      },
    })
    const bridge = createEventBridge(evs, ipc, 'git:')
    const cb = vi.fn()
    bridge.onStatusChanged(cb)
    const wrapper = ipc.on.mock.calls[0][1] as (...a: unknown[]) => void
    wrapper(null)
    expect(cb).toHaveBeenCalledWith()
  })
})
