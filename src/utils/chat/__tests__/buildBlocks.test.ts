import { describe, it, expect } from 'vitest'
import { buildBlocks } from '../buildBlocks'
import type { Message } from '@/types'

function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: 'm1', role: 'assistant', content: '', timestamp: Date.now(),
    ...over,
  } as Message
}

describe('buildBlocks', () => {
  it('纯文本消息生成单个 text block', () => {
    const msg = makeMessage({ content: '你好' })
    const blocks = buildBlocks(msg)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'text', content: '你好' })
  })

  it('reasoning 生成 thinking block', () => {
    const msg = makeMessage({
      content: '回答',
      reasoning: { content: '思考中', startTime: 0 },
    })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'thinking')).toBeTruthy()
  })

  it('toolCalls 生成 tool-group block', () => {
    const msg = makeMessage({
      content: '',
      toolCalls: [
        { id: 't1', name: 'Write', input: {}, status: 'completed' },
        { id: 't2', name: 'Write', input: {}, status: 'completed' },
      ],
    })
    const blocks = buildBlocks(msg)
    const group = blocks.find(b => b.kind === 'tool-group')
    expect(group).toMatchObject({ toolName: 'Write' })
    expect((group as any).calls).toHaveLength(2)
  })

  it('从 content 解析 <od-card> 为 od-card block 并剔除标签', () => {
    const content = '前面文字\n<od-card type="brand-preview" title="品牌">{"colors":["#f00"]}</od-card>\n后面文字'
    const msg = makeMessage({ content })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'od-card')).toMatchObject({
      payload: { type: 'brand-preview', title: '品牌', data: { colors: ['#f00'] } },
    })
    const textBlock = blocks.find(b => b.kind === 'text') as any
    expect(textBlock.content).not.toContain('<od-card')
    expect(textBlock.content).toContain('前面文字')
    expect(textBlock.content).toContain('后面文字')
  })

  it('从 content 解析 <question-form> 为 question-form block', () => {
    const content = '<question-form id="q1">{"fields":[]}</question-form>'
    const msg = makeMessage({ content })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'question-form')).toBeTruthy()
  })

  it('从 content 解析 <next-steps> 为 next-steps block', () => {
    const content = '完成\n<next-steps><action label="调整配色" prompt="改主色"/></next-steps>'
    const msg = makeMessage({ content })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'next-steps')).toMatchObject({
      actions: [{ label: '调整配色', prompt: '改主色' }],
    })
  })

  it('metadata 含用量时生成 status block', () => {
    const msg = makeMessage({
      content: 'ok',
      metadata: { inputTokens: 100, outputTokens: 200, duration: 5 } as any,
    })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'status')).toBeTruthy()
  })

  it('未闭合标签当作普通文本处理', () => {
    const msg = makeMessage({ content: '<od-card type="x">未闭合' })
    const blocks = buildBlocks(msg)
    expect(blocks.find(b => b.kind === 'od-card')).toBeFalsy()
    expect(blocks[0]).toMatchObject({ kind: 'text' })
  })
})
