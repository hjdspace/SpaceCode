/**
 * Agent 的生图工具面 —— 工具定义（JSON Schema）与调用分发。
 *
 * 这一层负责把字节喂进落盘、把授权闸在第一个出站请求之前；配置读取与 fetch 由参数注入，
 * 所以测试能真的 import 被测模块（ADR-0011）。
 *
 * 本期有文生图与改图，都是一次一张：多变体与批量是后续票，方言层也只实现了 openai。
 */
import { statSync } from 'fs'
import { generateImages, type ImageGenInputImage } from './imageGenClient'
import { readInputImages } from './imageGenInput'
import { imageDimensions, saveImage } from './imageGenStore'
import type { ImageGenDecision, ImageGenAuthorizationRequest } from './imageGenAuthorization'
import type { ImageGenConfig, ImageGenPresetId } from '@/shared/imageGenReference'
import type { LoopbackMcpContext, LoopbackMcpToolDefinition, LoopbackMcpToolResult } from '../tools/loopbackMcpServer'

export const IMAGEGEN_MCP_SERVER_KEY = 'spacecode-imagegen'

/** 一次改图最多几张参考图。超限拒绝并说明上限，不截断。 */
export const IMAGEGEN_MAX_INPUT_IMAGES = 4

export interface ImageGenToolDeps {
  loadConfig: () => ImageGenConfig | null
  authorize: (request: ImageGenAuthorizationRequest) => Promise<ImageGenDecision>
  fetchImpl?: typeof fetch
}

const OBJECT_SCHEMA = { type: 'object', additionalProperties: false } as const
const SIZE_SCHEMA = { type: 'string', description: 'Image size, e.g. "1024x1024". Omit to use the provider default.' }
const NAME_HINT_SCHEMA = { type: 'string', description: 'File name stem for the saved image. Sanitised before use.' }

export const IMAGEGEN_MCP_TOOLS: LoopbackMcpToolDefinition[] = [
  {
    name: 'generate_image',
    description:
      'Generate a new raster image from a text prompt and save it into the workspace. Use for photos, illustrations, sprites, mockups and banners. For simple shapes, diagrams or icons that should match existing repo SVG assets, write code instead. When the user points at an existing image they want changed, use edit_image. Generation is billable, so the host asks the user for authorization before the request goes out.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        prompt: { type: 'string', description: 'Image description: scene, subject, style, composition, constraints.' },
        size: SIZE_SCHEMA,
        nameHint: NAME_HINT_SCHEMA,
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
      },
      required: ['prompt', 'imagePaths'],
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

export async function callImageGenTool(
  name: string,
  rawArgs: unknown,
  context: LoopbackMcpContext,
  deps: ImageGenToolDeps,
): Promise<LoopbackMcpToolResult> {
  const args: Record<string, unknown> =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {}

  if (name !== 'generate_image' && name !== 'edit_image') {
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
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt) return fail(`${name} needs a non-empty "prompt" string describing the image.`)

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
  }

  const decision = await deps.authorize({
    sessionId: context.sessionId,
    provider: providerLabel(config),
    model: config.model,
    count: 1,
    prompt,
    ...(references ? { referenceCount: references.length } : {}),
  })
  if (decision === 'deny') return fail('The user denied this image generation. Do not retry without asking them first.')

  const outcome = await generateImages(
    config,
    { prompt, size: typeof args.size === 'string' ? args.size : undefined, images: references },
    deps.fetchImpl,
  )
  if (!outcome.ok) return fail(outcome.error)

  const images: Array<{ path: string; size?: string }> = []
  for (const [index, image] of outcome.images.entries()) {
    const path = await saveImage(root, image.bytes, typeof args.nameHint === 'string' ? args.nameHint : undefined, index)
    const size = imageDimensions(image.bytes)
    images.push(size ? { path, size } : { path })
  }
  return json({ model: outcome.model, ...(references ? { referenceCount: references.length } : {}), images })
}