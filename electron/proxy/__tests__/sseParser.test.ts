// @vitest-environment node
/**
 * 代理读取 OpenAI 兼容网关的 SSE 流时，事件边界必须支持 CRLF、LF 以及两者混用，
 * 且允许边界字节被 TCP 分块切断。
 *
 * 背景：SSE 规范的行结束符有 \r\n、\n、\r 三种，按 \r\n 换行的标准网关其事件边界是
 * \r\n\r\n。旧实现只 `indexOf('\n\n')`，该序列里不存在连续两个 \n，永远返回 -1 ——
 * 正文与工具调用全堆在缓冲区里切不出来，流结束时转换器只能补出一组没有内容的
 * message_delta/message_stop，Claude 侧看到的就是「空答复」。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { SSEEvent, SSEParser } from '../sseParser.ts'
import { OpenAIToAnthropicStreamTransformer } from '../streamingTransformer.ts'

/** 按 size 切块喂入，模拟 TCP 分块；省略 size 则一次性喂完 */
function feedAll(stream: string, size = Math.max(stream.length, 1)): SSEEvent[] {
  const parser = new SSEParser()
  const events: SSEEvent[] = []
  for (let i = 0; i < stream.length; i += size) {
    events.push(...parser.feed(stream.slice(i, i + size)))
  }
  return events
}

function chunkOf(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    model: 'deepseek-chat',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
}

/** 把若干 data 载荷拼成一条流，nl 决定行结束符（CRLF / LF / 混用由调用方控制） */
function sseStream(payloads: string[], nl: string): string {
  return payloads.map(p => `data: ${p}${nl}${nl}`).join('')
}

/** 转换器输出的 Anthropic 事件，只声明用例断言到的字段 */
interface AnthropicStreamEvent {
  type?: string
  delta?: {
    type?: string
    text?: string
    thinking?: string
    partial_json?: string
    stop_reason?: string
  }
  content_block?: { type?: string; name?: string }
}

/** 走完整链路：SSE 流 → 解析 → Anthropic 事件对象 */
function toAnthropicEvents(stream: string, size = Math.max(stream.length, 1)): AnthropicStreamEvent[] {
  const parser = new SSEParser()
  const transformer = new OpenAIToAnthropicStreamTransformer(0)
  const frames: string[] = []

  for (let i = 0; i < stream.length; i += size) {
    for (const event of parser.feed(stream.slice(i, i + size))) {
      frames.push(...transformer.transform(event))
    }
  }
  frames.push(...transformer.finish())

  return frames
    .filter(f => f.startsWith('event:'))
    .map(f => JSON.parse(f.slice(f.indexOf('data: ') + 6)) as AnthropicStreamEvent)
}

describe('SSEParser 事件边界', () => {
  it('纯 CRLF：一条事件能切出来', () => {
    const events = feedAll(`data: ${chunkOf({ content: 'hello' })}\r\n\r\n`)

    assert.equal(events.length, 1)
    assert.equal(JSON.parse(events[0].data).choices[0].delta.content, 'hello')
  })

  it('纯 CRLF：一次喂完多条事件全部切出且保序', () => {
    const stream = sseStream([
      chunkOf({ role: 'assistant' }),
      chunkOf({ content: '你' }),
      chunkOf({ content: '好' }),
      '[DONE]',
    ], '\r\n')

    const events = feedAll(stream)

    assert.equal(events.length, 4)
    assert.deepEqual(events.slice(1, 3).map(e => JSON.parse(e.data).choices[0].delta.content), ['你', '好'])
    assert.equal(events[3].event, 'done')
  })

  it('纯 LF：既有行为不变', () => {
    const events = feedAll(sseStream([chunkOf({ content: 'hi' }), '[DONE]'], '\n'))

    assert.equal(events.length, 2)
    assert.equal(JSON.parse(events[0].data).choices[0].delta.content, 'hi')
  })

  it('CRLF/LF 混用：两种边界同流都能切', () => {
    const a = chunkOf({ content: 'A' })
    const b = chunkOf({ content: 'B' })
    const c = chunkOf({ content: 'C' })
    const d = chunkOf({ content: 'D' })

    // \n\n、\r\n\r\n、\r\n\n、\n\r\n 四种写法混在一条流里
    const events = feedAll(`data: ${a}\n\n` + `data: ${b}\r\n\r\n` + `data: ${c}\r\n\n` + `data: ${d}\n\r\n`)

    assert.deepEqual(events.map(e => JSON.parse(e.data).choices[0].delta.content), ['A', 'B', 'C', 'D'])
  })

  it('字段值不留行尾 \\r：event/id/retry 一并正确解析', () => {
    const events = feedAll('event: message\r\ndata: {"x":1}\r\nid: 7\r\nretry: 1200\r\n\r\n')

    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'message')
    assert.equal(events[0].id, '7')
    assert.equal(events[0].retry, 1200)
    assert.deepEqual(JSON.parse(events[0].data), { x: 1 })
  })

  it('[DONE] 以 CRLF 结束时识别为 done 事件', () => {
    const events = feedAll('data: [DONE]\r\n\r\n')

    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'done')
  })

  it('多行 data 用 CRLF 分隔时按 \\n 拼接为同一事件', () => {
    const events = feedAll('data: {"a":1}\r\ndata: {"b":2}\r\n\r\n')

    assert.equal(events.length, 1)
    assert.equal(events[0].data, '{"a":1}\n{"b":2}')
  })

  it('注释行被忽略，不产生幽灵事件', () => {
    const events = feedAll(': keep-alive\r\n\r\n' + `data: ${chunkOf({ content: 'x' })}\r\n\r\n`)

    assert.equal(events.length, 1)
    assert.deepEqual(feedAll(': comment\ndata: ok\n\n'), [{ event: null, data: 'ok' }])
  })

  it('没有 data 的事件被丢弃（LF 与 CRLF 同）', () => {
    assert.deepEqual(feedAll('event: ping\n\ndata: real\n\n'), [{ event: null, data: 'real' }])
    assert.deepEqual(feedAll('event: ping\r\n\r\ndata: real\r\n\r\n'), [{ event: null, data: 'real' }])
  })

  it('id/retry 正确解析，retry 非数字时忽略（LF 与 CRLF 同）', () => {
    assert.deepEqual(feedAll('id: 42\nretry: 3000\ndata: x\n\ndata: y\nretry: abc\n\n'), [
      { event: null, data: 'x', id: '42', retry: 3000 },
      { event: null, data: 'y' },
    ])
    assert.deepEqual(feedAll('id: 42\r\nretry: 3000\r\ndata: x\r\n\r\n'), [
      { event: null, data: 'x', id: '42', retry: 3000 },
    ])
  })
})

describe('SSEParser 跨分块边界', () => {
  it('逐字节喂入 CRLF 流：边界被切成任意碎片也能正确解析', () => {
    const stream = sseStream([chunkOf({ content: 'hello' }), chunkOf({ content: 'world' }), '[DONE]'], '\r\n')

    const events = feedAll(stream, 1)

    assert.equal(events.length, 3)
    assert.equal(JSON.parse(events[0].data).choices[0].delta.content, 'hello')
    assert.equal(JSON.parse(events[1].data).choices[0].delta.content, 'world')
    assert.equal(events[2].event, 'done')
  })

  it('CRLF 的 \\r 落在块尾、\\n 落在下块头时不凭空多切一个空行', () => {
    // 一条事件内有两个 data 行，行分隔符正被拆在两块之间
    const parser = new SSEParser()

    assert.deepEqual(parser.feed('data: {"a":1}\r'), [])
    assert.deepEqual(parser.feed('\ndata: {"b":2}\r'), [])

    const events = parser.feed('\n\r\n')

    assert.equal(events.length, 1)
    assert.equal(events[0].data, '{"a":1}\n{"b":2}')
  })

  it('JSON 载荷被从中间切断时不提前派发、不丢字节', () => {
    const stream = sseStream([chunkOf({ content: '一段较长的中文回复内容' })], '\r\n')

    const events = feedAll(stream, 7)

    assert.equal(events.length, 1)
    assert.equal(JSON.parse(events[0].data).choices[0].delta.content, '一段较长的中文回复内容')
  })

  it('逐字节喂入混用换行同样正确', () => {
    const stream = `data: ${chunkOf({ content: 'A' })}\r\n\n` + `data: ${chunkOf({ content: 'B' })}\n\r\n`

    const events = feedAll(stream, 1)

    assert.deepEqual(events.map(e => JSON.parse(e.data).choices[0].delta.content), ['A', 'B'])
  })

  it('未闭合的尾部按 SSE 规范不派发（不补出残缺事件）', () => {
    const parser = new SSEParser()

    assert.equal(parser.feed('data: {"x":1}\r\n\r\n').length, 1)
    // 尾部只有一行 data，行结束符还分在两块里：没有空行就不是完整事件，不能提前派发
    assert.deepEqual(parser.feed('data: {"x":2}\r\n'), [])
    assert.deepEqual(parser.feed('\r\n'), [
      { event: null, data: '{"x":2}' },
    ])
  })

  it('reset() 丢弃缓冲', () => {
    const parser = new SSEParser()

    parser.feed('data: {"a":1}\r')
    parser.reset()

    assert.deepEqual(parser.feed('data: {"b":2}\r\n\r\n'), [{ event: null, data: '{"b":2}' }])
  })
})

describe('CRLF 流经完整转换链路后事件不丢', () => {
  const toolStream = sseStream([
    chunkOf({ role: 'assistant', content: '' }),
    chunkOf({ content: '我来查一下天气。' }),
    chunkOf({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather' } }] }),
    chunkOf({ tool_calls: [{ index: 0, function: { arguments: '{"city":"杭州"}' } }] }),
    chunkOf({}, 'tool_calls'),
    '[DONE]',
  ], '\r\n')

  it('正文、工具调用与结束原因都来自上游事件', () => {
    const events = toAnthropicEvents(toolStream)

    const text = events
      .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      .map(e => e.delta?.text)
      .join('')
    const partialJson = events
      .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta')
      .map(e => e.delta?.partial_json)
      .join('')
    const toolStart = events.find(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use')
    const messageStop = events.find(e => e.type === 'message_delta')

    assert.equal(events.some(e => e.type === 'message_start'), true)
    assert.equal(text, '我来查一下天气。')
    assert.equal(toolStart?.content_block?.name, 'get_weather')
    assert.equal(partialJson, '{"city":"杭州"}')
    assert.equal(messageStop?.delta?.stop_reason, 'tool_use')
  })

  it('逐字节喂入时输出与整块喂入完全一致', () => {
    assert.deepEqual(toAnthropicEvents(toolStream, 1), toAnthropicEvents(toolStream))
  })

  it('正文流的 stop_reason 是 end_turn 而非补出来的空结束', () => {
    const stream = sseStream([
      chunkOf({ role: 'assistant' }),
      chunkOf({ reasoning_content: '先想一下' }),
      chunkOf({ content: '答案' }),
      chunkOf({}, 'stop'),
      '[DONE]',
    ], '\r\n')

    const events = toAnthropicEvents(stream)

    assert.equal(
      events.filter(e => e.type === 'content_block_delta').map(e => e.delta?.thinking ?? e.delta?.text).join(''),
      '先想一下答案',
    )
    assert.equal(events.find(e => e.type === 'message_delta')?.delta?.stop_reason, 'end_turn')
  })
})
