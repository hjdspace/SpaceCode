// @vitest-environment node
/**
 * claude-code 的 /context 与 get_context_usage 会 POST /v1/messages/count_tokens 数 token。
 * 这个路径曾经落到 switch 的 default 分支返回 404，CLI 于是把每个分类的计数退化成一次带全量
 * tools 的真实请求，占住它的串行 stdin 循环几分钟 —— 用户消息全被堵在后面。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'http'
import { ProxyServer } from '../server'
import type { ProxyConfig } from '../types'

const TEST_PORT = 34991

const config: ProxyConfig = {
  host: '127.0.0.1',
  port: TEST_PORT,
  upstreamProvider: 'openai_compatible',
  upstreamBaseUrl: 'https://api.example.com/v1',
  upstreamApiKey: 'test-key',
  modelMapping: {},
}

let server: ProxyServer

function post(path: string, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let text = ''
        res.on('data', (chunk: Buffer) => { text += chunk.toString() })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

beforeAll(async () => {
  server = new ProxyServer(config)
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

describe('proxy /v1/messages/count_tokens', () => {
  it('本地直接回答 token 数，不落到 404', async () => {
    const res = await post('/v1/messages/count_tokens', {
      model: 'claude-sonnet-4-5',
      system: 'x'.repeat(4000),
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.text)
    // 4000 + 5 字符 ≈ 1001 token（与 estimateInputTokens 的 chars/4 口径一致）
    expect(parsed.input_tokens).toBeGreaterThan(900)
    expect(parsed.input_tokens).toBeLessThan(1100)
  })

  it('计入 tools 定义的开销', async () => {
    const withTools = await post('/v1/messages/count_tokens', {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'Bash', description: 'y'.repeat(4000), input_schema: { type: 'object' } }],
    })
    const withoutTools = await post('/v1/messages/count_tokens', {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(JSON.parse(withTools.text).input_tokens)
      .toBeGreaterThan(JSON.parse(withoutTools.text).input_tokens)
  })

  it('空请求体回答 0 而不是报错', async () => {
    const res = await post('/v1/messages/count_tokens', {})

    expect(res.status).toBe(200)
    expect(JSON.parse(res.text).input_tokens).toBe(0)
  })

  it('未实现的路径仍然 404', async () => {
    const res = await post('/v1/beta/messages/count_tokens', { messages: [] })
    expect(res.status).toBe(404)
  })
})
