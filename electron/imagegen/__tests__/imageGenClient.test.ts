// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { decodeBoundedBase64, generateImages, imageMultipartFieldName } from '../imageGenClient'
import type { ImageGenConfig } from '@/shared/imageGenReference'

const OPENAI: ImageGenConfig = {
  presetId: 'openai',
  dialect: 'openai',
  baseUrl: 'https://api.test/v1',
  apiKey: 'sk-test',
  model: 'gpt-image-1',
  disableWatermark: false,
}

const ARK: ImageGenConfig = {
  presetId: 'ark',
  dialect: 'seedream',
  baseUrl: 'https://ark.test/api/v3',
  apiKey: 'ark-key',
  model: 'doubao-seedream-4-0-250828',
  disableWatermark: false,
}

const ZHIPU: ImageGenConfig = {
  presetId: 'zhipu',
  dialect: 'zhipu',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'zp-key',
  model: 'cogview-4',
  disableWatermark: false,
}

/** 完整签名的最小 PNG（8 字节魔数 + IHDR 首块），独立构造的已知良好字节。 */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x04, 0x00,
])
const PNG_B64 = PNG.toString('base64')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeFetch(responses: Array<Response | (() => Response)>): typeof fetch {
  let call = 0
  return vi.fn(async () => {
    const next = responses[Math.min(call, responses.length - 1)]
    call += 1
    return typeof next === 'function' ? next() : next
  }) as unknown as typeof fetch
}

function calls(fetchImpl: typeof fetch): Array<[string, RequestInit]> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<[string, RequestInit]>
}

describe('generateImages — OpenAI 文生图', () => {
  it('POST /images/generations，带 model/prompt，解 b64_json', async () => {
    const png = PNG
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: png.toString('base64') }] })])

    const outcome = await generateImages(OPENAI, { prompt: 'a cat' }, fetchImpl)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images[0].bytes.equals(png)).toBe(true)
    expect(outcome.model).toBe('gpt-image-1')

    const [url, init] = calls(fetchImpl)[0]
    expect(url).toBe('https://api.test/v1/images/generations')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'gpt-image-1', prompt: 'a cat' })
  })

  it('size 给了就带，没给就不带 —— 不替用户编造尺寸', async () => {
    const withSize = fakeFetch([jsonResponse({ data: [{ b64_json: 'AA==' }] })])
    await generateImages(OPENAI, { prompt: 'p', size: '1024x1536' }, withSize)
    expect(JSON.parse(calls(withSize)[0][1].body as string).size).toBe('1024x1536')

    const without = fakeFetch([jsonResponse({ data: [{ b64_json: 'AA==' }] })])
    await generateImages(OPENAI, { prompt: 'p' }, without)
    expect(JSON.parse(calls(without)[0][1].body as string)).not.toHaveProperty('size')
  })

  it('只回 url 时下载字节，且下载不带供应商凭证', async () => {
    const bytes = JPEG
    const fetchImpl = fakeFetch([
      jsonResponse({ data: [{ url: 'https://cdn.test/a.jpg' }] }),
      new Response(bytes, { status: 200 }),
    ])

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images[0].bytes.equals(bytes)).toBe(true)
    const [downloadUrl, downloadInit] = calls(fetchImpl)[1]
    expect(downloadUrl).toBe('https://cdn.test/a.jpg')
    expect((downloadInit?.headers ?? {}) as Record<string, string>).not.toHaveProperty('Authorization')
  })

  it('上游 4xx 把供应商 message 递给模型，且不回显 key', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ error: { message: 'Invalid model' } }, 400)])

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome).toEqual({ ok: false, code: 'provider', error: expect.stringContaining('Invalid model') })
    if (outcome.ok) return
    expect(outcome.error).not.toContain('sk-test')
  })

  it('未知方言明确拒绝，不按 OpenAI 形状乱发', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: 'AA==' }] })])
    const outcome = await generateImages(
      { ...OPENAI, dialect: 'mystery' as ImageGenConfig['dialect'] },
      { prompt: 'p' },
      fetchImpl,
    )
    expect(outcome).toEqual({ ok: false, code: 'provider', error: expect.stringContaining('Unsupported image dialect') })
    expect(calls(fetchImpl)).toHaveLength(0)
  })

  it('拿不到图一律回 ok:false：空 data、既无 url 也无 b64、下载失败、传输抛错', async () => {
    const badShapes = [
      jsonResponse({ data: [] }),
      jsonResponse({ data: [{ revised_prompt: 'x' }] }),
      jsonResponse({}),
    ]
    for (const response of badShapes) {
      const outcome = await generateImages(OPENAI, { prompt: 'p' }, fakeFetch([response]))
      expect(outcome.ok).toBe(false)
    }

    const expired = fakeFetch([
      jsonResponse({ data: [{ url: 'https://cdn.test/expired.jpg' }] }),
      new Response('gone', { status: 403 }),
    ])
    expect((await generateImages(OPENAI, { prompt: 'p' }, expired, { lookupImpl: publicLookup })).ok).toBe(false)

    const broken = vi.fn(async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof fetch
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, broken)
    expect(outcome).toEqual({ ok: false, code: 'network', error: expect.stringContaining('socket hang up') })
  })
})

describe('generateImages — 不受信响应硬化', () => {
  it('JSON 响应 content-length 超限 → ok:false，不吃满内存', async () => {
    const fetchImpl = fakeFetch([
      new Response('{}', { status: 200, headers: { 'content-length': String(64 * 1024 * 1024 + 1) } }),
    ])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toMatch(/limit/i)
  })

  it('b64_json 解码后是 HTML 错误页 → ok:false（签名不符）', async () => {
    const html = Buffer.from('<!DOCTYPE html><html>502 Bad Gateway</html>').toString('base64')
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: html }] })])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome.ok).toBe(false)
  })

  it('b64_json 只有 4 字节 PNG 魔数（缺 IHDR）→ ok:false', async () => {
    const partial = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: partial }] })])
    expect((await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)).ok).toBe(false)
  })

  it('b64_json 格式非法 → ok:false', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: '!!!not-base64!!!' }] })])
    expect((await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)).ok).toBe(false)
  })

  it('HTTP 200 内逐图 error → 识别为失败项，全失败时 ok:false 且带原因', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ error: { code: 'x', message: 'content policy violation' } }] })])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome).toEqual({ ok: false, code: 'provider', error: expect.stringContaining('content policy violation') })
  })

  it('HTTP 200 内一成功一逐图 error → 成功项照常返回，失败项不冒充成功', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ data: [{ b64_json: PNG_B64 }, { error: { message: 'content policy' } }] }),
    ])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images).toHaveLength(1)
    expect(outcome.images[0].bytes.equals(PNG)).toBe(true)
  })

  it('供应商错误回显了 key → surfaced 错误里脱敏，绝不回显', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ error: { message: 'bad key sk-test leaked' } }, 401)])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('bad key')
    expect(outcome.error).not.toContain('sk-test')
  })

  it('fallback 错误体里 key 跨 500 截断边界 → 先脱敏再截断，不残留半截 key', async () => {
    // 纯字符串错误体走 text.slice(0,500) 的 fallback。让 key 从第 497 字符起：
    // 若先截断后脱敏，slice 会留下 'sk-' 半截，redactKey 找完整 key 匹配不到 → 泄露。
    const body = 'x'.repeat(497) + 'sk-testTAIL'
    const fetchImpl = fakeFetch([jsonResponse(body, 400)])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).not.toContain('sk-test')
    expect(outcome.error).not.toContain('sk-')
  })

  it('逐图 error 回显 key → failures 路径也脱敏', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ error: { message: 'bad sk-test here' } }] })])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('bad')
    expect(outcome.error).not.toContain('sk-test')
  })

  it('传输抛错且错误里带 key → catch 路径也脱敏', async () => {
    const broken = vi.fn(async () => {
      throw new Error('connect failed sk-test')
    }) as unknown as typeof fetch
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, broken)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).not.toContain('sk-test')
  })

  it('供应商给的下载 URL 指向元数据/内网 → ok:false，不发下载请求', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/a.png', 'ftp://host/a.png']) {
      const fetchImpl = fakeFetch([jsonResponse({ data: [{ url }] }), new Response(JPEG)])
      const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })
      expect(outcome.ok).toBe(false)
      expect(calls(fetchImpl)).toHaveLength(1) // 只有 generations，没有下载
    }
  })

  it('下载 URL 内嵌凭证 → ok:false', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ url: 'https://user:pass@cdn.test/a.png' }] }), new Response(JPEG)])
    expect((await generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })).ok).toBe(false)
    expect(calls(fetchImpl)).toHaveLength(1)
  })
})

describe('decodeBoundedBase64', () => {
  it('合法 base64 正常解码', () => {
    expect(decodeBoundedBase64(PNG_B64).equals(PNG)).toBe(true)
  })

  it('长度上界先行拒绝（小上限即可验证，无需分配巨串）', () => {
    const b64 = Buffer.alloc(9).toString('base64') // 12 字符 > maxBytes=3 对应的 4 字符上界
    expect(() => decodeBoundedBase64(b64, 3)).toThrow(/limit/i)
  })

  it('格式非法拒绝', () => {
    expect(() => decodeBoundedBase64('abcd!')).toThrow(/malformed/i)
    expect(() => decodeBoundedBase64('abc')).toThrow(/malformed/i) // 长度非 4 倍数
  })

  it('多兆字符串格式校验不递归爆栈（非分组字符类正则）', () => {
    const huge = 'A'.repeat(2 * 1024 * 1024) // 2MB 合法 base64 字符，长度是 4 倍数
    const bytes = decodeBoundedBase64(huge)
    expect(bytes.length).toBe(1572864)
  })
})

describe('generateImages — OpenAI 改图', () => {
  it('一张参考图走 /images/edits，multipart 用单数字段名 image', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])

    const outcome = await generateImages(
      OPENAI,
      { prompt: 'make it warm', images: [{ bytes: PNG, mime: 'image/png' }] },
      fetchImpl,
    )

    expect(outcome.ok).toBe(true)
    const [url, init] = calls(fetchImpl)[0]
    expect(url).toBe('https://api.test/v1/images/edits')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('prompt')).toBe('make it warm')
    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('image[]')).toHaveLength(0)
    // boundary 必须由 fetch 自己生成，手写 Content-Type 会让上游解析失败
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })
  it('多张参考图用数组字段名 image[]，字节与类型原样送出', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])

    await generateImages(
      OPENAI,
      { prompt: 'combine', images: [{ bytes: PNG, mime: 'image/png' }, { bytes: JPEG, mime: 'image/jpeg' }] },
      fetchImpl,
    )

    const form = calls(fetchImpl)[0][1].body as FormData
    expect(form.getAll('image')).toHaveLength(0)
    const parts = form.getAll('image[]') as File[]
    expect(parts).toHaveLength(2)
    expect(parts[0].type).toBe('image/png')
    expect(Buffer.from(await parts[0].arrayBuffer()).equals(PNG)).toBe(true)
    expect(parts[1].type).toBe('image/jpeg')
    expect(Buffer.from(await parts[1].arrayBuffer()).equals(JPEG)).toBe(true)
  })

  it('改图也带 size（给了才带）', async () => {
    const withSize = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    await generateImages(OPENAI, { prompt: 'p', size: '1024x1536', images: [{ bytes: PNG, mime: 'image/png' }] }, withSize)
    expect((calls(withSize)[0][1].body as FormData).get('size')).toBe('1024x1536')

    const without = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    await generateImages(OPENAI, { prompt: 'p', images: [{ bytes: PNG, mime: 'image/png' }] }, without)
    expect((calls(without)[0][1].body as FormData).get('size')).toBeNull()
  })

  it('改图失败就是失败：只发过 edits，绝不补一次 generations', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ error: { message: 'Invalid image file' } }, 400)])

    const outcome = await generateImages(OPENAI, { prompt: 'p', images: [{ bytes: PNG, mime: 'image/png' }] }, fetchImpl)

    expect(outcome).toEqual({ ok: false, code: 'provider', error: expect.stringContaining('Invalid image file') })
    expect(calls(fetchImpl)).toHaveLength(1)
    expect(calls(fetchImpl)[0][0]).toBe('https://api.test/v1/images/edits')
  })

  it('不支持改图的智谱方言明确拒绝，零出站，绝不降级成重新生成', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])

    const outcome = await generateImages(
      { ...OPENAI, dialect: 'zhipu' },
      { prompt: 'make it warm', images: [{ bytes: PNG, mime: 'image/png' }] },
      fetchImpl,
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('does not support image editing')
    expect(outcome.error).toContain('zhipu')
    expect(calls(fetchImpl)).toHaveLength(0)
  })
})

describe('imageMultipartFieldName — 单图/多图字段名规则', () => {
  it('一张用单数字段名 image', () => {
    expect(imageMultipartFieldName(1)).toBe('image')
  })

  it('多张用数组字段名 image[]', () => {
    for (const count of [2, 3, 4]) {
      expect(imageMultipartFieldName(count)).toBe('image[]')
    }
  })
})

describe('generateImages — Seedream 方言（火山方舟）', () => {
  it('文生图走 JSON generations，请求 b64_json 并直接解出字节', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ model: 'doubao-seedream-4-0-250828', data: [{ b64_json: PNG_B64 }] })])
    const outcome = await generateImages(ARK, { prompt: 'a cat' }, fetchImpl)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images[0].bytes.equals(PNG)).toBe(true)
    expect(outcome.model).toBe('doubao-seedream-4-0-250828')

    const [url, init] = calls(fetchImpl)[0]
    expect(url).toBe('https://ark.test/api/v3/images/generations')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ark-key')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'doubao-seedream-4-0-250828',
      prompt: 'a cat',
      response_format: 'b64_json',
    })
  })

  it('只回 url 时由主进程下载，下载不带供应商凭证且过签名校验', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ data: [{ url: 'https://cdn.test/a.jpg' }] }),
      new Response(JPEG, { status: 200 }),
    ])
    const outcome = await generateImages(ARK, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images[0].bytes.equals(JPEG)).toBe(true)
    const [downloadUrl, downloadInit] = calls(fetchImpl)[1]
    expect(downloadUrl).toBe('https://cdn.test/a.jpg')
    expect((downloadInit?.headers ?? {}) as Record<string, string>).not.toHaveProperty('Authorization')
  })

  it('返回的 base64 不是图片（签名不符）→ 失败项，不冒充成功', async () => {
    const html = Buffer.from('<!DOCTYPE html><html>502 Bad Gateway</html>').toString('base64')
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: html }] })])
    expect((await generateImages(ARK, { prompt: 'p' }, fetchImpl)).ok).toBe(false)
  })

  it('改图走同一个 generations 端点，参考图编成 data URL 数组，不是 multipart', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    const outcome = await generateImages(
      ARK,
      {
        prompt: 'make it warm',
        size: '2K',
        images: [{ bytes: PNG, mime: 'image/png' }, { bytes: JPEG, mime: 'image/jpeg' }],
      },
      fetchImpl,
    )

    expect(outcome.ok).toBe(true)
    const [url, init] = calls(fetchImpl)[0]
    expect(url).toBe('https://ark.test/api/v3/images/generations')
    expect(init.body).not.toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'doubao-seedream-4-0-250828',
      prompt: 'make it warm',
      response_format: 'b64_json',
      size: '2K',
      images: [`data:image/png;base64,${PNG_B64}`, `data:image/jpeg;base64,${JPEG.toString('base64')}`],
    })
  })

  it('张数仍由客户端扇出：每次物理请求只要一张，不发 n / sequential_image_generation', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    await generateImages(ARK, { prompt: 'p' }, fetchImpl)

    expect(calls(fetchImpl)).toHaveLength(1)
    const body = JSON.parse(calls(fetchImpl)[0][1].body as string)
    expect(body).not.toHaveProperty('n')
    expect(body).not.toHaveProperty('sequential_image_generation')
    expect(body).not.toHaveProperty('sequential_image_generation_options')
  })

  it('去水印按该供应商语义传：开启才发 watermark:false', async () => {
    const byDefault = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    await generateImages(ARK, { prompt: 'p' }, byDefault)
    expect(JSON.parse(calls(byDefault)[0][1].body as string)).not.toHaveProperty('watermark')

    const disabled = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    await generateImages({ ...ARK, disableWatermark: true }, { prompt: 'p' }, disabled)
    expect(JSON.parse(calls(disabled)[0][1].body as string).watermark).toBe(false)
  })

  it('HTTP 200 内一成功一逐图 error → 任一成功即成功，失败项不冒充成功', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({
        data: [
          { b64_json: PNG_B64 },
          { error: { code: 'OutputImageSensitiveContentDetected', message: 'content policy' } },
        ],
      }),
    ])
    const outcome = await generateImages(ARK, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images).toHaveLength(1)
    expect(outcome.images[0].bytes.equals(PNG)).toBe(true)
  })

  it('HTTP 200 内全部逐图 error → ok:false 且带原因', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ error: { message: 'content policy violation' } }] })])
    const outcome = await generateImages(ARK, { prompt: 'p' }, fetchImpl)
    expect(outcome).toEqual({ ok: false, code: 'provider', error: expect.stringContaining('content policy violation') })
  })

  it('鉴权失败把供应商消息递给模型，不回显 key，且不重试', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ error: { code: 'AuthenticationError', message: 'invalid api key ark-key' } }, 401),
    ])
    const outcome = await generateImages(ARK, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('invalid api key')
    expect(outcome.error).not.toContain('ark-key')
    expect(calls(fetchImpl)).toHaveLength(1)
  })
})

describe('generateImages — 智谱方言', () => {
  it('文生图走 JSON generations，只回 url 时由主进程下载，下载不带供应商凭证', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ created: 1, data: [{ url: 'https://cdn.test/z.jpg' }] }),
      new Response(JPEG, { status: 200 }),
    ])

    const outcome = await generateImages(ZHIPU, { prompt: 'a cat' }, fetchImpl, { lookupImpl: publicLookup })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images[0].bytes.equals(JPEG)).toBe(true)
    expect(outcome.model).toBe('cogview-4')

    const [url, init] = calls(fetchImpl)[0]
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/images/generations')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer zp-key')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'cogview-4', prompt: 'a cat' })

    const [downloadUrl, downloadInit] = calls(fetchImpl)[1]
    expect(downloadUrl).toBe('https://cdn.test/z.jpg')
    expect((downloadInit?.headers ?? {}) as Record<string, string>).not.toHaveProperty('Authorization')
  })

  it('不发任何批量参数：该端点的 data 数组恒为 1，张数一律客户端扇出', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] }), new Response(JPEG)])
    await generateImages(ZHIPU, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })

    const body = JSON.parse(calls(fetchImpl)[0][1].body as string)
    for (const key of ['n', 'response_format', 'sequential_image_generation', 'sequential_image_generation_options']) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('size 给了才带', async () => {
    const withSize = fakeFetch([jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] }), new Response(JPEG)])
    await generateImages(ZHIPU, { prompt: 'p', size: '1024x1024' }, withSize, { lookupImpl: publicLookup })
    expect(JSON.parse(calls(withSize)[0][1].body as string).size).toBe('1024x1024')

    const without = fakeFetch([jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] }), new Response(JPEG)])
    await generateImages(ZHIPU, { prompt: 'p' }, without, { lookupImpl: publicLookup })
    expect(JSON.parse(calls(without)[0][1].body as string)).not.toHaveProperty('size')
  })

  it('去水印默认关：未开启时不发 watermark_enabled，开启才明确关掉', async () => {
    const byDefault = fakeFetch([jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] }), new Response(JPEG)])
    await generateImages(ZHIPU, { prompt: 'p' }, byDefault, { lookupImpl: publicLookup })
    expect(JSON.parse(calls(byDefault)[0][1].body as string)).not.toHaveProperty('watermark_enabled')

    const disabled = fakeFetch([jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] }), new Response(JPEG)])
    await generateImages({ ...ZHIPU, disableWatermark: true }, { prompt: 'p' }, disabled, { lookupImpl: publicLookup })
    expect(JSON.parse(calls(disabled)[0][1].body as string).watermark_enabled).toBe(false)
  })

  it('下载失败 → ok:false，不返回半张图', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] }),
      new Response('gone', { status: 403 }),
    ])
    const outcome = await generateImages(ZHIPU, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })
    expect(outcome.ok).toBe(false)
    expect(calls(fetchImpl)).toHaveLength(2)
  })

  it('改图直接拒绝：零出站，绝不降级成重新生成', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ url: 'https://cdn.test/z.jpg' }] })])

    const outcome = await generateImages(
      ZHIPU,
      { prompt: 'make it warm', images: [{ bytes: PNG, mime: 'image/png' }] },
      fetchImpl,
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('does not support image editing')
    expect(outcome.error).toContain('zhipu')
    expect(outcome.error).toContain('Settings → Image model')
    expect(calls(fetchImpl)).toHaveLength(0)
  })
})

/** 挂住直到自己的 signal 被中止：用来观察「外部取消有没有真的传到 HTTP 层」。 */
function hangingFetch(): typeof fetch {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) return
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })) as unknown as typeof fetch
}

describe('generateImages — 外部中止', () => {
  it('外部信号中止在途 HTTP，结果是 cancelled 而不是通用失败，且不重试', async () => {
    const fetchImpl = hangingFetch()
    const controller = new AbortController()

    const pending = generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { signal: controller.signal })
    controller.abort('user')
    const outcome = await pending

    expect(outcome).toEqual({ ok: false, code: 'cancelled', error: expect.stringContaining('cancelled') })
    expect(calls(fetchImpl)).toHaveLength(1)
  })

  it('子请求继承同一信号：fetch 拿到的 signal 随外部中止而中止', async () => {
    const fetchImpl = hangingFetch()
    const controller = new AbortController()

    const pending = generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { signal: controller.signal })
    const sent = calls(fetchImpl)[0][1].signal as AbortSignal
    expect(sent.aborted).toBe(false)

    controller.abort('user')
    expect(sent.aborted).toBe(true)
    await pending
  })

  it('信号已经中止时零出站', async () => {
    const fetchImpl = hangingFetch()
    const controller = new AbortController()
    controller.abort('user')

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { signal: controller.signal })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('cancelled')
    expect(calls(fetchImpl)).toHaveLength(0)
  })

  it('下载阶段被中止同样报 cancelled，不冒充「图片数据无效」', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('images/generations')) {
        return jsonResponse({ data: [{ url: 'https://93.184.216.34/z.jpg' }] })
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        // 下载真的发出去了才中止：证明中止发生在下载途中，而不是请求之前。
        queueMicrotask(() => controller.abort('user'))
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }) as unknown as typeof fetch

    const outcome = await generateImages(ZHIPU, { prompt: 'p' }, fetchImpl, {
      signal: controller.signal,
      lookupImpl: publicLookup,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('cancelled')
  })

  it('中止前已经拿到的图照常返回：付过钱的产物不丢', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      controller.abort('user')
      return jsonResponse({ data: [{ b64_json: PNG_B64 }] })
    }) as unknown as typeof fetch

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl, { signal: controller.signal })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.images[0].bytes.equals(PNG)).toBe(true)
  })

  it('不给外部信号时行为不变：成功、超时与失败照旧', async () => {
    const ok = await generateImages(OPENAI, { prompt: 'p' }, fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })]))
    expect(ok.ok).toBe(true)

    const timedOut = await generateImages(OPENAI, { prompt: 'p' }, fakeFetch([
      () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') },
    ]))
    expect(timedOut.ok).toBe(false)
    if (timedOut.ok) return
    expect(timedOut.code).toBe('timeout')

    const rejected = await generateImages(OPENAI, { prompt: 'p' }, fakeFetch([jsonResponse({ error: { message: 'invalid key' } }, 401)]))
    expect(rejected.ok).toBe(false)
    if (rejected.ok) return
    expect(rejected.code).toBe('auth')
  })
})

describe('generateImages — 稳定错误码', () => {
  it.each([401, 403])('HTTP %i 是鉴权失败，供上层就地止血', async status => {
    const fetchImpl = fakeFetch([jsonResponse({ error: { message: 'invalid key sk-test' } }, status)])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('auth')
    expect(outcome.error).toMatch(/^auth: /)
    expect(outcome.error).not.toContain('sk-test')
    expect(calls(fetchImpl)).toHaveLength(1)
  })

  it('401 的错误体读不出来时仍是鉴权失败，不退回坏图', async () => {
    const brokenBody = new ReadableStream({
      start(controller) {
        controller.error(new Error('socket reset'))
      },
    })
    const fetchImpl = fakeFetch([new Response(brokenBody, { status: 401 })])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('auth')
    expect(outcome.error).toMatch(/^auth: /)
  })

  it('HTTP 429 是限流，不是鉴权失败', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ error: { message: 'rate limited' } }, 429)])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('rate_limit')
    expect(outcome.error).toContain('rate limited')
  })

  it('其余 HTTP 失败带供应商原文，码是 provider', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ error: { message: 'Invalid model' } }, 400)])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('provider')
    expect(outcome.error).toContain('Invalid model')
  })

  it('供应商超时是 timeout，不是网络不可达', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }) as unknown as typeof fetch

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('timeout')
  })

  it('读响应体时超时也是 timeout：坏图文案会让用户以为图坏了', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      },
    })
    const fetchImpl = fakeFetch([new Response(body, { status: 200 })])

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('timeout')
  })

  it('下载 url 图片时超时也是 timeout', async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ data: [{ url: 'https://93.184.216.34/x.png' }] }),
      () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') },
    ])

    const outcome = await generateImages(ZHIPU, { prompt: 'p' }, fetchImpl, { lookupImpl: publicLookup })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('timeout')
  })

  it('签名不符是 bad_image', async () => {
    const html = Buffer.from('<!DOCTYPE html><html>502</html>').toString('base64')
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: html }] })])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('bad_image')
  })

  it('响应体超限是 bad_image，不冒充网络问题', async () => {
    const fetchImpl = fakeFetch([
      new Response('{}', { status: 200, headers: { 'content-length': String(64 * 1024 * 1024 + 1) } }),
    ])
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('bad_image')
    expect(outcome.error).toMatch(/limit/i)
  })

  it('HTTP 200 内的逐图 error 是 provider，不是 bad_image', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ error: { message: 'content policy violation' } }] })])
    const outcome = await generateImages(ARK, { prompt: 'p' }, fetchImpl)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('provider')
    expect(outcome.error).toContain('content policy violation')
  })

  it('不支持改图的方言是 edit_unsupported，零出站', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    const outcome = await generateImages(
      ZHIPU,
      { prompt: 'warm', images: [{ bytes: PNG, mime: 'image/png' }] },
      fetchImpl,
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('edit_unsupported')
    expect(calls(fetchImpl)).toHaveLength(0)
  })

  it('OpenAI 方言也不发原生批量参数：张数一律客户端扇出', async () => {
    const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: PNG_B64 }] })])
    await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

    const body = JSON.parse(calls(fetchImpl)[0][1].body as string)
    for (const key of ['n', 'batch_size', 'sequential_image_generation']) {
      expect(body).not.toHaveProperty(key)
    }
  })
})