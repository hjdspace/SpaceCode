// electron/h5Server.ts
// H5 WebUI 服务器 — HTTP REST + WebSocket，直接调用引擎

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { join, extname, normalize } from 'path'
import { app, BrowserWindow, net } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import { isAllowedFetchUrlAfterResolution } from './h5FetchUrlValidator'
import { H5PathGuard } from './h5PathGuard'
import { redactSecretsInJson } from './h5ConfigRedactor'
import { H5AuthService } from './h5AuthService'
import { renderH5Document, resolveH5SandboxBaseUrl } from './h5DocumentPolicy'
import { startSandboxStaticServer, type SandboxStaticServer } from '../genui/sandboxStaticServer'
import { resolveSandboxResourceRoot } from '../genui/sandboxRoot'
import { newGenuiCspNonce } from '@/shared/genuiSandbox'
import { engineGateway } from '../engine/engineGateway'
import { isEffortLevel } from '@/shared/effort'
import { EngineFactory } from '../engine/engines/EngineFactory'
import type { EngineType, ExtensionDialogAnswer, PermissionMode } from '../engine/engines/types'
import { SessionHistoryManager } from '../session/sessionHistoryManager'
import { info, warn, error, debug } from '../infra/logger'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { eventChannels } from '@/shared/channelMap'
import { isEngineBlockedPayload } from '@/shared/engineErrors'
import type {
  H5ServerStatus,
  H5PushMessage,
  H5ConnectedPayload,
  H5SessionChangedPayload,
  H5RemoteUserMessagePayload,
} from './h5Types'

// 桌面渲染进程的引擎事件 channel 名与 preload bridge 共享同一真相源
const CLAUDE_CODE_EVENTS = eventChannels(claudeCodeNamespace.events, 'claude-code:')

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

// 远端可以读整个项目，但不能把 Electron 主进程拖进一次巨型同步读。
const MAX_TEXT_READ_BYTES = 2 * 1024 * 1024
const MAX_BINARY_READ_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_RESULTS = 200

const FS_READ_ROUTES = new Set([
  '/api/fs/read-dir',
  '/api/fs/read-file',
  '/api/fs/read-file-base64',
  '/api/fs/stat',
  '/api/fs/search-files',
])

export class H5Server {
  private httpServer: ReturnType<typeof createServer> | null = null
  private wsServer: WebSocketServer | null = null
  private clients: Set<WebSocket> = new Set()
  private authService: H5AuthService
  private port: number = 0
  private unsubEngineEvents: (() => void) | null = null
  private readonly pathGuard = new H5PathGuard()

  /**
   * GenUI 卡片沙箱的第二个源（票 06）。只服务 `dist/genui-sandbox` 那一份静态产物：
   * 不接 API、不接鉴权、不碰引擎网关，也不接会话数据。
   * `sandboxPort` 记下**该用**的端口，绑定失败也保留 —— 运维要知道该暴露哪一个。
   */
  private sandboxServer: SandboxStaticServer | null = null
  private sandboxPort: number = 0
  private readonly sandboxResourceRoot: string

  /** 镜像会话 — 桌面端当前活跃会话 */
  private mirrorSessionId: string | null = null
  private mirrorProjectPath: string | null = null
  private sessionMetadata: Map<string, { projectPath: string | null; title: string | null }> = new Map()

  constructor(authService: H5AuthService, sandboxResourceRoot?: string) {
    this.authService = authService
    // 与打包协议同一个锚点：app path 下的 dist/genui-sandbox。
    // 不按本模块的 __dirname 反推 —— H5 服务可能被搬进 dist-electron 的子目录，
    // 那样第二端口会在安装包里指向一个不存在的位置，而 dev 一切正常。
    this.sandboxResourceRoot = sandboxResourceRoot ?? resolveSandboxResourceRoot(app.getAppPath())
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
    this.unsubEngineEvents = EngineFactory.onRouteEvent((sessionId, eventType, data) => {
      // 转发所有引擎事件 — 客户端 chatStream store 已按 sessionId 过滤，
      // 仅处理有 turn state 的会话事件。
      // 之前的 mirror session 过滤会导致非镜像会话的事件被丢弃，
      // 造成 H5 端发消息后收不到 LLM 响应。
      this.broadcast({ type: eventType, sessionId, data })
    })

    const publicUrl = settings.publicBaseUrl
      ? `${settings.publicBaseUrl}`
      : `http://${ip}:${this.port}`

    // 第二个源起不来不影响主服务：卡片会显示可诊断的部署错误（票 06 第 5 条）
    await this.startSandboxServer(settings.sandboxPort ?? null)

    return {
      running: true,
      port: this.port,
      ip,
      publicUrl,
      connectedClients: 0,
      sandboxPort: this.sandboxPort,
      sandboxRunning: !!this.sandboxServer,
    }
  }

  /**
   * 只服务沙箱静态资源的第二个 HTTP 服务（票 06 第 1 条）。
   * 端口默认主端口 +1，可显式配置；绑定失败只记日志，不自动换端口 ——
   * 换了端口父页面的 frame-src 与运维的暴露规则就对不上了。
   */
  private async startSandboxServer(configuredPort: number | null): Promise<void> {
    const wanted = configuredPort ?? this.port + 1
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) {
      warn('H5Server', `Invalid GenUI sandbox port ${configuredPort}; second origin disabled`)
      return
    }
    this.sandboxPort = wanted

    try {
      this.sandboxServer = await startSandboxStaticServer({
        resourceRoot: this.sandboxResourceRoot,
        // 与主服务同口径：H5 要让局域网里的设备也连得上
        bindHost: '0.0.0.0',
        port: wanted,
        label: 'h5',
      })
    } catch (err) {
      warn('H5Server', `GenUI sandbox origin :${wanted} unavailable; cards will show a deployment error`, err)
      this.sandboxServer = null
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
    if (this.sandboxServer) {
      void this.sandboxServer.stop()
      this.sandboxServer = null
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
      sandboxPort: this.sandboxPort,
      sandboxRunning: !!this.sandboxServer,
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

  /**
   * 把一个项目目录登记为 H5 可读根。**只能由主进程侧调用**（h5:setMirrorSession
   * IPC）；远端通过 /api/mirror-session 或 /api/session/start 传的 cwd 一律不
   * 登记，否则持 token 者可以自己把根扩大到 `/`。
   */
  registerProjectRoot(projectPath: string | null): void {
    this.pathGuard.addRoot(projectPath)
  }

  // ──────────────────────────────────────────────────
  // HTTP 处理
  // ──────────────────────────────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    // 故意不发 Access-Control-Allow-Origin: H5 客户端与它所加载的页面同源
    // (h5ApiClient 的 baseUrl 取自 window.location)，泛域 CORS 只会在 token
    // 泄露之后把可读面放大到任意源。
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
    this.handleStatic(pathname, res, req.headers.host || '')
  }

  private handleStatic(pathname: string, res: ServerResponse, authority = ''): void {
    // 根路径 / → dist/index.html
    // /assets/* → dist/assets/*
    // 其他非文件路径 → SPA fallback to index.html
    let relativePath = pathname
    if (relativePath === '' || relativePath === '/') relativePath = '/index.html'

    // 安全区：规范化路径，防止目录遍历
    const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, '')
    // dist 目录在 asar 包内（package.json files 配置），与桌面窗口加载路径
    // (main.ts: join(__dirname, '../dist/index.html')) 保持一致。
    // 无论是开发模式还是打包模式，__dirname 都指向 dist-electron/，
    // 上一层即为 dist/。app.isPackaged + process.resourcesPath 路径
    // 指向 asar 包外，找不到 dist 目录。
    const distRoot = join(__dirname, '..', 'dist')

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
        this.serveStaticFile(indexPath, res, authority)
      } else {
        this.sendJson(res, 404, { error: 'H5 client not built. Run npm run build first.' })
      }
      return
    }

    this.serveStaticFile(filePath, res, authority)
  }

  /** HTML 文档逐响应改写 CSP，其余资源保持流式下发。 */
  private serveStaticFile(filePath: string, res: ServerResponse, authority: string): void {
    if (extname(filePath).toLowerCase() === '.html') {
      this.serveDocument(filePath, res, authority)
      return
    }
    this.serveFile(filePath, res)
  }

  /**
   * 文档响应带两份同一个策略：响应头 + 改写后的 CSP meta。
   * 浏览器会同时执行 meta 与响应头里的策略（取交集），构建产物里那条 meta 面向桌面，
   * 留着它就会把第二个源一起拦掉 —— 所以必须真的改，而不是只加头。
   */
  private serveDocument(filePath: string, res: ServerResponse, authority: string): void {
    const settings = this.authService.getSettings()
    // 第二端口没监听上就不广播它的源：卡片立刻落回"宿主未接入沙箱"，
    // 而不是先亮 5 秒空白 iframe 再换成超时（票 06 第 5 条）
    const sandboxBaseUrl = this.sandboxServer
      ? resolveH5SandboxBaseUrl({
          requestAuthority: authority,
          publicBaseUrl: settings.publicBaseUrl ?? null,
          sandboxPort: settings.sandboxPort ?? null,
          mainPort: this.port,
        })
      : null

    let html: string
    try {
      html = readFileSync(filePath, 'utf-8')
    } catch (err: any) {
      this.sendJson(res, 500, { error: err.message })
      return
    }

    // 算不出源（Host 畸形）时原样下发：那条面向桌面的 meta 至少还在，
    // 卡片落回"宿主未接入沙箱"，比下发一条指向不确定地址的 frame-src 安全。
    if (!sandboxBaseUrl) {
      this.sendHtml(res, html)
      return
    }

    const policy = renderH5Document(html, { sandboxBaseUrl, nonce: newGenuiCspNonce() })
    this.sendHtml(res, policy.html, policy.csp)
  }

  private sendHtml(res: ServerResponse, html: string, csp?: string): void {
    const body = Buffer.from(html, 'utf-8')
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-cache',
      ...(csp ? { 'Content-Security-Policy': csp } : {}),
    })
    res.end(body)
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

  /** 会话级路由统一守卫：sessionId 缺失时回 400（而非让引擎内部抛 TypeError） */
  private requireSessionId(res: ServerResponse, sessionId: string | undefined): sessionId is string {
    if (!sessionId) {
      this.sendJson(res, 400, { error: 'sessionId required' })
      return false
    }
    return true
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

    // Token 认证 — 只认 Authorization 头。查询串会进入浏览器历史、代理与访问日志、
    // Referer，而 /api/* 不存在需要它的调用方；唯一的 query token 豁免是 /ws
    // (浏览器 WebSocket 无法自定义请求头，见 handleWsConnection)。
    const authHeader = req.headers['authorization']
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

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
    const taskId = body.taskId as string | undefined

    switch (pathname) {
      case '/api/session/start': {
        this.rememberSessionMetadata(sessionId!, config)
        // 把会话状态一并回给调用方：agent 是否真的落地是启动结果的一部分 (#56)
        const status = await engineGateway.startSession(sessionId!, config)
        if (config?.cwd) {
          this.setMirrorSession(sessionId!, config.cwd)
        }
        this.sendJson(res, 200, { ok: true, status })
        return
      }

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
          const status = engineGateway.getSessionStatus(sessionId)
          if (!status?.isRunning) {
            this.sendJson(res, 409, {
              error: `Session ${sessionId} has no active process`,
              reason: 'session-not-active',
            })
            return
          }
        }
        this.pushRemoteUserMessage(
          sessionId,
          displayContent || content || '[Image]',
          clientMessageId || null,
        )
        try {
          await engineGateway.sendMessage(sessionId, content, images)
          this.sendJson(res, 200, { ok: true })
        } catch (err) {
          this.pushEngineError(sessionId, err)
          throw err
        }
        return

      case '/api/session/abort':
        await engineGateway.abort(sessionId!)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/stop':
        await engineGateway.stop(sessionId!)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/permission/allow':
        await engineGateway.allowPermission(
          sessionId!,
          requestId!,
          body.updatedInput as Record<string, unknown> | undefined,
          body.decisionClassification as 'user_temporary' | 'user_permanent' | undefined,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/permission/deny':
        await engineGateway.denyPermission(
          sessionId!,
          requestId!,
          body.message as string | undefined,
          body.options as { interrupt?: boolean } | undefined,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/tool-answer':
        await engineGateway.submitToolAnswer(
          sessionId!,
          toolCallId!,
          body.answers as Record<string, string>,
        )
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/tool-skip':
        await engineGateway.skipToolAnswer(sessionId!, toolCallId!)
        this.sendJson(res, 200, { ok: true })
        return

      // pi 扩展对话框的应答。抛错时交给 handleApi 那层的 catch 回 5xx ——
      // H5 端要的是这次点击失败了的信号，好把卡片退回可重试态 (#54)。
      case '/api/session/extension-dialog/respond': {
        if (!this.requireSessionId(res, sessionId)) return
        const dialogId = body.dialogId as string | undefined
        if (!dialogId) {
          this.sendJson(res, 400, { error: 'dialogId required' })
          return
        }
        engineGateway.respondExtensionDialog(sessionId, dialogId, body.answer as ExtensionDialogAnswer)
        this.sendJson(res, 200, { ok: true })
        return
      }

      // ── 挂起 / 恢复 ──
      // H5 端与桌面端共用同一进程池：挂起会释放 CLI 进程，恢复会重新拉起。
      case '/api/session/suspend':
        if (!this.requireSessionId(res, sessionId)) return
        engineGateway.suspendSession(sessionId)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/resume':
        if (!this.requireSessionId(res, sessionId)) return
        this.sendJson(res, 200, { status: await engineGateway.resumeSession(sessionId) })
        return

      // ── 权限模式 / 模型 / 思考等级 ──
      case '/api/session/permission-mode':
        if (!this.requireSessionId(res, sessionId)) return
        await engineGateway.setPermissionMode(sessionId, body.mode as PermissionMode)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/model':
        if (!this.requireSessionId(res, sessionId)) return
        await engineGateway.setModel(sessionId, body.model as string | undefined)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/thinking-level':
        if (!this.requireSessionId(res, sessionId)) return
        // timing 要带回：渲染层靠它决定提示，失败则原样抛给外层 catch 出 500（不能回 ok:true）。
        this.sendJson(res, 200, { ok: true, timing: await engineGateway.updateThinkingLevel(sessionId, Boolean(body.enabled)) })
        return

      case '/api/session/effort-level': {
        if (!this.requireSessionId(res, sessionId)) return
        // 浏览器提交的是任意字符串，而 CLI 对认不出的档位只 warn 后退默认、照样成功：
        // 不在这里挡住，界面就会显示一个从未生效过的档位。
        if (!isEffortLevel(body.level)) {
          this.sendJson(res, 400, { error: `Unsupported effort level: ${String(body.level)}` })
          return
        }
        this.sendJson(res, 200, { ok: true, timing: await engineGateway.updateEffortLevel(sessionId, body.level) })
        return
      }

      // ── 查询 ──
      case '/api/session/mcp-status':
        if (!this.requireSessionId(res, sessionId)) return
        this.sendJson(res, 200, await engineGateway.getMcpStatus(sessionId))
        return

      case '/api/session/context-usage':
        if (!this.requireSessionId(res, sessionId)) return
        this.sendJson(res, 200, await engineGateway.getContextUsage(sessionId))
        return

      case '/api/session/settings':
        if (!this.requireSessionId(res, sessionId)) return
        this.sendJson(res, 200, await engineGateway.getSettings(sessionId))
        return

      case '/api/session/pending-permissions':
        if (!this.requireSessionId(res, sessionId)) return
        this.sendJson(res, 200, engineGateway.getPendingPermissionRequestIds(sessionId))
        return

      case '/api/session/task-stop':
        if (!this.requireSessionId(res, sessionId)) return
        if (!taskId) {
          this.sendJson(res, 400, { error: 'taskId required' })
          return
        }
        await engineGateway.stopEngineTask(sessionId, taskId)
        this.sendJson(res, 200, { ok: true })
        return

      case '/api/session/agent-transcript':
        if (!this.requireSessionId(res, sessionId)) return
        if (!body.agentId) {
          this.sendJson(res, 400, { error: 'agentId required' })
          return
        }
        try {
          this.sendJson(res, 200, SessionHistoryManager.getAgentTranscriptPath(
            (body.projectPath as string) || this.mirrorProjectPath || '',
            sessionId,
            body.agentId as string,
          ))
        } catch (err) {
          warn('H5Server', `getAgentTranscriptPath failed | sessionId=${sessionId.slice(0, 8)} | error=${err}`)
          this.sendJson(res, 200, null)
        }
        return

      case '/api/session/agent-transcript-by-tool-use':
        if (!this.requireSessionId(res, sessionId)) return
        if (!body.toolUseId) {
          this.sendJson(res, 400, { error: 'toolUseId required' })
          return
        }
        try {
          this.sendJson(res, 200, SessionHistoryManager.findAgentTranscriptByToolUse(
            (body.projectPath as string) || this.mirrorProjectPath || '',
            sessionId,
            body.toolUseId as string,
          ))
        } catch (err) {
          warn('H5Server', `findAgentTranscriptByToolUse failed | sessionId=${sessionId.slice(0, 8)} | error=${err}`)
          this.sendJson(res, 200, null)
        }
        return

      // ── Agent / 引擎能力 ──
      case '/api/agents/list':
        this.sendJson(res, 200, await engineGateway.listAgents(
          body.cwd as string | undefined,
          body.engineType as EngineType | undefined,
        ))
        return

      case '/api/engine/available':
        if (!body.engineType) {
          this.sendJson(res, 400, { error: 'engineType required' })
          return
        }
        // 与桌面端 IPC 同口径：把「为什么不可用」和真正会跑的版本一起给出去，
        // 移动端才不至于在版本不达标时还把 Pi 当可选项 (#52)
        this.sendJson(res, 200, await EngineFactory.getEngineAvailability(body.engineType as EngineType))
        return

      case '/api/session/status':
        if (sessionId) {
          this.sendJson(res, 200, engineGateway.getSessionStatus(sessionId))
        } else {
          this.sendJson(res, 400, { error: 'sessionId required' })
        }
        return

      case '/api/sessions/active':
        this.sendJson(res, 200, engineGateway.getActiveSessions())
        return

      case '/api/sessions/list':
        const projectPath = url.searchParams.get('projectPath') || (body.projectPath as string)
        if (!projectPath) {
          this.sendJson(res, 400, { error: 'projectPath required' })
          return
        }
        const sessions = await SessionHistoryManager.listProjectSessions(projectPath)
        const mapped = sessions.map(s => ({
          ...s,
          title: SessionHistoryManager.getSessionTitle(s),
          displayTime: SessionHistoryManager.formatTimestamp(s.lastMessageTimestamp),
        }))
        this.sendJson(res, 200, mapped)
        return

      case '/api/sessions/history':
        const hp = url.searchParams.get('projectPath') || (body.projectPath as string)
        const hs = url.searchParams.get('sessionId') || (body.sessionId as string)
        if (!hp || !hs) {
          this.sendJson(res, 400, { error: 'projectPath and sessionId required' })
          return
        }
        const history = await SessionHistoryManager.getFullSession(hp, hs)
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
      case '/api/fs/read-file':
      case '/api/fs/read-file-base64':
      case '/api/fs/stat':
      case '/api/fs/search-files':
        this.handleFsRoute(res, pathname, body)
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
    // 读取 ~/.claude/gui-settings.json —— 这份文件装着模型提供商的 apiKey，
    // 所以外发前必须剥掉凭据字段；解析不动它的文件就一律不发。
    let guiSettings: string | null = null
    try {
      const settingsPath = join(app.getPath('home'), '.claude', 'gui-settings.json')
      if (existsSync(settingsPath)) {
        guiSettings = redactSecretsInJson(readFileSync(settingsPath, 'utf-8'))
      }
    } catch (err) {
      warn('H5Server', `Failed to read gui-settings.json: ${err}`)
    }

    return {
      guiSettings,
      mirrorSessionId: this.mirrorSessionId,
      mirrorProjectPath: this.mirrorProjectPath,
      activeSessions: engineGateway.getActiveSessions().map(s => ({
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

  /**
   * `/api/fs/*` 唯一的入口闸门：路径必须先落在桌面端登记过的项目根之内，
   * 才交给具体的读取实现。
   */
  private handleFsRoute(
    res: ServerResponse,
    pathname: string,
    body: Record<string, unknown>,
  ): void {
    if (!FS_READ_ROUTES.has(pathname)) {
      this.sendJson(res, 404, { error: `Unknown API: ${pathname}` })
      return
    }

    const rawPath = body.path
    if (typeof rawPath !== 'string' || rawPath === '') {
      // 没有可读路径：保持各路由既有的「空结果」契约，不判越权，也不碰磁盘。
      const listRoute = pathname === '/api/fs/read-dir' || pathname === '/api/fs/search-files'
      this.sendJson(res, 200, listRoute ? [] : null)
      return
    }

    const decision = this.pathGuard.check(rawPath)
    if (!decision.allowed) {
      warn('H5Server', `fs route blocked | route=${pathname} | reason=${decision.reason} | path=${rawPath}`)
      this.sendJson(res, 403, { error: 'Path is outside the registered project roots' })
      return
    }

    // 读取时沿用调用方给的原串：越权判定已经按 realpath 校过，保留原写法才能让
    // 客户端收到的路径与它自己发出去的一致（软链、macOS 的 /var → /private/var）。
    switch (pathname) {
      case '/api/fs/read-dir':
        this.sendJson(res, 200, this.readDir(rawPath))
        return
      case '/api/fs/read-file':
        this.sendJson(res, 200, this.readTextFile(rawPath))
        return
      case '/api/fs/read-file-base64':
        this.sendJson(res, 200, this.readFileAsBase64(rawPath))
        return
      case '/api/fs/stat':
        this.sendJson(res, 200, this.statFile(rawPath))
        return
      case '/api/fs/search-files':
        this.sendJson(res, 200, this.searchFiles(
          rawPath,
          body.query as string,
          body.options as { maxResults?: number } | undefined,
        ))
        return
      default:
        this.sendJson(res, 404, { error: `Unknown API: ${pathname}` })
    }
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
      if (statSync(filePath).size > MAX_TEXT_READ_BYTES) {
        warn('H5Server', `readTextFile refused, oversized | path=${filePath}`)
        return null
      }
      return readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  private readFileAsBase64(filePath: string): string | null {
    if (!filePath || typeof filePath !== 'string') return null
    try {
      if (statSync(filePath).size > MAX_BINARY_READ_BYTES) {
        warn('H5Server', `readFileAsBase64 refused, oversized | path=${filePath}`)
        return null
      }
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
      const maxResults = Math.min(options?.maxResults || 100, MAX_SEARCH_RESULTS)
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
        win.webContents.send(CLAUDE_CODE_EVENTS.onUser, { sessionId, data: payload })
      }
    }
  }

  private pushEngineError(sessionId: string, err: unknown): void {
    // 拦截类错误带完整结构化 payload（issue #55）；其余错误沿用 message。
    const attached = (err as { engineBlocked?: unknown } | null)?.engineBlocked
    const payload = isEngineBlockedPayload(attached)
      ? attached
      : { message: err instanceof Error ? err.message : String(err) }

    this.broadcast({ type: 'error', sessionId, data: payload })

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(CLAUDE_CODE_EVENTS.onError, { sessionId, data: payload })
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
    if (!(await isAllowedFetchUrlAfterResolution(targetUrl))) {
      warn('H5Server', `http fetch blocked internal/private URL | url=${targetUrl}`)
      return { ok: false, status: 0, error: 'URL is not allowed' }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const response = await net.fetch(targetUrl, {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body || undefined,
        signal: controller.signal,
        // 重定向会把一个刚通过校验的公网 URL 变成内网一跳，因此不跟随。
        redirect: 'manual',
      })
      clearTimeout(timeout)

      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        warn('H5Server', `http fetch blocked redirect | url=${targetUrl} | status=${response.status}`)
        return { ok: false, status: 0, error: 'Redirects are not allowed' }
      }

      const text = await response.text()
      debug('H5Server', `http fetch response | status=${response.status} elapsed=${Date.now() - start}ms bodyLen=${text.length}`)
      return { ok: response.ok, status: response.status, data: text }
    } catch (err: any) {
      const errorMsg = err?.name === 'AbortError'
        ? `Request timed out (${Math.round(timeoutMs / 1000)}s)`
        // redirect:'manual' 在 Electron 43 实测是直接抛错（"Redirect was cancelled"），
        // 不会返回 3xx；上面的状态码分支是留给其他实现的纵深防御。
        : /redirect/i.test(String(err?.message ?? err))
          ? 'Redirects are not allowed'
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
    // 浏览器建 WebSocket 时无法带自定义请求头，所以 /ws 是 query token 的唯一豁免；
    // 它只在这条路径上被接受，/api/* 一律只认 Authorization 头。
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
