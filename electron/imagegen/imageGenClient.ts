/**
 * 生图 HTTP 客户端 + 供应商方言层。
 *
 * 「OpenAI 兼容生图」不是一种协议而是三种方言：改图机制、批量参数、返回形态都不同。
 * 方言分派在这一层，工具层不感知。
 *
 * 本模块零 fs、零 electron：图片字节由调用方传入/取回，fetch 由参数注入。
 */
import type { ImageGenConfig } from '@/shared/imageGenReference'

export interface ImageGenRequest {
  prompt: string
  size?: string
}

export interface GeneratedImage {
  bytes: Buffer
}

export type ImageGenOutcome =
  | { ok: true; images: GeneratedImage[]; model: string }
  | { ok: false; error: string }

/** 供应商挂住时不能把这次 MCP 调用一起挂死。 */
export const IMAGEGEN_TIMEOUT_MS = 120_000

export async function generateImages(
  config: ImageGenConfig,
  request: ImageGenRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageGenOutcome> {
  // 方言不是「兼容协议」：本期只实现 openai，其余明确拒绝，不按 OpenAI 形状乱发请求。
  if (config.dialect !== 'openai') {
    return { ok: false, error: `Unsupported image dialect "${config.dialect}".` }
  }

  const body: Record<string, unknown> = { model: config.model, prompt: request.prompt }
  // 不发 response_format：gpt-image 系恒回 b64_json，dall-e 系默认回 url，两种都解。
  if (request.size) body.size = request.size

  const signal = AbortSignal.timeout(IMAGEGEN_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })

    const payload = await readJson(res)
    if (!res.ok) return { ok: false, error: providerMessage(payload, res.status) }

    const collected = await collectImages(payload, fetchImpl, signal)
    if ('error' in collected) return { ok: false, error: collected.error }
    if (collected.images.length === 0) return { ok: false, error: 'The provider returned no image data.' }

    const model = (payload as { model?: unknown } | null)?.model
    return {
      ok: true,
      images: collected.images,
      model: typeof model === 'string' && model ? model : config.model,
    }
  } catch (err) {
    return { ok: false, error: `Image request failed: ${String(err)}` }
  }
}

async function collectImages(
  payload: unknown,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<{ images: GeneratedImage[] } | { error: string }> {
  const data = (payload as { data?: unknown } | null)?.data
  const entries = Array.isArray(data) ? data : []
  const images: GeneratedImage[] = []

  for (const item of entries) {
    const entry = (item ?? {}) as { b64_json?: unknown; url?: unknown }
    if (typeof entry.b64_json === 'string' && entry.b64_json) {
      images.push({ bytes: Buffer.from(entry.b64_json, 'base64') })
      continue
    }
    if (typeof entry.url === 'string' && entry.url) {
      // 短期 url 由供应商 CDN 提供，凭证不该跟着过去：那是另一个域。
      const downloaded = await fetchImpl(entry.url, { signal })
      if (!downloaded.ok) return { error: `Failed to download generated image (HTTP ${downloaded.status}).` }
      images.push({ bytes: Buffer.from(await downloaded.arrayBuffer()) })
    }
  }
  return { images }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** 供应商错误结构各不相同，但都尽量把 message 递到模型面前；绝不回显我们自己的配置。 */
function providerMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const err = (payload as { error?: { message?: unknown } }).error
    if (err && typeof err.message === 'string' && err.message) return err.message
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return `HTTP ${status}: ${(text ?? '').slice(0, 500)}`
}