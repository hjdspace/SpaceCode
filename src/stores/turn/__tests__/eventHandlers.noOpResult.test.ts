// @vitest-environment jsdom
/**
 * 引擎"空转"result（is_error=false、无输出、num_turns=0）的处理。
 *
 * 实测链路：会话被中断后重启（--resume），被杀后台任务合成的 task-notification
 * 排在用户 prompt 前面被当作独立命令处理（shouldQuery=false），引擎先吐一个空
 * "成功"result；用户真正的 prompt 还在引擎队列里，紧接着会有第二个 result。
 * 这里钉住四件事：
 *  - 空转 result 不结算回合、不报错 —— turn 保持打开等下一个 result
 *  - 下一个 result 正常收口（loading 落下，不触发错误处理）
 *  - 超时仍无后续 result 才报错，且文案准确（不是"上游请求失败/检查 API 配置"）
 *  - num_turns>0 的空 result 仍走"上游重试耗尽"错误路径（回归保护）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory, type ClassifiedError } from '@/types'

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

async function setupTurn(sessionId: string) {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('@/stores/turn')
  const turnStore = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Test', undefined, sessionId)
  sessionStore.addMessage({ role: 'user', content: '你能做什么' }, sessionId)
  // message_start 建立 turn 状态 —— 没有它 onResult 会被 `if (!ts) return` 挡掉
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'message_start', message: { model: 'test-model' } },
  })
  return { fake, turnStore }
}

function classifiedError(): ClassifiedError {
  return {
    category: ErrorCategory.UNKNOWN,
    title: '请求失败',
    message: '请求失败',
    technicalDetail: 'boom',
    retryable: false,
    originalError: new Error('boom'),
    timestamp: Date.now(),
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('引擎空转 result（num_turns=0）不结算回合', () => {
  it('空转 result 后紧跟的第二个 result 正常收口，不触发错误处理', async () => {
    const handleErrorSpy = vi.spyOn(errorHandler, 'handleError')
    vi.spyOn(errorHandler, 'classifyError').mockImplementation(classifiedError)
    const { fake, turnStore } = await setupTurn('sess-noop-followup')

    // 引擎先吐空转 result（task-notification 被当作独立命令处理）
    fake._handlers.onResult({
      sessionId: 'sess-noop-followup',
      data: { type: 'result', result: '', num_turns: 0, is_error: false },
    })
    // turn 必须保持打开：loading 不落下，错误处理不被触发
    expect(turnStore.loadingSessions.get('sess-noop-followup')).toBe(true)
    expect(handleErrorSpy).not.toHaveBeenCalled()

    // 用户真正的 prompt 处理完，第二个 result 到达
    fake._handlers.onResult({
      sessionId: 'sess-noop-followup',
      data: { type: 'result', result: '我可以帮你管理工单', num_turns: 2, is_error: false },
    })

    expect(turnStore.loadingSessions.get('sess-noop-followup')).toBe(false)
    expect(handleErrorSpy).not.toHaveBeenCalled()
  })

  it('超时仍无后续 result 才报错，文案指向上游请求失败之外的真实原因', async () => {
    const handleErrorSpy = vi.spyOn(errorHandler, 'handleError')
    vi.spyOn(errorHandler, 'classifyError').mockImplementation(classifiedError)
    const { fake } = await setupTurn('sess-noop-timeout')
    // 计时器在 onResult 里才被调度，必须先切假时钟再触发空转 result
    vi.useFakeTimers()

    fake._handlers.onResult({
      sessionId: 'sess-noop-timeout',
      data: { type: 'result', result: '', num_turns: 0, is_error: false },
    })
    expect(handleErrorSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(120_000)

    expect(handleErrorSpy).toHaveBeenCalledTimes(1)
    const errorArg = handleErrorSpy.mock.calls[0][0] as Error
    expect(String(errorArg.message)).not.toContain('upstream request failed')
    expect(String(errorArg.message)).toContain('produced no output')
  })

  it('空转 result 后用户中止回合，兜底计时器不再触发错误', async () => {
    const handleErrorSpy = vi.spyOn(errorHandler, 'handleError')
    vi.spyOn(errorHandler, 'classifyError').mockImplementation(classifiedError)
    const { fake, turnStore } = await setupTurn('sess-noop-abort')

    fake._handlers.onResult({
      sessionId: 'sess-noop-abort',
      data: { type: 'result', result: '', num_turns: 0, is_error: false },
    })
    await turnStore.abort('sess-noop-abort')

    vi.useFakeTimers()
    vi.advanceTimersByTime(120_000)
    expect(handleErrorSpy).not.toHaveBeenCalled()
  })
})

describe('num_turns>0 的空 result 仍按上游重试耗尽报错（回归保护）', () => {
  it('空 result 且 num_turns>0 走原有错误路径', async () => {
    const handleErrorSpy = vi.spyOn(errorHandler, 'handleError')
    vi.spyOn(errorHandler, 'classifyError').mockImplementation(classifiedError)
    const { fake } = await setupTurn('sess-empty-positive')

    fake._handlers.onResult({
      sessionId: 'sess-empty-positive',
      data: { type: 'result', result: '', num_turns: 3, is_error: false },
    })

    expect(handleErrorSpy).toHaveBeenCalledTimes(1)
    const errorArg = handleErrorSpy.mock.calls[0][0] as Error
    expect(String(errorArg.message)).toContain('upstream request failed')
  })
})
