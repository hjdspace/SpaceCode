import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mapPiEvent } from '@electron/engine/engines/PiEventMapper'
import { hasToolComponent } from '@/components/chat/tools/index'
import { useChatSessionStore } from '@/stores/chatSession'

/**
 * Pi 帧 → 工具卡片身份 的跨边界契约。
 *
 * 单测各自看一半时都成立、拼起来才出错的那段：
 *  - pi-ai 的 toolcall_start 帧只有 { contentIndex, partial }，id/name 在
 *    partial.content[contentIndex] 的 toolCall 块上；真 id 也要到
 *    tool_execution_start 才第二次出现。mapper 若读帧顶层不存在的字段，
 *    turn store 会用随机 uuid + 'Unknown Tool' 建一张幽灵卡片（tool_result 按
 *    真 id 匹配，幽灵永远 running → 一直转圈、时长一直涨），再由
 *    tool_execution_start 另建真卡片 —— 同一次调用渲染成两行。
 *  - 工具名必须归一成渲染层词表：组件/图标/标签表按名精确匹配，小写 bash
 *    命中不了 BashToolCard，终端卡片会退化成通用行 + input/output JSON 直出。
 *
 * 帧 fixture 按 pi-ai 真实事件形状构造（见 node_modules/@earendil-works/pi-ai
 * /dist/types.d.ts 的 AssistantMessageEvent），不手搓"应该有"的字段。
 */

const SID = 'pi-tool-card-identity'
const COMMAND = 'npm run test:coverage'

type Handler = (event: { sessionId: string; data: any }) => void

function makeHarness() {
  const handlers: Record<string, Handler> = {}
  const on = (name: string) => (cb: Handler) => {
    handlers[name] = cb
    return () => {}
  }
  const api = {
    claudeCode: {
      onStreamEvent: on('onStreamEvent'),
      onAssistant: on('onAssistant'),
      onToolUse: on('onToolUse'),
      onToolResult: on('onToolResult'),
      onUser: on('onUser'),
      onSystem: on('onSystem'),
      onResult: on('onResult'),
      onExit: on('onExit'),
      onError: on('onError'),
      onPermissionRequest: on('onPermissionRequest'),
      onPermissionRequestCancelled: on('onPermissionRequestCancelled'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn(),
      denyPermission: vi.fn(),
      submitToolAnswer: vi.fn(),
      skipToolAnswer: vi.fn(),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
  }
  return { api, handlers }
}

/** 走真实路由：Pi 帧 → mapPiEvent → 按 UnifiedEngineEvent.type 派给对应订阅回调 */
function feedPi(handlers: Record<string, Handler>, frame: any) {
  const mapped = mapPiEvent(SID, frame)
  if (!mapped) return
  const route: Record<string, string> = {
    stream_event: 'onStreamEvent',
    assistant: 'onAssistant',
    user: 'onUser',
    tool_use: 'onToolUse',
    tool_result: 'onToolResult',
    system: 'onSystem',
    result: 'onResult',
  }
  handlers[route[mapped.type]]?.({ sessionId: SID, data: mapped.data })
}

function feedToolCallStream(handlers: Record<string, Handler>) {
  const toolCall = { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: {}, partialJson: '', index: 0 }
  const partial = { content: [toolCall] }
  const update = (assistantMessageEvent: any) => feedPi(handlers, { type: 'message_update', assistantMessageEvent })
  update({ type: 'toolcall_start', contentIndex: 0, partial })
  update({ type: 'toolcall_delta', contentIndex: 0, delta: `{"command":"${COMMAND}"}`, partial })
  update({
    type: 'toolcall_end',
    contentIndex: 0,
    toolCall: { ...toolCall, arguments: { command: COMMAND } },
    partial,
  })
}

function assistantMessage() {
  const session = useChatSessionStore().sessions.find(s => s.id === SID)
  return session?.messages.find(m => m.role === 'assistant')
}

describe('Pi 工具卡片身份（mapper → turn store）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('一次 bash 调用只留一张卡片：id 对齐、名字归一为 Bash、结果能收口', async () => {
    const { useTurnStore } = await import('@/stores/turn')
    const { api, handlers } = makeHarness()
    useTurnStore(api as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Pi', undefined, SID)
    sessionStore.addMessage({ role: 'user', content: '跑一下覆盖率' }, SID)

    feedToolCallStream(handlers)
    feedPi(handlers, { type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash', args: { command: COMMAND } })
    feedPi(handlers, {
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      result: { content: [{ type: 'text', text: 'all tests passed' }] },
      isError: false,
    })

    const msg = assistantMessage()
    expect(msg?.toolCalls).toHaveLength(1)
    const [tool] = msg!.toolCalls!
    expect(tool.id).toBe('tc-1')
    expect(tool.name).toBe('Bash')
    expect(tool.input).toEqual({ command: COMMAND })
    expect(tool.status).toBe('completed')
    expect(msg!.timelineEvents?.filter(e => e.type === 'tool_call')).toHaveLength(1)
    // 渲染层契约：命中专用卡片才会出终端 UI，否则退化成 JSON 行
    expect(hasToolComponent(tool.name)).toBe(true)
  })

  it('tool_result 之前卡片保持 running，且不因 tool_execution_start 重复建卡', async () => {
    const { useTurnStore } = await import('@/stores/turn')
    const { api, handlers } = makeHarness()
    useTurnStore(api as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Pi', undefined, SID)
    sessionStore.addMessage({ role: 'user', content: '列目录' }, SID)

    feedToolCallStream(handlers)
    feedPi(handlers, { type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash', args: { command: COMMAND } })

    const msg = assistantMessage()
    expect(msg?.toolCalls).toHaveLength(1)
    expect(msg!.toolCalls![0].status).toBe('running')
    // 幽灵卡片的特征就是名字兜底成 Unknown Tool
    expect(msg!.toolCalls![0].name).not.toBe('Unknown Tool')
  })
})
