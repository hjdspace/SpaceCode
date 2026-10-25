/**
 * 沙箱静态资源的文件闸门 — 自定义协议处理器与开发期静态服务共用同一套判定。
 *
 * 两条链路必须给出同一个答案，否则"开发能看到的东西打包后读不到"（或反过来）
 * 就成了只在某一侧暴露的问题。规则与 `electron/infra/previewServer.ts` 同源：
 * 先归一化百分号编码，再用 realpath 口径判归属，只服务白名单 MIME，不做目录列举。
 */
import { statSync } from 'fs'
import { extname, resolve } from 'path'
import { canonicalize, inside } from '../infra/pathBoundary'
import { GENUI_SANDBOX_CSP } from '@/shared/genuiSandbox'

/** 沙箱只需要自己的文档、脚本、样式与字体；其余扩展名一律不服务。 */
export const SANDBOX_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
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
}

/** 沙箱文档及其子资源统一的响应头：CSP 逐响应下发，禁止类型嗅探。 */
export function sandboxResponseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': GENUI_SANDBOX_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // 沙箱产物文件名不带 hash，开发期重建后必须重新取到新版本
    'Cache-Control': 'no-cache',
  }
}

export type SandboxFileDecision =
  | { ok: true; filePath: string; contentType: string }
  | { ok: false; status: number; reason: 'bad-request' | 'outside-root' | 'not-found' | 'unsupported-type' }

function fail(status: number, reason: NonNullable<Exclude<SandboxFileDecision, { ok: true }>['reason']>): SandboxFileDecision {
  return { ok: false, status, reason }
}

/** 非法百分号编码按字面段处理 — 后面的边界判定才是权威闸门。 */
function decodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/**
 * 把请求路径解析成资源根内的一个文件。
 * 目录（含被当作目录的 `..` 结果）与不存在的文件同码返回，不泄露资源根里有什么。
 */
export function resolveSandboxFile(options: { resourceRoot: string; pathname: string }): SandboxFileDecision {
  const { resourceRoot } = options
  if (!resourceRoot) return fail(400, 'bad-request')

  const decoded = decodePath(options.pathname)
  // NUL 之后文件系统会截断路径，必须当作非法请求而不是尝试解析
  if (decoded.includes('\0')) return fail(400, 'bad-request')

  const relative = decoded.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
  const target = relative === '' ? 'index.html' : relative
  const candidate = resolve(resourceRoot, target)

  const rootReal = canonicalize(resourceRoot)
  if (!inside(canonicalize(candidate), rootReal)) return fail(403, 'outside-root')

  let stats
  try {
    stats = statSync(candidate)
  } catch {
    return fail(404, 'not-found')
  }
  if (!stats.isFile()) return fail(404, 'not-found')

  const ext = extname(candidate).toLowerCase()
  // 白名单按小写比对；名单之外的类型即使存在也不读
  const contentType = SANDBOX_MIME[ext]
  if (!contentType) return fail(404, 'unsupported-type')

  return { ok: true, filePath: candidate, contentType }
}
