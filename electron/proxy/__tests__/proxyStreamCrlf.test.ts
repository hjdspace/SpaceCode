// @vitest-environment node
/**
 * 端到端：上游网关按标准 SSE 的 CRLF（\r\n\r\n 事件边界）推流时，代理必须把正文与
 * 工具调用事件切出来并转成 Anthropic 事件转发给 Claude CLI。
 *
 * 解析器只认 '\n\n' 时，这条流一个事件都切不出来，代理最终只转发转换器补出的
 * message_delta/message_stop —— CLI 看到一次没有内容的"正常结束"。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'http'

import { ProxyServer } from '../server'
import type { ProxyConfig } from '../types'

const PROXY_PORT = 34992
const UPSTREAM_PORT = 34993
const CRLF = '\r\n'

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    model: 'deepseek-chat',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}${CRLF}${CRLF}`
}

const UPSTREAM_FRAMES = [
  chunk({ role: 'assistant' }),
  chunk({ content: '我来查一下天气。' }),
  chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":"杭州"}' } }] }),
  chunk({}, 'tool_calls'),
  `data: [DONE]${CRLF}${CRLF}`,
]

let upstream: http.Server
let proxy: ProxyServer

beforeAll(async () => {
  // 按小片段写出。Node 会合并同步 write，所以这里只制造"多块到达"；
  // 边界被逐字节切断的确定性场景由 sseParser.test.ts 的 size=1 用例覆盖。
  upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const body = UPSTREAM_FRAMES.join('')
    for (let i = 0; i < body.length; i += 9) {
      res.write(body.slice(i, i + 9))
    }
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

function streamMessages(): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: '杭州天气怎么样' }],
    })

    const req = http.request(
      {
        host: '127.0.0.1',
        port: PROXY_PORT,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let text = ''
        res.on('data', (c: Buffer) => { text += c.toString() })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** 代理转发出的 Anthropic SSE 事件，只声明用例断言到的字段 */
interface ForwardedEvent {
  event: string
  data: {
    type?: string
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
    content_block?: { type?: string; name?: string }
  }
}

function parseAnthropicSSE(raw: string): ForwardedEvent[] {
  return raw
    .split('\n\n')
    .filter(block => block.includes('data: '))
    .map(block => ({
      event: /event: (\S+)/.exec(block)?.[1] ?? '',
      data: JSON.parse(/data: (.*)/.exec(block)?.[1] ?? 'null') as ForwardedEvent['data'],
    }))
}

describe('CRLF 上游经代理转发', () => {
  it('正文与工具调用事件都被转发，结束原因来自上游', async () => {
    const res = await streamMessages()
    expect(res.status).toBe(200)

    const events = parseAnthropicSSE(res.text)

    const types = events.map(e => e.data.type)
    expect(types).toContain('message_start')
    expect(types).toContain('content_block_start')
    expect(types).toContain('message_stop')

    const text = events
      .filter(e => e.data.delta?.type === 'text_delta')
      .map(e => e.data.delta?.text)
      .join('')
    const partialJson = events
      .filter(e => e.data.delta?.type === 'input_json_delta')
      .map(e => e.data.delta?.partial_json)
      .join('')
    const toolName = events
      .map(e => e.data.content_block)
      .find(b => b?.type === 'tool_use')?.name

    expect(text).toBe('我来查一下天气。')
    expect(toolName).toBe('get_weather')
    expect(partialJson).toBe('{"city":"杭州"}')
    expect(events.find(e => e.data.type === 'message_delta')?.data.delta?.stop_reason).toBe('tool_use')
  })
})
