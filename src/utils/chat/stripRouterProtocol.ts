import { describe, it, expect } from 'vitest'
import { stripSuperAgentRouterProtocol } from '../stripRouterProtocol'

const FENCE = '```super-agent:route'

describe('stripSuperAgentRouterProtocol', () => {
  it('剥掉闭合的建单协议块，保留人读的正文', () => {
    const text = [
      '收到，我把这个活派给 worker。',
      '',
      FENCE,
      '{ "version": 1, "tickets": [{ "title": "做考勤表", "text": "做一个考勤表" }] }',
      '```',
    ].join('\n')

    expect(stripSuperAgentRouterProtocol(text)).toBe('收到，我把这个活派给 worker。')
  })

  it('流式途中未闭合的围栏也整体吞掉，不留半截 JSON', () => {
    const text = [
      '我先建单。',
      '',
      FENCE,
      '{ "version": 1, "tickets": [{ "title": "做考勤表"',
    ].join('\n')

    expect(stripSuperAgentRouterProtocol(text)).toBe('我先建单。')
  })

  it('协议块前后的正文都保留，只删块本身', () => {
    const text = [
      '前一句。',
      '',
      FENCE,
      '{}',
      '```',
      '',
      '后一句。',
    ].join('\n')

    expect(stripSuperAgentRouterProtocol(text)).toBe('前一句。\n\n后一句。')
  })

  it('不碰其他语言的代码块', () => {
    const text = ['看这段：', '', '```ts', 'const a = 1', '```'].join('\n')

    expect(stripSuperAgentRouterProtocol(text)).toBe(text)
  })

  it('整条回复只有协议块时返回空串（交给调用方丢弃该文本事件）', () => {
    expect(stripSuperAgentRouterProtocol(`${FENCE}\n{}\n\``)).toBe('')
  })
})
