/**
 * Agent 的生图工具面 —— 工具定义（JSON Schema）与调用分发。
 *
 * 这一层负责扇出、落盘、逐图报告，并把授权闸在第一个出站请求之前；配置读取与 fetch
 * 由参数注入，所以测试能真的 import 被测模块（ADR-0011）。
 *
 * 张数一律由这里扇出：每次物理请求只要一张，不用供应商的原生批量参数 —— 三种方言的
 * 批量语义各不相同，靠它们对齐等于把「按输入顺序返回」交给供应商。
 */
import { statSync } from 'fs'
import { generateImages, IMAGEGEN_CANCELLED_ERROR, type ImageGenInputImage, type ImageGenRequest } from './imageGenClient'
import { readInputImages } from './imageGenInput'
import { imageDimensions, saveImage } from './imageGenStore'
import { beginImageGenWork, type ImageGenWork } from './imageGenWork'
import type { ImageGenDecision, ImageGenAuthorizationRequest } from './imageGenAuthorization'
import type { ImageGenConfig, ImageGenPresetId } from '@/shared/imageGenReference'
import type { LoopbackMcpContext, LoopbackMcpToolDefinition, LoopbackMcpToolResult } from '../tools/loopbackMcpServer'

export const IMAGEGEN_MCP_SERVER_KEY = 'spacecode-imagegen'

/** 一次改图最多几张参考图。超限拒绝并说明上限，不截断。 */
export const IMAGEGEN_MAX_INPUT_IMAGES = 4

/** 同一 prompt 最多几张变体。超限拒绝并说明上限，不截断。 */
export const IMAGEGEN_MAX_VARIANTS = 4

/** 一次批量最多几条不同 prompt。超限拒绝并说明上限，不截断。 */
export const IMAGEGEN_MAX_BATCH = 8

/** 变体与批量共享同一个上限：一次调用最多两个在途计费请求。 */
export const IMAGEGEN_CONCURRENCY = 2

export interface ImageGenToolDeps {
  loadConfig: () => ImageGenConfig | null
  authorize: (request: ImageGenAuthorizationRequest) => Promise<ImageGenDecision>
  fetchImpl?: typeof fetch
}

const OBJECT_SCHEMA = { type: 'object', additionalProperties: false } as const
const SIZE_SCHEMA = { type: 'string', description: 'Image size, e.g. "1024x1024". Omit to use the provider default.' }
const NAME_HINT_SCHEMA = { type: 'string', description: 'File name stem for the saved image. Sanitised before use.' }
const VARIANTS_SCHEMA = {
  type: 'integer',
  minimum: 1,
  maximum: IMAGEGEN_MAX_VARIANTS,
  description: `How many variants of the same prompt to generate (1-${IMAGEGEN_MAX_VARIANTS}). Defaults to 1. Each variant is a separate billable request.`,
}

export const IMAGEGEN_MCP_TOOLS: LoopbackMcpToolDefinition[] = [
  {
    name: 'generate_image',
    description:
      'Generate a new raster image from a text prompt and save it into the workspace. Use for photos, illustrations, sprites, mockups and banners. For simple shapes, diagrams or icons that should match existing repo SVG assets, write code instead. When the user points at an existing image they want changed, use edit_image. For a set of different assets use generate_batch. Generation is billable, so the host asks the user for authorization before the request goes out.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        prompt: { type: 'string', description: 'Image description: scene, subject, style, composition, constraints.' },
        size: SIZE_SCHEMA,
        nameHint: NAME_HINT_SCHEMA,
        n: VARIANTS_SCHEMA,
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description:
      'Edit existing workspace images with a text instruction and save the result as a new file; the source images are never overwritten. State what must stay unchanged. Use this instead of generate_image whenever the user points at an existing image. Editing is billable, so the host asks the user for authorization before the request goes out. Not every provider supports editing: when the tool says so, report it and stop — never fall back to generating a fresh image.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        prompt: { type: 'string', description: 'What to change, plus what must stay unchanged.' },
        imagePaths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: IMAGEGEN_MAX_INPUT_IMAGES,
          description: `Reference image paths (1-${IMAGEGEN_MAX_INPUT_IMAGES}), absolute or workspace-relative. Must stay inside the workspace. PNG, JPEG or WebP, verified by signature rather than extension.`,
        },
        size: SIZE_SCHEMA,
        nameHint: NAME_HINT_SCHEMA,
        n: VARIANTS_SCHEMA,
      },
      required: ['prompt', 'imagePaths'],
    },
  },
  {
    name: 'generate_batch',
    description:
      `Generate a set of different images in one call: one independent asset per prompt (1-${IMAGEGEN_MAX_BATCH}). Use for icon sets, per-section illustrations or any group of distinct assets. For variants of the same prompt use generate_image with n instead. Every entry is a separate billable request; the host asks the user for authorization once, stating how many images will be generated. Results come back in input order with a per-image report.`,
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        prompts: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: IMAGEGEN_MAX_BATCH,
          description: `One independent asset per entry (1-${IMAGEGEN_MAX_BATCH}). Over the limit the call is rejected, not truncated.`,
        },
        size: SIZE_SCHEMA,
        nameHint: NAME_HINT_SCHEMA,
      },
      required: ['prompts'],
    },
  },
]

export const IMAGEGEN_TOOL_NAMES = IMAGEGEN_MCP_TOOLS.map(tool => tool.name)

const PROVIDER_LABELS: Record<Exclude<ImageGenPresetId, 'custom'>, string> = {
  openai: 'OpenAI',
  zhipu: 'Zhipu CogView',
  ark: 'Volcano Ark Seedream',
}

/** 自定义供应商没有名字可报，报端点 —— 用户要能看出这次钱付给了谁。 */
function providerLabel(config: ImageGenConfig): string {
  return config.presetId === 'custom'
    ? config.baseUrl.replace(/^https?:\/\//i, '')
    : PROVIDER_LABELS[config.presetId]
}

function json(payload: unknown): LoopbackMcpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function fail(message: string): LoopbackMcpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** 逐图三态。cancelled 与 failed 绝不折叠：前者没花钱，后者花了钱没拿到图。 */
interface ItemReport {
  status: 'succeeded' | 'failed' | 'cancelled'
  path?: string
  size?: string
  error?: string
  prompt?: string
}

/** 按输入顺序占位的工作池：谁先空出来谁领下一条，结果仍写回自己的下标。 */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function cancelledResult(items: ItemReport[]): LoopbackMcpToolResult {
  return json({ cancelled: true, images: items })
}

/**
 * 扇出 + 落盘 + 逐图报告。任一张成功即为成功 —— 第 3 张失败就丢掉前 2 张已画好的图，
 * 会让用户以为整次调用白费，而钱已经付了。
 */
async function runItems(
  config: ImageGenConfig,
  requests: ImageGenRequest[],
  root: string,
  nameHint: string | undefined,
  work: ImageGenWork,
  fetchImpl: typeof fetch | undefined,
  isBatch: boolean,
  referenceCount: number | undefined,
): Promise<LoopbackMcpToolResult> {
  let authError: string | null = null
  const outcomes = await mapWithLimit(requests, IMAGEGEN_CONCURRENCY, async request => {
    const outcome = await generateImages(config, request, fetchImpl, { signal: work.signal })
    // 401/403 就地止血：一个错 key 不该把整批排队项都烧成同样的付费失败。
    if (!outcome.ok && outcome.code === 'auth') {
      authError ??= outcome.error
      work.stop('auth')
    }
    return outcome
  })

  const items: ItemReport[] = []
  let model = config.model
  let saved = 0
  for (const [index, outcome] of outcomes.entries()) {
    const prompt = isBatch ? { prompt: requests[index].prompt } : {}
    if (!outcome.ok) {
      // 被鉴权止血丢掉的排队项报鉴权失败，不是用户取消：原因不同，用户的下一步也不同。
      const stoppedByAuth = outcome.code === 'cancelled' && work.stopReason === 'auth'
      items.push({
        status: stoppedByAuth || outcome.code !== 'cancelled' ? 'failed' : 'cancelled',
        error: stoppedByAuth ? (authError ?? outcome.error) : outcome.error,
        ...prompt,
      })
      continue
    }
    model = outcome.model
    for (const image of outcome.images) {
      try {
        const path = await saveImage(root, image.bytes, nameHint, saved)
        saved += 1
        const size = imageDimensions(image.bytes)
        items.push({ status: 'succeeded', path, ...(size ? { size } : {}), ...prompt })
      } catch (err) {
        items.push({ status: 'failed', error: err instanceof Error ? err.message : String(err), ...prompt })
      }
    }
  }

  const succeeded = items.filter(item => item.status === 'succeeded').length
  const cancelled = items.filter(item => item.status === 'cancelled').length
  // 全被取消是取消结果，不冒充通用失败：模型据此知道「没画」而不是「画失败了」。
  if (succeeded === 0 && cancelled === items.length) return cancelledResult(items)
  if (succeeded === 0) {
    const reasons = [...new Set(items.map(item => item.error).filter(Boolean))]
    return fail([...reasons, ...(cancelled ? [`${cancelled} item(s) were cancelled.`] : [])].join('\n'))
  }
  return json({ model, ...(referenceCount ? { referenceCount } : {}), images: items })
}

export async function callImageGenTool(
  name: string,
  rawArgs: unknown,
  context: LoopbackMcpContext,
  deps: ImageGenToolDeps,
): Promise<LoopbackMcpToolResult> {
  const args: Record<string, unknown> =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {}

  if (!IMAGEGEN_TOOL_NAMES.includes(name)) {
    return fail(`Unknown image tool "${name}". Available tools: ${IMAGEGEN_TOOL_NAMES.join(', ')}.`)
  }

  const config = deps.loadConfig()
  if (!config) {
    return fail('Image generation is not configured yet. Ask the user to open Settings → Image model, pick a provider and save an API key, then retry.')
  }
  const root = context.projectRoot
  if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return fail('This session has no workspace folder, so there is nowhere to save the image. Ask the user to open a workspace folder first.')
  }

  const size = typeof args.size === 'string' ? args.size : undefined
  const nameHint = typeof args.nameHint === 'string' ? args.nameHint : undefined
  const isBatch = name === 'generate_batch'
  const requests: ImageGenRequest[] = []
  let referenceCount: number | undefined

  if (isBatch) {
    const prompts = args.prompts
    if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > IMAGEGEN_MAX_BATCH) {
      return fail(`generate_batch needs a "prompts" array of 1-${IMAGEGEN_MAX_BATCH} prompts. Split the set into smaller batches; do not truncate it silently.`)
    }
    if (!prompts.every((prompt): prompt is string => typeof prompt === 'string' && prompt.trim().length > 0)) {
      return fail('generate_batch "prompts" must contain non-empty prompt strings.')
    }
    for (const prompt of prompts) requests.push({ prompt: prompt.trim(), size })
  } else {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (!prompt) return fail(`${name} needs a non-empty "prompt" string describing the image.`)
    const variants = args.n === undefined ? 1 : args.n
    if (typeof variants !== 'number' || !Number.isInteger(variants) || variants < 1 || variants > IMAGEGEN_MAX_VARIANTS) {
      return fail(`"n" must be an integer between 1 and ${IMAGEGEN_MAX_VARIANTS}. Ask for fewer variants per call; do not truncate the request silently.`)
    }

    // 参考图在授权之前读：读本地文件不花钱，路径不合格就别拿一张注定失败的卡去打扰用户。
    let references: ImageGenInputImage[] | undefined
    if (name === 'edit_image') {
      const paths = args.imagePaths
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > IMAGEGEN_MAX_INPUT_IMAGES) {
        return fail(`edit_image needs an "imagePaths" array of 1-${IMAGEGEN_MAX_INPUT_IMAGES} reference image paths.`)
      }
      if (!paths.every((path): path is string => typeof path === 'string' && path.trim().length > 0)) {
        return fail('edit_image "imagePaths" must contain non-empty path strings.')
      }
      try {
        references = await readInputImages(root, paths)
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
      referenceCount = references.length
    }
    for (let index = 0; index < variants; index += 1) requests.push({ prompt, size, images: references })
  }

  // 登记在授权之前：卡片还挂着时用户中止，也要能关掉这张卡并让本次调用返回取消。
  const work = beginImageGenWork(context.sessionId)
  try {
    const decision = await deps.authorize({
      sessionId: context.sessionId,
      provider: providerLabel(config),
      model: config.model,
      count: requests.length,
      prompt: requests[0].prompt,
      ...(referenceCount ? { referenceCount } : {}),
    })
    if (decision === 'deny') return fail('The user denied this image generation. Do not retry without asking them first.')
    if (decision === 'cancelled') {
      return cancelledResult(requests.map(request => ({ status: 'cancelled', error: IMAGEGEN_CANCELLED_ERROR, ...(isBatch ? { prompt: request.prompt } : {}) })))
    }
    return await runItems(config, requests, root, nameHint, work, deps.fetchImpl, isBatch, referenceCount)
  } finally {
    work.release()
  }
}