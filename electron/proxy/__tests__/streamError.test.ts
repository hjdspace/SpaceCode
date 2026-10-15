// @vitest-environment node
/**
 * 上游以 HTTP 200 应答之后，仍可能在 SSE 的 data 里回一个 error 对象（配额耗尽、内容
 * 审查、参数校验失败都从这里冒出来）。转换器必须把它转成 Anthropic 的 event: error
 * 下发给引擎，而不是让流继续走到收尾逻辑、补出一组 stop_reason="end_turn" +
 * message_stop —— 那会让一次失败在客户端显示成"成功但空回复"。
 *
 * 同理：一条从未给出 finish_reason 就结束的流是被截断的答复，属于异常终止，
 * 不能被 default 分支当成正常完成。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as http from 'http'

import { OpenAIToAnthropicStreamTransformer } from '../streamingTransformer'
import { ProxyServer } from '../server'
import type { ProxyConfig } from '../types'

const PROXY_PORT = 34994
const UPSTREAM_PORT = 34995

interface Frame {
  event: string
  data: {
    type?: string
    error?: { type?: string; message?: string }
    delta?: { type?: string; text?: string; stop_reason?: string }
    content_block?: { type?: string }
  }
}

const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
  data: JSON.stringify({
    id: 'chatcmpl-1',
    model: 'deepseek-chat',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }),
})

const payload = (obj: unknown) => ({ data: JSON.stringify(obj) })

const UPSTREAM_ERROR = { error: { message: 'fixture rejected', type: 'invalid_request_error' } }

/** 走完整转换链路：transform 逐事件 + finish 收尾，返回 Anthropic 事件帧 */
function frames(events: { data: string }[], estimate = 0): Frame[] {
  const t = new OpenAIToAnthropicStreamTransformer(estimate)
  const out: string[] = []
  for (const e of events) out.push(...t.transform(e))
  out.push(...t.finish())
  return out.map(raw => ({
    event: /event: (\S+)/.exec(raw)?.[1] ?? '',
    data: JSON.parse(/data: (.*)/.exec(raw)?.[1] ?? 'null'),
  }))
}

const types = (f: Frame[]) => f.map(e => e.data.type)

describe('SSE 流内 error 对象', () => {
  it('转成 event: error 并带上 message/type，不再补出 message_start', () => {
    const f = frames([payload(UPSTREAM_ERROR)])

    expect(f).toEqual([
      {
        event: 'error',
        data: { type: 'error', error: { type: 'invalid_request_error', message: 'fixture rejected' } },
      },
    ])
  })

  it('error 之后即便收到 [DONE]，也没有 end_turn/message_stop 假完成', () => {
    const f = frames([payload(UPSTREAM_ERROR), { data: '[DONE]' }])

    expect(types(f)).toEqual(['error'])
    expect(JSON.stringify(f)).not.toContain('end_turn')
  })

  it('error 到达时先收口未闭合的内容块，再下发错误', () => {
    const f = frames([chunk({ content: '部分答复' }), payload(UPSTREAM_ERROR)])

    expect(types(f)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'error',
    ])
  })

  it('error 之后到达的分片不再产出半截消息', () => {
    const t = new OpenAIToAnthropicStreamTransformer(0)

    expect(types(frames([payload(UPSTREAM_ERROR)]))).toEqual(['error'])
    t.transform(payload(UPSTREAM_ERROR))
    expect(t.transform(chunk({ content: '还在流' }))).toEqual([])
    expect(t.transform({ data: '[DONE]' })).toEqual([])
    expect(t.finish()).toEqual([])
  })

  it('error 为字符串形态时兜底成 api_error', () => {
    const f = frames([payload({ error: 'boom' })])

    expect(f[0].data.error).toEqual({ type: 'api_error', message: 'boom' })
  })

  it('error 对象缺 type/message 时补出可辨识的兜底值', () => {
    const f = frames([payload({ error: {} })])

    expect(f[0].data.error?.type).toBe('api_error')
    expect(f[0].data.error?.message?.length).toBeGreaterThan(0)
  })
})

describe('收尾事件区分正常完成与异常终止', () => {
  it('正常 finish_reason 仍是 end_turn + message_stop', () => {
    const f = frames([chunk({ content: '答案' }), chunk({}, 'stop'), { data: '[DONE]' }])

    expect(f.find(e => e.data.type === 'message_delta')?.data.delta?.stop_reason).toBe('end_turn')
    expect(types(f)).toContain('message_stop')
    expect(f.some(e => e.event === 'error')).toBe(false)
  })

  it('非标准但存在的 finish_reason 按正常完成收尾', () => {
    // 上游给出自定义结束原因时仍算"正常结束"：把它判成异常会让兼容网关全线报错。
    const f = frames([chunk({ content: '答案' }), chunk({}, 'finish'), { data: '[DONE]' }])

    expect(f.find(e => e.data.type === 'message_delta')?.data.delta?.stop_reason).toBe('end_turn')
    expect(f.some(e => e.event === 'error')).toBe(false)
  })

  it('没有 finish_reason 的流按异常终止处理', () => {
    const f = frames([chunk({ content: '半截答复' }), { data: '[DONE]' }])

    expect(types(f)).not.toContain('message_delta')
    expect(types(f)).not.toContain('message_stop')
    expect(f[f.length - 1]).toEqual({
      event: 'error',
      data: { type: 'error', error: { type: 'api_error', message: expect.any(String) } },
    })
  })

  it('上游直接断流（只有 finish()）也报异常终止', () => {
    const f = frames([chunk({ content: '半截答复' })])

    expect(types(f)).not.toContain('message_stop')
    expect(f.some(e => e.event === 'error')).toBe(true)
  })

  it('纯 usage 尾巴不改变正常收尾', () => {
    const f = frames([
      chunk({ content: '答案' }),
      chunk({}, 'stop'),
      payload({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      { data: '[DONE]' },
    ])

    expect(f.find(e => e.data.type === 'message_delta')?.data.delta?.stop_reason).toBe('end_turn')
    expect(f.some(e => e.event === 'error')).toBe(false)
  })
})

describe('经代理端到端转发流内 error', () => {
  let upstream: http.Server
  let proxy: ProxyServer

  beforeAll(async () => {
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write(`data: ${JSON.stringify(UPSTREAM_ERROR)}\r\n\r\n`)
      res.write('data: [DONE]\r\n\r\n')
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

  it('客户端收到 event: error，且不是一次假完成', { timeout: 20_000 }, async () => {
    const raw = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: PROXY_PORT,
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
        },
        res => {
          let body = ''
          res.on('data', (c: Buffer) => { body += c.toString() })
          res.on('end', () => resolve(body))
        },
      )
      req.on('error', reject)
      req.end(JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }))
    })

    expect(raw).toContain('event: error')
    expect(raw).toContain('fixture rejected')
    expect(raw).not.toContain('end_turn')
    expect(raw).not.toContain('message_stop')
  })
})
