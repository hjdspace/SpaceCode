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
 * 处理器本身不碰 electron API（只有注册函数碰），文件闸门与 HTTP 预览服务共用
 * `previewGrants.ts`，于是"协议能读、HTTP 读不到"的分裂不会发生。
 */
import { protocol } from 'electron'
import { readFileSync } from 'fs'
import { sep } from 'path'
import {
  PREVIEW_CSP,
  PREVIEW_HOST,
  PREVIEW_HOST_ORIGIN_PARAM,
  PREVIEW_NONCE_PARAM,
  PREVIEW_SCHEME,
} from '@/shared/previewOrigin'
import { buildBridgedDocument, stripCspMeta } from '@/shared/previewDocument'
import { PreviewGrants, REJECT_STATUS, decodeSegment, type ServeDecision } from './previewGrants'
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

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers })
}

function readBridgeOptions(url: URL): { nonce: string; hostOrigin: string } | null {
  const nonce = url.searchParams.get(PREVIEW_NONCE_PARAM)
  const hostOrigin = url.searchParams.get(PREVIEW_HOST_ORIGIN_PARAM)
  if (!nonce || !/^[A-Za-z0-9-]{1,64}$/.test(nonce)) return null
  if (!isAllowedHostOrigin(hostOrigin)) return null
  return { nonce, hostOrigin }
}

/** 宿主 origin 只接受 http(s) 与打包态的 `file://`；其他值不注入桥。 */
function isAllowedHostOrigin(value: string | null): value is string {
  if (!value) return false
  if (value === 'file://') return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function createPreviewRequestHandler(options: {
  grants: PreviewGrants
}): (request: PreviewRequestLike) => Promise<Response> {
  const { grants } = options

  return async (request: PreviewRequestLike): Promise<Response> => {
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
    // 只服务本预览源；其他 host 会串出另一个 origin 的身份
    if (url.protocol !== `${PREVIEW_SCHEME}:` || url.host !== PREVIEW_HOST) return emptyResponse(404)

    const [rawToken, ...segments] = url.pathname.slice(1).split('/')
    const token = decodeSegment(rawToken ?? '')
    const rel = segments.map(decodeSegment).join(sep)
    const root = token ? grants.rootFor(token) : undefined
    const decision: ServeDecision = root
      ? grants.authorize(root, rel)
      : { reject: 'no-grant' }

    if ('reject' in decision) {
      const status = REJECT_STATUS[decision.reject]
      if (status === 403) {
        warn('PreviewProtocol', `Rejected ${decision.reject}: ${decision.target ?? url.pathname}`)
      } else {
        debug('PreviewProtocol', `Not served (${decision.reject}): ${url.pathname}`)
      }
      return emptyResponse(status)
    }

    let raw: Buffer
    try {
      raw = readFileSync(decision.serve)
    } catch {
      return emptyResponse(404)
    }

    const headers: Record<string, string> = {
      'Content-Type': decision.contentType,
      'Cache-Control': 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    }

    let body: Buffer | null = raw
    if (decision.contentType.startsWith('text/html')) {
      // 预览文档的策略由宿主统一给：产物自带的 meta 会被交集执行，必须先移除
      headers['Content-Security-Policy'] = PREVIEW_CSP
      const bridge = readBridgeOptions(url)
      const html = raw.toString('utf-8')
      body = Buffer.from(bridge ? buildBridgedDocument(html, bridge) : stripCspMeta(html), 'utf-8')
    }

    headers['Content-Length'] = String(body?.length ?? 0)
    return new Response(method === 'HEAD' ? null : new Uint8Array(body ?? raw), {
      status: 200,
      headers,
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
