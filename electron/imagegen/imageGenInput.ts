/**
 * 改图输入：路径归属判定 + 参考图字节读取。
 *
 * 输入路径来自模型，可能带 `..` 或软链接。仅做路径规范化会让符号链接逃出工作区，
 * 所以先 realpath 再判归属：链接指向工作区外即拒。判定口径与预览服务/导出打包
 * 共用 infra/pathBoundary，不另写一份。
 *
 * 类型按完整签名判定，不看扩展名 —— 扩展名同样来自模型，撒谎的代价是把错误的
 * mime 报给供应商。GIF 不在支持范围内（ADR 0019）。
 */
import { readFile, stat } from 'fs/promises'
import { resolve } from 'path'
import { canonicalize, inside, isFileSystemRoot } from '../infra/pathBoundary'
import { MAX_IMAGE_BYTES } from './imageGenDownload'
import { detectImageFormat, type ImageFormat } from './imageSignatures'
import type { ImageGenInputImage } from './imageGenClient'

/**
 * 把输入路径解析到工作区内并返回真实路径；越界（词法或软链接）抛错。
 * 不存在的路径只要归属在内就放行 —— 存在性由调用方读取字节时判定。
 */
export function resolveWorkspaceInput(root: string, inputPath: string): string {
  const realRoot = canonicalize(root)
  // 把整盘当工作区等于没有边界：任何路径都"在内"，必须先拒。
  if (isFileSystemRoot(realRoot)) {
    throw new Error('Workspace root must not be the filesystem root.')
  }
  const candidate = resolve(root, inputPath)
  const real = canonicalize(candidate)
  if (!inside(real, realRoot)) {
    throw new Error('Input image path is outside the workspace.')
  }
  return real
}

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/** 按输入顺序读参考图；任何一张不合格就整次拒绝，不悄悄少送一张。 */
export async function readInputImages(root: string, paths: string[]): Promise<ImageGenInputImage[]> {
  const images: ImageGenInputImage[] = []
  for (const input of paths) {
    const real = resolveWorkspaceInput(root, input)
    // 先量大小再读：路径来自模型，工作区里可能躺着几个 G 的文件，readFile 会整块吃进内存。
    const entry = await stat(real).catch(() => null)
    if (!entry?.isFile()) {
      throw new Error(`Could not read reference image "${input}". Check that the file exists.`)
    }
    if (entry.size > MAX_IMAGE_BYTES) {
      throw new Error(`Reference image "${input}" exceeds the ${MAX_IMAGE_BYTES} byte limit.`)
    }
    const bytes = await readFile(real)
    const format = detectImageFormat(bytes)
    if (!format) {
      throw new Error(`Reference image "${input}" is not a supported PNG, JPEG or WebP image.`)
    }
    images.push({ bytes, mime: MIME_BY_FORMAT[format] })
  }
  return images
}