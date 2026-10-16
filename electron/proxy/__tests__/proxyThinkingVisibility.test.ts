// @vitest-environment node
/**
 * 代理的端到端思考可见性（issue #40 问题 2 的真实病灶）。
 *
 * 排查时踩到的不是"开关没送到 CLI"：日志里 spawn 参数已经是 --thinking disabled，
 * 引擎也确实没在请求体里带 thinking。推理仍然出现在界面上，是因为兼容网关**默认**
 * 回传 reasoning_content，而代理无条件把它合成 Anthropic 的 thinking 块。
 * 所以判据必须是"这次请求有没有要思考"，两处（流式 / 非流式）都得听同一个口径。
 *
 * 这里起真的 ProxyServer + 一个假的上游兼容网关，专门覆盖 server.ts → transformer 的接线，
 * 单元测试看不到那一段。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'http'
import { ProxyServer } from '../server'
import type { ProxyConfig } from '../types'

const PROXY_PORT = 34993
const UPSTREAM_PORT = 34994

/** 上游收到的请求体，用于断言我们往上游发了什么。 */
const upstreamRequests: Array<Record<string, any>> = []

// 兼容网关的默认行为：不管理你要不要思考，reasoning_content 照吐。
const UPSTREAM_SSE = [
  'data: ' + JSON.stringify({ id: 'c1', model: 'glm-5.3-flash', choices: [{ index: 0, delta: { reasoning_content: 'SECRET-REASONING' } }] }) + '\n\n',
  'data: ' + JSON.stringify({ id: 'c1', model: 'glm-5.3-flash', choices: [{ index: 0, delta: { content: 'final answer' } }] }) + '\n\n',
  'data: ' + JSON.stringify({ id: 'c1', model: 'glm-5.3-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
  'data: [DONE]\n\n',
].join('')

let upstream: http.Server
let server: ProxyServer

const config: ProxyConfig = {
  host: '127.0.0.1',
  port: PROXY_PORT,
  upstreamProvider: 'openai_compatible',
  upstreamBaseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
  upstreamApiKey: 'test-key',
  modelMapping: {},
}

function postMessages(body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PROXY_PORT,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let text = ''
        res.on('data', (chunk: Buffer) => { text += chunk.toString() })
        res.on('end', () => resolve(text))
      },
    )
    req.on('error', reject)
    req.end(payload)
  })
}

function anthropicBody(extra: Record<string, unknown> = {}) {
  return {
    model: 'claude-haiku-4-8',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 64,
    stream: true,
    ...extra,
  }
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      try { upstreamRequests.push(JSON.parse(raw)) } catch { /* 只关心能解析的 */ }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(UPSTREAM_SSE)
    })
  })
  await new Promise<void>(r => upstream!.listen(UPSTREAM_PORT, '127.0.0.1', () => r()))

  server = new ProxyServer(config)
  await server.start()
})

afterAll(async () => {
  await server?.stop()
  await new Promise<void>(r => upstream!.close(() => r()))
})

describe('代理对 reasoning_content 的呈现口径', () => {
  it('请求没要思考时，上游的 reasoning_content 不会变成 thinking 块', async () => {
    upstreamRequests.length = 0

    const sse = await postMessages(anthropicBody())

    expect(sse).not.toContain('thinking_delta')
    expect(sse).not.toContain('"type":"thinking"')
    expect(sse).not.toContain('SECRET-REASONING')
    expect(sse).toContain('final answer')
    // 正文没被误判成"只有推理"而走兜底路径：只开出 text 一个内容块
    // （formatSSE 每条事件同时写 event: 与 data:，所以按 data 里的 type 计数）
    expect((sse.match(/"type":"content_block_start"/g) ?? []).length).toBe(1)
    // 也没往上游塞任何私有思考参数
    const sent = upstreamRequests[upstreamRequests.length - 1]
    expect(sent.enable_thinking).toBeUndefined()
    expect(sent.thinking).toBeUndefined()
    expect(sent.chat_template_kwargs).toBeUndefined()
  })

  it('请求要思考时（--thinking enabled），推理照旧呈现', async () => {
    const sse = await postMessages(anthropicBody({ thinking: { type: 'adaptive' } }))

    expect(sse).toContain('thinking_delta')
    expect(sse).toContain('SECRET-REASONING')
    expect(sse).toContain('final answer')
  })
})
