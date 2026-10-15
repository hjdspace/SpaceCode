// @vitest-environment node
/**
 * 端到端：上游把多字节 UTF-8 字符的字节切到不同 TCP 分块（模型流式输出的常见形态）时，
 * 代理必须把正文逐字符还原后转发给引擎。
 *
 * 每个分块独立 chunk.toString() 是无状态解码：跨边界的字符会碎成替换字符 ，
 * 且因为  是合法 JSON 字符，解析不报错，乱码直接落到引擎看到的正文里。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'http'

import { ProxyServer } from '../server'
import type { ProxyConfig } from '../types'

const PROXY_PORT = 34996
const UPSTREAM_PORT = 34997
const REPLACEMENT_CHAR = '\uFFFD'

const STREAM_TEXT = '我来查一下天气。你好，世界'
const JSON_TEXT = '非流式正文：你好，世界'
const ERROR_TEXT = '上游错误：额度不足，请稍后重试'

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 2))

/**
 * 单字节（ASCII）连续写出，多字节字符的字节流一律拆成"首字节 / 其余字节"两次 write，
 * 中间留出一个真实分块边界，保证被切断的正好是字符内部。
 */
async function writeSplit(res: http.ServerResponse, text: string): Promise<void> {
  let ascii: number[] = []
  const flush = () => {
    if (ascii.length) {
      res.write(Buffer.from(ascii))
      ascii = []
    }
  }

  for (const char of text) {
    const bytes = Buffer.from(char, 'utf8')
    if (bytes.length === 1) {
      ascii.push(bytes[0])
      continue
    }
    flush()
    res.write(bytes.subarray(0, 1))
    await tick()
    res.write(bytes.subarray(1))
    await tick()
  }
  flush()
}

function frame(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    model: 'gpt-test',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function readUpstreamBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

let upstream: http.Server
let proxy: ProxyServer

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const body = await readUpstreamBody(req)

    if (body.includes('MARKER-ERROR')) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      await writeSplit(res, JSON.stringify({ error: { message: ERROR_TEXT } }))
      res.end()
      return
    }

    if (body.includes('MARKER-JSON')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      await writeSplit(res, JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: JSON_TEXT },
          finish_reason: 'stop',
        }],
      }))
      res.end()
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    await writeSplit(res, [
      frame({ role: 'assistant' }),
      frame({ content: STREAM_TEXT.slice(0, 9) }),
      frame({ content: STREAM_TEXT.slice(9) }),
      frame({}, 'stop'),
      'data: [DONE]\n\n',
    ].join(''))
    res.end()
  })
  await new Promise<void>(resolve => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

  const config: ProxyConfig = {
    host: '127.0.0.1',
    port: PROXY_PORT,
    upstreamProvider: 'openai_compatible',
    upstreamBaseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
    upstreamApiKey: 'test-key',
    modelMapping: {},
  }
  proxy = new ProxyServer(config)
  await proxy.start()
})

afterAll(async () => {
  await proxy.stop()
  await new Promise<void>(resolve => upstream.close(() => resolve()))
})

/** 客户端整体收字节后一次性解码，避免把测试自身的解码算进结论 */
function callProxy(path: string, payload: Record<string, unknown>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PROXY_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', reject)
    req.end(data)
  })
}

function parseAnthropicSSE(raw: string): Array<{ event: string; data: any }> {
  return raw
    .split('\n\n')
    .filter(block => block.includes('data: '))
    .map(block => ({
      event: /event: (\S+)/.exec(block)?.[1] ?? '',
      data: JSON.parse(/data: (.*)/.exec(block)?.[1] ?? 'null'),
    }))
}

describe('UTF-8 字符跨分块的代理转发', () => {
  it('流式正文按字节切断后仍逐字符还原', async () => {
    const { body } = await callProxy('/v1/messages', {
      model: 'claude-sonnet-4-5',
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: 'MARKER-STREAM 杭州天气怎么样' }],
    })

    const events = parseAnthropicSSE(body)
    const text = events
      .filter(e => e.data.delta?.type === 'text_delta')
      .map(e => e.data.delta.text)
      .join('')

    expect(text).toBe(STREAM_TEXT)
    expect(body).not.toContain(REPLACEMENT_CHAR)
    expect(events.map(e => e.data.type)).toContain('message_stop')
  })

  it('非流式响应体按字节切断后仍逐字符还原', async () => {
    const { status, body } = await callProxy('/v1/chat/completions', {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'MARKER-JSON 你好' }],
    })

    expect(status).toBe(200)
    expect(body).not.toContain(REPLACEMENT_CHAR)
    expect(JSON.parse(body).choices[0].message.content).toBe(JSON_TEXT)
  })

  it('上游非 200 的错误体按字节切断后仍原样转发', async () => {
    const { status, body } = await callProxy('/v1/chat/completions', {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'MARKER-ERROR 你好' }],
    })

    expect(status).toBe(500)
    expect(body).not.toContain(REPLACEMENT_CHAR)
    expect(body).toBe(JSON.stringify({ error: { message: ERROR_TEXT } }))
  })
})
