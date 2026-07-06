// electron/h5Server.ts
// H5 WebUI 服务器 — HTTP REST + WebSocket，直接调用引擎

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { join, extname, normalize } from 'path'
import { app, BrowserWindow, net } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import { H5AuthService } from './h5AuthService'
import { h5EngineService } from './h5EngineService'
import { info, warn, error, debug } from './logger'
import type {
  H5ServerStatus,
  H5PushMessage,
  H5ConnectedPayload,
  H5SessionChangedPayload,
  H5RemoteUserMessagePayload,
} from './h5Types'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

export class H5Server {
  private httpServer: ReturnType<typeof createServer> | null = null
  private wsServer: WebSocketServer | null = null
  private clients: Set<WebSocket> = new Set()
  private authService: H5AuthService
  private port: number = 0
  private unsubEngineEvents: (() => void) | null = null

  /** 镜像会话 — 桌面端当前活跃会话 */
  private mirrorSessionId: string | null = null
  private mirrorProjectPath: string | null = null
  private sessionMetadata: Map<string, { projectPath: string | null; title: string | null }> = new Map()

  constructor(authService: H5AuthService) {
    this.authService = authService
  }

  async start(port?: number): Promise<H5ServerStatus> {
    if (this.httpServer) {
      throw new Error('H5 Server is already running')
    }

    const settings = this.authService.getSettings()
    const listenPort = port ?? settings.fixedPort ?? 0 // 0 = 随机端口
    const ip = this.authService.findLanIP()

    this.httpServer = createServer((req, res) => this.handleHttp(req, res))

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject)
      this.httpServer!.listen(listenPort, '0.0.0.0', () => {
        const addr = this.httpServer!.address()
        this.port = typeof addr === 'object' && addr ? addr.port : listenPort
        info('H5Server', `HTTP server listening on 0.0.0.0:${this.port}`)
        resolve()
      })
    })

    // WebSocket 服务器 — 挂载到同一 HTTP server，路径 /ws
    this.wsServer = new WebSocketServer({ server: this.httpServer, path: '/ws' })
    this.wsServer.on('connection', (ws, req) => this.handleWsConnection(ws, req))

    // 订阅引擎事件 → 转发给所有 WS 客户端
    this.unsubEngineEvents = h5EngineService.onRouteEvent((sessionId, eventType, data) => {
      // 转发所有引擎事件 — 客户端 chatStream store 已按 sessionId 过滤，
      // 仅处理有 turn state 的会话事件。
      // 之前的 mirror session 过滤会导致非镜像会话的事件被丢弃，
      // 造成 H5 端发消息后收不到 LLM 响应。
      this.broadcast({ type: eventType, sessionId, data })
    })

    const publicUrl = settings.publicBaseUrl
      ? `${settings.publicBaseUrl}`
      : `http://${ip}:${this.port}`

    return {
      running: true,
      port: this.port,
      ip,
      publicUrl,
      connectedClients: 0,
    }
  }

  stop(): void {
    if (this.unsubEngineEvents) {
      this.unsubEngineEvents()
      this.unsubEngineEvents = null
    }
    // 关闭所有 WS 连接
    for (const ws of this.clients) {
      ws.close(1001, 'Server shutting down')
    }
    this.clients.clear()

    if (this.wsServer) {
      this.wsServer.close()
      this.wsServer = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    info('H5Server', 'Server stopped')
  }

  getStatus(): H5ServerStatus {
    const settings = this.authService.getSettings()
    const ip = this.authService.findLanIP()
    const publicUrl = settings.publicBaseUrl
      ? `${settings.publicBaseUrl}`
      : this.httpServer
        ? `http://${ip}:${this.port}`
        : null
    return {
      running: !!this.httpServer,
      port: this.port,
      ip,
      publicUrl,
      connectedClients: this.clients.size,
    }
  }

  /** 桌面端切换会话时调用，推送给所有 H5 客户端 */
  setMirrorSession(sessionId: string | null, projectPath: string | null): void {
    this.mirrorSessionId = sessionId
    this.mirrorProjectPath = projectPath
    const payload: H5SessionChangedPayload = { sessionId, projectPath }
    this.broadcast({ type: 'session_changed', data: payload })
    info('H5Server', `Mirror session updated | sessionId=${sessionId?.slice(0, 8)} | projectPath=${projectPath}`)
  }

  // ──────────────────────────────────────────────────
  // HTTP 处理
  // ──────────────────────────────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 健康检查（不需要认证）
    if (pathname === '/health') {
      this.sendJson(res, 200, { status: 'ok', timestamp: Date.now() })
      return
    }

    // API 路由
    if (pathname.startsWith('/api/')) {
      this.handleApi(req, res, url).catch(err => {
        error('H5Server', `API error: ${err.message}`)
        this.sendJson(res, 500, { error: err.message })
      })
      return
    }

    // 静态文件（H5 前端）— 在根路径提供，支持 SPA
    this.handleStatic(pathname, res)
  }

  private handleStatic(pathname: string, res: ServerResponse): void {
    // 根路径 / → dist/index.html
    // /assets/* → dist/assets/*
    // 其他非文件路径 → SPA fallback to index.html
    let relativePath = pathname
    if (relativePath === '' || relativePath === '/') relativePath = '/index.html'

    // 安全区：规范化路径，防止目录遍历
    const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
    const distRoot = app.isPackaged
      ? join(process.resourcesPath, 'dist')
      : join(__dirname, '..', 'dist')

    const filePath = join(distRoot, safePath)

    // 防止路径逃逸
    if (!filePath.startsWith(distRoot)) {
      this.sendJson(res, 403, { error: 'Forbidden' })
      return
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA fallback → index.html
      const indexPath = join(distRoot, 'index.html')
      if (existsSync(indexPath)) {
        this.serveFile(indexPath, res)
      } else {
        this.sendJson(res, 404, { error: 'H5 client not built. Run npm run build first.' })
      }
      return
    }

    this.serveFile(filePath, res)
  }

  private serveFile(filePath: string, res: ServerResponse): void {
    try {
      const stat = statSync(filePath)
      const mime = MIME[extname(filePath)] || 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      })
      // 用流式读取避免大文件占内存
      const { createReadStream } = require('fs') as typeof import('fs')
      createReadStream(filePath).pipe(res)
    } catch (err: any) {
      this.sendJson(res, 500, { error: err.message })
    }
  }

  private sendJson(res: ServerResponse, code: number, data: unknown): void {
    const body = JSON.stringify(data)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  // ──────────────────────────────────────────────────
  // API 处理
  // ──────────────────────────────────────────────────

  private async handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const pathname = url.pathname

    // Token 认证
    const authHeader = req.headers['authorization']
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null
    const queryToken = url.searchParams.get('token')
    const token = bearerToken || queryToken

    if (!this.authService.validateToken(token)) {
      this.sendJson(res, 401, { error: 'Unauthorized' })
      return
    }

    const method = req.method || 'GET'
    const body = method === 'POST' ? await this.readBody(req) : {}
    const sessionId = body.sessionId as string | undefined
    const config = body.config as any | undefined
    const content = body.content as string | undefined
    const images = body.images as any[] | undefined
    const clientMessageId = body.clientMessageId as string | undefined
    const displayContent = body.displayContent as string | undefined
    const requestId = body.requestId as string | undefined
    const toolCallId = body.toolCallId as string | undefined

    switch (pathname) {
      case '/api/session/start':
        this.rememberSessionMetadata(sessionId!, config)
        await h5EngineService.startSession(sessionId!, config)
        if (config?.cwd) {
          this.setMirrorSession(sessionId!, config.cwd)
        }
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/send':
        if (!sessionId || typeof content !== 'string') {
          this.sendJson(res, 400, { error: 'sessionId and content required' })
          return
        }
        if (!content && (!Array.isArray(images) || images.length === 0)) {
          this.sendJson(res, 400, { error: 'content or images required' })
          return
        }
        {
          const status = h5EngineService.getSessionStatus(sessionId)
          if (!status?.isRunning) {
            this.sendJson(res, 409, { error: `Session ${sessionId} has no active process` })
            return
          }
        }
        this.pushRemoteUserMessage(
          sessionId,
          displayContent || content || '[Image]',
          clientMessageId || null,
        )
        try {
          await h5EngineService.sendMessage(sessionId, content, images)
          this.sendJson(res, 200, { ok: true })
        } catch (err) {
          this.pushEngineError(sessionId, err)
          throw err
        }
        return

      case '/api/session/abort':
        await h5EngineService.abort(sessionId!)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/stop':
        await h5EngineService.stop(sessionId!)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/permission/allow':
        await h5EngineService.allowPermission(
          sessionId!,
          requestId!,
          body.updatedInput as Record<string, unknown> | undefined,
          body.decisionClassification as 'user_temporary' | 'user_permanent' | undefined,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/permission/deny':
        await h5EngineService.denyPermission(
          sessionId!,
          requestId!,
          body.message as string | undefined,
          body.options as { interrupt?: boolean } | undefined,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/tool-answer':
        await h5EngineService.submitToolAnswer(
          sessionId!,
          toolCallId!,
          body.answers as Record<string, string>,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/tool-skip':
        await h5EngineService.skipToolAnswer(sessionId!, toolCallId!)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/status':
        if (sessionId) {
          this.sendJson(res, 200, h5EngineService.getSessionStatus(sessionId))
        } else {
          this.sendJson(res, 400, { error: 'sessionId required' })
        }
        return

      case '/api/sessions/active':
        this.sendJson(res, 200, h5EngineService.getActiveSessions())
        return

      case '/api/sessions/list':
        const projectPath = url.searchParams.get('projectPath') || (body.projectPath as string)
        if (!projectPath) {
          this.sendJson(res, 400, { error: 'projectPath required' })
          return
        }
        const sessions = await h5EngineService.listProjectSessions(projectPath)
        this.sendJson(res, 200, sessions)
        return

      case '/api/sessions/history':
        const hp = url.searchParams.get('projectPath') || (body.projectPath as string)
        const hs = url.searchParams.get('sessionId') || (body.sessionId as string)
        if (!hp || !hs) {
          this.sendJson(res, 400, { error: 'projectPath and sessionId required' })
          return
        }
        const history = await h5EngineService.restoreSession(hp, hs)
        this.sendJson(res, 200, history)
        return

      case '/api/mirror-session':
        // 桌面端通知 H5 Server 当前会话
        this.setMirrorSession(
          body.sessionId as string | null,
          body.projectPath as string | null,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/desktop-config':
        // 返回桌面端 GUI 设置 + 当前镜像会话信息
        this.sendJson(res, 200, this.getDesktopConfig())
        return

      case '/api/http/fetch':
        this.sendJson(res, 200, await this.proxyHttpFetch(
          body.url as string,
          body.options as { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } | undefined,
        ))
        return

      case '/api/fs/read-dir':
        this.sendJson(res, 200, this.readDir(body.path as string))
        return

      case '/api/fs/read-file':
        this.sendJson(res, 200, this.readTextFile(body.path as string))
        return

      case '/api/fs/read-file-base64':
        this.sendJson(res, 200, this.readFileAsBase64(body.path as string))
        return

      case '/api/fs/stat':
        this.sendJson(res, 200, this.statFile(body.path as string))
        return

      case '/api/fs/search-files':
        this.sendJson(res, 200, this.searchFiles(
          body.path as string,
          body.query as string,
          body.options as { maxResults?: number } | undefined,
        ))
        return

      default:
        this.sendJson(res, 404, { error: `Unknown API: ${pathname}` })
        return
    }
  }

  /** 读取桌面端 GUI 设置 + 当前镜像会话，供手机端初始化 */
  private getDesktopConfig(): {
    guiSettings: string | null
    mirrorSessionId: string | null
    mirrorProjectPath: string | null
    activeSessions: Array<{ sessionId: string; engineSessionId: string | null; status: string; isRunning: boolean }>
  } {
    // 读取 ~/.claude/gui-settings.json
    let guiSettings: string | null = null
    try {
      const settingsPath = join(app.getPath('home'), '.claude', 'gui-settings.json')
      if (existsSync(settingsPath)) {
        guiSettings = readFileSync(settingsPath, 'utf-8')
      }
    } catch (err) {
      warn('H5Server', `Failed to read gui-settings.json: ${err}`)
    }

    return {
      guiSettings,
      mirrorSessionId: this.mirrorSessionId,
      mirrorProjectPath: this.mirrorProjectPath,
      activeSessions: h5EngineService.getActiveSessions().map(s => ({
        sessionId: s.sessionId,
        engineSessionId: s.engineSessionId,
        status: s.status,
        isRunning: s.isRunning,
      })),
    }
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
        } catch (err) {
          reject(new Error('Invalid JSON body'))
        }
      })
      req.on('error', reject)
    })
  }

  private readDir(dirPath: string): Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }> {
    if (!dirPath || typeof dirPath !== 'string') return []
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }))
    } catch (err) {
      warn('H5Server', `readDir failed | path=${dirPath} | error=${err}`)
      return []
    }
  }

  private readTextFile(filePath: string): string | null {
    if (!filePath || typeof filePath !== 'string') return null
    try {
      return readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  private readFileAsBase64(filePath: string): string | null {
    if (!filePath || typeof filePath !== 'string') return null
    try {
      return readFileSync(filePath).toString('base64')
    } catch {
      return null
    }
  }

  private statFile(filePath: string): { size: number; isDirectory: boolean; isFile: boolean; mtime: number } | null {
    if (!filePath || typeof filePath !== 'string') return null
    try {
      const stat = statSync(filePath)
      return {
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        mtime: stat.mtime.getTime(),
      }
    } catch {
      return null
    }
  }

  private searchFiles(
    dirPath: string,
    query: string,
    options?: { maxResults?: number },
  ): Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }> {
    if (!dirPath || typeof dirPath !== 'string') return []
    try {
      const maxResults = options?.maxResults || 100
      const results: Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }> = []
      const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'vendor', 'build', 'out', '.tox', 'target'])

      if (!query) {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.claude') continue
          if (ignoreDirs.has(entry.name)) continue
          results.push({
            name: entry.name,
            path: join(dirPath, entry.name),
            relativePath: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
          })
        }
        results.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        return results.slice(0, maxResults)
      }

      const q = query.toLowerCase()
      const visited = new Set<string>()

      const walkDir = (currentPath: string, depth: number): void => {
        if (results.length >= maxResults) return
        if (depth > 8) return

        let entries
        try {
          entries = readdirSync(currentPath, { withFileTypes: true })
        } catch {
          return
        }

        const sorted = entries
          .filter(e => !e.name.startsWith('.') && !ignoreDirs.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
            return a.name.localeCompare(b.name)
          })

        for (const entry of sorted) {
          if (results.length >= maxResults) return

          const fullPath = join(currentPath, entry.name)
          const relativePath = fullPath.slice(dirPath.length + 1).replace(/\\/g, '/')
          const nameLower = entry.name.toLowerCase()
          const relativeLower = relativePath.toLowerCase()

          if (nameLower.includes(q) || relativeLower.includes(q)) {
            if (!visited.has(fullPath)) {
              visited.add(fullPath)
              results.push({
                name: entry.name,
                path: fullPath,
                relativePath,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile(),
              })
            }
          }

          if (entry.isDirectory()) {
            walkDir(fullPath, depth + 1)
          }
        }
      }

      walkDir(dirPath, 0)

      results.sort((a, b) => {
        const aNameMatch = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2
        const bNameMatch = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2
        if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.relativePath.localeCompare(b.relativePath)
      })

      return results
    } catch (err) {
      warn('H5Server', `searchFiles failed | path=${dirPath} | query=${query} | error=${err}`)
      return []
    }
  }

  private rememberSessionMetadata(sessionId: string, config?: Record<string, unknown>): void {
    if (!sessionId) return
    const existing = this.sessionMetadata.get(sessionId)
    this.sessionMetadata.set(sessionId, {
      projectPath: (config?.cwd as string | undefined) || existing?.projectPath || this.mirrorProjectPath,
      title: (config?.title as string | undefined) || existing?.title || null,
    })
  }

  private pushRemoteUserMessage(sessionId: string, content: string, messageId: string | null): void {
    const meta = this.sessionMetadata.get(sessionId)
    const payload: H5RemoteUserMessagePayload = {
      __h5RemoteUserMessage: true,
      messageId,
      content,
      projectPath: meta?.projectPath || this.mirrorProjectPath,
      title: meta?.title || (content ? content.slice(0, 50) : null),
      timestamp: Date.now(),
    }

    // 同步给其他 H5 客户端，也让发送端用 messageId 去重。
    this.broadcast({ type: 'user', sessionId, data: payload })

    // 同步给桌面渲染进程；桌面 chatStream 会将其作为远端用户消息处理。
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('claude-code:user', { sessionId, data: payload })
      }
    }
  }

  private pushEngineError(sessionId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    const payload = { message }

    this.broadcast({ type: 'error', sessionId, data: payload })

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('claude-code:error', { sessionId, data: payload })
      }
    }
  }

  private async proxyHttpFetch(
    targetUrl: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data?: string; error?: string }> {
    const timeoutMs = options?.timeoutMs ?? 30000
    const start = Date.now()
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return { ok: false, status: 0, error: 'Invalid URL' }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const response = await net.fetch(targetUrl, {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body || undefined,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const text = await response.text()
      debug('H5Server', `http fetch response | status=${response.status} elapsed=${Date.now() - start}ms bodyLen=${text.length}`)
      return { ok: response.ok, status: response.status, data: text }
    } catch (err: any) {
      const errorMsg = err?.name === 'AbortError'
        ? `Request timed out (${Math.round(timeoutMs / 1000)}s)`
        : (err instanceof Error ? err.message : String(err))
      warn('H5Server', `http fetch failed | elapsed=${Date.now() - start}ms | url=${targetUrl} | error=${errorMsg}`)
      return { ok: false, status: 0, error: errorMsg }
    }
  }

  // ──────────────────────────────────────────────────
  // WebSocket 处理
  // ──────────────────────────────────────────────────

  private handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const token = url.searchParams.get('token')

    if (!this.authService.validateToken(token)) {
      ws.close(4001, 'Unauthorized')
      return
    }

    this.clients.add(ws)
    info('H5Server', `WS client connected | total=${this.clients.size}`)

    // 推送 connected 消息（包含当前镜像会话信息）
    const connectedPayload: H5ConnectedPayload = {
      projectPath: this.mirrorProjectPath,
      sessionId: this.mirrorSessionId,
    }
    this.sendTo(ws, { type: 'connected', data: connectedPayload })

    ws.on('message', (raw: Buffer) => {
      // 处理客户端 WS 请求（用于未来扩展，目前所有操作走 REST）
      try {
        const msg = JSON.parse(raw.toString())
        debug('H5Server', `WS message from client: ${msg.type}`)
      } catch {
        // ignore
      }
    })

    ws.on('close', () => {
      this.clients.delete(ws)
      info('H5Server', `WS client disconnected | total=${this.clients.size}`)
    })

    ws.on('error', () => {
      this.clients.delete(ws)
    })
  }

  private broadcast(message: H5PushMessage): void {
    const json = JSON.stringify(message)
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json)
      }
    }
  }

  private sendTo(ws: WebSocket, message: H5PushMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }
}
