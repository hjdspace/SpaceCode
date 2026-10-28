/**
 * 预览资源的统一响应体 — `spacecode-preview://` 协议与 H5 第二端口共用。
 *
 * 两条承载必须给出同一个答案：token 校验、realpath 边界、MIME 白名单、
 * 文档 CSP 与桥注入都只在这里做一次。任一侧复制一份，就会出现"协议能读、
 * HTTP 读不到"（或反过来）的分裂，而这类分裂只在打包态或手机上暴露。
 *
 * 本模块不碰 Electron API：协议处理器和 `http.createServer` 都只是它的壳。
 */
import { readFileSync } from 'fs'
import { PREVIEW_CSP, PREVIEW_HOST_ORIGIN_PARAM, PREVIEW_NONCE_PARAM } from '@/shared/previewOrigin'
import { buildBridgedDocument, stripCspMeta } from '@/shared/previewDocument'
import { PreviewGrants, REJECT_STATUS, type RejectReason } from './previewGrants'

export type PreviewBridgeOptions = { nonce: string; hostOrigin: string }

export type PreviewServeResult = {
  status: number
  headers: Record<string, string>
  /** HEAD 请求为 null；`headers['Content-Length']` 仍是真实长度的口径 */
  body: Buffer | null
  /** 拒绝原因只用于日志分档，不写进响应 */
  reject?: RejectReason
  target?: string
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

/** 桥参数只从 query 读，形状不对就整份不注入（预览内容仍照常服务）。 */
export function readBridgeOptions(url: URL): PreviewBridgeOptions | null {
  const nonce = url.searchParams.get(PREVIEW_NONCE_PARAM)
  const hostOrigin = url.searchParams.get(PREVIEW_HOST_ORIGIN_PARAM)
  if (!nonce || !/^[A-Za-z0-9-]{1,64}$/.test(nonce)) return null
  if (!isAllowedHostOrigin(hostOrigin)) return null
  return { nonce, hostOrigin }
}

export function servePreviewResource(options: {
  grants: PreviewGrants
  token: string
  rel: string
  bridge: PreviewBridgeOptions | null
  method?: string
}): PreviewServeResult {
  const method = (options.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, headers: { Allow: 'GET, HEAD' }, body: null }
  }

  const root = options.token ? options.grants.rootFor(options.token) : undefined
  const decision = root
    ? options.grants.authorize(root, options.rel)
    : { reject: 'no-grant' as const }

  if ('reject' in decision) {
    return {
      status: REJECT_STATUS[decision.reject],
      headers: {},
      body: null,
      reject: decision.reject,
      target: decision.target,
    }
  }

  let raw: Buffer
  try {
    raw = readFileSync(decision.serve)
  } catch {
    return { status: 404, headers: {}, body: null }
  }

  const headers: Record<string, string> = {
    'Content-Type': decision.contentType,
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }

  let body = raw
  if (decision.contentType.startsWith('text/html')) {
    // 预览文档的策略由宿主统一给：产物自带的 meta 会被交集执行，必须先移除
    headers['Content-Security-Policy'] = PREVIEW_CSP
    const html = raw.toString('utf-8')
    body = Buffer.from(options.bridge ? buildBridgedDocument(html, options.bridge) : stripCspMeta(html), 'utf-8')
  }

  headers['Content-Length'] = String(body.length)
  return { status: 200, headers, body: method === 'HEAD' ? null : body }
}
