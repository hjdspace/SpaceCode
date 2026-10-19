// @vitest-environment jsdom
/**
 * Trace 事件耗时写入 schema（#41 拆分票 16）。
 *
 * renderer 结算回合时往 trace 事件里写 `metadata.duration`，而所有读取方（traceIpc 转换器、
 * traceViewModel）认的是 `metadata.durationMs` —— 键名错配让现网 491 个 completed
 * `assistant_turn` 的耗时在 Trace 界面一处都不显示。这里钉住写入侧：
 *  - trace 事件统一写规范键 durationMs（毫秒），不再写 legacy duration
 *  - 失败回合也带耗时（此前它的 trace 事件根本没有 metadata）
 *  - started 事件不带耗时（回合还没结束）
 * 消息级 metadata.duration 是聊天 UI 在读的字段（MessageMetadata / TurnSummaryBar），
 * 不属于 trace schema，所以同时钉住它不能被一起改掉。
 *
 * trace 事件由 chatSession.traceEvent 发出，它用的是模块级 `api`，不是 useTurnStore 注入的
 * fake —— 所以这里 wrap 真实 api.trace.event 来录制，注入的 fake 只负责事件订阅。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory, type ClassifiedError } from '@/types'

const BASE = Date.parse('2026-06-12T12:44:57.259Z')
const TURN_MS = 15900

type RecordedTraceEvent = { type: string; status?: string; metadata?: Record<string, unknown> }
type StreamEvent = { sessionId: string; data: Record<string, unknown> }
type StreamHandler = (event: StreamEvent) => void

const probe = vi.hoisted(() => ({ emitted: [] as RecordedTraceEvent[] }))

vi.mock('@/services/electronAPI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/electronAPI')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      trace: {
        ...actual.api.trace,
        event: (event: RecordedTraceEvent) => { probe.emitted.push(event) },
      },
    },
  }
})

function makeFakeApi() {
  const handlers: Record<string, StreamHandler> = {}
  const subscribe = (key: string) => (cb: StreamHandler) => {
    handlers[key] = cb
    return () => { delete handlers[key] }
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
    /** 触发某个订阅回调 */
    fire: (key: string, event: StreamEvent) => { handlers[key]?.(event) },
  }
}

/** message_start 开局：建 turn（发 started 事件）、建 assistant 消息，时间戳都落在 BASE。 */
async function startTurn(sessionId: string) {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('@/stores/turn')
  useTurnStore(fake)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Test', undefined, sessionId)
  sessionStore.addMessage({ role: 'user', content: '跑一个回合' }, sessionId)
  fake.fire('onStreamEvent', { sessionId, data: { type: 'message_start', message: { model: 'test-model' } } })
  return fake
}

function turnEvent(status: string) {
  return probe.emitted.find(e => e.type === 'assistant_turn' && e.status === status)
}

/** 只推进时钟、不跑定时器队列，避免把回合内的 debounce 卷进来。 */
function elapse(ms: number) {
  vi.setSystemTime(BASE + ms)
}

beforeEach(() => {
  probe.emitted = []
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('assistant_turn trace 事件的耗时字段', () => {
  it('成功回合写 metadata.durationMs（毫秒），不再写 legacy duration', async () => {
    const fake = await startTurn('sess-dur-ok')
    elapse(TURN_MS)
    fake.fire('onResult', {
      sessionId: 'sess-dur-ok',
      data: { result: '已完成', usage: { input_tokens: 1, output_tokens: 1 } },
    })

    const event = turnEvent('completed')
    expect(event?.metadata?.durationMs).toBe(TURN_MS)
    expect(event?.metadata).not.toHaveProperty('duration')
  })

  it('消息级 metadata.duration 保留 —— 聊天 UI 在读它', async () => {
    const fake = await startTurn('sess-dur-msg')
    elapse(TURN_MS)
    fake.fire('onResult', { sessionId: 'sess-dur-msg', data: { result: '已完成' } })

    const assistant = useChatSessionStore()
      .getSessionMessages('sess-dur-msg')
      .find(m => m.role === 'assistant')
    expect(assistant?.metadata?.duration).toBe(TURN_MS)
  })

  it('失败回合也带耗时', async () => {
    const classified: ClassifiedError = {
      category: ErrorCategory.UNKNOWN,
      title: '请求失败',
      message: '请求失败',
      technicalDetail: 'bad request',
      retryable: false,
      originalError: new Error('bad request'),
      timestamp: BASE,
    }
    vi.spyOn(errorHandler, 'classifyError').mockReturnValue(classified)
    const reportError = vi.spyOn(errorHandler, 'handleError').mockReturnValue(classified)

    const fake = await startTurn('sess-dur-fail')
    elapse(TURN_MS)
    fake.fire('onError', { sessionId: 'sess-dur-fail', data: { message: 'bad request' } })

    const event = turnEvent('failed')
    expect(event?.metadata?.durationMs).toBe(TURN_MS)
    expect(event?.metadata).not.toHaveProperty('duration')
    expect(reportError).toHaveBeenCalled()
  })

  it('started 事件不带耗时（回合尚未结束，不能显示成 0ms）', async () => {
    await startTurn('sess-dur-started')

    const event = turnEvent('started')
    expect(event).toBeDefined()
    expect(event?.metadata?.durationMs).toBeUndefined()
    expect(event?.metadata?.duration).toBeUndefined()
  })
})
