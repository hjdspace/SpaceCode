import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock WebSocket — must be before any imports that use 'ws'
vi.mock('ws', async () => {
  const { EventEmitter } = await import('events')

  class MockWebSocket extends EventEmitter {
    static OPEN = 1
    static CONNECTING = 0
    static CLOSED = 3
    static CLOSING = 2

    readyState = MockWebSocket.CONNECTING
    url: string

    constructor(url: string) {
      super()
      this.url = url
      // Auto-connect on next tick
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN
        this.emit('open')
      })
    }

    send(data: string): void {
      this.emit('_sent', data)
    }

    close(code?: number, reason?: string): void {
      this.readyState = MockWebSocket.CLOSED
      this.emit('close', code, reason)
    }

    _receive(data: object): void {
      this.emit('message', Buffer.from(JSON.stringify(data)))
    }

    _error(err: Error): void {
      this.emit('error', err)
    }

    _close(code: number, reason?: string): void {
      this.readyState = MockWebSocket.CLOSED
      this.emit('close', code, reason ?? '')
    }

    removeAllListeners(): this {
      super.removeAllListeners()
      return this
    }
  }

  return { default: MockWebSocket, __esModule: true }
})

import { WsBridge } from '@electron/im/adapters/common/ws-bridge'
import type { ServerMessage } from '@electron/im/adapters/common/types'
import MockWS from 'ws'

/** Extended WS type that includes test-only helper methods from the mock. */
type MockWsInstance = InstanceType<typeof MockWS> & {
  _receive(data: object): void
  _close(code: number, reason?: string): void
  _error(err: Error): void
}

/** Helper to extract the mock WS instance from bridge internals. */
function getWs(bridge: WsBridge, chatId: string): MockWsInstance | undefined {
  const sessions = (bridge as unknown as { sessions: Map<string, { ws: MockWsInstance }> }).sessions
  return sessions.get(chatId)?.ws
}

describe('WsBridge', () => {
  let bridge: WsBridge

  beforeEach(() => {
    vi.useFakeTimers()
    bridge = new WsBridge({
      serverUrl: 'ws://127.0.0.1:3456',
      authToken: 'test-token',
    })
  })

  afterEach(() => {
    bridge.destroy()
    vi.useRealTimers()
  })

  it('should connect and track session state', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    expect(bridge.getSessionId('chat1')).toBe('sess1')
    expect(bridge.isConnected('chat1')).toBe(true)
  })

  it('should serialize handler execution in order (start:1,end:1,start:2,end:2)', async () => {
    const order: string[] = []
    const delays: Record<number, number> = { 1: 50, 2: 10, 3: 10 }

    bridge.onServerMessage('chat1', async (msg) => {
      const num = (msg as { num?: number }).num ?? 0
      order.push(`start:${num}`)
      await new Promise((r) => setTimeout(r, delays[num] ?? 10))
      order.push(`end:${num}`)
    })

    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')
    expect(ws).toBeDefined()

    ws!._receive({ type: 'status', state: 'thinking', num: 1 })
    ws!._receive({ type: 'status', state: 'streaming', num: 2 })
    ws!._receive({ type: 'status', state: 'idle', num: 3 })

    vi.advanceTimersByTime(200)
    await vi.waitFor(() => expect(order.length).toBe(6))

    expect(order).toEqual([
      'start:1', 'end:1',
      'start:2', 'end:2',
      'start:3', 'end:3',
    ])
  })

  it('should drop stale messages from old socket after reset', async () => {
    const received: ServerMessage[] = []

    bridge.onServerMessage('chat1', (msg) => {
      received.push(msg)
    })

    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const oldWs = getWs(bridge, 'chat1')

    bridge.resetSession('chat1')
    await bridge.connectSession('chat1', 'sess2', '/tmp/work')

    oldWs!._receive({ type: 'status', state: 'idle' })

    expect(received).toHaveLength(0)
  })

  it('should send user messages via WS', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')
    const sent: string[] = []
    ws!.on('_sent', (data: string) => sent.push(data))

    bridge.sendUserMessage('chat1', 'hello world')

    expect(sent).toHaveLength(1)
    const msg = JSON.parse(sent[0])
    expect(msg).toEqual({ type: 'user_message', content: 'hello world' })
  })

  it('should send permission responses', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')
    const sent: string[] = []
    ws!.on('_sent', (data: string) => sent.push(data))

    bridge.sendPermissionResponse('chat1', 'req1', true, 'always')

    const msg = JSON.parse(sent[0])
    expect(msg).toEqual({
      type: 'permission_response',
      requestId: 'req1',
      allowed: true,
      rule: 'always',
    })
  })

  it('should send stop generation', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')
    const sent: string[] = []
    ws!.on('_sent', (data: string) => sent.push(data))

    bridge.sendStopGeneration('chat1')

    const msg = JSON.parse(sent[0])
    expect(msg).toEqual({ type: 'stop_generation' })
  })

  it('should send ping on heartbeat', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')
    const sent: string[] = []
    ws!.on('_sent', (data: string) => sent.push(data))

    bridge.startHeartbeat()

    vi.advanceTimersByTime(31_000)

    const pingMsg = sent.find((s) => JSON.parse(s).type === 'ping')
    expect(pingMsg).toBeDefined()
  })

  it('should not reconnect on normal close (code 1000)', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')

    ws!._close(1000, 'normal')

    vi.advanceTimersByTime(35_000)

    expect(bridge.isConnected('chat1')).toBe(false)
    expect(bridge.getSessionId('chat1')).toBeNull()
  })

  it('should attempt reconnect on abnormal close with exponential backoff', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    const ws = getWs(bridge, 'chat1')

    ws!._close(1006, 'abnormal')

    vi.advanceTimersByTime(1100)

    expect(bridge.getSessionId('chat1')).toBe('sess1')
  })

  it('resetSession should close WS and clean up', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')

    bridge.resetSession('chat1')

    expect(bridge.getSessionId('chat1')).toBeNull()
    expect(bridge.isConnected('chat1')).toBe(false)
  })

  it('destroy should clean up all sessions', async () => {
    await bridge.connectSession('chat1', 'sess1', '/tmp/work')
    await bridge.connectSession('chat2', 'sess2', '/tmp/work')

    bridge.destroy()

    expect(bridge.isConnected('chat1')).toBe(false)
    expect(bridge.isConnected('chat2')).toBe(false)
  })
})
