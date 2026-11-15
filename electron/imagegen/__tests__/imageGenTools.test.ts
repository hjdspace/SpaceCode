// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ImageGenConfig } from '@/shared/imageGenReference'
import type { LoopbackMcpContext } from '../../tools/loopbackMcpServer'
import { callImageGenTool, IMAGEGEN_MCP_TOOLS, IMAGEGEN_TOOL_NAMES } from '../imageGenTools'
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
    const result = await callImageGenTool('edit_image', { prompt: 'a cat' }, context, {
      loadConfig: () => CONFIG,
      fetchImpl: provider(order),
      authorize: allowing(order),
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('generate_image')
    expect(order).toEqual([])
  })
})

describe('工具面', () => {
  it('本期只暴露文生图单张，参数面收紧', () => {
    expect(IMAGEGEN_TOOL_NAMES).toEqual(['generate_image'])
    const schema = IMAGEGEN_MCP_TOOLS[0].inputSchema
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['prompt'])
    expect(Object.keys(schema.properties as Record<string, unknown>).sort()).toEqual(['nameHint', 'prompt', 'size'])
  })
})