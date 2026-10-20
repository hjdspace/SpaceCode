import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mapPiEvent } from '@electron/engine/engines/PiEventMapper'
import { useChatSessionStore } from '@/stores/chatSession'
import type { Message } from '@/types'

/**
 * Pi 帧 → 推理卡片身份 的跨边界契约。
 *
 * 一段思考只准产出一张卡片。两层各自看都对、拼起来才出错的那段：
 *  - pi 每个 assistant 消息发两帧 assistant 事件（message_start / message_end）。
 *    message_start 那帧的 content 是流式进行中的**活对象**：pi-ai 在
 *    `stream.push({type:'start', partial: output})` 之后继续原地写 output.content
 *    （`@earendil-works/pi-ai/dist/api/openai-completions.js` 的 ensureThinkingBlock
 *    + `block.thinking += delta`），agent-loop 取到队列里的 "start" 时才转发，于是
 *    宿主收到的时候半截 thinking 已经在里面。mapper 若照原样透传，turn store 会在
 *    还没有任何 timeline 事件时把它落成一张独立推理卡，紧接着 thinking_start 又开一张
 *    —— 同一段思考渲染两遍，第一张只剩开头几个字（截图里的 "The"）。
 *  - 只有**第一块**会重复：streamingHandledThinking 一旦置位，后续块都走 else 分支被挡住。
 *  - claude-code 以 --include-partial-messages 启动，assistant 帧必然晚于该消息的
 *    全部 stream_event，结构上到不了这条分支，所以这条缝只有 pi 侧需要钉。
 *
 * 帧 fixture 按 pi 真实 RPC 帧形状构造，投递口径照 PiProcessPool.routeEvent。
 */

const SID = 'pi-thinking-frame'

const THINKING_CHUNKS = ['The', ' user', ' is', ' asking', ' in', ' Chinese', ' which', ' MCP', ' servers']
const THINKING_FULL = THINKING_CHUNKS.join('')

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

const CHANNEL_BY_EVENT_TYPE: Record<string, string> = {
  stream_event: 'onStreamEvent',
  assistant: 'onAssistant',
  tool_use: 'onToolUse',
  tool_result: 'onToolResult',
  user: 'onUser',
  system: 'onSystem',
  result: 'onResult',
  error: 'onError',
}

/** 照 PiProcessPool.routeEvent 的口径投递：映射后按类型发往对应频道。 */
function feedPiFrame(fake: ReturnType<typeof makeFakeApi>, frame: Record<string, any>): void {
  const mapped = mapPiEvent(SID, frame as any)
  if (!mapped) return
  const channel = CHANNEL_BY_EVENT_TYPE[mapped.type]
  if (!channel) return
  fake._handlers[channel]?.({ sessionId: SID, data: mapped.data })
}

function assistantMessage(): Message | undefined {
  return useChatSessionStore().getSessionMessages(SID).find(m => m.role === 'assistant')
}

type TimelineEvent = NonNullable<Message['timelineEvents']>[number]

function reasoningEvents(): TimelineEvent[] {
  return (assistantMessage()?.timelineEvents || []).filter(e => e.type === 'reasoning')
}

async function settleContentPatch() {
  await new Promise(resolve => setTimeout(resolve, 120))
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('pi 首段思考只应产出一张推理卡', () => {
  it('message_start 的半截 thinking 不再单独成卡，thinking_start 之后流式补全', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('@/stores/turn')
    useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('你目前连接了哪些mcp', undefined, SID)
    sessionStore.addMessage({ role: 'user', content: '你目前连接了哪些mcp' }, SID)

    // 1) message_start：活数组快照，thinking 块里已经攒了第一个分片
    feedPiFrame(fake, {
      type: 'message_start',
      message: {
        role: 'assistant',
        model: 'glm-5.3-flash',
        content: [{ type: 'thinking', thinking: 'The', thinkingSignature: 'reasoning_content' }],
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
      },
    })

    // 2) thinking_start + 全部分片
    feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } })
    for (const chunk of THINKING_CHUNKS) {
      feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: chunk } })
    }

    // 3) pi 在 thinking 块尚未 end 时就开出工具调用块（真实帧序如此）
    feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 'call_1', toolName: 'codemode' } })
    feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 0 } })
    feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 1 } })

    // 4) message_end：完整快照
    feedPiFrame(fake, {
      type: 'message_end',
      message: {
        role: 'assistant',
        model: 'glm-5.3-flash',
        content: [
          { type: 'thinking', thinking: THINKING_FULL },
          { type: 'toolCall', id: 'call_1', name: 'codemode', arguments: { code: 'x' } },
        ],
        usage: { input: 100, output: 20 },
        stopReason: 'toolUse',
      },
    })
    await settleContentPatch()

    const events = reasoningEvents()
    expect(events).toHaveLength(1)
    expect(events[0].content).toBe(THINKING_FULL)
    expect(events[0].status).toBe('completed')
  })

  it('后续思考块同样各成一张卡，不与前一块重复', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('@/stores/turn')
    useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('多块思考', undefined, SID)
    sessionStore.addMessage({ role: 'user', content: 'q' }, SID)

    const block = (text: string) => {
      feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } })
      feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: text } })
      feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: `call_${text.length}`, toolName: 'codemode' } })
      feedPiFrame(fake, { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 0 } })
      feedPiFrame(fake, {
        type: 'message_end',
        message: { role: 'assistant', model: 'm', content: [{ type: 'thinking', thinking: text }], usage: {} },
      })
    }

    block('第一段思考')
    await settleContentPatch()
    block('第二段思考')
    await settleContentPatch()

    expect(reasoningEvents().map(e => e.content)).toEqual(['第一段思考', '第二段思考'])
  })
})
