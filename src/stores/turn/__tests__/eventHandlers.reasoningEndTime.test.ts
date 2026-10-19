// @vitest-environment jsdom
/**
 * thinking 块结束时 msg.reasoning.endTime 的收口时机。
 *
 * endTime 是 MessageItem.reasoningIsThinking 回退分支（消息没有 reasoning
 * timeline 事件时）判断"是否仍在思考"的唯一信号；AgentTimeline 的事件级
 * 渲染则认 timeline 事件的 status。若 endTime 只在 result 事件才写，块结束
 * 到回合结算之间（工具执行期可能长达数分钟）回退分支会一直显示"思考中"，
 * 与事件级渲染不一致。这里钉住三件事：
 *  - 块边界收口（message_delta / message_stop / 下一个 content_block_start）
 *    与 timeline 事件同步写 endTime
 *  - 多块 thinking 轮次：新块开始清空 endTime（回到"思考中"），再收口时写回
 *  - 没经历边界收口的回合仍由 result 事件兜底（回归保护）
 *  - 不走 result 事件的回合结局（用户 abort / 引擎 error）也必须收口 reasoning，
 *    否则思考卡片永远转圈
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory, type ClassifiedError } from '@/types'
import type { Message, MessageTimelineEvent } from '@/types'

function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const noopSubscribe = (key: string) => (cb: any) => {
    handlers[key] = cb
    return () => {}
  }
  return {
    claudeCode: {
      onStreamEvent: noopSubscribe('onStreamEvent'),
      onAssistant: noopSubscribe('onAssistant'),
      onToolUse: noopSubscribe('onToolUse'),
      onToolResult: noopSubscribe('onToolResult'),
      onUser: noopSubscribe('onUser'),
      onSystem: noopSubscribe('onSystem'),
      onResult: noopSubscribe('onResult'),
      onExit: noopSubscribe('onExit'),
      onError: noopSubscribe('onError'),
      onPermissionRequest: noopSubscribe('onPermissionRequest'),
      onPermissionRequestCancelled: noopSubscribe('onPermissionRequestCancelled'),
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

function assistantOf(sessionId: string): Message | undefined {
  return useChatSessionStore()
    .getSessionMessages(sessionId)
    .find(m => m.role === 'assistant')
}

function reasoningEventsOf(msg: Message | undefined): MessageTimelineEvent[] {
  return (msg?.timelineEvents || []).filter(e => e.type === 'reasoning')
}

async function setupTurn(sessionId: string) {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('@/stores/turn')
  const turnStore = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Test', undefined, sessionId)
  sessionStore.addMessage({ role: 'user', content: '想一想' }, sessionId)
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'message_start', message: { model: 'test-model' } },
  })
  return { fake, turnStore }
}

function fireThinking(fake: ReturnType<typeof makeFakeApi>, sessionId: string, text: string) {
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'content_block_start', content_block: { type: 'thinking' } },
  })
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: text } },
  })
}

function fireBoundary(fake: ReturnType<typeof makeFakeApi>, sessionId: string, type: 'message_delta' | 'message_stop') {
  fake._handlers.onStreamEvent({ sessionId, data: { type } })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('thinking 块结束时 msg.reasoning.endTime 的收口时机', () => {
  it('块边界收口时同步写 endTime，不等 result 事件', async () => {
    const { fake } = await setupTurn('sess-block-end')
    fireThinking(fake, 'sess-block-end', '第一段思考')
    fireBoundary(fake, 'sess-block-end', 'message_delta')

    const msg = assistantOf('sess-block-end')
    const events = reasoningEventsOf(msg)
    expect(events).toHaveLength(1)
    expect(events[0].status).toBe('completed')
    expect(typeof msg?.reasoning?.endTime).toBe('number')
    expect(msg?.reasoning?.isExpanded).toBe(false)
    // result 未到：回合尚未结算，endTime 却已写好 —— 这才是回退分支要的语义
    expect(msg?.metadata).toBeUndefined()
  })

  it('第二段 thinking 开始时清空 endTime，其块收口后重新写回', async () => {
    const { fake } = await setupTurn('sess-multi-block')
    fireThinking(fake, 'sess-multi-block', '第一段思考')
    fireBoundary(fake, 'sess-multi-block', 'message_delta')
    expect(typeof assistantOf('sess-multi-block')?.reasoning?.endTime).toBe('number')

    // 工具执行完，模型又输出一段 thinking
    fireThinking(fake, 'sess-multi-block', '第二段思考')
    const msg = assistantOf('sess-multi-block')
    expect(msg?.reasoning?.endTime).toBeUndefined()
    const events = reasoningEventsOf(msg)
    expect(events).toHaveLength(2)
    expect(events.map(e => e.status)).toEqual(['completed', 'running'])

    fireBoundary(fake, 'sess-multi-block', 'message_stop')
    expect(reasoningEventsOf(assistantOf('sess-multi-block')).map(e => e.status))
      .toEqual(['completed', 'completed'])
    expect(typeof assistantOf('sess-multi-block')?.reasoning?.endTime).toBe('number')
  })

  it('未经历边界收口的回合由 result 事件兜底写 endTime（回归保护）', async () => {
    const { fake } = await setupTurn('sess-result-only')
    fireThinking(fake, 'sess-result-only', '一次性思考')
    fake._handlers.onResult({
      sessionId: 'sess-result-only',
      data: { result: '答复', usage: { input_tokens: 1, output_tokens: 1 } },
    })

    const msg = assistantOf('sess-result-only')
    expect(reasoningEventsOf(msg).every(e => e.status === 'completed')).toBe(true)
    expect(typeof msg?.reasoning?.endTime).toBe('number')
  })
})

describe('不走 result 事件的回合结局也必须收口 reasoning', () => {
  it('用户中止（abort）时收口仍在进行的 thinking 块', async () => {
    const { fake, turnStore } = await setupTurn('sess-abort')
    fireThinking(fake, 'sess-abort', '思考了一半被打断')

    await turnStore.abort('sess-abort')

    const msg = assistantOf('sess-abort')
    expect(reasoningEventsOf(msg).map(e => e.status)).toEqual(['completed'])
    expect(typeof msg?.reasoning?.endTime).toBe('number')
  })

  it('引擎报错（handleError）结算回合时收口仍在进行的 thinking 块', async () => {
    const classified: ClassifiedError = {
      category: ErrorCategory.UNKNOWN,
      title: '请求失败',
      message: '请求失败',
      technicalDetail: 'boom',
      retryable: false,
      originalError: new Error('boom'),
      timestamp: Date.now(),
    }
    vi.spyOn(errorHandler, 'classifyError').mockReturnValue(classified)
    vi.spyOn(errorHandler, 'handleError').mockReturnValue(classified)

    const { fake } = await setupTurn('sess-error')
    fireThinking(fake, 'sess-error', '思考了一半报错')

    fake._handlers.onError({ sessionId: 'sess-error', data: { message: 'boom' } })

    const msg = assistantOf('sess-error')
    expect(reasoningEventsOf(msg).map(e => e.status)).toEqual(['completed'])
    expect(typeof msg?.reasoning?.endTime).toBe('number')
  })
})
