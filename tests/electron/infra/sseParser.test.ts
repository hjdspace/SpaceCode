// @vitest-environment node
/**
 * 本地代理的 SSE 流解析：把上游网关的字节流拆成离散事件。
 *
 * 背景：代理把上游的 text/event-stream 增量转发给 CLI。分块边界的切割错误
 * （半个事件被提前解析、多行 data 拼接错误、[DONE] 哨兵漏判）会直接破坏流式
 * 响应的事件序列。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { SSEParser } from '../../../electron/proxy/sseParser.ts'

describe('SSEParser', () => {
  it('解析以双换行分隔的单个完整事件', () => {
    const p = new SSEParser()
    const events = p.feed('event: message\ndata: hello\n\n')
    assert.deepEqual(events, [{ event: 'message', data: 'hello' }])
  })

  it('一次 feed 可解析出多个事件', () => {
    const p = new SSEParser()
    const events = p.feed('data: a\n\ndata: b\n\n')
    assert.deepEqual(events, [
      { event: null, data: 'a' },
      { event: null, data: 'b' },
    ])
  })

  it('跨多次 feed 的不完整事件会被缓冲到分块齐全后再产出', () => {
    const p = new SSEParser()
    assert.deepEqual(p.feed('data: hel'), []) // 无分隔符，不产出
    const events = p.feed('lo\n\n')
    assert.deepEqual(events, [{ event: null, data: 'hello' }])
  })

  it('同一事件的多行 data 用换行拼接', () => {
    const p = new SSEParser()
    const events = p.feed('data: line1\ndata: line2\n\n')
    assert.deepEqual(events, [{ event: null, data: 'line1\nline2' }])
  })

  it('[DONE] 哨兵被归为 done 事件', () => {
    const p = new SSEParser()
    const events = p.feed('data: [DONE]\n\n')
    assert.deepEqual(events, [{ event: 'done', data: '[DONE]' }])
  })

  it('无 data 的事件被丢弃', () => {
    const p = new SSEParser()
    const events = p.feed('event: ping\n\ndata: real\n\n')
    assert.deepEqual(events, [{ event: null, data: 'real' }])
  })

  it('解析 id 与 retry 字段，retry 非数字时忽略', () => {
    const p = new SSEParser()
    const events = p.feed('id: 42\nretry: 3000\ndata: x\n\ndata: y\nretry: abc\n\n')
    assert.deepEqual(events, [
      { event: null, data: 'x', id: '42', retry: 3000 },
      { event: null, data: 'y' },
    ])
  })

  it('忽略不认识的字段行', () => {
    const p = new SSEParser()
    const events = p.feed(': comment\ndata: ok\n\n')
    assert.deepEqual(events, [{ event: null, data: 'ok' }])
  })

  it('reset 清空缓冲，丢弃半截事件', () => {
    const p = new SSEParser()
    p.feed('data: partial')
    p.reset()
    const events = p.feed('data: fresh\n\n')
    assert.deepEqual(events, [{ event: null, data: 'fresh' }])
  })
})
