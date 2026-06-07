// electron/mobileServer.ts
import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import * as net from 'net'
import * as os from 'os'
import { WebSocketServer, WebSocket } from 'ws'
import type { MobileRequest, MobilePush, QRCodeData, ServerStatus, ThemeSyncData, ConnectData } from './mobileServerTypes'

export class MobileServer extends EventEmitter {
  private wss: WebSocketServer | null = null
  private token: string = ''
  private client: WebSocket | null = null
  private clientInfo: string = ''
  private heartbeatInterval: NodeJS.Timeout | null = null
  private missedHeartbeats = 0
  private port: number = 0

  constructor(
    private readonly onMessage: (message: MobileRequest) => Promise<unknown>,
    private readonly getThemeSyncData: () => ThemeSyncData | Promise<ThemeSyncData>
  ) {
    super()
  }

  async start(preferredPort = 9527): Promise<QRCodeData> {
    this.token = crypto.randomBytes(32).toString('hex')

    const port = await this.findAvailablePort(preferredPort, preferredPort + 20)
    this.port = port

    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req)
    })

    const ip = this.getLocalIP()
    const url = `ws://${ip}:${port}?token=${this.token}`

    this.startHeartbeat()

    return { url, token: this.token, port, ip }
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.close()
      this.client = null
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = null
    }
    this.emit('stopped')
  }

  getStatus(): ServerStatus {
    return {
      running: this.wss !== null,
      connected: this.client !== null,
      clientInfo: this.clientInfo || undefined,
      port: this.port || undefined,
    }
  }

  sendToClient(push: MobilePush): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(push))
    }
  }

  private async routeMessage(message: MobileRequest): Promise<unknown> {
    switch (message.type) {
      case 'connect':
        return { status: 'ok' }

      case 'send_message': {
        const { sessionId, content, images } = message.data as {
          sessionId: string; content: string; images?: string[]
        }
        this.emit('send_message', { sessionId, content, images })
        return { status: 'sent' }
      }

      case 'abort': {
        const { sessionId } = message.data as { sessionId: string }
        this.emit('abort', { sessionId })
        return { status: 'ok' }
      }

      case 'allow_permission': {
        const { sessionId, toolUseId } = message.data as { sessionId: string; toolUseId: string }
        this.emit('allow_permission', { sessionId, toolUseId })
        return { status: 'ok' }
      }

      case 'deny_permission': {
        const { sessionId, toolUseId } = message.data as { sessionId: string; toolUseId: string }
        this.emit('deny_permission', { sessionId, toolUseId })
        return { status: 'ok' }
      }

      case 'submit_tool_answer': {
        const { sessionId, toolUseId, answer } = message.data as {
          sessionId: string; toolUseId: string; answer: string
        }
        this.emit('submit_tool_answer', { sessionId, toolUseId, answer })
        return { status: 'ok' }
      }

      case 'list_sessions': {
        this.emit('list_sessions', {})
        return null
      }

      case 'restore_session': {
        const { sessionId } = message.data as { sessionId: string }
        this.emit('restore_session', { sessionId })
        return { status: 'ok' }
      }

      case 'new_session': {
        this.emit('new_session', {})
        return null
      }

      case 'switch_session': {
        const { sessionId } = message.data as { sessionId: string }
        this.emit('switch_session', { sessionId })
        return { status: 'ok' }
      }

      case 'list_agents': {
        this.emit('list_agents', {})
        return null
      }

      case 'get_settings': {
        this.emit('get_settings', {})
        return null
      }

      default:
        throw new Error(`Unknown message type: ${message.type}`)
    }
  }

  private async handleConnection(ws: WebSocket, req: import('http').IncomingMessage): Promise<void> {
    if (this.client) {
      ws.close(4001, 'Another client already connected')
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    if (token !== this.token) {
      ws.close(4003, 'Invalid token')
      return
    }

    this.client = ws
    this.clientInfo = req.headers['user-agent'] || 'Unknown Device'
    this.missedHeartbeats = 0

    const themeData = await this.getThemeSyncData()
    this.sendToClient({
      type: 'connected',
      data: {
        deviceName: this.clientInfo,
        theme: themeData,
      },
    })

    this.emit('connected', this.clientInfo)

    ws.on('message', async (raw) => {
      try {
        const message: MobileRequest = JSON.parse(raw.toString())
        await this.routeMessage(message)
      } catch (err) {
        this.sendToClient({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Unknown error' },
        })
      }
    })

    ws.on('close', () => {
      this.client = null
      this.clientInfo = ''
      this.emit('disconnected')
    })

    ws.on('pong', () => {
      this.missedHeartbeats = 0
    })
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.client) return

      this.missedHeartbeats++
      if (this.missedHeartbeats > 2) {
        this.client.terminate()
        this.client = null
        this.clientInfo = ''
        this.emit('disconnected')
        return
      }

      if (this.client.readyState === WebSocket.OPEN) {
        this.client.ping()
      }
    }, 30_000)
  }

  private findAvailablePort(start: number, end: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port > end) {
          reject(new Error('No available port'))
          return
        }
        const server = net.createServer()
        server.listen(port, () => {
          server.close(() => resolve(port))
        })
        server.on('error', () => {
          tryPort(port + 1)
        })
      }
      tryPort(start)
    })
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name]
      if (!ifaceList) continue
      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
    return '127.0.0.1'
  }
}
