/**
 * 预览文件的可读范围 — HTTP 预览服务与 `spacecode-preview://` 协议共用同一套判定。
 *
 * 两条承载必须给出同一个答案：登记过的工作区、词法 resolve 拦 `..`、realpath 拦
 * 符号链接逃逸、只服务白名单 MIME。任一侧出现分歧，就会出现"协议能读、HTTP 读不到"
 * 或反过来的漏洞，所以这里不复制两份。
 *
 * 未知扩展名一律不服务：脚本真正执行之后，预览页能 `fetch` 整个登记根，
 * 照发 `application/octet-stream` 等于把 `.env` / 无扩展名文件也交出去。
 */
import { existsSync, statSync } from 'fs'
import { dirname, extname, relative, resolve, sep } from 'path'
import { randomBytes } from 'crypto'
import { canonicalize, compareForm, inside, isFileSystemRoot } from './pathBoundary'

export const PREVIEW_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
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
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
}

export function contentTypeFor(filePath: string): string | null {
  return PREVIEW_MIME[extname(filePath).toLowerCase()] ?? null
}

/** 非法百分号编码不当作错误，按字面段处理 — 后续边界检查才是权威闸门。 */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export type RejectReason =
  | 'no-grant'
  | 'missing'
  | 'lexical'
  | 'symlink'
  | 'listing'
  | 'unsupported'

/** 无凭证的路径与不存在的路径同码：服务不能当成本机文件探测的 oracle。 */
export const REJECT_STATUS: Record<RejectReason, 403 | 404> = {
  'no-grant': 404,
  missing: 404,
  lexical: 403,
  symlink: 403,
  listing: 403,
  unsupported: 404,
}

export type ServeDecision =
  | { serve: string; contentType: string }
  | { reject: RejectReason; target?: string }

export type PreviewGrant = { token: string; root: string; rel: string }

export class PreviewGrants {
  /** token → 已登记的预览工作区根目录（realpath 后的绝对路径） */
  private readonly grants = new Map<string, string>()

  /**
   * 登记文件所属的预览工作区并签发/复用 token。
   * 登记范围尽量收窄：workspaceRoot 确实包含该文件时用该根（同工作区内的相对
   * 引用可用），否则只到文件所在目录；文件系统根拒绝登记。
   */
  register(filePath: string, workspaceRoot?: string): PreviewGrant | null {
    const target = canonicalize(resolve(filePath))
    const root = this.pickGrantRoot(target, workspaceRoot)
    if (!root) return null

    const token = this.tokenForRoot(root)
    // 保留目录层级，浏览器里 index.html 的相对子资源才能同源命中同一工作区
    const rel = relative(root, target).split(sep).map(encodeURIComponent).join('/')
    return { token, root, rel }
  }

  rootFor(token: string): string | undefined {
    return this.grants.get(token)
  }

  clear(): void {
    this.grants.clear()
  }

  /**
   * 两段闸门：词法 resolve 先拦掉 `..` 与绝对路径段（不碰文件系统），
   * realpath 再判一次 —— 符号链接按目标计算，链接指向工作区外即拒。
   * 目录的 index.html 也要整条走一遍，否则"链接出去的 index.html"会被直接服务。
   */
  authorize(root: string, rel: string): ServeDecision {
    const candidate = resolve(root, rel)
    if (!inside(candidate, root)) {
      return { reject: 'lexical', target: candidate }
    }
    if (!existsSync(candidate)) return { reject: 'missing', target: candidate }

    const real = canonicalize(candidate)
    if (!inside(real, root)) {
      return { reject: 'symlink', target: candidate }
    }
    if (!statSync(real).isDirectory()) return this.serve(real)

    const indexFile = resolve(real, 'index.html')
    if (!existsSync(indexFile)) return { reject: 'listing', target: candidate }
    const realIndex = canonicalize(indexFile)
    if (!inside(realIndex, root)) {
      return { reject: 'symlink', target: indexFile }
    }
    return this.serve(realIndex)
  }

  private serve(filePath: string): ServeDecision {
    const contentType = contentTypeFor(filePath)
    // 白名单之外的类型即使存在也不读（`.env`、无扩展名、源码扩展名都在这里被挡）
    if (!contentType) return { reject: 'unsupported', target: filePath }
    return { serve: filePath, contentType }
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
}

/** 应用级单例：HTTP 预览服务与自定义协议处理器共用。 */
export const previewGrants = new PreviewGrants()
