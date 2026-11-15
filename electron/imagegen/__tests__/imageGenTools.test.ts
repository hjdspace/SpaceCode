// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ImageGenConfig } from '@/shared/imageGenReference'
import type { LoopbackMcpContext } from '../../tools/loopbackMcpServer'
import { callImageGenTool, IMAGEGEN_MAX_BATCH, IMAGEGEN_MAX_INPUT_IMAGES, IMAGEGEN_MAX_VARIANTS, IMAGEGEN_MCP_TOOLS, IMAGEGEN_TOOL_NAMES } from '../imageGenTools'
import type { ImageGenToolDeps } from '../imageGenTools'
import { cancelAllImageGenWork, cancelImageGenWork } from '../imageGenWork'
import { createImageGenAuthorization, setImageGenAuthorization } from '../imageGenAuthorization'

const CONFIG: ImageGenConfig = {
  presetId: 'openai',
  dialect: 'openai',
  baseUrl: 'https://api.test/v1',
  apiKey: 'sk-test',
  model: 'gpt-image-1',
  disableWatermark: false,
}
/** 真 PNG 头（IHDR 里 1024x1024）：尺寸要从字节里读出来，不是供应商说了算。 */
const PNG = (() => {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(1024, 16)
  bytes.writeUInt32BE(1024, 20)
  return bytes
})()

let root: string
let context: LoopbackMcpContext

/** 与产物字节不同的源图（512x512）：两边一样的话「有没有被覆盖」根本分辨不出来。 */
const SOURCE_PNG = (() => {
  const bytes = Buffer.from(PNG)
  bytes.writeUInt32BE(512, 16)
  bytes.writeUInt32BE(512, 20)
  return bytes
})()

/** 智谱只回 url，下载回来的字节按签名定扩展名：给一段最小合法 JPEG。 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])

/** 探测本机能否创建符号链接（Windows 默认无权限）。不能则显式 skip，而非静默空跑假绿。 */
function detectSymlinkSupport(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'spacecode-symlink-probe-'))
  try {
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
const canSymlink = detectSymlinkSupport()

/** 回一张真 PNG 的供应商应答；order 用来钉「授权在第一个出站请求之前」。 */
function provider(order: string[], model = 'gpt-image-1'): typeof fetch {
  return vi.fn(async () => {
    order.push('fetch')
    // OpenAI 的 /images/generations 不回 size —— 照真实形状给，尺寸只能从字节里读
    return new Response(JSON.stringify({ model, data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 })
  }) as unknown as typeof fetch
}

function allowing(order: string[]): ImageGenToolDeps['authorize'] {
  return vi.fn(async () => {
    order.push('authorize')
    return 'allow' as const
  })
}

interface ReportItem {
  path?: string
  size?: string
  status?: 'succeeded' | 'failed' | 'cancelled'
  error?: string
  prompt?: string
}

function payload(result: { content: Array<{ text: string }> }): {
  model: string
  referenceCount?: number
  cancelled?: boolean
  images: ReportItem[]
} {
  return JSON.parse(result.content[0].text)
}

/** 每张图把序号编进 PNG 宽度：完成顺序与输入顺序不同时，才分辨得出报告有没有错位。 */
function pngOfWidth(width: number): Buffer {
  const bytes = Buffer.from(PNG)
  bytes.writeUInt32BE(width, 16)
  return bytes
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return init.body instanceof FormData
    ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, String(v)]))
    : JSON.parse(String(init.body))
}

/** 挂住直到自己的 signal 被中止：用来观察取消有没有真的传到 HTTP 层。 */
function hangingResponse(signal?: AbortSignal | null): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (!signal) return
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function calls(fetchImpl: typeof fetch): Array<[string, RequestInit]> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spacecode-imagegen-tools-'))
  context = { sessionId: 's1', projectRoot: root }
})

afterEach(() => {
  cancelAllImageGenWork('shutdown')
  setImageGenAuthorization(null)
  rmSync(root, { recursive: true, force: true })
})

describe('generate_image', () => {
  it('先取得宿主授权再发请求，落盘后回绝对路径、尺寸与真实模型名', async () => {
    const order: string[] = []
    const fetchImpl = provider(order, 'gpt-image-1-2026-04')
    const authorize = allowing(order)

    const result = await callImageGenTool(
      'generate_image',
      { prompt: 'a cat on a windowsill', nameHint: 'cat' },
      context,
      { loadConfig: () => CONFIG, fetchImpl, authorize },
    )

    expect(order).toEqual(['authorize', 'fetch'])
    expect(authorize).toHaveBeenCalledWith({
      sessionId: 's1',
      provider: 'OpenAI',
      model: 'gpt-image-1',
      count: 1,
      prompt: 'a cat on a windowsill',
    })
    expect(result.isError).toBeFalsy()

    const body = payload(result)
    expect(body.model).toBe('gpt-image-1-2026-04')
    expect(body.images).toHaveLength(1)
    expect(body.images[0].path).toBe(join(root, 'outputs', 'imagegen', 'cat.png'))
    expect(body.images[0].size).toBe('1024x1024')
    expect(existsSync(body.images[0].path!)).toBe(true)

    const text = result.content[0].text
    expect(text).not.toContain(PNG.toString('base64'))
    expect(text).not.toContain('sk-test')
  })

  it('没配 key 时点名设置分区，既不问授权也不发请求', async () => {
    const order: string[] = []
    const fetchImpl = provider(order)
    const authorize = allowing(order)

    const result = await callImageGenTool('generate_image', { prompt: 'a cat' }, context, {
      loadConfig: () => null,
      fetchImpl,
      authorize,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Image model')
    expect(order).toEqual([])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('会话没有工作区、或工作区不是目录时拒绝，不猜落盘位置', async () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'x')

    for (const projectRoot of [null, file]) {
      const order: string[] = []
      const result = await callImageGenTool('generate_image', { prompt: 'a cat' }, { sessionId: 's1', projectRoot }, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('workspace')
      expect(order).toEqual([])
    }
  })

  it('prompt 缺失、空白或不是字符串时拒绝，连授权都不问', async () => {
    for (const args of [{}, { prompt: '   ' }, { prompt: 42 }, { prompt: null }]) {
      const order: string[] = []
      const result = await callImageGenTool('generate_image', args, context, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('prompt')
      expect(order).toEqual([])
    }
  })

  it('用户拒绝时零出站、零落盘', async () => {
    const order: string[] = []
    const fetchImpl = provider(order)
    const authorize = vi.fn(async () => {
      order.push('authorize')
      return 'deny' as const
    })

    const result = await callImageGenTool('generate_image', { prompt: 'a cat' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize,
    })

    expect(result.isError).toBe(true)
    expect(order).toEqual(['authorize'])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('供应商失败时把原因原样递给模型，不落半张图', async () => {
    const order: string[] = []
    const fetchImpl = vi.fn(async () => {
      order.push('fetch')
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })
    }) as unknown as typeof fetch

    const result = await callImageGenTool('generate_image', { prompt: 'a cat' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing(order),
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('rate limited')
    expect(result.content[0].text).not.toContain('sk-test')
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('HTTP 200 但 b64 解出来是 HTML 错误页 → 签名不符，不落半成品文件', async () => {
    const order: string[] = []
    const html = Buffer.from('<!DOCTYPE html><html>502 Bad Gateway</html>').toString('base64')
    const fetchImpl = vi.fn(async () => {
      order.push('fetch')
      return new Response(JSON.stringify({ data: [{ b64_json: html }] }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await callImageGenTool('generate_image', { prompt: 'a cat' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing(order),
    })

    expect(result.isError).toBe(true)
    expect(order).toEqual(['authorize', 'fetch'])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('每次调用重新读配置：刚存好的 key 下一次就生效', async () => {
    const order: string[] = []
    let config: ImageGenConfig | null = null
    const deps: ImageGenToolDeps = {
      loadConfig: () => config,
      fetchImpl: provider(order),
      authorize: allowing(order),
    }

    expect((await callImageGenTool('generate_image', { prompt: 'a cat' }, context, deps)).isError).toBe(true)
    config = CONFIG
    expect((await callImageGenTool('generate_image', { prompt: 'a cat' }, context, deps)).isError).toBeFalsy()
  })

  it('未知工具名回可读错误并列出可用工具', async () => {
    const order: string[] = []
    const result = await callImageGenTool('nope', { prompt: 'a cat' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl: provider(order),
      authorize: allowing(order),
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('generate_image')
    expect(result.content[0].text).toContain('edit_image')
    expect(order).toEqual([])
  })
})

describe('edit_image', () => {
  it('读工作区内的参考图走 multipart 改图，结果落盘且源文件一字节未动', async () => {
    const source = join(root, 'src.png')
    writeFileSync(source, PNG)
    const order: string[] = []
    const fetchImpl = provider(order, 'gpt-image-1-2026-04')

    const result = await callImageGenTool(
      'edit_image',
      { prompt: 'make it warm', imagePaths: ['src.png'], nameHint: 'warm' },
      context,
      { loadConfig: () => CONFIG, fetchImpl, authorize: allowing(order) },
    )

    expect(result.isError).toBeFalsy()
    expect(order).toEqual(['authorize', 'fetch'])

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/images/edits')
    const form = init.body as FormData
    expect(form.get('prompt')).toBe('make it warm')
    expect(form.getAll('image')).toHaveLength(1)

    const body = payload(result)
    expect(body.model).toBe('gpt-image-1-2026-04')
    expect(body.referenceCount).toBe(1)
    expect(body.images[0].path).toBe(join(root, 'outputs', 'imagegen', 'warm.png'))
    expect(body.images[0].size).toBe('1024x1024')
    expect(readFileSync(source).equals(PNG)).toBe(true)
    expect(result.content[0].text).not.toContain('sk-test')
  })

  it('多张参考图按数组字段名送出，授权卡拿到张数', async () => {
    writeFileSync(join(root, 'a.png'), SOURCE_PNG)
    writeFileSync(join(root, 'b.png'), PNG)
    const order: string[] = []
    const fetchImpl = provider(order)
    const authorize = allowing(order)

    const result = await callImageGenTool(
      'edit_image',
      { prompt: 'combine them', imagePaths: ['a.png', 'b.png'] },
      context,
      { loadConfig: () => CONFIG, fetchImpl, authorize },
    )

    expect(result.isError).toBeFalsy()
    expect(authorize).toHaveBeenCalledWith({
      sessionId: 's1',
      provider: 'OpenAI',
      model: 'gpt-image-1',
      count: 1,
      prompt: 'combine them',
      referenceCount: 2,
    })
    const form = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(form.getAll('image')).toHaveLength(0)
    expect(payload(result).referenceCount).toBe(2)
  })

  it('源图就在输出目录且同名时版本化落盘，源文件绝不被覆盖', async () => {
    const dir = join(root, 'outputs', 'imagegen')
    mkdirSync(dir, { recursive: true })
    const source = join(dir, 'cat.png')
    writeFileSync(source, SOURCE_PNG)
    const order: string[] = []

    const result = await callImageGenTool(
      'edit_image',
      { prompt: 'make it warm', imagePaths: ['outputs/imagegen/cat.png'], nameHint: 'cat' },
      context,
      { loadConfig: () => CONFIG, fetchImpl: provider(order), authorize: allowing(order) },
    )

    expect(result.isError).toBeFalsy()
    expect(payload(result).images[0].path).toBe(join(dir, 'cat-v2.png'))
    expect(readFileSync(source).equals(SOURCE_PNG)).toBe(true)
    expect(readdirSync(dir).sort()).toEqual(['cat-v2.png', 'cat.png'])
  })

  it('imagePaths 缺失 / 空 / 超过 4 张 / 含非字符串 → 拒绝，不问授权也不发请求', async () => {
    const bad = [
      {},
      { imagePaths: [] },
      { imagePaths: ['a', 'b', 'c', 'd', 'e'] },
      { imagePaths: ['a.png', 3] },
      { imagePaths: ['  '] },
      { imagePaths: 'a.png' },
    ]
    for (const args of bad) {
      const order: string[] = []
      const result = await callImageGenTool('edit_image', { prompt: 'p', ...args }, context, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('imagePaths')
      expect(order).toEqual([])
    }
  })

  it('越界路径 → 拒绝，不读工作区外的字节', async () => {
    const outside = join(root, '..', 'outside-secret.png')
    writeFileSync(outside, PNG)
    try {
      for (const path of ['../outside-secret.png', outside]) {
        const order: string[] = []
        const result = await callImageGenTool('edit_image', { prompt: 'p', imagePaths: [path] }, context, {
          loadConfig: () => CONFIG,
          fetchImpl: provider(order),
          authorize: allowing(order),
        })
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toMatch(/outside/i)
        expect(order).toEqual([])
      }
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it.skipIf(!canSymlink)('软链接指向工作区外 → 拒绝，不问授权也不发请求', async () => {
    const outside = join(root, '..', 'outside-secret.png')
    writeFileSync(outside, PNG)
    try {
      symlinkSync(outside, join(root, 'link.png'), 'file')
      const order: string[] = []
      const result = await callImageGenTool('edit_image', { prompt: 'p', imagePaths: ['link.png'] }, context, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/outside/i)
      expect(order).toEqual([])
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('参考图签名不符（GIF / 文本 / 不存在）→ 拒绝，不问授权也不发请求', async () => {
    writeFileSync(join(root, 'anim.gif'), Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)]))
    writeFileSync(join(root, 'notes.png'), Buffer.from('not an image'))
    for (const path of ['anim.gif', 'notes.png', 'ghost.png']) {
      const order: string[] = []
      const result = await callImageGenTool('edit_image', { prompt: 'p', imagePaths: [path] }, context, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(order).toEqual([])
      expect(existsSync(join(root, 'outputs'))).toBe(false)
    }
  })

  it('用户拒绝改图时零出站、零落盘，源文件不动', async () => {
    const source = join(root, 'src.png')
    writeFileSync(source, SOURCE_PNG)
    const order: string[] = []
    const authorize = vi.fn(async () => {
      order.push('authorize')
      return 'deny' as const
    })

    const result = await callImageGenTool('edit_image', { prompt: 'p', imagePaths: ['src.png'] }, context, {
      loadConfig: () => CONFIG,
      fetchImpl: provider(order),
      authorize,
    })

    expect(result.isError).toBe(true)
    expect(order).toEqual(['authorize'])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
    expect(readFileSync(source).equals(SOURCE_PNG)).toBe(true)
  })

  it('改图失败就是失败：只发过 edits，绝不补一次重新生成', async () => {
    writeFileSync(join(root, 'src.png'), SOURCE_PNG)
    const order: string[] = []
    const fetchImpl = vi.fn(async () => {
      order.push('fetch')
      return new Response(JSON.stringify({ error: { message: 'Invalid image file' } }), { status: 400 })
    }) as unknown as typeof fetch

    const result = await callImageGenTool('edit_image', { prompt: 'p', imagePaths: ['src.png'] }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing(order),
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Invalid image file')
    expect(order).toEqual(['authorize', 'fetch'])
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string]>
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('https://api.test/v1/images/edits')
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('不支持改图的方言明确拒绝，不偷偷产出一张新图', async () => {
    writeFileSync(join(root, 'src.png'), SOURCE_PNG)
    const order: string[] = []
    const zhipu: ImageGenConfig = { ...CONFIG, presetId: 'zhipu', dialect: 'zhipu' }

    const result = await callImageGenTool('edit_image', { prompt: 'p', imagePaths: ['src.png'] }, context, {
      loadConfig: () => zhipu,
      fetchImpl: provider(order),
      authorize: allowing(order),
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('does not support image editing')
    expect(result.content[0].text).toContain('Image model')
    expect(order).toEqual(['authorize'])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })
})

describe('智谱 CogView', () => {
  const ZHIPU: ImageGenConfig = {
    presetId: 'zhipu',
    dialect: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: 'zp-key',
    model: 'cogview-4',
    disableWatermark: false,
  }

  it('授权卡的供应商与模型和实际发出的请求一致；只回 url 时下载后落盘', async () => {
    const order: string[] = []
    const fetchImpl = vi.fn(async (input: unknown) => {
      if (String(input).includes('images/generations')) {
        order.push('fetch')
        // 智谱只回 url（30 天有效）；用公网 IP 字面量，免去测试里的 DNS 解析。
        return new Response(JSON.stringify({ created: 1, data: [{ url: 'https://93.184.216.34/z.jpg' }] }), { status: 200 })
      }
      order.push('download')
      return new Response(JPEG, { status: 200 })
    }) as unknown as typeof fetch
    const authorize = allowing(order)

    const result = await callImageGenTool(
      'generate_image',
      { prompt: 'a cat on a windowsill', nameHint: 'cat' },
      context,
      { loadConfig: () => ZHIPU, fetchImpl, authorize },
    )

    expect(result.isError).toBeFalsy()
    expect(order).toEqual(['authorize', 'fetch', 'download'])
    expect(authorize).toHaveBeenCalledWith({
      sessionId: 's1',
      provider: 'Zhipu CogView',
      model: 'cogview-4',
      count: 1,
      prompt: 'a cat on a windowsill',
    })

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/images/generations')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'cogview-4', prompt: 'a cat on a windowsill' })

    const body = payload(result)
    expect(body.model).toBe('cogview-4')
    expect(body.images[0].path).toBe(join(root, 'outputs', 'imagegen', 'cat.jpg'))
    expect(readFileSync(body.images[0].path!).equals(JPEG)).toBe(true)
  })
})

describe('Seedream（火山方舟）', () => {
  const ARK: ImageGenConfig = {
    presetId: 'ark',
    dialect: 'seedream',
    baseUrl: 'https://ark.test/api/v3',
    apiKey: 'ark-key',
    model: 'doubao-seedream-4-0-250828',
    disableWatermark: true,
  }

  it('授权卡的供应商与模型，和实际发出的 JSON 请求一致', async () => {
    const order: string[] = []
    const fetchImpl = provider(order, ARK.model)
    const authorize = allowing(order)

    const result = await callImageGenTool('generate_image', { prompt: 'a cat' }, context, {
      loadConfig: () => ARK,
      fetchImpl,
      authorize,
    })

    expect(result.isError).toBeFalsy()
    expect(authorize).toHaveBeenCalledWith({
      sessionId: 's1',
      provider: 'Volcano Ark Seedream',
      model: 'doubao-seedream-4-0-250828',
      count: 1,
      prompt: 'a cat',
    })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ark.test/api/v3/images/generations')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('doubao-seedream-4-0-250828')
    expect(body.watermark).toBe(false)
    expect(body.images).toBeUndefined()
  })

  it('改图走同一个端点，参考图以 data URL 数组送出，授权卡报的是同一模型', async () => {
    writeFileSync(join(root, 'src.png'), SOURCE_PNG)
    const order: string[] = []
    const fetchImpl = provider(order, ARK.model)
    const authorize = allowing(order)

    const result = await callImageGenTool(
      'edit_image',
      { prompt: 'make it warm', imagePaths: ['src.png'] },
      context,
      { loadConfig: () => ARK, fetchImpl, authorize },
    )

    expect(result.isError).toBeFalsy()
    expect(authorize).toHaveBeenCalledWith({
      sessionId: 's1',
      provider: 'Volcano Ark Seedream',
      model: 'doubao-seedream-4-0-250828',
      count: 1,
      prompt: 'make it warm',
      referenceCount: 1,
    })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ark.test/api/v3/images/generations')
    expect(init.body).not.toBeInstanceOf(FormData)
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('doubao-seedream-4-0-250828')
    expect(body.images).toEqual([`data:image/png;base64,${SOURCE_PNG.toString('base64')}`])
  })
})

describe('批量（generate_batch）', () => {
  /** 按 prompt 回不同宽度的图，并让靠后的 prompt 先完成：错位与并发都能被看出来。 */
  function echoProvider(prompts: string[], onCall?: (index: number) => void): typeof fetch {
    let inFlight = 0
    let peak = 0
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      const prompt = String(bodyOf(init ?? {}).prompt)
      const index = prompts.indexOf(prompt)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      onCall?.(index)
      await new Promise(resolve => setTimeout(resolve, (prompts.length - index) * 4))
      inFlight -= 1
      return new Response(JSON.stringify({ data: [{ b64_json: pngOfWidth(1200 + index).toString('base64') }] }), { status: 200 })
    }) as unknown as ReturnType<typeof vi.fn>
    ;(impl as unknown as { peak: () => number }).peak = () => peak
    return impl as unknown as typeof fetch
  }

  it('每条 prompt 一次单图请求，报告按输入顺序、带各自的 prompt', async () => {
    const order: string[] = []
    const prompts = ['a red icon', 'a blue icon', 'a green icon']
    const fetchImpl = echoProvider(prompts, () => order.push('fetch'))
    const authorize = allowing(order)

    const result = await callImageGenTool('generate_batch', { prompts, nameHint: 'icon' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize,
    })

    expect(result.isError).toBeFalsy()
    expect(order).toEqual(['authorize', 'fetch', 'fetch', 'fetch'])
    expect(authorize).toHaveBeenCalledWith({
      sessionId: 's1',
      provider: 'OpenAI',
      model: 'gpt-image-1',
      count: 3,
      prompt: 'a red icon',
    })
    expect(calls(fetchImpl).map(([, init]) => bodyOf(init).prompt)).toEqual(prompts)
    for (const [, init] of calls(fetchImpl)) expect(bodyOf(init).n).toBeUndefined()

    const body = payload(result)
    expect(body.images.map(item => item.prompt)).toEqual(prompts)
    expect(body.images.map(item => item.size)).toEqual(['1200x1024', '1201x1024', '1202x1024'])
    expect(body.images.map(item => item.path)).toEqual([
      join(root, 'outputs', 'imagegen', 'icon.png'),
      join(root, 'outputs', 'imagegen', 'icon-2.png'),
      join(root, 'outputs', 'imagegen', 'icon-3.png'),
    ])
  })

  it('prompts 缺失 / 空 / 超过 8 条 / 含非字符串 → 拒绝并说明上限，不截断', async () => {
    const bad = [
      {},
      { prompts: [] },
      { prompts: Array.from({ length: IMAGEGEN_MAX_BATCH + 1 }, (_, i) => `p${i}`) },
      { prompts: ['x', 3] },
      { prompts: ['  '] },
      { prompts: 'x' },
    ]
    for (const args of bad) {
      const order: string[] = []
      const result = await callImageGenTool('generate_batch', args, context, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('prompts')
      expect(order).toEqual([])
      expect(existsSync(join(root, 'outputs'))).toBe(false)
    }
    const order: string[] = []
    const tooMany = await callImageGenTool(
      'generate_batch',
      { prompts: Array.from({ length: IMAGEGEN_MAX_BATCH + 1 }, (_, i) => `p${i}`) },
      context,
      { loadConfig: () => CONFIG, fetchImpl: provider(order), authorize: allowing(order) },
    )
    expect(tooMany.content[0].text).toContain(String(IMAGEGEN_MAX_BATCH))
  })

  it('批量与变体共享并发上限 2', async () => {
    const prompts = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']
    const batchFetch = echoProvider(prompts)
    await callImageGenTool('generate_batch', { prompts }, context, {
      loadConfig: () => CONFIG,
      fetchImpl: batchFetch,
      authorize: allowing([]),
    })
    expect((batchFetch as unknown as { peak: () => number }).peak()).toBe(2)

    const variantPrompts = ['same']
    const variantFetch = echoProvider(variantPrompts)
    await callImageGenTool('generate_image', { prompt: 'same', n: IMAGEGEN_MAX_VARIANTS }, context, {
      loadConfig: () => CONFIG,
      fetchImpl: variantFetch,
      authorize: allowing([]),
    })
    expect((variantFetch as unknown as { peak: () => number }).peak()).toBe(2)
    expect(calls(variantFetch)).toHaveLength(IMAGEGEN_MAX_VARIANTS)
  })

  it('部分失败仍算成功：成功的照常落盘，失败项带原因且不冒充成功', async () => {
    const prompts = ['ok one', 'bad one', 'ok two']
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const prompt = String(bodyOf(init ?? {}).prompt)
      if (prompt === 'bad one') {
        return new Response(JSON.stringify({ error: { message: 'content policy violation' } }), { status: 400 })
      }
      return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await callImageGenTool('generate_batch', { prompts, nameHint: 'set' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })

    expect(result.isError).toBeFalsy()
    const body = payload(result)
    expect(body.images.map(item => item.status)).toEqual(['succeeded', 'failed', 'succeeded'])
    expect(body.images[1].path).toBeUndefined()
    expect(body.images[1].error).toContain('content policy violation')
    expect(body.images[1].prompt).toBe('bad one')
    expect(existsSync(body.images[0].path!)).toBe(true)
    expect(existsSync(body.images[2].path!)).toBe(true)
    expect(readdirSync(join(root, 'outputs', 'imagegen'))).toHaveLength(2)
  })

  it('全部失败才返回工具错误，且一条 prompt 只发一次请求 —— 不自动重试', async () => {
    const prompts = ['p0', 'p1', 'p2']
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'upstream exploded' } }), { status: 500 })) as unknown as typeof fetch

    const result = await callImageGenTool('generate_batch', { prompts }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('upstream exploded')
    expect(calls(fetchImpl)).toHaveLength(prompts.length)
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })
})

describe('取消', () => {
  it('中止在途 HTTP、丢弃未开始的排队项，全被取消时返回取消结果', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => hangingResponse(init?.signal)) as unknown as typeof fetch

    const pending = callImageGenTool('generate_image', { prompt: 'a cat', n: IMAGEGEN_MAX_VARIANTS }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })
    await vi.waitFor(() => expect(calls(fetchImpl)).toHaveLength(2))
    cancelImageGenWork('s1', 'user')
    const result = await pending

    expect(result.isError).toBeFalsy()
    const body = payload(result)
    expect(body.cancelled).toBe(true)
    expect(body.images.map(item => item.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled'])
    // 只有并发上限内的两条真的出站，排队项在出站之前就被丢掉。
    expect(calls(fetchImpl)).toHaveLength(2)
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('取消保留已拿到的图：成功项照常落盘，其余记为已取消', async () => {
    const prompts = ['done', 'slow one', 'slow two']
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(bodyOf(init ?? {}).prompt) === 'done') {
        return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 })
      }
      return hangingResponse(init?.signal)
    }) as unknown as typeof fetch

    const pending = callImageGenTool('generate_batch', { prompts, nameHint: 'keep' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })
    await vi.waitFor(() => expect(calls(fetchImpl)).toHaveLength(3))
    cancelImageGenWork('s1', 'user')
    const result = await pending

    expect(result.isError).toBeFalsy()
    const body = payload(result)
    expect(body.cancelled).toBeUndefined()
    expect(body.images.map(item => item.status)).toEqual(['succeeded', 'cancelled', 'cancelled'])
    expect(existsSync(body.images[0].path!)).toBe(true)
    expect(readdirSync(join(root, 'outputs', 'imagegen'))).toHaveLength(1)
  })

  it('已取消与失败分开报告，不折叠成同一种状态', async () => {
    const prompts = ['ok', 'bad', 'slow one', 'slow two']
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const prompt = String(bodyOf(init ?? {}).prompt)
      if (prompt === 'ok') return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 })
      if (prompt === 'bad') return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 400 })
      return hangingResponse(init?.signal)
    }) as unknown as typeof fetch

    const pending = callImageGenTool('generate_batch', { prompts }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })
    await vi.waitFor(() => expect(calls(fetchImpl)).toHaveLength(4))
    cancelImageGenWork('s1', 'user')
    const result = await pending

    expect(result.isError).toBeFalsy()
    expect(payload(result).images.map(item => item.status)).toEqual(['succeeded', 'failed', 'cancelled', 'cancelled'])
  })

  it('授权卡还挂着时中止：卡片被关掉，工具返回取消且零出站', async () => {
    const closed: string[] = []
    const gate = createImageGenAuthorization({
      sendDialog: () => {},
      sendClosed: (_sessionId, event) => closed.push(event.reason),
      permissionMode: () => 'default',
    })
    setImageGenAuthorization(gate)
    const order: string[] = []
    const fetchImpl = provider(order)

    const pending = callImageGenTool('generate_image', { prompt: 'a cat', n: 2 }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: gate.authorize,
    })
    await vi.waitFor(() => expect(closed).toHaveLength(0))
    cancelImageGenWork('s1', 'user')
    const result = await pending

    expect(closed).toEqual(['aborted'])
    expect(result.isError).toBeFalsy()
    expect(payload(result).cancelled).toBe(true)
    expect(payload(result).images.map(item => item.status)).toEqual(['cancelled', 'cancelled'])
    expect(order).toEqual([])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('应用退出序列取消所有会话的在途生图', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => hangingResponse(init?.signal)) as unknown as typeof fetch
    const pending = callImageGenTool('generate_image', { prompt: 'a cat', n: 2 }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })
    await vi.waitFor(() => expect(calls(fetchImpl)).toHaveLength(2))
    cancelAllImageGenWork('shutdown')
    const result = await pending

    expect(result.isError).toBeFalsy()
    expect(payload(result).images.map(item => item.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('调用结束就注销登记：之后的取消不影响下一次调用', async () => {
    const order: string[] = []
    const deps: ImageGenToolDeps = { loadConfig: () => CONFIG, fetchImpl: provider(order), authorize: allowing(order) }
    expect((await callImageGenTool('generate_image', { prompt: 'a cat' }, context, deps)).isError).toBeFalsy()
    cancelImageGenWork('s1', 'user')
    expect((await callImageGenTool('generate_image', { prompt: 'a cat' }, context, deps)).isError).toBeFalsy()
  })

  it('取消不自动重试：中止后一条请求都不再补发', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => hangingResponse(init?.signal)) as unknown as typeof fetch
    const pending = callImageGenTool('generate_batch', { prompts: ['p0', 'p1', 'p2', 'p3'] }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })
    await vi.waitFor(() => expect(calls(fetchImpl)).toHaveLength(2))
    cancelImageGenWork('s1', 'user')
    await pending
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(calls(fetchImpl)).toHaveLength(2)
  })
})

describe('鉴权失败止血', () => {
  it('401 立刻掐掉剩余排队项，全部标为鉴权失败而不是用户取消', async () => {
    const prompts = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid api key sk-test' } }), { status: 401 })) as unknown as typeof fetch

    const result = await callImageGenTool('generate_batch', { prompts }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })

    expect(result.isError).toBe(true)
    // 并发上限内的两条已经出站，其余 4 条在出站之前就被掐掉 —— 一个错 key 不烧 6 次钱。
    expect(calls(fetchImpl)).toHaveLength(2)
    expect(result.content[0].text).toContain('auth:')
    expect(result.content[0].text).not.toContain('sk-test')
    expect(result.content[0].text).not.toContain('cancelled')
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })

  it('403 与 401 同样止血；已成功的图不受影响', async () => {
    const prompts = ['ok', 'p1', 'p2', 'p3']
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(bodyOf(init ?? {}).prompt) === 'ok') {
        return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 })
    }) as unknown as typeof fetch

    const result = await callImageGenTool('generate_batch', { prompts }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize: allowing([]),
    })

    expect(result.isError).toBeFalsy()
    const body = payload(result)
    expect(body.images[0].status).toBe('succeeded')
    expect(existsSync(body.images[0].path!)).toBe(true)
    for (const item of body.images.slice(1)) {
      expect(item.status).toBe('failed')
      expect(item.error).toMatch(/^auth: /)
    }
    expect(calls(fetchImpl).length).toBeLessThanOrEqual(2)
  })
})

describe('三种方言一致', () => {
  const DIALECTS: Array<[string, ImageGenConfig]> = [
    ['openai', CONFIG],
    ['seedream', { ...CONFIG, presetId: 'ark', dialect: 'seedream', baseUrl: 'https://ark.test/api/v3' }],
    ['zhipu', { ...CONFIG, presetId: 'zhipu', dialect: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }],
  ]

  /** 智谱只回 url，另两家回 b64：方言差异只在返回形态，批量与取消口径必须一样。 */
  function dialectProvider(config: ImageGenConfig, hang = false): typeof fetch {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('images/generations')) return new Response(PNG, { status: 200 })
      if (hang) return hangingResponse(init?.signal)
      const data = config.dialect === 'zhipu' ? [{ url: 'https://93.184.216.34/x.png' }] : [{ b64_json: PNG.toString('base64') }]
      return new Response(JSON.stringify({ data }), { status: 200 })
    }) as unknown as typeof fetch
  }

  it.each(DIALECTS)('%s：批量逐条单图请求，按输入顺序落盘', async (_label, config) => {
    const fetchImpl = dialectProvider(config)
    const result = await callImageGenTool('generate_batch', { prompts: ['first', 'second'], nameHint: 'd' }, context, {
      loadConfig: () => config,
      fetchImpl,
      authorize: allowing([]),
    })

    expect(result.isError).toBeFalsy()
    const generations = calls(fetchImpl).filter(([url]) => url.includes('images/generations'))
    expect(generations).toHaveLength(2)
    expect(generations.map(([, init]) => bodyOf(init).prompt)).toEqual(['first', 'second'])
    for (const [, init] of generations) {
      const body = bodyOf(init)
      expect(body.n).toBeUndefined()
      expect(body.sequential_image_generation).toBeUndefined()
    }
    const body = payload(result)
    expect(body.images.map(item => item.status)).toEqual(['succeeded', 'succeeded'])
    expect(body.images.map(item => item.prompt)).toEqual(['first', 'second'])
    for (const item of body.images) expect(existsSync(item.path!)).toBe(true)
  })

  it.each(DIALECTS)('%s：取消中止在途、丢掉排队项，全被取消返回取消结果', async (_label, config) => {
    const fetchImpl = dialectProvider(config, true)
    const pending = callImageGenTool('generate_batch', { prompts: ['p0', 'p1', 'p2', 'p3'] }, context, {
      loadConfig: () => config,
      fetchImpl,
      authorize: allowing([]),
    })
    await vi.waitFor(() => expect(calls(fetchImpl)).toHaveLength(2))
    cancelImageGenWork('s1', 'user')
    const result = await pending

    expect(result.isError).toBeFalsy()
    expect(payload(result).cancelled).toBe(true)
    expect(payload(result).images.map(item => item.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled'])
    expect(calls(fetchImpl)).toHaveLength(2)
    expect(existsSync(join(root, 'outputs'))).toBe(false)
  })
})

describe('工具面', () => {
  it('暴露文生图、改图与批量，参数面收紧、上限写进 schema', () => {
    expect(IMAGEGEN_TOOL_NAMES).toEqual(['generate_image', 'edit_image', 'generate_batch'])
    for (const tool of IMAGEGEN_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }

    const generate = IMAGEGEN_MCP_TOOLS[0].inputSchema
    expect(generate.required).toEqual(['prompt'])
    expect(Object.keys(generate.properties as Record<string, unknown>).sort()).toEqual(['n', 'nameHint', 'prompt', 'size'])

    const edit = IMAGEGEN_MCP_TOOLS[1].inputSchema
    expect(edit.required).toEqual(['prompt', 'imagePaths'])
    expect(Object.keys(edit.properties as Record<string, unknown>).sort()).toEqual(['imagePaths', 'n', 'nameHint', 'prompt', 'size'])
    const paths = (edit.properties as Record<string, { minItems: number; maxItems: number; items: { type: string } }>).imagePaths
    expect(paths.minItems).toBe(1)
    expect(paths.maxItems).toBe(IMAGEGEN_MAX_INPUT_IMAGES)
    expect(paths.items.type).toBe('string')

    const batch = IMAGEGEN_MCP_TOOLS[2].inputSchema
    expect(batch.required).toEqual(['prompts'])
    expect(Object.keys(batch.properties as Record<string, unknown>).sort()).toEqual(['nameHint', 'prompts', 'size'])
    const prompts = (batch.properties as Record<string, { minItems: number; maxItems: number; items: { type: string } }>).prompts
    expect(prompts.minItems).toBe(1)
    expect(prompts.maxItems).toBe(IMAGEGEN_MAX_BATCH)
    expect(prompts.items.type).toBe('string')

    for (const tool of [IMAGEGEN_MCP_TOOLS[0], IMAGEGEN_MCP_TOOLS[1]]) {
      const n = (tool.inputSchema.properties as Record<string, { type: string; minimum: number; maximum: number }>).n
      expect(n.type).toBe('integer')
      expect(n.minimum).toBe(1)
      expect(n.maximum).toBe(IMAGEGEN_MAX_VARIANTS)
    }
  })

  /** 上限是票面写死的数字：拿常量自比等于没测，改大常量必须让这里红。 */
  it('上限就是 4 张变体 / 8 条 prompt / 4 张参考图，多一个即拒', async () => {
    expect(IMAGEGEN_MAX_VARIANTS).toBe(4)
    expect(IMAGEGEN_MAX_BATCH).toBe(8)
    expect(IMAGEGEN_MAX_INPUT_IMAGES).toBe(4)

    const order: string[] = []
    const deps = { loadConfig: () => CONFIG, authorize: allowing(order), fetchImpl: provider(order) }

    const five = await callImageGenTool('generate_image', { prompt: 'p', n: 5 }, context, deps)
    expect(five.isError).toBe(true)
    expect(five.content[0].text).toContain('4')

    const nine = await callImageGenTool(
      'generate_batch',
      { prompts: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] },
      context,
      deps,
    )
    expect(nine.isError).toBe(true)
    expect(nine.content[0].text).toContain('8')

    // 拒在授权之前：一个注定被拒的请求不该拿卡片去打扰用户，更不该出站。
    expect(order).toEqual([])
  })
})

describe('多变体（n）', () => {
  it('n=3 扇出三次单图请求，按输入顺序报告，逐张落盘不撞名', async () => {
    const order: string[] = []
    let seq = 0
    // 完成顺序刻意与输入顺序相反：报告若按完成顺序排，宽度就会错位。
    const fetchImpl = vi.fn(async () => {
      const index = seq++
      order.push('fetch')
      await new Promise(resolve => setTimeout(resolve, (3 - index) * 5))
      return new Response(JSON.stringify({ data: [{ b64_json: pngOfWidth(1000 + index).toString('base64') }] }), { status: 200 })
    }) as unknown as typeof fetch
    const authorize = allowing(order)

    const result = await callImageGenTool('generate_image', { prompt: 'a cat', n: 3, nameHint: 'cat' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl,
      authorize,
    })

    expect(result.isError).toBeFalsy()
    expect(order).toEqual(['authorize', 'fetch', 'fetch', 'fetch'])
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }))
    expect(calls(fetchImpl)).toHaveLength(3)
    for (const [, init] of calls(fetchImpl)) {
      const body = bodyOf(init)
      expect(body.n).toBeUndefined()
      expect(body.batch_size).toBeUndefined()
      expect(body.sequential_image_generation).toBeUndefined()
    }

    const body = payload(result)
    expect(body.images.map(item => item.size)).toEqual(['1000x1024', '1001x1024', '1002x1024'])
    expect(body.images.map(item => item.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(body.images.map(item => item.path)).toEqual([
      join(root, 'outputs', 'imagegen', 'cat.png'),
      join(root, 'outputs', 'imagegen', 'cat-2.png'),
      join(root, 'outputs', 'imagegen', 'cat-3.png'),
    ])
    for (const item of body.images) expect(existsSync(item.path!)).toBe(true)
  })

  it('n 超上限 / 非整数 / 小于 1 → 拒绝并说明上限，不截断也不问授权', async () => {
    for (const n of [0, IMAGEGEN_MAX_VARIANTS + 1, 1.5, '2', null, -1]) {
      const order: string[] = []
      const result = await callImageGenTool('generate_image', { prompt: 'a cat', n }, context, {
        loadConfig: () => CONFIG,
        fetchImpl: provider(order),
        authorize: allowing(order),
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(String(IMAGEGEN_MAX_VARIANTS))
      expect(order).toEqual([])
      expect(existsSync(join(root, 'outputs'))).toBe(false)
    }
  })

  it('edit_image 的 n 同样扇出，每次物理请求都带同一批参考图', async () => {
    writeFileSync(join(root, 'src.png'), SOURCE_PNG)
    const order: string[] = []
    const fetchImpl = provider(order)
    const authorize = allowing(order)

    const result = await callImageGenTool(
      'edit_image',
      { prompt: 'make it warm', imagePaths: ['src.png'], n: 2, nameHint: 'warm' },
      context,
      { loadConfig: () => CONFIG, fetchImpl, authorize },
    )

    expect(result.isError).toBeFalsy()
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ count: 2, referenceCount: 1 }))
    expect(calls(fetchImpl)).toHaveLength(2)
    for (const [url, init] of calls(fetchImpl)) {
      expect(url).toBe('https://api.test/v1/images/edits')
      expect((init.body as FormData).getAll('image')).toHaveLength(1)
    }
    expect(payload(result).images).toHaveLength(2)
    expect(readFileSync(join(root, 'src.png')).equals(SOURCE_PNG)).toBe(true)
  })
})