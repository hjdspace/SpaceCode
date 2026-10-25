/**
 * 开发环境的沙箱承载服务（ADR 0015 第 2 条：独立主机名 + 独立端口）。
 *
 * 主窗口是 `http://127.0.0.1:5173`，这里只服务 `dist/genui-sandbox` 里的静态产物，
 * 监听在 `http://localhost:5174` —— 主机名与端口同时变化才换 site，卡片才拿得到
 * OOPIF 进程隔离。文件闸门、MIME 与 CSP 全部复用打包环境同一套（`sandboxFiles`），
 * 于是"开发能看到的东西打包后读不到"这类分裂不会发生。
 *
 * 只读静态资源：不暴露 API、不读引擎、不碰会话数据。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { info } from '../infra/logger'
import { GENUI_SANDBOX_DEV_HOST, GENUI_SANDBOX_DEV_PORT } from '@/shared/genuiSandbox'
import { resolveSandboxFile, sandboxResponseHeaders } from './sandboxFiles'

export type GenuiSandboxDevServer = { port: number; stop: () => Promise<void> }

/**
 * 绑定的网卡。URL 里用的是 `localhost` 这个主机名（换主机名才换 site），
 * 而监听地址与主机名是两件事：绑 IPv4 回环即可，Chromium 会把 `localhost`
 * 解析并回落到 127.0.0.1（实测）。
 */
const BIND_HOST = '127.0.0.1'

export async function startGenuiSandboxDevServer(options: {
  resourceRoot: string
  bindHost?: string
  port?: number
}): Promise<GenuiSandboxDevServer> {
  const bindHost = options.bindHost ?? BIND_HOST
  const wantedPort = options.port ?? GENUI_SANDBOX_DEV_PORT

  const httpServer: Server = createServer((req, res) => {
    void handleRequest(req, res, options.resourceRoot)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    // 端口被占不自动漂移：漂移了宿主就不知道去哪儿找沙箱，卡片只会变成空白
    httpServer.once('error', rejectListen)
    httpServer.listen(wantedPort, bindHost, () => {
      httpServer.removeListener('error', rejectListen)
      resolveListen()
    })
  })

  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : wantedPort
  info('GenUISandbox', `Dev sandbox hosting ${GENUI_SANDBOX_DEV_HOST}:${port} from ${options.resourceRoot}`)

  return {
    port,
    stop: () =>
      new Promise<void>((resolveClose) => {
        httpServer.close(() => resolveClose())
      }),
  }
}

async function handleRequest(
  req: Pick<IncomingMessage, 'method' | 'url'>,
  res: ServerResponse,
  resourceRoot: string,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  let pathname = '/'
  try {
    pathname = new URL(req.url ?? '/', 'http://sandbox.local').pathname
  } catch {
    res.writeHead(400)
    res.end()
    return
  }

  const decision = resolveSandboxFile({ resourceRoot, pathname })
  if (!decision.ok) {
    res.writeHead(decision.status)
    res.end()
    return
  }

  let body: Buffer
  try {
    body = await readFile(decision.filePath)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }

  if (method === 'HEAD') {
    res.writeHead(200, sandboxResponseHeaders(decision.contentType))
    res.end()
    return
  }
  res.writeHead(200, sandboxResponseHeaders(decision.contentType))
  res.end(body)
}
