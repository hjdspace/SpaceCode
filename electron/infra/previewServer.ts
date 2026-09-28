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
 *  - 路径安全：normalize + resolve 防止路径穿越
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname, normalize, resolve } from 'path'
import { ipcMain } from 'electron'
import { info, warn, error, debug } from './logger'

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

class PreviewServer {
  private server: Server | null = null
  private port: number = 0

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
      info('PreviewServer', 'Stopped')
    }
  }

  /** 当前监听端口（未启动时为 0） */
  getPort(): number {
    return this.port
  }

  /**
   * 将本地文件路径转换为预览服务器 URL。
   * 如果服务器尚未启动，返回 null。
   */
  toPreviewUrl(filePath: string): string | null {
    if (!this.port) return null
    const normalized = filePath.replace(/\\/g, '/')
    // 将路径编码为 URL 段，保留目录结构以便相对路径引用正常工作
    const encoded = encodeURIComponent(normalized).replace(/%2F/gi, '/')
    return `http://127.0.0.1:${this.port}/${encoded}`
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      // 解码 URL pathname（去掉前导 /）
      const urlPath = decodeURIComponent(req.url?.split('?')[0] || '/')
      // 去掉前导 / 得到文件路径
      const rawPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath

      // 规范化路径，防止路径穿越
      const filePath = normalize(rawPath)
      const resolved = resolve(filePath)

      debug('PreviewServer', `Request: ${req.url} → ${resolved}`)

      if (!existsSync(resolved)) {
        warn('PreviewServer', `File not found: ${resolved}`)
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('404 Not Found')
        return
      }

      const stat = statSync(resolved)
      if (stat.isDirectory()) {
        // 目录 → 尝试 index.html
        const indexFile = join(resolved, 'index.html')
        if (existsSync(indexFile)) {
          this.serveFile(indexFile, res)
        } else {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('403 Directory listing not allowed')
        }
        return
      }

      this.serveFile(resolved, res)
    } catch (err) {
      error('PreviewServer', 'Request handling error', err)
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  }

  private serveFile(filePath: string, res: ServerResponse) {
    try {
      const ext = extname(filePath).toLowerCase()
      const mime = MIME[ext] || 'application/octet-stream'

      const data = readFileSync(filePath)

      // 允许跨域读取（webview 同源策略需要）
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
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
  ipcMain.handle('preview:getUrl', async (_event, filePath: string) => {
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
  })
}

/** 清理 — 在 app 退出时调用 */
export function cleanupPreviewServer() {
  previewServer.stop()
}
