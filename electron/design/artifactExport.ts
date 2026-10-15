/**
 * 设计产物打包（ZIP）— 票 08。
 *
 * 收集范围与预览服务器登记工作区共用同一套边界判定（electron/infra/pathBoundary），
 * 于是「用户在预览里看得见的资源」与「导出打进归档的资源」是同一个口径；
 * 条目名相对该根，解压后 index.html 的相对引用仍能命中原来的兄弟资源。
 * 不 import electron：这条链路在纯 Node 下可测。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'path'
import { canonicalize, inside, isFileSystemRoot } from '../infra/pathBoundary'
import { writeZip, type ZipEntryInput } from './zipWriter'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** src / href / srcset 的字面量取值（双引号、单引号或裸值） */
const ATTR_REF = /\b(src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`<>]+))/gi
const CSS_URL = /\burl\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/gi
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(["'])([^"']*)\1/gi
/** ES Module 的三类说明符：副作用导入、from 导入、动态导入。 */
const JS_SIDE_EFFECT_IMPORT = /\bimport\s+["']([^"']+)["']/g
const JS_FROM = /\bfrom\s*["']([^"']+)["']/g
const JS_DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
/** 只认相对说明符：`vue` 这类裸说明符由打包器/CDN 解析，不是本机文件 */
const RELATIVE_MODULE_SPEC = /^\.{1,2}[\\/]/

const TEXT_MARKUP = /\.(html?|css)$/i
const TEXT_SCRIPT = /\.m?js$/i

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, '$2')
}

/** 归一为相对引用源文件的 POSIX 路径；非本地引用（外链、锚点、站点根路径）返回 null。 */
function toLocalRef(raw: string): string | null {
  const value = raw.trim()
  if (!value || value.startsWith('#') || value.startsWith('//')) return null
  if (SCHEME.test(value) || /^[\\/]/.test(value)) return null

  const path = value.split('#')[0].split('?')[0]
  if (!path) return null

  const decoded = path
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')

  const normalized = posix.normalize(decoded)
  // 站点根绝对路径解码后才显形（%2Fstyle.css）；纯锚点归一后为空也落在这里
  if (!normalized || /^[\\/]/.test(normalized)) return null
  return normalized
}

/** 抽出标记与样式里的本地相对引用（src/href/srcset、url() 与 @import）。 */
export function collectLocalRefs(source: string): string[] {
  const refs = new Set<string>()
  const add = (raw: string) => {
    const ref = toLocalRef(raw)
    if (ref) refs.add(ref)
  }

  for (const match of source.matchAll(ATTR_REF)) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (match[1].toLowerCase() === 'srcset') {
      // srcset 是「URL 描述符」逗号列表，每段只取 URL
      for (const candidate of value.split(',')) add(candidate.trim().split(/\s+/)[0] ?? '')
    } else {
      add(value)
    }
  }
  for (const match of source.matchAll(CSS_URL)) add(unquote(match[1]))
  for (const match of source.matchAll(CSS_IMPORT)) add(match[2])

  return [...refs]
}

/** 抽出脚本里的本地相对引用（ES Module 静态与动态说明符）。 */
export function collectModuleRefs(source: string): string[] {
  const refs = new Set<string>()
  for (const pattern of [JS_SIDE_EFFECT_IMPORT, JS_FROM, JS_DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) {
      if (!RELATIVE_MODULE_SPEC.test(match[1])) continue
      const ref = toLocalRef(match[1])
      if (ref) refs.add(ref)
    }
  }
  return [...refs]
}

/**
 * 归档根：工作区根确实包含产物时用工作区根（与 previewServer 的登记范围同规则），
 * 否则退到产物所在目录；宽到文件系统根时拒绝导出（那等于把整盘引用打包走）。
 */
export function resolveArtifactRoot(htmlPath: string, workspaceRoot?: string): string | null {
  const target = canonicalize(resolve(htmlPath))
  const workspace = workspaceRoot?.trim() ? canonicalize(resolve(workspaceRoot)) : null
  const fileDir = dirname(target)
  const root = workspace && inside(target, workspace) ? workspace : fileDir
  if (!isFileSystemRoot(root)) return root
  // 退到产物所在目录，那已是最窄可用范围；它也是文件系统根时就没有可用根了
  return isFileSystemRoot(fileDir) ? null : fileDir
}

export function exportZip(htmlPath: string, workspaceRoot?: string): string {
  const target = canonicalize(resolve(htmlPath))
  if (!existsSync(target)) throw new Error(`Artifact not found: ${target}`)

  const root = resolveArtifactRoot(target, workspaceRoot)
  if (!root) throw new Error(`No usable workspace root for export: ${target}`)

  const entries = new Map<string, ZipEntryInput>()
  const scanned = new Set<string>()
  const queue = [target]

  // 引用是传递的：HTML → 兄弟 CSS/JS → CSS 的 url()/@import 与 JS 的 import。
  // scanned 让互引成环也能收敛。
  while (queue.length) {
    const candidate = queue.shift()!
    if (!inside(candidate, root)) continue
    // 符号链接按目标判定，链接指向工作区外的文件不入档（与预览服务同一闸门）
    const file = canonicalize(candidate)
    if (!inside(file, root)) continue
    let stat
    try {
      stat = statSync(file)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    const name = relative(root, file).split(sep).join('/')
    if (!entries.has(name)) {
      entries.set(name, { name, data: readFileSync(file), mtime: stat.mtime })
    }
    if (scanned.has(name)) continue
    scanned.add(name)

    const refs = TEXT_MARKUP.test(name)
      ? collectLocalRefs(readFileSync(file, 'utf8'))
      : TEXT_SCRIPT.test(name)
        ? collectModuleRefs(readFileSync(file, 'utf8'))
        : []
    for (const ref of refs) queue.push(resolve(dirname(file), ref))
  }

  const output = join(dirname(target), `${basename(target, extname(target))}.zip`)
  writeFileSync(output, writeZip([...entries.values()]))
  return output
}
