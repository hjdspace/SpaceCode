/**
 * WsBridge — WebSocket connection pool + reconnect + heartbeat + serialization
 *
 * Manages WebSocket connections to the IM Server, one per chatId.
 * Key features:
 *
 * 1. **handlerChains serialization**: Ensures server messages for the same
 *    chatId are processed sequentially (prevents race conditions where a
 *    slow handler is still awaiting while a fast handler reads stale state).
 *    Chain is truncated every 100 messages to prevent unbounded Promise growth.
 *
 * 2. **Exponential backoff reconnect**: base=1s, max=30s, max 10 attempts.
 *    Close code 1000 (normal) does not trigger reconnect.
 *
 * 3. **Heartbeat**: Every 30s, sends ping to all OPEN connections.
 *
 * 4. **Stale message prevention**: If session is replaced, messages from
 *    the old socket are silently dropped (if sessions.get(chatId) !== session).
 */

import WebSocket from 'ws'
import type { ClientMessage, ServerMessage, MessageHandler } from './types'

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 10
const CHAIN_TRUNCATE_THRESHOLD = 100

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface BridgeSession {
  sessionId: string
  ws: WebSocket
  workDir: string
  reconnectAttempts: number
  destroyed: boolean
}

export interface WsBridgeOptions {
  serverUrl: string
  /** Optional token for client channel authentication */
  authToken?: string
  /** Protocol version for handshake negotiation */
  protocolVersion?: string
}

// ──────────────────────────────────────────────────────────────────────────
// WsBridge
// ──────────────────────────────────────────────────────────────────────────

export class WsBridge {
  private sessions: Map<string, BridgeSession> = new Map()
  private handlers: Map<string, MessageHandler> = new Map()
  private handlerChains: Map<string, Promise<void>> = new Map()
  private chainCounts: Map<string, number> = new Map()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private destroyed: boolean = false

  private readonly serverUrl: string
  private readonly authToken: string | undefined
  private readonly protocolVersion: string

  constructor(opts: WsBridgeOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/$/, '') // trim trailing slash
    this.authToken = opts.authToken
    this.protocolVersion = opts.protocolVersion ?? 'v1'
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────────

  /** Current sessionId for a chatId, or null. */
  getSessionId(chatId: string): string | null {
    return this.sessions.get(chatId)?.sessionId ?? null
  }

  /** Whether the WS connection for a chatId is currently OPEN. */
  isConnected(chatId: string): boolean {
    const session = this.sessions.get(chatId)
    return !!session && !session.destroyed && session.ws.readyState === WebSocket.OPEN
  }

  /**
   * Connect to the IM Server for a given chatId + sessionId.
   * If an existing session exists, it will be reset first.
   */
  async connectSession(chatId: string, sessionId: string, workDir: string): Promise<void> {
    // Reset any existing session
    this.resetSession(chatId)

    const url = this.buildWsUrl(sessionId)
    const ws = new WebSocket(url)

    const session: BridgeSession = {
      sessionId,
      ws,
      workDir,
      reconnectAttempts: 0,
      destroyed: false,
    }

    this.sessions.set(chatId, session)

    // Set up event handlers
    ws.on('open', () => this.onOpen(chatId, session))
    ws.on('message', (data) => this.onMessage(chatId, session, data))
    ws.on('close', (code, reason) => this.onClose(chatId, session, code, reason.toString()))
    ws.on('error', (err) => {
      // Error is usually followed by close, which triggers reconnect
      console.error(`[WsBridge] WS error on ${chatId}:`, err.message)
    })

    // Wait for connection
    await this.waitForOpen(chatId)
  }

  /** Send a user message to the server. */
  sendUserMessage(chatId: string, content: string): void {
    this.send(chatId, { type: 'user_message', content })
  }

  /** Send a permission response to the server. */
  sendPermissionResponse(chatId: string, requestId: string, allowed: boolean, rule?: 'always'): void {
    this.send(chatId, { type: 'permission_response', requestId, allowed, rule })
  }

  /** Send stop generation signal to the server. */
  sendStopGeneration(chatId: string): void {
    this.send(chatId, { type: 'stop_generation' })
  }

  /** Register a message handler for server messages. */
  onServerMessage(chatId: string, handler: MessageHandler): void {
    this.handlers.set(chatId, handler)
  }

  /** Wait for the WS connection to be OPEN. */
  async waitForOpen(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId)
    if (!session) {
      throw new Error(`No session for chatId: ${chatId}`)
    }

    if (session.ws.readyState === WebSocket.OPEN) {
      return
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`WS connection timeout for ${chatId}`))
      }, 10_000)

      session.ws.once('open', () => {
        clearTimeout(timeout)
        resolve()
      })

      session.ws.once('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /** Reset the session for a chatId (close WS, remove from pool). */
  resetSession(chatId: string): void {
    const session = this.sessions.get(chatId)
    if (session) {
      session.destroyed = true
      try {
        session.ws.removeAllListeners()
        if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
          session.ws.close(1000, 'session reset')
        }
      } catch {
        // ignore
      }
    }
    this.sessions.delete(chatId)
    this.handlerChains.delete(chatId)
    this.chainCounts.delete(chatId)
  }

  /** Destroy all sessions and stop heartbeat. */
  destroy(): void {
    this.destroyed = true
    this.stopHeartbeat()

    for (const chatId of this.sessions.keys()) {
      this.resetSession(chatId)
    }

    this.handlers.clear()
  }

  /** Start the heartbeat timer. */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      for (const [chatId, session] of this.sessions) {
        if (!session.destroyed && session.ws.readyState === WebSocket.OPEN) {
          this.send(chatId, { type: 'ping' })
        }
      }
    }, HEARTBEAT_INTERVAL_MS)

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }

  /** Stop the heartbeat timer. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private: WS event handlers
  // ────────────────────────────────────────────────────────────────────────

  private onOpen(chatId: string, session: BridgeSession): void {
    session.reconnectAttempts = 0
    // Start heartbeat on first successful connection
    if (!this.heartbeatTimer) {
      this.startHeartbeat()
    }
  }

  private onMessage(chatId: string, session: BridgeSession, data: WebSocket.RawData): void {
    // Stale message prevention: if session was replaced, drop the message
    if (this.sessions.get(chatId) !== session) {
      return
    }

    let msg: ServerMessage
    try {
      msg = JSON.parse(data.toString()) as ServerMessage
    } catch {
      console.error(`[WsBridge] Failed to parse message on ${chatId}`)
      return
    }

    // Serialize handler execution via handlerChains
    const handler = this.handlers.get(chatId)
    if (!handler) return

    const prev = this.handlerChains.get(chatId) ?? Promise.resolve()
    const next = prev
      .catch(() => {}) // upstream error doesn't propagate
      .then(() => Promise.resolve().then(() => handler(msg)))
      .catch((err) => {
        console.error(`[WsBridge] Handler error on ${chatId}:`, err)
      })

    this.handlerChains.set(chatId, next)

    // Truncate chain every CHAIN_TRUNCATE_THRESHOLD messages to prevent
    // unbounded Promise chain growth (GC pressure for long-running chatIds)
    const count = (this.chainCounts.get(chatId) ?? 0) + 1
    this.chainCounts.set(chatId, count)

    if (count >= CHAIN_TRUNCATE_THRESHOLD) {
      // Once the current chain settles, reset it to a fresh Promise.resolve()
      next.then(() => {
        if (this.chainCounts.get(chatId) === count) {
          this.handlerChains.set(chatId, Promise.resolve())
          this.chainCounts.set(chatId, 0)
        }
      })
    }
  }

  private onClose(chatId: string, session: BridgeSession, code: number, reason: string): void {
    // Stale check: if session was replaced, don't reconnect
    if (this.sessions.get(chatId) !== session) {
      return
    }

    // Normal close (1000) — don't reconnect
    if (code === 1000 || session.destroyed || this.destroyed) {
      this.sessions.delete(chatId)
      return
    }

    // Abnormal close — attempt reconnect with exponential backoff
    session.reconnectAttempts++
    if (session.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WsBridge] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for ${chatId}`
      )
      this.sessions.delete(chatId)
      return
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, session.reconnectAttempts - 1),
      RECONNECT_MAX_MS
    )

    console.warn(
      `[WsBridge] Reconnecting ${chatId} in ${delay}ms (attempt ${session.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    )

    setTimeout(() => {
      // Check if session was destroyed during the wait
      if (session.destroyed || this.destroyed) return
      if (this.sessions.get(chatId) !== session) return

      this.reconnect(chatId, session)
    }, delay)
  }

  private async reconnect(chatId: string, session: BridgeSession): Promise<void> {
    const url = this.buildWsUrl(session.sessionId)
    const ws = new WebSocket(url)

    session.ws = ws

    ws.on('open', () => this.onOpen(chatId, session))
    ws.on('message', (data) => this.onMessage(chatId, session, data))
    ws.on('close', (code, reason) => this.onClose(chatId, session, code, reason.toString()))
    ws.on('error', (err) => {
      console.error(`[WsBridge] WS reconnect error on ${chatId}:`, err.message)
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private: helpers
  // ────────────────────────────────────────────────────────────────────────

  private buildWsUrl(sessionId: string): string {
    const url = new URL(`${this.serverUrl}/ws/${sessionId}`)
    url.searchParams.set('proto', this.protocolVersion)
    if (this.authToken) {
      url.searchParams.set('token', this.authToken)
    }
    return url.toString()
  }

  private send(chatId: string, msg: ClientMessage): void {
    const session = this.sessions.get(chatId)
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WsBridge] Cannot send to ${chatId}: WS not open`)
      return
    }
    session.ws.send(JSON.stringify(msg))
  }
}
