// src/services/h5WebSocketClient.ts
// H5 WebSocket 客户端 — 接收引擎事件推送，替代 Electron ipcRenderer.on

import { getH5Config } from './h5ApiClient'
import type { H5PushMessage } from '../../electron/h5Types'

type EventCallback = (data: { sessionId: string; data: any }) => void

class H5WebSocketClient {
  private ws: WebSocket | null = null
  private listeners: Map<string, Set<EventCallback>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false

  /** 连接 WebSocket */
  connect(): void {
    const config = getH5Config()
    if (!config) {
      console.error('[H5WS] No connection config')
      return
    }

    const wsUrl = config.baseUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(config.token)}`

    try {
      this.ws = new WebSocket(wsUrl)
    } catch (err) {
      console.error('[H5WS] Failed to create WebSocket:', err)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      console.log('[H5WS] Connected')
      this.connected = true
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: H5PushMessage = JSON.parse(event.data)
        this.dispatch(msg)
      } catch (err) {
        console.error('[H5WS] Failed to parse message:', err)
      }
    }

    this.ws.onclose = () => {
      console.log('[H5WS] Disconnected')
      this.connected = false
      this.ws = null
      this.scheduleReconnect()
    }

    this.ws.onerror = (err: Event) => {
      console.error('[H5WS] Error:', err)
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
  }

  /** 分发事件到已注册的监听器 */
  private dispatch(msg: H5PushMessage): void {
    const eventType = msg.type
    const sessionId = msg.sessionId || ''
    const data = msg.data

    const payload = { sessionId, data }

    // 通知该事件类型的所有监听器
    const callbacks = this.listeners.get(eventType)
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(payload)
        } catch (err) {
          console.error(`[H5WS] Listener error for ${eventType}:`, err)
        }
      }
    }
  }

  /** 注册事件监听器，返回取消订阅函数 */
  on(eventType: string, callback: EventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(callback)

    // 延迟自动连接
    if (!this.ws && !this.connected) {
      this.connect()
    }

    return () => {
      const set = this.listeners.get(eventType)
      if (set) {
        set.delete(callback)
        if (set.size === 0) {
          this.listeners.delete(eventType)
        }
      }
    }
  }

  /** 关闭连接 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.listeners.clear()
  }

  isConnected(): boolean {
    return this.connected
  }
}

export const h5WebSocketClient = new H5WebSocketClient()
