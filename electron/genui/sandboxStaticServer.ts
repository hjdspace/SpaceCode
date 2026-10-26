/**
 * 沙箱静态资源的 HTTP 承载服务（ADR 0015 第 2 条：跨 origin / 跨 site 才能拿到隔离）。
 *
 * 两个宿主共用这一条服务，只有绑哪块网卡与哪个端口不同：
 *   - 桌面开发期：绑回环，主机名与端口都跟主窗口（`127.0.0.1:5173`）不同，换 site 才换得出
 *     OOPIF 进程隔离；
 *   - H5（票 06）：绑局域网网卡，端口取主服务端口 +1，浏览器从另一台机器访问时才拿得到第二个源。
 *
 * 文件闸门、MIME 与 CSP 全部复用打包环境同一套（`sandboxFiles`），于是
 * "开发能看到的东西打包后读不到"这类分裂不会发生。
 *
 * 只读静态资源：不暴露 API、不读引擎、不碰会话数据、不做目录列举。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { info } from '../infra/logger'
import { resolveSandboxFile, sandboxResponse } from './sandboxFiles'

export type SandboxStaticServer = { port: number; stop: () => Promise<void> }

/**
 * 桌面开发期的沙箱主机该不该起 —— 打包态一律不起（票 09 第 2 条）。
 *
 * 这条服务只为「开发期的桌面窗口」存在：它多开一个本机端口，而打包环境的沙箱资源由
 * `spacecode-genui://` 协议提供。判据留成可注入的纯函数，是因为主进程产物里 Rollup 不会
 * 把运行时检查折掉 —— 「装好的应用不会监听这个端口」这件事必须能被测试钉住，
 * 而不是靠"看起来在 if (isDev) 里"。H5 的第二端口不走这条判断（那是生产功能）。
 */
export function shouldStartDesktopSandboxHost(origin: { isPackaged: boolean; nodeEnv?: string }): boolean {
  return origin.nodeEnv !== 'production' && !origin.isPackaged
}

export type SandboxStaticServerOptions = {
  resourceRoot: string
  /** 监听地址。桌面开发绑回环，H5 要绑 `0.0.0.0` 才让局域网里的手机连得上。 */
  bindHost: string
  /** `0` = 由系统分配；H5 传主服务端口 +1。 */
  port: number
  /** 日志里认得出的宿主名，两个实例同时开着时不再互相冒充。 */
  label: string
}

/** URL 里用的占位 origin，只为把请求目标解析成一个 pathname。 */
const PARSE_BASE = 'http://sandbox.local'

export async function startSandboxStaticServer(
  options: SandboxStaticServerOptions,
): Promise<SandboxStaticServer> {
  const httpServer: Server = createServer((req, res) => {
    void handleRequest(req, res, options.resourceRoot)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    // 端口被占不自动漂移：漂移了宿主就不知道去哪儿找沙箱，卡片只会变成空白
    httpServer.once('error', rejectListen)
    httpServer.listen(options.port, options.bindHost, () => {
      httpServer.removeListener('error', rejectListen)
      resolveListen()
    })
  })

  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  info('GenUISandbox', `${options.label} hosting on ${options.bindHost}:${port} from ${options.resourceRoot}`)

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
    pathname = new URL(req.url ?? '/', PARSE_BASE).pathname
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

  const response = sandboxResponse(decision.contentType, body)
  if (method === 'HEAD') {
    res.writeHead(200, response.headers)
    res.end()
    return
  }
  res.writeHead(200, response.headers)
  res.end(response.body)
}
