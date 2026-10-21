// @vitest-environment jsdom
/**
 * 流式工具参数的路径字段必须等引号闭合后才进入 toolCall.input。
 *
 * 回归背景：pi 的 write 参数是 { content, path }，path 排在最后。早期提取曾在
 * 分片停在 `src/composables/__` 时就把半截路径写进 input；会话改动列表把第一次
 * 看到的路径当成最终路径，而后续补全不改变“写调用数”，悬浮条就一直停在截断的
 * 文件名上。这里同时钉住“完整工具帧必须覆盖早期半截 input”。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'

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
  useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Test', undefined, sessionId)
  sessionStore.addMessage({ role: 'user', content: '写文件' }, sessionId)
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'message_start', message: { model: 'test-model' } },
  })
  return fake
}

function startWrite(fake: ReturnType<typeof makeFakeApi>, sessionId: string, id: string) {
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'content_block_start', content_block: { type: 'tool_use', id, name: 'Write' } },
  })
}

function pushJson(fake: ReturnType<typeof makeFakeApi>, sessionId: string, partialJson: string) {
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: partialJson } },
  })
}

function toolCallOf(sessionId: string, id: string) {
  const msg = useChatSessionStore()
    .getSessionMessages(sessionId)
    .find(m => m.role === 'assistant')
  return msg?.toolCalls?.find(tc => tc.id === id)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('流式工具参数里的路径', () => {
  it('半截路径不进入 input，引号闭合后才写入', async () => {
    const sid = 'sess-early-path'
    const fake = await setupTurn(sid)

    startWrite(fake, sid, 'tc-write')
    pushJson(fake, sid, '{"content":"x","path":"src/composables/__')
    vi.advanceTimersByTime(150)

    const partial = toolCallOf(sid, 'tc-write')
    expect(partial?.input?.content).toBe('x')
    expect(partial?.input?.path).toBeUndefined()

    pushJson(fake, sid, 'tests__/useContentEditor.test.ts"}')
    vi.advanceTimersByTime(150)

    expect(toolCallOf(sid, 'tc-write')?.input?.path)
      .toBe('src/composables/__tests__/useContentEditor.test.ts')
  })

  it('完整 tool_use 帧覆盖键数相同的早期 input', async () => {
    const sid = 'sess-authoritative-input'
    const fake = await setupTurn(sid)

    startWrite(fake, sid, 'tc-write')
    pushJson(fake, sid, '{"content":"x","path":"src/composables/__"}')
    vi.advanceTimersByTime(150)
    expect(toolCallOf(sid, 'tc-write')?.input?.path).toBe('src/composables/__')

    fake._handlers.onToolUse({
      sessionId: sid,
      data: {
        id: 'tc-write',
        name: 'Write',
        input: { content: 'x', path: 'src/composables/__tests__/useContentEditor.test.ts' },
      },
    })

    expect(toolCallOf(sid, 'tc-write')?.input?.path)
      .toBe('src/composables/__tests__/useContentEditor.test.ts')
  })
})
