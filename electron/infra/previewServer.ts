/**
 * PreviewServer — 轻量级本地 HTTP 服务器，用于在内置 webview 中预览 HTML 产物。
 *
 * 背景：直接用 file:// 协议加载 HTML 时，ES Module (`<script type="module">`)
 * 会因 CORS 策略被浏览器静默拒绝，导致页面 JS 不执行 — 表现为"能看到页面但无法交互"。
 * 通过本地 HTTP 服务器提供文件，可完全模拟真实浏览器行为。
 *
 * 注意：设计模式的**预览 iframe** 不再走这个端口 —— 宿主 CSP 的 `frame-src` 无法
 * 放行随机端口，预览改由 `spacecode-preview://` 协议承载（见 `previewProtocol.ts`）。
 * 这里的 HTTP 服务保留给顶层 webview（不受 `frame-src` 约束）。
 *
 * 设计：
 *  - 单例，随 app.whenReady 启动，app 退出时关闭
 *  - 自动分配空闲端口（port 0 → OS 分配）
 *  - 仅服务白名单静态资源，不做目录列表
 *
 * 安全边界（服务器监听 127.0.0.1，同机任意进程都能连上，所以 URL 本身就是能力凭证）：
 *  - 只有登记过的产物目录可被读取；URL 首段是一次性随机 token，
 *    未登记的绝对路径请求一律 404，不再退化成"知道端口就能读本机文件"。
 *  - 边界判定与 MIME 白名单在 `previewGrants.ts`，与自定义协议共用。
 *  - 故意不发 Access-Control-Allow-Origin：预览页在 webview 里是顶层文档，
 *    它的子资源与自身同源，无需泛域 CORS；放开 `*` 只会把可读面扩大到任意源。
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { readFileSync } from 'fs'
import { sep } from 'path'
import { ipcMain } from 'electron'
import { info, warn, error, debug } from './logger'
import {
  PreviewGrants,
  REJECT_STATUS,
  decodeSegment,
  previewGrants,
  type ServeDecision,
} from './previewGrants'
import { buildPreviewFrameUrl } from '@/shared/previewOrigin'

export class PreviewServer {
  private server: Server | null = null
  private port: number = 0

  constructor(private readonly grants: PreviewGrants = new PreviewGrants()) {}

  /**
   * 启动预览服务器。可安全地重复调用 — 已启动时直接返回端口。
   */
  start(): Promise<number> {
    if (this.server) return Promise.resolve(this.port)

    return new Promise((resolvePort, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res))

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        error('PreviewServer', 'Server error', err)
        reject(err)
      })

      // port 0 → OS 自动分配空闲端口
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        info('PreviewServer', `Listening on http://127.0.0.1:${this.port}`)
        resolvePort(this.port)
      })
    })
  }

  /** 停止服务器 */
  stop() {
    if (this.server) {
      this.server.close()
      this.server = null
      this.port = 0
      // OS 可能把同一个端口发还给下一次 start()，不留旧凭证
      this.grants.clear()
      info('PreviewServer', 'Stopped')
    }
  }

  /** 当前监听端口（未启动时为 0） */
  getPort(): number {
    return this.port
  }

  /**
   * 将本地文件路径转换为 HTTP 预览 URL（webview 用）。
   * 服务器尚未启动或无法安全登记时返回 null。
   */
  toPreviewUrl(filePath: string): string | null {
    if (!this.port) return null

    const grant = this.grants.register(filePath)
    if (!grant) return null

    return `http://127.0.0.1:${this.port}/${grant.token}/${grant.rel}`
  }

  /**
   * 将本地文件路径转换为设计预览 iframe 的专用源 URL。
   * 不依赖 HTTP 端口：失败原因只有"无法安全登记"。
   */
  toFrameUrl(filePath: string): string | null {
    const grant = this.grants.register(filePath)
    if (!grant) return null
    return buildPreviewFrameUrl(grant.token, grant.rel)
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      const [token, ...segments] = (req.url?.split('?')[0] || '/').slice(1).split('/')
      const root = token ? this.grants.rootFor(token) : undefined
      const decision: ServeDecision = root
        ? this.grants.authorize(root, segments.map(decodeSegment).join(sep))
        : { reject: 'no-grant' }

      if ('reject' in decision) {
        this.reject(res, decision, req.url)
        return
      }

      debug('PreviewServer', `Request: ${req.url} → ${decision.serve}`)
      this.serveFile(decision.serve, decision.contentType, res)
    } catch (err) {
      error('PreviewServer', 'Request handling error', err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  }

  private reject(
    res: ServerResponse,
    decision: { reject: keyof typeof REJECT_STATUS; target?: string },
    url: string | undefined,
  ) {
    const status = REJECT_STATUS[decision.reject]
    warn('PreviewServer', `Rejected ${decision.reject}: ${decision.target ?? url ?? '/'}`)
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(status === 403 ? '403 Forbidden' : '404 Not Found')
  }

  private serveFile(filePath: string, contentType: string, res: ServerResponse) {
    try {
      const data = readFileSync(filePath)

      // 故意不发 Access-Control-Allow-Origin：预览页是 webview 里的顶层文档，
      // 子资源与自身同源。Referer 也不能把 URL 里的凭证带给预览页拉起的第三方。
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(data)
    } catch (err) {
      error('PreviewServer', `Failed to serve file: ${filePath}`, err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  }
}

// 单例：HTTP 服务与自定义协议共用同一份 grant 登记
export const previewServer = new PreviewServer(previewGrants)

/**
 * 注册 IPC 处理器 — 渲染进程通过这两个接口获取预览 URL。
 * 必须在 app.whenReady() 之后调用。
 */
export function registerPreviewServerIPCHandlers() {
  ipcMain.handle(
    'preview:getUrl',
    async (_event, filePath: string) => {
      if (typeof filePath !== 'string' || filePath.trim() === '') return null
      // 确保服务器已启动
      if (!previewServer.getPort()) {
        try {
          await previewServer.start()
        } catch (err) {
          error('PreviewServer', 'Failed to start server', err)
          return null
        }
      }
      const url = previewServer.toPreviewUrl(filePath)
      debug('PreviewServer', `getUrl: ${filePath} → ${url}`)
      return url
    },
  )

  ipcMain.handle(
    'preview:getFrameUrl',
    async (_event, filePath: string) => {
      if (typeof filePath !== 'string' || filePath.trim() === '') return null
      const url = previewServer.toFrameUrl(filePath)
      debug('PreviewServer', `getFrameUrl: ${filePath} → ${url}`)
      return url
    },
  )
}

/** 清理 — 在 app 退出时调用 */
export function cleanupPreviewServer() {
  previewServer.stop()
}
