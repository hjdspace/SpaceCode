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

/**
 * 稳定错误码。卡片按它选本地文案，工具层按 `auth` 就地止血、按 `cancelled` 与失败分开报告。
 * `error` 一律带 `code: ` 前缀，模型与卡片看到的是同一份可识别的串。
 */
export type ImageGenErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'bad_image'
  | 'edit_unsupported'
  | 'cancelled'
  | 'provider'

export type ImageGenOutcome =
  | { ok: true; images: GeneratedImage[]; model: string }
  | { ok: false; code: ImageGenErrorCode; error: string }

export interface ImageGenCallOptions {
  lookupImpl?: LookupImpl
  /** 调用方自持的中止信号（会话级取消 / 鉴权止血）。与内部超时并存，谁先到算谁。 */
  signal?: AbortSignal
}

function failed(code: ImageGenErrorCode, message: string): ImageGenOutcome {
  return { ok: false, code, error: `${code}: ${message}` }
}

/** 工具层丢弃排队项时要报同一串错误：卡片按 `code: ` 前缀认码，两侧不能各写一份。 */
export const IMAGEGEN_CANCELLED_ERROR = 'cancelled: The image request was cancelled.'

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

/** multipart 单图用单数字段名、多图用数组字段名。 */
export function imageMultipartFieldName(imageCount: number): string {
  return imageCount > 1 ? 'image[]' : 'image'
}

export async function generateImages(
  config: ImageGenConfig,
  request: ImageGenRequest,
  fetchImpl: typeof fetch = fetch,
  options: ImageGenCallOptions = {},
): Promise<ImageGenOutcome> {
  const { lookupImpl, signal: external } = options
  const images = request.images ?? []
  const editing = images.length > 0

  const built = buildRequest(config, request, images, editing)
  if ('error' in built) return failed(built.code, built.error)

  // 已经取消就别发请求：这一步要花钱，排队项必须在出站之前丢掉。
  if (external?.aborted) return cancelled()

  const timeout = AbortSignal.timeout(IMAGEGEN_TIMEOUT_MS)
  const signal = external ? AbortSignal.any([timeout, external]) : timeout

  let res: Response
  try {
    res = await fetchImpl(built.url, { ...built.init, signal })
  } catch (err) {
    if (external?.aborted) return cancelled()
    if (isTimeout(err)) {
      return failed('timeout', `The provider did not respond within ${IMAGEGEN_TIMEOUT_MS / 1000}s.`)
    }
    return failed('network', redactKey(`Image request failed: ${String(err)}`, config.apiKey))
  }

  // 先看状态码再读 body：401/403 的止血判定不能被「错误体读失败」吞掉，
  // 否则一个坏 key 仍可能把整批排队项烧完。
  if (!res.ok) {
    const payload = await readJsonBounded(res).catch(() => null)
    if (external?.aborted) return cancelled()
    return failed(httpErrorCode(res.status), providerMessage(payload, res.status, config.apiKey))
  }

  let payload: unknown
  try {
    payload = await readJsonBounded(res)
  } catch (err) {
    if (external?.aborted) return cancelled()
    if (isTimeout(err)) {
      return failed('timeout', `The provider did not respond within ${IMAGEGEN_TIMEOUT_MS / 1000}s.`)
    }
    return failed('bad_image', redactKey(errorText(err), config.apiKey))
  }

  const collected = await collectImages(payload, fetchImpl, signal, lookupImpl)
  if (collected.images.length === 0) {
    if (external?.aborted) return cancelled()
    const first = collected.failures[0]
    return failed(
      first?.code ?? 'bad_image',
      redactKey(first?.message ?? 'The provider returned no image data.', config.apiKey),
    )
  }

  // 拿到图就算成功，即使信号随后被中止：那张图已经画好也已经计费，不能丢。
  const model = (payload as { model?: unknown } | null)?.model
  return {
    ok: true,
    images: collected.images,
    model: typeof model === 'string' && model ? model : config.model,
  }
}

function cancelled(): ImageGenOutcome {
  return { ok: false, code: 'cancelled', error: IMAGEGEN_CANCELLED_ERROR }
}

/** 超时可能发生在出站、读 body 或下载图片任一阶段：都报 timeout，别冒充坏图。 */
function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'TimeoutError'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 401/403 是止血信号：一个错 key 不该把整批排队项都烧成同样的付费失败。 */
function httpErrorCode(status: number): ImageGenErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  return 'provider'
}

interface BuiltRequest {
  url: string
  init: RequestInit
}

/**
 * 方言分派：同一份工具契约，请求形态由供应商决定。
 * 未实现的方言明确拒绝，不按 OpenAI 形状乱发请求；改图绝不能降级成重新生成。
 */
function buildRequest(
  config: ImageGenConfig,
  request: ImageGenRequest,
  images: ImageGenInputImage[],
  editing: boolean,
): BuiltRequest | { code: ImageGenErrorCode; error: string } {
  switch (config.dialect) {
    case 'openai':
      return editing
        ? {
            url: `${config.baseUrl}/images/edits`,
            init: { method: 'POST', headers: authHeaders(config, false), body: editForm(config, request, images) },
          }
        : {
            url: `${config.baseUrl}/images/generations`,
            init: {
              method: 'POST',
              headers: authHeaders(config, true),
              // 不发 response_format：gpt-image 系恒回 b64_json，dall-e 系默认回 url，两种都解。
              // 也不发 n：张数由客户端扇出，每次物理请求只要一张。
              body: JSON.stringify(openAiPayload(config, request)),
            },
          }
    case 'seedream':
      return seedreamRequest(config, request, images)
    case 'zhipu':
      // 智谱没有 edits 端点：绝不当成文生图发出去，那会产出一张与用户意图无关的图。
      return editing
        ? {
            code: 'edit_unsupported',
            error:
              'The "zhipu" dialect (Zhipu CogView) does not support image editing. Ask the user to switch to OpenAI or Volcengine Ark in Settings → Image model, then retry. Do not fall back to a fresh generation.',
          }
        : zhipuRequest(config, request)
    default:
      return editing
        ? {
            code: 'edit_unsupported',
            error: `The "${config.dialect}" dialect does not support image editing. Ask the user to pick a provider that does (Settings → Image model); do not retry as a fresh generation.`,
          }
        : { code: 'provider', error: `Unsupported image dialect "${config.dialect}".` }
  }
}

function authHeaders(config: ImageGenConfig, json: boolean): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` }
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

function openAiPayload(config: ImageGenConfig, request: ImageGenRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = { model: config.model, prompt: request.prompt }
  if (request.size) payload.size = request.size
  return payload
}

/**
 * 火山方舟 Seedream：文生图与改图是同一个 generations 端点，请求体都是 JSON。
 * 改图把参考图编成 data URL 数组，而不是 OpenAI 式的 multipart。
 */
function seedreamRequest(
  config: ImageGenConfig,
  request: ImageGenRequest,
  images: ImageGenInputImage[],
): BuiltRequest {
  const body: Record<string, unknown> = {
    model: config.model,
    prompt: request.prompt,
    // 直接要 base64：省一次下载，也绕开 url 的 24 小时过期。
    response_format: 'b64_json',
  }
  if (request.size) body.size = request.size
  // 去水印按该供应商语义传：默认不发（用供应商默认），开启才明确关掉。
  if (config.disableWatermark) body.watermark = false
  if (images.length > 0) {
    body.images = images.map(image => `data:${image.mime};base64,${image.bytes.toString('base64')}`)
  }
  // 不传 n / sequential_image_generation：张数由客户端扇出，每次物理请求只要一张。
  return {
    url: `${config.baseUrl}/images/generations`,
    init: { method: 'POST', headers: authHeaders(config, true), body: JSON.stringify(body) },
  }
}

/**
 * 智谱 CogView：只有 JSON generations，没有 edits；data 数组恒为 1，也无批量参数。
 * 返回只有 url（30 天有效），由 collectImages 下载后落盘。
 */
function zhipuRequest(config: ImageGenConfig, request: ImageGenRequest): BuiltRequest {
  const body: Record<string, unknown> = { model: config.model, prompt: request.prompt }
  if (request.size) body.size = request.size
  // 去水印默认不发：智谱要求账号已签署免责声明，默认发 false 会让未签署账号直接报错。
  if (config.disableWatermark) body.watermark_enabled = false
  return {
    url: `${config.baseUrl}/images/generations`,
    init: { method: 'POST', headers: authHeaders(config, true), body: JSON.stringify(body) },
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
): Promise<{ images: GeneratedImage[]; failures: Array<{ code: ImageGenErrorCode; message: string }> }> {
  const data = (payload as { data?: unknown } | null)?.data
  const entries = Array.isArray(data) ? data : []
  const images: GeneratedImage[] = []
  const failures: Array<{ code: ImageGenErrorCode; message: string }> = []

  for (const item of entries) {
    const entry = (item ?? {}) as { b64_json?: unknown; url?: unknown; error?: unknown }
    // HTTP 200 里也可能逐图带 error（内容审核等）：那是失败项，不能冒充成功。
    if (entry.error != null) {
      failures.push({ code: 'provider', message: entryErrorMessage(entry.error) })
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
      failures.push({ code: isTimeout(err) ? 'timeout' : 'bad_image', message: errorText(err) })
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
  if (payload == null) return `HTTP ${status}`
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  // 先脱敏再截断：key 若横跨 500 边界，先截断会留下半截 key，redactKey 匹配不到完整 key。
  return redactKey(`HTTP ${status}: ${text ?? ''}`, key).slice(0, 500)
}