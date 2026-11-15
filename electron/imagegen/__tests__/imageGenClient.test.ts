// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { generateImages } from '../imageGenClient'
import type { ImageGenConfig } from '@/shared/imageGenReference'

const OPENAI: ImageGenConfig = {
  presetId: 'openai',
  dialect: 'openai',
  baseUrl: 'https://api.test/v1',
  apiKey: 'sk-test',
  model: 'gpt-image-1',
  disableWatermark: false,
}

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
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
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
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    const fetchImpl = fakeFetch([
      jsonResponse({ data: [{ url: 'https://cdn.test/a.jpg' }] }),
      new Response(bytes, { status: 200 }),
    ])

    const outcome = await generateImages(OPENAI, { prompt: 'p' }, fetchImpl)

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

    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('Invalid model') })
    if (outcome.ok) return
    expect(outcome.error).not.toContain('sk-test')
  })

  it('本期只实现 openai 方言：其余方言明确拒绝，不按 OpenAI 形状乱发', async () => {
    for (const dialect of ['seedream', 'zhipu'] as const) {
      const fetchImpl = fakeFetch([jsonResponse({ data: [{ b64_json: 'AA==' }] })])
      const outcome = await generateImages({ ...OPENAI, dialect }, { prompt: 'p' }, fetchImpl)
      expect(outcome).toEqual({ ok: false, error: expect.stringContaining(dialect) })
      expect(calls(fetchImpl)).toHaveLength(0)
    }
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
    expect((await generateImages(OPENAI, { prompt: 'p' }, expired)).ok).toBe(false)

    const broken = vi.fn(async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof fetch
    const outcome = await generateImages(OPENAI, { prompt: 'p' }, broken)
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('socket hang up') })
  })
})