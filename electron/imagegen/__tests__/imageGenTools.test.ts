// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ImageGenConfig } from '@/shared/imageGenReference'
import type { LoopbackMcpContext } from '../../tools/loopbackMcpServer'
import { callImageGenTool, IMAGEGEN_MAX_INPUT_IMAGES, IMAGEGEN_MCP_TOOLS, IMAGEGEN_TOOL_NAMES } from '../imageGenTools'
import type { ImageGenToolDeps } from '../imageGenTools'

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

function payload(result: { content: Array<{ text: string }> }): {
  model: string
  referenceCount?: number
  images: Array<{ path: string; size?: string }>
} {
  return JSON.parse(result.content[0].text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spacecode-imagegen-tools-'))
  context = { sessionId: 's1', projectRoot: root }
})

afterEach(() => {
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
    expect(existsSync(body.images[0].path)).toBe(true)

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
    expect(order).toEqual(['authorize'])
    expect(existsSync(join(root, 'outputs'))).toBe(false)
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

describe('工具面', () => {
  it('暴露文生图与改图，参数面收紧、参考图上限写进 schema', () => {
    expect(IMAGEGEN_TOOL_NAMES).toEqual(['generate_image', 'edit_image'])
    for (const tool of IMAGEGEN_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }

    const generate = IMAGEGEN_MCP_TOOLS[0].inputSchema
    expect(generate.required).toEqual(['prompt'])
    expect(Object.keys(generate.properties as Record<string, unknown>).sort()).toEqual(['nameHint', 'prompt', 'size'])

    const edit = IMAGEGEN_MCP_TOOLS[1].inputSchema
    expect(edit.required).toEqual(['prompt', 'imagePaths'])
    expect(Object.keys(edit.properties as Record<string, unknown>).sort()).toEqual(['imagePaths', 'nameHint', 'prompt', 'size'])
    const paths = (edit.properties as Record<string, { minItems: number; maxItems: number; items: { type: string } }>).imagePaths
    expect(paths.minItems).toBe(1)
    expect(paths.maxItems).toBe(IMAGEGEN_MAX_INPUT_IMAGES)
    expect(paths.items.type).toBe('string')
  })
})