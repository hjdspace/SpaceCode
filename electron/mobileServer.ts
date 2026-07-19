// electron/mobileServer.ts
import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import * as net from 'net'
import * as os from 'os'
import * as child_process from 'child_process'
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

  /**
   * 返回本机局域网 IPv4，供手机端连接。
   *
   * 之前实现返回 os.networkInterfaces() 第一个非 internal IPv4，存在两个问题：
   *   1. 可能命中虚拟网卡（vgate0 / vmnet / docker 等），手机无法访问
   *   2. Node 在 Windows 上 os.networkInterfaces() 看不到 WLAN 接口（已知限制）
   *
   * 现按以下优先级返回候选 IP（关键：虚拟网卡过滤优先于系统命令补充）：
   *   P1. os.networkInterfaces() 中"非虚拟网卡 + 私网"IPv4
   *   P2. os.networkInterfaces() 中"非虚拟网卡"任意 IPv4
   *   P3. 系统命令（ipconfig / ip addr）输出中的私网 IPv4（弥补 Windows WLAN 不可见）
   *   P4. 系统命令输出中的任意 IPv4
   *   P5. os.networkInterfaces() 中所有非 internal IPv4（含虚拟网卡，最后兜底）
   *   P6. 127.0.0.1
   */
  private getLocalIP(): string {
    const virtualIfacePatterns = [
      /^vmnet/i, /^docker/i, /^veth/i, /^br-/i, /^virbr/i, /^vgate/i,
      /^vbox/i, /^hyper-?v/i, /^tun/i, /^tap/i, /^ppp/i, /^utun/i, /^rmnet/i,
    ]
    const isVirtual = (name: string) =>
      virtualIfacePatterns.some((re) => re.test(name))

    const isPrivateV4 = (ip: string) => {
      if (ip.startsWith('192.168.')) return true
      if (ip.startsWith('10.')) return true
      const m = /^172\.(\d+)\./.exec(ip)
      if (m) {
        const second = parseInt(m[1], 10)
        if (second >= 16 && second <= 31) return true
      }
      return false
    }

    // P1 / P2 / P5：来自 os.networkInterfaces()，可按接口名过滤虚拟网卡
    const interfacesPrivate: string[] = []
    const interfacesNonVirtual: string[] = []
    const interfacesAll: string[] = []
    for (const [name, ifaceList] of Object.entries(os.networkInterfaces())) {
      if (!ifaceList) continue
      const virtual = isVirtual(name)
      for (const iface of ifaceList) {
        if (iface.family !== 'IPv4' || iface.internal) continue
        interfacesAll.push(iface.address)
        if (!virtual) {
          interfacesNonVirtual.push(iface.address)
          if (isPrivateV4(iface.address)) interfacesPrivate.push(iface.address)
        }
      }
    }

    // P3 / P4：来自系统命令（弥补 Windows WLAN 不可见，但拿不到接口名无法过滤虚拟网卡）
    const cmdIPs = listLocalIPsFromSystemCommand()
    const cmdPrivate = cmdIPs.filter(isPrivateV4)

    if (interfacesPrivate.length > 0) return interfacesPrivate[0]
    if (interfacesNonVirtual.length > 0) return interfacesNonVirtual[0]
    if (cmdPrivate.length > 0) return cmdPrivate[0]
    if (cmdIPs.length > 0) return cmdIPs[0]
    if (interfacesAll.length > 0) return interfacesAll[0]
    return '127.0.0.1'
  }
}

/**
 * 通过系统命令获取本机 IPv4 地址列表，弥补 Node 在 Windows 上
 * os.networkInterfaces() 看不到 WLAN 接口的限制。
 *
 * - Windows: `ipconfig` 输出解析 IPv4 Address 行
 * - Linux/macOS: `ip -4 addr show` 或 `ifconfig` 解析 inet 行
 * 失败时返回空数组，不抛异常。
 */
function listLocalIPsFromSystemCommand(): string[] {
  const isWindows = process.platform === 'win32'
  const result: string[] = []
  try {
    const stdout = child_process.execSync(
      isWindows ? 'ipconfig' : 'ip -4 addr show 2>/dev/null || ifconfig',
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    if (isWindows) {
      const re = /IPv4[^\d]*:\s*(\d+\.\d+\.\d+\.\d+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(stdout)) !== null) {
        if (m[1] !== '127.0.0.1') result.push(m[1])
      }
    } else {
      const re = /inet\s+(\d+\.\d+\.\d+\.\d+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(stdout)) !== null) {
        if (m[1] !== '127.0.0.1') result.push(m[1])
      }
    }
  } catch {
    // 系统命令失败时返回空数组，调用方应继续使用 os.networkInterfaces() 结果
  }
  return result
}
