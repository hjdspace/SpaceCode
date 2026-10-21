// @vitest-environment jsdom
/**
 * 运行中的工具输出是「最新快照」，不是追加流。
 *
 * 引擎（pi 的 tool_execution_update，或主进程为 claude-code 合成的
 * tool_execution_delta）每次都送整段快照。超过内存上限时必须保留尾部：
 * 保留头部会让终端在输出达到上限后永久冻结在早期内容上，引擎再怎么推
 * 界面都不再变化。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '@/stores/chatSession'
import { MAX_INMEMORY_TOOL_OUTPUT } from '@/stores/turn/types'
import type { Message, ToolCall } from '@/types'

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

type FakeApi = ReturnType<typeof makeFakeApi>

function assistantOf(sessionId: string): Message | undefined {
  return useChatSessionStore()
    .getSessionMessages(sessionId)
    .find(m => m.role === 'assistant')
}

function toolCallOf(sessionId: string, toolId: string): ToolCall | undefined {
  return assistantOf(sessionId)?.toolCalls?.find(tc => tc.id === toolId)
}

async function setupTurn(sessionId: string): Promise<FakeApi> {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('@/stores/turn')
  useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Test', undefined, sessionId)
  sessionStore.addMessage({ role: 'user', content: '跑一下测试' }, sessionId)
  fake._handlers.onStreamEvent({
    sessionId,
    data: { type: 'message_start', message: { model: 'test-model' } },
  })
  return fake
}

function startBashTool(fake: FakeApi, sessionId: string, toolId: string): void {
  fake._handlers.onStreamEvent({
    sessionId,
    data: {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: toolId, name: 'Bash' },
    },
  })
}

function pushSnapshot(fake: FakeApi, sessionId: string, toolId: string, text: string): void {
  fake._handlers.onStreamEvent({
    sessionId,
    data: {
      type: 'content_block_delta',
      delta: {
        type: 'tool_execution_delta',
        toolCallId: toolId,
        partialResult: { content: [{ type: 'text', text }] },
      },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('运行中工具输出的快照写入', () => {
  it('短快照原样写入并随下一次快照整体替换', async () => {
    const sessionId = 'sess-live-short'
    const fake = await setupTurn(sessionId)
    startBashTool(fake, sessionId, 'tc-1')

    pushSnapshot(fake, sessionId, 'tc-1', '第一行\n第二行')
    expect(toolCallOf(sessionId, 'tc-1')?.output).toBe('第一行\n第二行')

    pushSnapshot(fake, sessionId, 'tc-1', '第一行\n第二行\n第三行')
    expect(toolCallOf(sessionId, 'tc-1')?.output).toBe('第一行\n第二行\n第三行')
  })

  it('超过内存上限的快照保留尾部，不冻结在早期内容', async () => {
    const sessionId = 'sess-live-long'
    const fake = await setupTurn(sessionId)
    startBashTool(fake, sessionId, 'tc-long')

    const head = 'HEAD_MARK\n' + 'a'.repeat(MAX_INMEMORY_TOOL_OUTPUT)
    const body = 'b'.repeat(MAX_INMEMORY_TOOL_OUTPUT)
    pushSnapshot(fake, sessionId, 'tc-long', head + '\n' + body + '\nTAIL_MARK')

    const output = toolCallOf(sessionId, 'tc-long')?.output || ''
    expect(output).toContain('[Output truncated to the most recent output]')
    expect(output.endsWith('TAIL_MARK')).toBe(true)
    expect(output.includes('HEAD_MARK')).toBe(false)
  })

  it('工具结束后迟到的快照不会覆盖终态输出', async () => {
    const sessionId = 'sess-live-settled'
    const fake = await setupTurn(sessionId)
    startBashTool(fake, sessionId, 'tc-2')

    fake._handlers.onToolResult({
      sessionId,
      data: { tool_use_id: 'tc-2', output: 'final output', is_error: false },
    })
    pushSnapshot(fake, sessionId, 'tc-2', 'late snapshot')

    expect(toolCallOf(sessionId, 'tc-2')?.output).toBe('final output')
    expect(toolCallOf(sessionId, 'tc-2')?.status).toBe('completed')
  })
})
