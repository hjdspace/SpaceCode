/**
 * 打包环境的沙箱资源协议 `spacecode-genui://`（ADR 0015 第 2 条）。
 *
 * 必须在 app ready **之前**把协议注册为 standard + secure，ready 之后才挂处理器。
 * 处理器不碰 electron API（只有 `registerGenuiSandbox*` 两个入口碰），于是文件闸门
 * 可以脱离 Electron 进程单测；开发期的静态服务复用同一个 `resolveSandboxFile`。
 */
import { protocol } from 'electron'
import { readFileSync } from 'fs'
import { GENUI_SANDBOX_HOST, GENUI_SANDBOX_SCHEME } from '@/shared/genuiSandbox'
import { resolveSandboxFile, sandboxResponse } from './sandboxFiles'

/** 处理器真正读到的字段，注入资源根后可脱离 Electron 测试。 */
export type SandboxRequestLike = { url: string; method?: string }

/**
 * 最小权限：只把它当安全源与 standard scheme 用。
 * 不放 `corsEnabled`/`supportFetchAPI` — 卡片文档是 opaque origin，一旦放行就等于
 * 让任意页面能跨源读取沙箱资源；经典脚本不需要 CORS 也能加载。
 */
const SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  stream: true,
  supportFetchAPI: false,
  corsEnabled: false,
  allowServiceWorkers: false,
  bypassCSP: false,
}

/** 在 app ready 之前调用；ready 之后调用会直接被 Electron 拒绝。 */
export function registerGenuiSandboxScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: GENUI_SANDBOX_SCHEME, privileges: SCHEME_PRIVILEGES }])
}

export function registerGenuiSandboxProtocol(options: { resourceRoot: string }): void {
  protocol.handle(GENUI_SANDBOX_SCHEME, createSandboxRequestHandler(options))
}

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers })
}

export function createSandboxRequestHandler(
  options: { resourceRoot: string; scheme?: string; host?: string },
): (request: SandboxRequestLike) => Promise<Response> {
  const { resourceRoot, scheme = GENUI_SANDBOX_SCHEME, host = GENUI_SANDBOX_HOST } = options

  return async (request: SandboxRequestLike): Promise<Response> => {
    const method = (request.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      return emptyResponse(405, { Allow: 'GET, HEAD' })
    }

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return emptyResponse(400)
    }
    // 只服务本沙箱源；其他 host 会串出另一个 origin 的身份
    if (url.protocol !== `${scheme}:` || url.host !== host) return emptyResponse(404)

    const decision = resolveSandboxFile({ resourceRoot, pathname: url.pathname })
    if (!decision.ok) return emptyResponse(decision.status)

    let body: Buffer
    try {
      body = readFileSync(decision.filePath)
    } catch {
      return emptyResponse(404)
    }

    const response = sandboxResponse(decision.contentType, body)
    return new Response(method === 'HEAD' ? null : new Uint8Array(response.body), {
      status: 200,
      headers: response.headers,
    })
  }
}
