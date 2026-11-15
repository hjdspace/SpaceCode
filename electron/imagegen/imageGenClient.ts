/**
 * 生图 HTTP 客户端 + 供应商方言层。
 *
 * 「OpenAI 兼容生图」不是一种协议而是三种方言：改图机制、批量参数、返回形态都不同。
 * 方言分派在这一层，工具层不感知。
 *
 * 本模块零 fs、零 electron：图片字节由调用方传入/取回，fetch 由参数注入。
 */
import type { ImageGenConfig } from '@/shared/imageGenReference'
import { detectImageFormat } from './imageSignatures'
import {
  downloadImage,
  MAX_IMAGE_BYTES,
  MAX_JSON_BYTES,
  readBoundedBody,
  type LookupImpl,
} from './imageGenDownload'

export interface ImageGenInputImage {
  bytes: Buffer
  mime: string
}

export interface ImageGenRequest {
  prompt: string
  size?: string
  /** 有值即为改图。字节由工具层读好传进来 —— 本模块不碰文件系统。 */
  images?: ImageGenInputImage[]
}

export interface GeneratedImage {
  bytes: Buffer
}

export type ImageGenOutcome =
  | { ok: true; images: GeneratedImage[]; model: string }
  | { ok: false; error: string }

/** 供应商挂住时不能把这次 MCP 调用一起挂死。 */
export const IMAGEGEN_TIMEOUT_MS = 120_000

/**
 * base64 先量长度再解码：长度上界先行拒绝，不为超大串分配解码缓冲。
 * 格式校验用单字符类正则（非分组重复），多兆串也线性扫描、不递归爆栈。
 */
export function decodeBoundedBase64(b64: string, maxBytes: number = MAX_IMAGE_BYTES): Buffer {
  const maxChars = Math.ceil(maxBytes / 3) * 4
  if (b64.length > maxChars) throw new Error(`Base64 image exceeds the ${maxBytes} byte limit.`)
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new Error('Malformed base64 image data.')
  }
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length > maxBytes) throw new Error(`Base64 image exceeds the ${maxBytes} byte limit.`)
  return bytes
}

/** multipart 单图用单数字段名、多图用数组字段名（改图票 #111 会用到）。 */
export function imageMultipartFieldName(imageCount: number): string {
  return imageCount > 1 ? 'image[]' : 'image'
}

export async function generateImages(
  config: ImageGenConfig,
  request: ImageGenRequest,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: LookupImpl,
): Promise<ImageGenOutcome> {
  const images = request.images ?? []
  const editing = images.length > 0

  // 方言不是「兼容协议」：本期只实现 openai，其余明确拒绝，不按 OpenAI 形状乱发请求。
  // 改图尤其不能降级成重新生成：那会产出一张与用户意图无关的图，而用户以为改图成功了。
  if (config.dialect !== 'openai') {
    return {
      ok: false,
      error: editing
        ? `The "${config.dialect}" dialect does not support image editing. Ask the user to pick a provider that does (Settings → Image model); do not retry as a fresh generation.`
        : `Unsupported image dialect "${config.dialect}".`,
    }
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` }
  let body: FormData | string
  if (editing) {
    body = editForm(config, request, images)
  } else {
    headers['Content-Type'] = 'application/json'
    const payload: Record<string, unknown> = { model: config.model, prompt: request.prompt }
    // 不发 response_format：gpt-image 系恒回 b64_json，dall-e 系默认回 url，两种都解。
    if (request.size) payload.size = request.size
    body = JSON.stringify(payload)
  }

  const signal = AbortSignal.timeout(IMAGEGEN_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${config.baseUrl}/images/${editing ? 'edits' : 'generations'}`, {
      method: 'POST',
      headers,
      body,
      signal,
    })

    const payload = await readJsonBounded(res)
    if (!res.ok) return { ok: false, error: providerMessage(payload, res.status, config.apiKey) }

    const collected = await collectImages(payload, fetchImpl, signal, lookupImpl)
    if (collected.images.length === 0) {
      const reason = collected.failures[0] ?? 'The provider returned no image data.'
      return { ok: false, error: redactKey(reason, config.apiKey) }
    }

    const model = (payload as { model?: unknown } | null)?.model
    return {
      ok: true,
      images: collected.images,
      model: typeof model === 'string' && model ? model : config.model,
    }
  } catch (err) {
    return { ok: false, error: redactKey(`Image request failed: ${String(err)}`, config.apiKey) }
  }
}

/**
 * 改图的 multipart 体。字段名按张数选（单数 / 数组），恒用数组名会让部分端点拒收单图。
 * 不设 Content-Type：boundary 由 fetch 生成，手写会让上游解析失败。
 */
function editForm(config: ImageGenConfig, request: ImageGenRequest, images: ImageGenInputImage[]): FormData {
  const form = new FormData()
  form.append('model', config.model)
  form.append('prompt', request.prompt)
  if (request.size) form.append('size', request.size)
  const field = imageMultipartFieldName(images.length)
  for (const [index, image] of images.entries()) {
    const blob = new Blob([new Uint8Array(image.bytes)], { type: image.mime })
    form.append(field, blob, `reference-${index + 1}.${image.mime.split('/')[1]}`)
  }
  return form
}

async function collectImages(
  payload: unknown,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  lookupImpl?: LookupImpl,
): Promise<{ images: GeneratedImage[]; failures: string[] }> {
  const data = (payload as { data?: unknown } | null)?.data
  const entries = Array.isArray(data) ? data : []
  const images: GeneratedImage[] = []
  const failures: string[] = []

  for (const item of entries) {
    const entry = (item ?? {}) as { b64_json?: unknown; url?: unknown; error?: unknown }
    // HTTP 200 里也可能逐图带 error（内容审核等）：那是失败项，不能冒充成功。
    if (entry.error != null) {
      failures.push(entryErrorMessage(entry.error))
      continue
    }
    try {
      if (typeof entry.b64_json === 'string' && entry.b64_json) {
        images.push({ bytes: validateImageBytes(decodeBoundedBase64(entry.b64_json)) })
        continue
      }
      if (typeof entry.url === 'string' && entry.url) {
        // 短期 url 由供应商 CDN 提供：按不受信 URL 校验下载，凭证不跟过去（另一个域）。
        const bytes = await downloadImage(entry.url, { signal, fetchImpl, lookupImpl })
        images.push({ bytes: validateImageBytes(bytes) })
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }
  return { images, failures }
}

/** 解码/下载得到的字节按完整签名校验：HTML 错误页、截断头、GIF 一律拒。 */
function validateImageBytes(bytes: Buffer): Buffer {
  if (!detectImageFormat(bytes)) {
    throw new Error('Image data is not a supported PNG, JPEG or WebP image.')
  }
  return bytes
}

function entryErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'The provider reported an error for this image.'
}

async function readJsonBounded(res: Response): Promise<unknown> {
  const bytes = await readBoundedBody(res, MAX_JSON_BYTES)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
}

/** 供应商可能把我们的 key 回显进错误：surface 前一律抹掉，绝不回显、绝不写日志。 */
function redactKey(text: string, key: string): string {
  return key ? text.split(key).join('[redacted]') : text
}

/** 供应商错误结构各不相同，但都尽量把 message 递到模型面前；绝不回显我们自己的配置。 */
function providerMessage(payload: unknown, status: number, key: string): string {
  if (payload && typeof payload === 'object') {
    const err = (payload as { error?: { message?: unknown } }).error
    if (err && typeof err.message === 'string' && err.message) return redactKey(err.message, key)
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  // 先脱敏再截断：key 若横跨 500 边界，先截断会留下半截 key，redactKey 匹配不到完整 key。
  return redactKey(`HTTP ${status}: ${text ?? ''}`, key).slice(0, 500)
}