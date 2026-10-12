// @vitest-environment node
/**
 * 代理读取网关响应时，对 `tool_calls[].function.arguments` 的两种形态都要能吃下。
 *
 * 背景：OpenAI 规范该字段是 JSON 字符串，但自建网关（其 chat template 要求 arguments
 * 为 mapping）常在服务端就把字符串反序列化成对象，回包也跟着回对象。旧实现无条件
 * `JSON.parse(arguments)`，对象会被强转成 "[object Object]" 再抛错、异常被吞掉，
 * 结果工具入参静默变成 {} —— 模型要执行的命令丢了，且没有任何报错痕迹。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { openAIToAnthropicResponse } from '../transformer.ts'
import { OpenAIToAnthropicStreamTransformer } from '../streamingTransformer.ts'

function toolUseOf(messageToolCalls: unknown[]) {
  const response = openAIToAnthropicResponse({
    id: 'chatcmpl-1',
    model: 'm',
    choices: [{ index: 0, finish_reason: 'tool_calls', message: { content: null, tool_calls: messageToolCalls } }],
  })
  return response.content[0]
}

function streamDeltas(chunks: unknown[]) {
  const t = new OpenAIToAnthropicStreamTransformer(0)
  const out: string[] = []
  for (const c of chunks) out.push(...t.transform({ data: JSON.stringify(c) }))
  out.push(...t.finish())
  return out
    .filter(s => s.startsWith('event:'))
    .map(s => JSON.parse(s.slice(s.indexOf('data: ') + 6)))
}

describe('openAIToAnthropicResponse tool_use.input', () => {
  it('字符串形态按 JSON 解析', () => {
    const block = toolUseOf([
      { id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls -la"}' } },
    ])

    assert.equal(block.type, 'tool_use')
    assert.deepEqual(block.input, { command: 'ls -la' })
  })

  it('对象形态原样取用，不会静默变空', () => {
    const block = toolUseOf([
      { id: 'call_2', type: 'function', function: { name: 'Bash', arguments: { command: 'ls -la' } } },
    ])

    assert.deepEqual(block.input, { command: 'ls -la' })
  })

  it('残缺或非对象 JSON 降级为空 input', () => {
    assert.deepEqual(toolUseOf([{ id: 'a', function: { name: 'Bash', arguments: '{"comm' } }]).input, {})
    assert.deepEqual(toolUseOf([{ id: 'b', function: { name: 'Bash', arguments: '123' } }]).input, {})
    assert.deepEqual(toolUseOf([{ id: 'c', function: { name: 'Bash' } }]).input, {})
  })
})

describe('streaming tool_calls arguments', () => {
  const chunk = (toolCall: unknown) => ({
    id: 'chatcmpl-1',
    model: 'm',
    choices: [{ index: 0, delta: { tool_calls: [toolCall] } }],
  })

  it('字符串片段原样透传给 partial_json', () => {
    const deltas = streamDeltas([
      chunk({ index: 0, id: 'call_1', function: { name: 'Bash', arguments: '{"command":' } }),
      chunk({ index: 0, function: { arguments: '"ls"}' } }),
    ]).filter(e => e.type === 'content_block_delta')

    const joined = deltas.map(d => d.delta.partial_json).join('')
    assert.equal(joined, '{"command":"ls"}')
    assert.deepEqual(JSON.parse(joined), { command: 'ls' })
  })

  it('对象形态被序列化成字符串，保证累加器仍能 parse', () => {
    const deltas = streamDeltas([
      chunk({ index: 0, id: 'call_2', function: { name: 'Bash', arguments: { command: 'ls' } } }),
    ]).filter(e => e.type === 'content_block_delta')

    assert.equal(deltas.length, 1)
    assert.equal(typeof deltas[0].delta.partial_json, 'string')
    assert.deepEqual(JSON.parse(deltas[0].delta.partial_json), { command: 'ls' })
  })
})
