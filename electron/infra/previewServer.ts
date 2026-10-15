/**
 * PreviewServer — 轻量级本地 HTTP 服务器，用于在内置 webview 中预览 HTML 产物。
 *
 * 背景：直接用 file:// 协议加载 HTML 时，ES Module (`<script type="module">`)
 * 会因 CORS 策略被浏览器静默拒绝，导致页面 JS 不执行 — 表现为"能看到页面但无法交互"。
 * 通过本地 HTTP 服务器提供文件，可完全模拟真实浏览器行为。
 *
 * 设计：
 *  - 单例，随 app.whenReady 启动，app 退出时关闭
 *  - 自动分配空闲端口（port 0 → OS 分配）
 *  - 仅服务 HTML/CSS/JS/图片等静态资源，不做目录列表
 *
 * 安全边界（服务器监听 127.0.0.1，同机任意进程都能连上，所以 URL 本身就是能力凭证）：
 *  - 只有 toPreviewUrl 登记过的预览工作区可被读取；URL 首段是一次性随机 token，
 *    未登记的绝对路径请求一律 404，不再退化成"知道端口就能读本机文件"。
 *  - 边界判定用 realpath：词法 resolve 拦 `..`，realpath 拦符号链接逃逸。
 *  - 故意不发 Access-Control-Allow-Origin：预览页在 webview 里是顶层文档，
 *    它的子资源与自身同源，无需泛域 CORS；放开 `*` 只会把可读面扩大到任意源。
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, resolve, dirname, relative, sep } from 'path'
import { randomBytes } from 'crypto'
import { ipcMain } from 'electron'
import { info, warn, error, debug } from './logger'
import { canonicalize, compareForm, inside, isFileSystemRoot } from './pathBoundary'

/** 非法百分号编码不当作错误，按字面段处理 — 后续边界检查才是权威闸门。 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
}

type RejectReason = 'no-grant' | 'missing' | 'lexical' | 'symlink' | 'listing'

/** 无凭证的路径与不存在的路径同码：服务不能当成本机文件探测的 oracle。 */
const REJECT_STATUS: Record<RejectReason, 403 | 404> = {
  'no-grant': 404,
  missing: 404,
  lexical: 403,
  symlink: 403,
  listing: 403,
}

type ServeDecision = { serve: string } | { reject: RejectReason; target?: string }

export class PreviewServer {
  private server: Server | null = null
  private port: number = 0
  /** token → 已登记的预览工作区根目录（realpath 后的绝对路径） */
  private readonly grants = new Map<string, string>()

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
   * 将本地文件路径转换为预览服务器 URL，同时把该文件所属的预览工作区登记为可读根。
   * 登记范围尽量收窄：workspaceRoot 确实包含该文件时用该根（同工作区内的相对
   * 引用可用），否则只到文件所在目录；文件系统根拒绝登记。
   * 服务器尚未启动或无法安全登记时返回 null — 调用方回退 file:// 协议。
   */
  toPreviewUrl(filePath: string, workspaceRoot?: string): string | null {
    if (!this.port) return null

    const target = canonicalize(resolve(filePath))
    const root = this.pickGrantRoot(target, workspaceRoot)
    if (!root) return null

    const token = this.tokenForRoot(root)
    // 保留目录层级，浏览器里 index.html 的相对子资源才能同源命中同一工作区
    const rel = relative(root, target).split(sep).map(encodeURIComponent).join('/')
    return `http://127.0.0.1:${this.port}/${token}/${rel}`
  }

  private pickGrantRoot(target: string, workspaceRoot?: string): string | null {
    const workspace = workspaceRoot?.trim() ? canonicalize(resolve(workspaceRoot)) : null
    const fileDir = dirname(target)
    const root = workspace && inside(target, workspace) ? workspace : fileDir
    if (isFileSystemRoot(root)) {
      // 宽到文件系统根等于放开整盘 — 退到文件所在目录，那已是最窄可用范围
      return isFileSystemRoot(fileDir) ? null : fileDir
    }
    return root
  }

  private tokenForRoot(root: string): string {
    const wanted = compareForm(root)
    for (const [token, granted] of this.grants) {
      if (compareForm(granted) === wanted) return token
    }
    const token = randomBytes(16).toString('hex')
    this.grants.set(token, root)
    return token
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      const [token, ...segments] = (req.url?.split('?')[0] || '/').slice(1).split('/')
      const root = token ? this.grants.get(token) : undefined
      const decision: ServeDecision = root
        ? this.authorize(root, segments.map(decodeSegment).join(sep))
        : { reject: 'no-grant' }

      if ('reject' in decision) {
        this.reject(res, decision, req.url)
        return
      }

      debug('PreviewServer', `Request: ${req.url} → ${decision.serve}`)
      this.serveFile(decision.serve, res)
    } catch (err) {
      error('PreviewServer', 'Request handling error', err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  }

  /**
   * 两段闸门：词法 resolve 先拦掉 `..` 与绝对路径段（不碰文件系统），
   * realpath 再判一次 —— 符号链接按目标计算，链接指向工作区外即拒。
   * 目录的 index.html 也要整条走一遍，否则"链接出去的 index.html"会被直接服务。
   */
  private authorize(root: string, rel: string): ServeDecision {
    const candidate = resolve(root, rel)
    if (!inside(candidate, root)) {
      return { reject: 'lexical', target: candidate }
    }
    if (!existsSync(candidate)) return { reject: 'missing', target: candidate }

    const real = canonicalize(candidate)
    if (!inside(real, root)) {
      return { reject: 'symlink', target: candidate }
    }
    if (!statSync(real).isDirectory()) return { serve: real }

    const indexFile = join(real, 'index.html')
    if (!existsSync(indexFile)) return { reject: 'listing', target: candidate }
    const realIndex = canonicalize(indexFile)
    if (!inside(realIndex, root)) {
      return { reject: 'symlink', target: indexFile }
    }
    return { serve: realIndex }
  }

  private reject(
    res: ServerResponse,
    decision: { reject: RejectReason; target?: string },
    url: string | undefined,
  ) {
    const status = REJECT_STATUS[decision.reject]
    warn('PreviewServer', `Rejected ${decision.reject}: ${decision.target ?? url ?? '/'}`)
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(status === 403 ? '403 Forbidden' : '404 Not Found')
  }

  private serveFile(filePath: string, res: ServerResponse) {
    try {
      const ext = extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'application/octet-stream'

      const data = readFileSync(filePath)

      // 故意不发 Access-Control-Allow-Origin：预览页是 webview 里的顶层文档，
      // 子资源与自身同源。Referer 也不能把 URL 里的凭证带给预览页拉起的第三方。
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        'Referrer-Policy': 'no-referrer',
      })
      res.end(data)
    } catch (err) {
      error('PreviewServer', `Failed to serve file: ${filePath}`, err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  }
}

// 单例
export const previewServer = new PreviewServer()

/**
 * 注册 IPC 处理器 — 渲染进程通过此接口获取预览 URL。
 * 必须在 app.whenReady() 之后调用。
 */
export function registerPreviewServerIPCHandlers() {
  ipcMain.handle(
    'preview:getUrl',
    async (_event, filePath: string, workspaceRoot?: string) => {
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
      const url = previewServer.toPreviewUrl(
        filePath,
        typeof workspaceRoot === 'string' ? workspaceRoot : undefined,
      )
      debug('PreviewServer', `getUrl: ${filePath} → ${url}`)
      return url
    },
  )
}

/** 清理 — 在 app 退出时调用 */
export function cleanupPreviewServer() {
  previewServer.stop()
}
