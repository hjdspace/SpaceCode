/**
 * 产物预览的专用源 `spacecode-preview://`（Issue #63）。
 *
 * 为什么需要独立 origin：srcdoc 继承宿主 CSP（`script-src 'self'`），注入桥与产物
 * 脚本都不执行；随机 HTTP 端口又写不进静态 `frame-src`。固定自定义源让预览文档
 * 拿到自己的 origin 与自己的策略，宿主只需放行这一个源。
 *
 * 两条 Electron 口径：
 *  - scheme 必须在 app ready **之前**注册为 standard + secure；
 *  - `protocol.handle` 只作用于被注册的 session。主窗口跑在
 *    `persist:claude-code-desktop`，不能只注册到默认 session。
 *
 * 处理器本身不碰 electron API（只有注册函数碰），文件闸门与响应形状都由
 * `previewServe.ts` 提供，H5 第二端口复用同一份 —— "协议能读、HTTP 读不到"的分裂不会发生。
 */
import { protocol } from 'electron'
import { sep } from 'path'
import { PREVIEW_HOST, PREVIEW_SCHEME } from '@/shared/previewOrigin'
import { PreviewGrants, decodeSegment } from './previewGrants'
import { readBridgeOptions, servePreviewResource } from './previewServe'
import { debug, info, warn } from './logger'

/**
 * standard + secure 才有真正的 origin；`supportFetchAPI` 让产物能同源 `fetch()`
 * 自己的 JSON（实测关掉会 "Failed to fetch"）。`corsEnabled: false` 保持跨源读取
 * 被 CORS 挡住，不把预览目录变成任意页面可读的资源。
 */
const SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  stream: true,
  supportFetchAPI: true,
  corsEnabled: false,
  allowServiceWorkers: false,
  bypassCSP: false,
}

/** 在 app ready 之前调用；ready 之后调用会直接被 Electron 拒绝。 */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_SCHEME, privileges: SCHEME_PRIVILEGES }])
}

/** 处理器真正读到的字段，注入 grants 后可脱离 Electron 测试。 */
export type PreviewRequestLike = { url: string; method?: string }

/** 能挂协议处理器的宿主（主进程传 `Session['protocol']`）。 */
export type PreviewProtocolHost = {
  handle: (scheme: string, handler: (request: PreviewRequestLike) => Promise<Response>) => void
}

export function createPreviewRequestHandler(options: {
  grants: PreviewGrants
}): (request: PreviewRequestLike) => Promise<Response> {
  const { grants } = options

  return async (request: PreviewRequestLike): Promise<Response> => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response(null, { status: 400 })
    }
    // 只服务本预览源；其他 host 会串出另一个 origin 的身份
    if (url.protocol !== `${PREVIEW_SCHEME}:` || url.host !== PREVIEW_HOST) {
      return new Response(null, { status: 404 })
    }

    const [rawToken, ...segments] = url.pathname.slice(1).split('/')
    const result = servePreviewResource({
      grants,
      token: decodeSegment(rawToken ?? ''),
      rel: segments.map(decodeSegment).join(sep),
      bridge: readBridgeOptions(url),
      method: request.method,
    })

    if (result.reject) {
      if (result.status === 403) {
        warn('PreviewProtocol', `Rejected ${result.reject}: ${result.target ?? url.pathname}`)
      } else {
        debug('PreviewProtocol', `Not served (${result.reject}): ${url.pathname}`)
      }
    }

    return new Response(result.body ? new Uint8Array(result.body) : null, {
      status: result.status,
      headers: result.headers,
    })
  }
}

/** ready 之后调用；每个实际承载 iframe 的 session 都要挂一次。 */
export function registerPreviewProtocol(options: {
  grants: PreviewGrants
  hosts: PreviewProtocolHost[]
}): void {
  const handler = createPreviewRequestHandler(options)
  for (const host of options.hosts) {
    host.handle(PREVIEW_SCHEME, handler)
  }
  info('PreviewProtocol', `Registered ${PREVIEW_SCHEME}:// on ${options.hosts.length} session(s)`)
}
