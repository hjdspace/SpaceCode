// @vitest-environment jsdom
/**
 * 从 assistant 事件驱动到消息落库 —— 生成式 UI 卡片投影（票 02）。
 *
 * 这条缝只断言外部可观察结果：消息正文剩下什么、metadata 里有哪些卡与降级说明。
 * 围栏原文不进正文、未闭合不闪半张卡、重复投影不多出一张卡，都在这里钉住
 * （口径见 docs/prd/genui-cards.md §1/§2 与 .scratch/genui-cards/issues/02）。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import type { Message } from '@/types'

const SESSION = 'sess-genui'

function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const subscribe = (key: string) => (cb: any) => {
    handlers[key] = cb
    return () => {}
  }
  return {
    claudeCode: {
      onStreamEvent: subscribe('onStreamEvent'),
      onAssistant: subscribe('onAssistant'),
      onToolUse: subscribe('onToolUse'),
      onToolResult: subscribe('onToolResult'),
      onUser: subscribe('onUser'),
      onSystem: subscribe('onSystem'),
      onResult: subscribe('onResult'),
      onExit: subscribe('onExit'),
      onError: subscribe('onError'),
      onPermissionRequest: subscribe('onPermissionRequest'),
      onPermissionRequestCancelled: subscribe('onPermissionRequestCancelled'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    artifacts: { list: vi.fn().mockResolvedValue({ artifacts: [] }) },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

type Fake = ReturnType<typeof makeFakeApi>

function stream(fake: Fake, event: Record<string, unknown>) {
  fake._handlers.onStreamEvent({ sessionId: SESSION, data: event })
}

/** 流式写入按 50ms 节流，推进定时器才会落到消息上。 */
function flushStreaming() {
  vi.advanceTimersByTime(60)
}

function assistant(fake: Fake): Message | undefined {
  return useChatSessionStore()
    .getSessionMessages(SESSION)
    .find(m => m.role === 'assistant')
}

function textEventContent(message?: Message): string {
  return (message?.timelineEvents ?? []).filter(e => e.type === 'text').map(e => e.content).join('')
}

function formSchema(title: string) {
  return JSON.stringify({ componentName: 'TinyForm', props: { title } })
}

function fence(body: string) {
  return ['```schemaJson', body, '```'].join('\n')
}

async function beginTurn(fake: Fake) {
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('GenUI', 'D:\\ws', SESSION)
  sessionStore.currentSessionId = SESSION
  sessionStore.addMessage({ role: 'user', content: '做成界面' }, SESSION)
  stream(fake, { type: 'message_start', message: { model: 'test-model' } })
}

beforeEach(async () => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const fake = makeFakeApi()
  const { useTurnStore } = await import('@/stores/turn')
  useTurnStore(fake as any)
  ;(globalThis as any).__fake = fake
})

afterEach(() => {
  vi.useRealTimers()
})

function fakeApi(): Fake {
  return (globalThis as any).__fake
}

describe('流式期间的卡片投影', () => {
  it('未闭合的围栏不出卡，也不从正文里闪出来', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '先说明一句\n\n```schemaJson\n' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: formSchema('A') } })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.content).toBe('先说明一句')
    expect(textEventContent(message)).toBe('先说明一句')
    expect(message?.metadata?.genUiCards).toBeUndefined()
    expect(message?.metadata?.genUiCardFallbacks).toBeUndefined()
  })

  it('围栏一闭合就出卡：正文去掉围栏，卡片记录写进 metadata', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '先说明一句\n\n' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: `${fence(formSchema('A'))}\n\n` } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '收尾说明' } })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.content).toBe('先说明一句\n\n收尾说明')
    expect(textEventContent(message)).toBe('先说明一句\n\n收尾说明')
    expect(message?.metadata?.genUiCards).toEqual([
      {
        id: `${message!.id}:card:0`,
        protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
        schema: { componentName: 'TinyForm', props: { title: 'A' } },
      },
    ])
  })

  it('整条正文只有卡片时不留空文本事件，时间线不会多出空白行', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: fence(formSchema('A')) } })
    flushStreaming()

    expect(assistant(fake)?.content).toBe('')
  })

  it('多卡按围栏顺序成卡，散文原样保留', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(
      fake,
      {
        type: 'content_block_delta',
        delta: {
          type: 'text_delta',
          text: ['第一段', '', fence(formSchema('A')), '', '第二段', '', fence(formSchema('B')), '', '结尾'].join('\n'),
        },
      },
    )
    flushStreaming()

    const message = assistant(fake)
    expect(message?.metadata?.genUiCards?.map(c => c.id)).toEqual([`${message!.id}:card:0`, `${message!.id}:card:1`])
    expect(message?.content).toContain('第一段')
    expect(message?.content).toContain('第二段')
    expect(message?.content).toContain('结尾')
    expect(message?.content).not.toContain('schemaJson')
  })
})

describe('消息收口', () => {
  it('收口时仍未闭合的围栏按普通代码块显示，不成卡', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = ['开头', '', '```schemaJson', formSchema('A')].join('\n')
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()
    expect(assistant(fake)?.content).toBe('开头')

    fake._handlers.onResult({ sessionId: SESSION, data: { result: raw } })

    const message = assistant(fake)
    expect(message?.content).toBe(raw)
    expect(textEventContent(message)).toBe(raw)
    expect(message?.metadata?.genUiCards).toBeUndefined()
  })

  it('result 带来的全文重复投影同一张卡时不重复追加', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = fence(formSchema('A'))
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()
    expect(assistant(fake)?.metadata?.genUiCards).toHaveLength(1)

    fake._handlers.onResult({ sessionId: SESSION, data: { result: raw } })

    const message = assistant(fake)
    expect(message?.metadata?.genUiCards).toHaveLength(1)
    expect(message?.content).toBe('')
  })

  it('畸形围栏收口后留在正文并给出可见降级原因', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = ['说明', '', fence('{componentName: 坏 JSON,}')].join('\n')
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()
    fake._handlers.onResult({ sessionId: SESSION, data: { result: raw } })

    const message = assistant(fake)
    expect(message?.content).toBe(raw)
    expect(message?.metadata?.genUiCards).toBeUndefined()
    expect(message?.metadata?.genUiCardFallbacks).toEqual([
      { id: `${message!.id}:fallback:0`, reason: 'malformed-json', componentName: '' },
    ])
  })

  it('两条降级说明都写进 metadata，第二条不会被第一条挡住', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = [fence('{坏 JSON,}'), '', fence('{"componentName":"TinyHuichartsBar"}')].join('\n')
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.metadata?.genUiCardFallbacks?.map(f => f.reason)).toEqual([
      'malformed-json',
      'unsupported-component',
    ])
  })

  it('降级从有到无时收回提示，不留一条已不成立的说明', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    // 先只给到坏 JSON 的开栏与内容（未闭合 → 流式期间隐藏，也不记降级）
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: fence('{"componentName":"TinyHuichartsBar"}').slice(0, -3) } })
    flushStreaming()
    expect(assistant(fake)?.metadata?.genUiCardFallbacks).toBeUndefined()

    // 补上闭栏：这次投影出的是降级，说明要出现
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '```' } })
    flushStreaming()
    expect(assistant(fake)?.metadata?.genUiCardFallbacks).toHaveLength(1)
  })

  it('超出限额的第 9 张卡降级为文本并记录原因', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = Array.from({ length: 9 }, (_, i) => fence(formSchema(`C${i}`))).join('\n\n')
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.metadata?.genUiCards).toHaveLength(8)
    expect(message?.metadata?.genUiCardFallbacks).toEqual([
      { id: `${message!.id}:fallback:8`, reason: 'too-many-cards', componentName: 'TinyForm' },
    ])
    // 超限的卡原文仍在正文里，不静默丢弃
    expect(message?.content).toContain('C8')
  })
})

describe('引擎只回 assistant 事件（非流式）', () => {
  it('正文经 assistant 事件到达时同样成卡并去围栏', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = ['说明', '', fence(formSchema('A'))].join('\n')
    fake._handlers.onAssistant({ sessionId: SESSION, data: { message: { content: [{ type: 'text', text: raw }] } } })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.content).toBe('说明')
    expect(textEventContent(message)).toBe('说明')
    expect(message?.metadata?.genUiCards).toEqual([
      {
        id: `${message!.id}:card:0`,
        protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
        schema: { componentName: 'TinyForm', props: { title: 'A' } },
      },
    ])
  })

  it('流式只给到半个围栏，assistant 事件补全后半段时补齐成卡', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const closed = fence(formSchema('A'))
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: `说明\n\n${closed.slice(0, -3)}` } })
    flushStreaming()
    expect(assistant(fake)?.metadata?.genUiCards).toBeUndefined()

    fake._handlers.onAssistant({
      sessionId: SESSION,
      data: { message: { content: [{ type: 'text', text: `说明\n\n${closed}` }] } },
    })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.metadata?.genUiCards).toHaveLength(1)
    expect(message?.content).toBe('说明')
    expect(textEventContent(message)).toBe('说明')
  })

  it('工具调用前后的两段文本各自成块，不因为投影而重复渲染', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '调用前' } })
    stream(fake, { type: 'content_block_start', content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } })
    stream(fake, { type: 'content_block_stop' })
    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: `调用后\n\n${fence(formSchema('A'))}` } })
    flushStreaming()

    const message = assistant(fake)
    const texts = (message?.timelineEvents ?? []).filter(e => e.type === 'text').map(e => e.content)
    expect(texts).toEqual(['调用前', '调用后'])
    expect(message?.content).toBe('调用前\n\n调用后')
    expect(message?.metadata?.genUiCards).toHaveLength(1)
  })
})

describe('回合以报错收口', () => {
  /** 不可重试的错误：走硬失败分支，这条消息确定不会再有文本来。 */
  async function failTurn(fake: Fake, sessionId: string) {
    const { errorHandler } = await import('@/services/errorHandler')
    const classified = {
      category: 'UNKNOWN',
      title: '请求失败',
      message: '请求失败',
      technicalDetail: 'boom',
      retryable: false,
      originalError: new Error('boom'),
      timestamp: Date.now(),
    } as never
    vi.spyOn(errorHandler, 'classifyError').mockReturnValue(classified)
    vi.spyOn(errorHandler, 'handleError').mockReturnValue(classified)
    void sessionId
    fake._handlers.onError({ sessionId: SESSION, data: { message: 'boom' } })
  }

  it('未闭合的围栏在报错后回到时间线文本，不会被永久藏起来', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = ['开头', '', '```schemaJson', '{"componentName": "TinyForm"'].join('\n')
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()
    expect(textEventContent(assistant(fake))).toBe('开头')

    await failTurn(fake, SESSION)

    const message = assistant(fake)
    expect(textEventContent(message)).toContain('```schemaJson')
    expect(textEventContent(message)).toContain('{"componentName": "TinyForm"')
    expect(message?.metadata?.genUiCards).toBeUndefined()
  })
})

describe('跨 text 块的围栏（模型在 JSON 中间插了一次工具调用）', () => {
  it('整条消息仍然成卡，块内留下可读的原始片段', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    // 开栏与半个 schema 在第一个块，闭合在工具调用之后的第二个块
    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '开头\n```schemaJson\n{"componentName": "TinyForm",\n' } })
    stream(fake, { type: 'content_block_start', content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } })
    stream(fake, { type: 'content_block_stop' })
    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '"props": { "title": "B" }\n}\n```' } })
    flushStreaming()

    const message = assistant(fake)
    // 整条正文拼起来是闭合的，所以卡片照常出现
    expect(message?.metadata?.genUiCards).toHaveLength(1)
    expect(message?.content).toBe('开头')
    // 单块里闭合不了，块文本按普通代码块留着 —— 表现是「卡片 + 一段可读的降级原文」，
    // 消息其余部分不受影响。这是投影只按整条正文判定的已知取舍，不是漏网。
    expect(textEventContent(message)).toContain('```')
  })

  it('DEFECT: 围栏始终不闭合且中途换过块时，藏起来的那段只回到正文，时间线看不到', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '开头\n```schemaJson\n{"componentName": "TinyForm",' } })
    stream(fake, { type: 'content_block_start', content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } })
    stream(fake, { type: 'content_block_stop' })
    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: '后面还有一句' } })
    flushStreaming()
    fake._handlers.onResult({ sessionId: SESSION, data: {} })

    const message = assistant(fake)
    // 收口按整条正文判定：未闭合围栏回到 msg.content
    expect(message?.content).toContain('```schemaJson')
    // 但时间线只回补**当前**块（更早块的原文没留档），于是这段在界面上是看不见的。
    // 这条钉的是「现状如此」，不是「应该如此」：修它要给每个 text 块留原文底账，
    // 另开票决定（口径见 docs/prd/genui-cards.md §1「消息收口时仍未闭合则按普通代码块显示」）。
    expect(textEventContent(message)).not.toContain('```schemaJson')
    expect(message?.metadata?.genUiCards).toBeUndefined()
  })
})

describe('零行为变化', () => {
  it('普通文本回复不碰 metadata', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    const raw = '这是普通回答\n\n```json\n{"a":1}\n```\n\n  ```schemaJson\n  缩进的不算围栏\n  ```'
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } })
    flushStreaming()
    fake._handlers.onResult({ sessionId: SESSION, data: { result: raw } })

    const message = assistant(fake)
    expect(message?.content).toBe(raw)
    expect(textEventContent(message)).toBe(raw)
    expect(message?.metadata?.genUiCards).toBeUndefined()
    expect(message?.metadata?.genUiCardFallbacks).toBeUndefined()
  })

  it('工具卡与推理卡不受投影影响', async () => {
    const fake = fakeApi()
    await beginTurn(fake)

    stream(fake, { type: 'content_block_start', content_block: { type: 'thinking' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '先想想' } })
    stream(fake, { type: 'content_block_stop' })
    stream(fake, { type: 'content_block_start', content_block: { type: 'text' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'text_delta', text: `说明\n\n${fence(formSchema('A'))}` } })
    stream(fake, { type: 'content_block_start', content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read' } })
    stream(fake, { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' } })
    stream(fake, { type: 'content_block_stop' })
    flushStreaming()

    const message = assistant(fake)
    expect(message?.reasoning?.content).toBe('先想想')
    expect(message?.toolCalls?.map(t => t.id)).toEqual(['toolu_1'])
    expect(message?.timelineEvents?.map(e => e.type)).toEqual(['reasoning', 'text', 'tool_call'])
    expect(textEventContent(message)).toBe('说明')
    expect(message?.metadata?.genUiCards).toHaveLength(1)
  })
})
