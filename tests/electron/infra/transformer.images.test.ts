// @vitest-environment node
/**
 * 本地代理的 Anthropic → OpenAI 请求转换如何携带图片。
 *
 * 背景：桌面端把图片内联在 user 轮交给引擎，官方 CLI 再以 Anthropic 线格式发到
 * 本地代理（ANTHROPIC_BASE_URL=127.0.0.1:34567），代理转成 OpenAI 格式给非
 * Anthropic 网关。转换里一旦跳过 image block，模型就拿不到像素，会拿上下文里的
 * 文字冒充"图片识别结果"作答。
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { anthropicToOpenAIRequest, estimateInputTokens } from '../../../electron/proxy/transformer.ts'

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64')

function convert(messages: unknown[]) {
  return anthropicToOpenAIRequest({
    model: 'claude-sonnet-4-20250514',
    messages,
    stream: true,
  }).messages
}

describe('anthropicToOpenAIRequest 图片', () => {
  it('user 轮的 image block 转成 image_url data URL，正文排在图片之前', () => {
    const [msg] = convert([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } },
        { type: 'text', text: '识别图片中的文字' },
      ],
    }])

    assert.equal(msg.role, 'user')
    assert.deepEqual(msg.content, [
      { type: 'text', text: '识别图片中的文字' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
    ])
  })

  it('纯文本 user 消息仍转换为字符串 content', () => {
    const [msg] = convert([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])

    assert.equal(msg.content, 'hello')
  })

  it('tool_result 里的图片另起一条 user 消息，且排在 tool 消息之后', () => {
    const messages = convert([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [
              { type: 'text', text: 'Read image from disk.' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PNG_B64 } },
            ],
          },
          { type: 'text', text: '这张图里有什么' },
        ],
      },
    ])

    const toolMsg = messages.find((m: any) => m.role === 'tool')
    assert.equal(toolMsg.content, 'Read image from disk.')

    const mediaMsg = messages.find((m: any) =>
      Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image_url'))
    assert.equal(mediaMsg.role, 'user')
    assert.equal(
      mediaMsg.content[1].image_url.url,
      `data:image/jpeg;base64,${PNG_B64}`,
    )
    // tool 消息必须仍在所有 user 消息之前，否则 OpenAI 会拒绝请求
    assert.ok(
      messages.findIndex((m: any) => m.role === 'tool') <
        messages.findIndex((m: any) => m.role === 'user'),
    )
  })

  it('url 源直接透传，media_type 缺失时回落 image/png', () => {
    const messages = convert([
      {
        role: 'user',
        content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }],
      },
      {
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', data: PNG_B64 } }],
      },
    ])

    assert.equal(messages[0].content[0].image_url.url, 'https://example.com/a.png')
    assert.equal(messages[1].content[0].image_url.url, `data:image/png;base64,${PNG_B64}`)
  })

  it('无法表达的 image block 不产生空 part，也不吞掉正文', () => {
    const [msg] = convert([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'file', path: '/tmp/a.png' } },
        { type: 'text', text: '看图' },
      ],
    }])

    assert.equal(msg.content, '看图')
  })
})

describe('estimateInputTokens 图片', () => {
  it('按视觉 token 口径估算，不按 base64 字符数虚报', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(40000) } },
          { type: 'text', text: '看图' },
        ],
      }],
    }

    const tokens = estimateInputTokens(body)

    // 按 base64 字符数计会报出 ~10000；一张图实际约 1300 视觉 token
    assert.ok(tokens >= 1300 && tokens < 2000, `图片被按 base64 长度计了：${tokens}`)
  })
})
