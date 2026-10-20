import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 固定连接配置；单条用例里用 mockReturnValue 覆盖（mock 工厂返回的同一 fn 实例）
const h5ApiMocks = vi.hoisted(() => ({
  getH5Config: vi.fn<() => { baseUrl: string; token: string } | null>(),
}))

vi.mock('../h5ApiClient', () => h5ApiMocks)

const DEFAULT_CONFIG = { baseUrl: 'http://192.168.1.5:34567', token: 'h5_tok' }

/** 可控 fake：不依赖 jsdom 的 WebSocket 实现，事件由测试手动触发 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  /** 下一次构造抛出的异常，用于测 constructor 失败 → 重连路径 */
  static nextThrow: Error | null = null

  url: string
  closed = false
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((err: Event) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(url: string) {
    if (FakeWebSocket.nextThrow) throw FakeWebSocket.nextThrow
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  // ── 测试辅助：手动驱动事件 ──
  fireOpen(): void {
    this.onopen?.()
  }

  fireMessage(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  fireClose(): void {
    this.onclose?.()
  }
}

import { h5WebSocketClient } from '../h5WebSocketClient'
import { getH5Config } from '../h5ApiClient'

const client = h5WebSocketClient

describe('h5WebSocketClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    client.disconnect()
    FakeWebSocket.instances = []
    FakeWebSocket.nextThrow = null
    vi.mocked(getH5Config).mockReset().mockReturnValue(DEFAULT_CONFIG)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    client.disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('无连接配置时 connect 只报错、不创建 WebSocket', () => {
    vi.mocked(getH5Config).mockReturnValue(null)
    client.connect()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith('[H5WS] No connection config')
  })

  it('URL 由 http 转 ws 且 token 经 encodeURIComponent', () => {
    vi.mocked(getH5Config).mockReturnValue({
      baseUrl: 'https://example.com',
      token: 'h5 a+b/c',
    })
    client.connect()
    expect(FakeWebSocket.instances[0].url).toBe('wss://example.com/ws?token=h5%20a%2Bb%2Fc')
  })

  it('构造失败进入重连，3 秒后重试成功', () => {
    FakeWebSocket.nextThrow = new Error('boom')
    client.connect()
    expect(FakeWebSocket.instances).toHaveLength(0)

    FakeWebSocket.nextThrow = null
    vi.advanceTimersByTime(2999)
    expect(FakeWebSocket.instances).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('onopen 置为已连接，并清掉挂起的重连计时器', () => {
    client.connect()
    const ws1 = FakeWebSocket.instances[0]
    ws1.fireClose() // 调度 3s 重连
    // 模拟闪断的 socket 恢复：陈旧实例的 onopen 仍应清掉挂起的重连
    ws1.fireOpen()
    expect(client.isConnected()).toBe(true)

    vi.advanceTimersByTime(3000)
    expect(FakeWebSocket.instances).toHaveLength(1) // 没有重连出第二条
  })

  it('onclose 调度 3 秒重连（重连闭环）', () => {
    client.connect()
    const ws1 = FakeWebSocket.instances[0]
    expect(client.isConnected()).toBe(false) // 未 open 前不算已连接

    ws1.fireOpen()
    expect(client.isConnected()).toBe(true)

    ws1.fireClose()
    expect(client.isConnected()).toBe(false)
    expect(FakeWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(3000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('onmessage 按类型分发 {sessionId, data}', () => {
    const cb = vi.fn()
    client.on('engine', cb)
    const ws = FakeWebSocket.instances[0]

    ws.fireMessage({ type: 'engine', sessionId: 's1', data: { foo: 1 } })
    expect(cb).toHaveBeenCalledWith({ sessionId: 's1', data: { foo: 1 } })

    // sessionId 缺失回落 ''
    cb.mockClear()
    ws.fireMessage({ type: 'engine', data: null })
    expect(cb).toHaveBeenCalledWith({ sessionId: '', data: null })
  })

  it('非法 JSON 不抛出、不分发', () => {
    const cb = vi.fn()
    client.on('engine', cb)
    const ws = FakeWebSocket.instances[0]

    expect(() => ws.fireMessage('{broken')).not.toThrow()
    expect(cb).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      '[H5WS] Failed to parse message:',
      expect.any(Error),
    )
  })

  it('同类型多个监听器全部收到；单个抛错不影响其余', () => {
    const bad = vi.fn(() => {
      throw new Error('listener blew up')
    })
    const good = vi.fn()
    client.on('engine', bad)
    client.on('engine', good)
    const ws = FakeWebSocket.instances[0]

    ws.fireMessage({ type: 'engine', sessionId: 's1', data: 1 })

    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(
      '[H5WS] Listener error for engine:',
      expect.any(Error),
    )
  })

  it('同一回调重复注册只收到一次（Set 语义）', () => {
    const cb = vi.fn()
    client.on('engine', cb)
    client.on('engine', cb)
    FakeWebSocket.instances[0].fireMessage({ type: 'engine', sessionId: 's', data: null })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('on() 返回退订函数：退订后不再收到，其余监听器不受影响', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = client.on('engine', a)
    client.on('engine', b)

    offA()
    FakeWebSocket.instances[0].fireMessage({ type: 'engine', sessionId: 's', data: null })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('on() 在未连接时自动触发 connect()（延迟连接）', () => {
    expect(FakeWebSocket.instances).toHaveLength(0)
    client.on('engine', () => {})
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('disconnect 清掉挂起的重连计时器', () => {
    client.connect()
    const ws1 = FakeWebSocket.instances[0]

    ws1.fireClose() // 挂起一条 3s 重连
    client.disconnect()

    vi.advanceTimersByTime(3000)
    expect(FakeWebSocket.instances).toHaveLength(1) // 没有重连出第二条
  })

  it('disconnect 对活连接先摘 onclose 再 close，并清空监听器', () => {
    const cb = vi.fn()
    client.on('engine', cb)
    const ws1 = FakeWebSocket.instances[0]

    client.disconnect()

    expect(ws1.closed).toBe(true)
    expect(ws1.onclose).toBeNull() // 先摘 onclose 再 close，避免触发重连
    expect(client.isConnected()).toBe(false)

    // 监听器已清空：重新连接后旧监听器不应复活
    client.connect()
    const ws2 = FakeWebSocket.instances[1]
    ws2.fireOpen()
    ws2.fireMessage({ type: 'engine', sessionId: 's', data: null })
    expect(cb).not.toHaveBeenCalled()
  })
})
