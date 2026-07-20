/**
 * markdownImagePath — markdown 预览中本地图片路径解析工具。
 *
 * 背景：从文件树打开 README.md 时，图片 src 通常是相对路径（如 ./docs/a.png）。
 * 浏览器会按当前页面 URL 解析相对路径，导致 404；同时 index.html 的 CSP
 * `img-src 'self' data: https:;` 禁止 file: 协议。因此需要把相对路径解析为
 * 绝对路径，读取为 base64 后以 data: URL 注入 <img>，绕过 CSP 限制。
 */

/** 带扩展名 → MIME 映射（小写）。 */
const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

/**
 * 判断 src 是否为远程或内联 URL（http/https/ftp/data/blob/file 协议）。
 * 这些 URL 由浏览器直接加载，无需本地路径解析。
 * 注意：锚点（#xxx）不属于 URL，由 resolveImagePath 单独处理。
 */
export function isRemoteUrl(src: string): boolean {
  if (!src) return false
  return /^(https?|ftp|data|blob|file):/i.test(src.trim())
}

/**
 * 根据文件路径扩展名推断图片 MIME 类型；未知扩展名回退到 image/png。
 * 支持带查询参数（如 a.png?v=1）的路径。
 */
export function getImageMimeType(filePath: string): string {
  if (!filePath) return 'image/png'
  const clean = filePath.split('?')[0].split('#')[0]
  const ext = clean.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'image/png'
}

/** 拼装 data: URL（base64）。 */
export function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`
}

/**
 * 根据 markdown 文件路径与图片 src，解析出本地图片的绝对路径。
 *
 * - 远程/内联 URL（http/https/ftp/data/blob/file）→ 返回 null（无需本地解析）
 * - 锚点（#xxx）→ 返回 null
 * - 空字符串 → 返回 null
 * - Windows 绝对路径（D:\... 或 D:/...）→ 原样返回
 * - Unix 绝对路径（/...）→ 原样返回
 * - 相对路径（./a.png、a.png、../a.png）→ 基于 markdown 文件所在目录解析
 *   - 统一使用正斜杠输出（Node.js readFileSync 在 Windows 上接受正斜杠）
 *   - 正确处理 . 与 .. 段
 *
 * @param markdownFilePath markdown 文件的绝对路径（如 D:/proj/README.md）
 * @param imgSrc <img src="..."> 的原始值
 * @returns 解析后的绝对路径，或 null（无需/无法处理）
 */
export function resolveImagePath(markdownFilePath: string | undefined, imgSrc: string): string | null {
  if (!imgSrc) return null
  const trimmed = imgSrc.trim()
  if (!trimmed) return null

  // 远程/内联 URL：跳过
  if (isRemoteUrl(trimmed)) return null

  // 锚点：跳过
  if (trimmed.startsWith('#')) return null

  // 绝对路径：Windows 盘符 或 Unix /
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed
  }

  // 相对路径：需要 markdown 文件路径作为基准
  if (!markdownFilePath) return null

  // 取 markdown 文件所在目录（去掉最后一段文件名），统一为正斜杠
  const normalizedMdPath = markdownFilePath.replace(/\\/g, '/')
  const lastSlash = normalizedMdPath.lastIndexOf('/')
  const dir = lastSlash > 0 ? normalizedMdPath.slice(0, lastSlash) : ''

  // 规范化相对路径前缀
  const rel = trimmed.replace(/^\.\//, '').replace(/\\/g, '/')

  // 拼接并解析 . 与 ..
  const combined = dir ? `${dir}/${rel}` : rel
  const parts = combined.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') {
      // 不会越过根目录（如 D:）
      if (out.length > 0 && !/^[A-Za-z]:$/.test(out[out.length - 1])) {
        out.pop()
      } else if (out.length > 0) {
        // 形如 ['D:'] 时保留盘符，不 pop
      }
    } else if (part !== '.' && part !== '') {
      out.push(part)
    }
  }
  return out.join('/')
}
