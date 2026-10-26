import { describe, expect, it } from 'vitest'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'

/**
 * 历史回放里的卡片投影（票 02，PRD §5）。
 *
 * JSONL 是引擎写的，正文里带着 ` ```schemaJson ` 原文。不重投影的话，重载后会把
 * 本该是界面的东西显示成一段 JSON，卡片也丢了。这里钉住回放与流式共用同一条判定：
 * 同一份正文在两条路径上得到同样的正文与同样的确定性 id。
 */
function assistantRecord(text: string, id = 'msg_1') {
  return {
    type: 'assistant',
    uuid: `uuid-${id}`,
    message: { id, role: 'assistant', content: [{ type: 'text', text }] },
  }
}

const FENCE = (body: string) => ['```schemaJson', body, '```'].join('\n')
const SCHEMA = JSON.stringify({ componentName: 'TinyForm', props: { title: '构建参数' } })

describe('回放时的卡片重投影', () => {
  it('闭合围栏在回放后仍然是卡片，正文里不再出现 JSON', () => {
    const messages = buildMessagesFromHistory([assistantRecord(`说明\n\n${FENCE(SCHEMA)}`)])
    const assistant = messages[0]

    expect(assistant.content).toBe('说明')
    expect(assistant.metadata?.genUiCards).toEqual([
      {
        id: 'msg_1:card:0',
        protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
        schema: { componentName: 'TinyForm', props: { title: '构建参数' } },
      },
    ])
  })

  it('时间线里的 text 事件同样去掉围栏，否则界面仍会显示 JSON', () => {
    const messages = buildMessagesFromHistory([assistantRecord(`说明\n\n${FENCE(SCHEMA)}`)])
    const textEvents = messages[0].timelineEvents?.filter(event => event.type === 'text') ?? []

    expect(textEvents.map(event => event.content)).toEqual(['说明'])
  })

  it('同一份历史两次回放结果一致（确定性 id 不因回放漂移）', () => {
    const raw = [assistantRecord(`${FENCE(SCHEMA)}\n\n中间\n\n${FENCE(SCHEMA)}`)]
    // 只比卡片相关字段：缺 timestamp 的记录会被补上 Date.now()，两次跑本来就该不同
    const view = (messages: ReturnType<typeof buildMessagesFromHistory>) =>
      messages.map(msg => ({ content: msg.content, metadata: msg.metadata }))

    expect(view(buildMessagesFromHistory(raw))).toEqual(view(buildMessagesFromHistory(raw)))
    expect(buildMessagesFromHistory(raw)[0].metadata?.genUiCards?.map(card => card.id)).toEqual([
      'msg_1:card:0',
      'msg_1:card:1',
    ])
  })

  it('畸形围栏回放后原样留在正文并带一条降级说明', () => {
    const text = `说明\n\n${FENCE('{componentName: 坏 JSON,}')}`
    const messages = buildMessagesFromHistory([assistantRecord(text)])
    const assistant = messages[0]

    expect(assistant.content).toBe(text)
    expect(assistant.metadata?.genUiCards).toBeUndefined()
    expect(assistant.metadata?.genUiCardFallbacks).toEqual([
      { id: 'msg_1:fallback:0', reason: 'malformed-json', componentName: '' },
    ])
  })

  it('普通回复与别的语言围栏一律不动', () => {
    const text = '普通回答\n\n```json\n{"a":1}\n```'
    const messages = buildMessagesFromHistory([assistantRecord(text)])

    expect(messages[0].content).toBe(text)
    expect(messages[0].metadata?.genUiCards).toBeUndefined()
    expect(messages[0].metadata?.genUiCardFallbacks).toBeUndefined()
  })

  it('卡片不影响同一条消息里的推理与工具调用还原', () => {
    const messages = buildMessagesFromHistory([
      {
        type: 'assistant',
        uuid: 'uuid-multi',
        message: {
          id: 'msg_multi',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '先想想', signature: 'sig' },
            { type: 'text', text: `说明\n\n${FENCE(SCHEMA)}` },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        },
      },
    ])
    const assistant = messages[0]

    expect(assistant.reasoning?.content).toBe('先想想')
    expect(assistant.toolCalls?.map(call => call.id)).toEqual(['toolu_1'])
    expect(assistant.content).toBe('说明')
    expect(assistant.metadata?.genUiCards).toHaveLength(1)
  })
})
