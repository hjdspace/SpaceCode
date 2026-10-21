import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import AgentTimeline from '../AgentTimeline.vue'
import BashToolCard from '../tools/BashToolCard.vue'
import { useChatSessionStore } from '@/stores/chatSession'
import { mapPiEvent } from '@electron/engine/engines/PiEventMapper'
import { resolveToolComponent } from '../tools/index'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'ThinkingState', 'ErrorCard']
const COMMAND = 'npm run test:coverage'
const PARTIAL_COMMAND = 'npm run'

type Handler = (event: { sessionId: string; data: any }) => void

function makeHarness() {
  const handlers: Record<string, Handler> = {}
  const on = (name: string) => (cb: Handler) => { handlers[name] = cb; return () => {} }
  const api = {
    claudeCode: {
      onStreamEvent: on('onStreamEvent'), onAssistant: on('onAssistant'), onToolUse: on('onToolUse'),
      onToolResult: on('onToolResult'), onUser: on('onUser'), onSystem: on('onSystem'),
      onResult: on('onResult'), onExit: on('onExit'), onError: on('onError'),
      onPermissionRequest: on('onPermissionRequest'), onPermissionRequestCancelled: on('onPermissionRequestCancelled'),
      sendMessage: async () => {}, abort: async () => {}, allowPermission: async () => {}, denyPermission: async () => {},
      submitToolAnswer: async () => {}, skipToolAnswer: async () => {},
    },
    image: { save: () => {} },
    trace: { event: () => {} },
  }
  return { api, handlers }
}

async function settle(ms = 150) {
  await nextTick()
  await new Promise(r => setTimeout(r, ms))
  await nextTick()
}

function mountTimeline(sid: string) {
  const session = useChatSessionStore().sessions.find(s => s.id === sid)!
  return mount(AgentTimeline, {
    props: { messages: session.messages, loading: true },
    global: { stubs: STUBS },
  })
}

function assistantOf(sid: string) {
  const session = useChatSessionStore().sessions.find(s => s.id === sid)!
  return session.messages.find(m => m.role === 'assistant')
}

describe('AgentTimeline 工具参数流式可见（方案 B）', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    config.global.plugins = [i18n, pinia]
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('Claude：建卡后补 command，运行中和折叠 chip 都应显示', async () => {
    const { useTurnStore } = await import('@/stores/turn')
    const { api, handlers } = makeHarness()
    useTurnStore(api as any)
    const sessionStore = useChatSessionStore()
    const sid = 'claude-command-visible'
    sessionStore.createSession('Claude', undefined, sid)
    sessionStore.addMessage({ role: 'user', content: '跑测试' }, sid)

    const stream = (event: any) => handlers.onStreamEvent?.({ sessionId: sid, data: { event } })
    // 1) CLI 先发 content_block_start：卡片此刻 input 为空
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } })
    const wrapper = mountTimeline(sid)
    await settle()
    expect(wrapper.text()).toContain('Bash')
    expect(wrapper.text()).not.toContain(COMMAND)

    // 2) 参数随后才到
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: COMMAND }) } })
    stream({ type: 'content_block_stop', index: 0 })
    await settle(200)

    expect(wrapper.text()).toContain(COMMAND)
    expect(assistantOf(sid)!.toolCalls![0].status).toBe('running')

    // 折叠成 chips 后，目标仍来自当前 toolCall
    await wrapper.find('.tool-group__toggle').trigger('click')
    await nextTick()
    expect(wrapper.find('.tool-group__chip-text').text()).toContain(COMMAND)
  })

  it('Pi：半截 input 先到，tool_execution_start 的完整参数必须覆盖', async () => {
    const { useTurnStore } = await import('@/stores/turn')
    const { api, handlers } = makeHarness()
    useTurnStore(api as any)
    const sessionStore = useChatSessionStore()
    const sid = 'pi-command-authoritative'
    sessionStore.createSession('Pi', undefined, sid)
    sessionStore.addMessage({ role: 'user', content: '跑测试' }, sid)

    const feed = (frame: any) => {
      const mapped = mapPiEvent(sid, frame)
      if (!mapped) return
      const route: Record<string, string> = {
        stream_event: 'onStreamEvent', assistant: 'onAssistant', user: 'onUser',
        tool_use: 'onToolUse', tool_result: 'onToolResult', system: 'onSystem', result: 'onResult',
      }
      handlers[route[mapped.type]]?.({ sessionId: sid, data: mapped.data })
    }

    feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 'call_1', toolName: 'bash' } })
    const wrapper = mountTimeline(sid)
    await settle()
    expect(wrapper.text()).toContain('Bash')

    // 半截 JSON：content_block_stop 解析失败，但仍会被早期提取写成 { command: 'npm run' }
    feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: '{"command":"npm run' } })
    await settle(200)
    expect(assistantOf(sid)!.toolCalls![0].input).toEqual({ command: PARTIAL_COMMAND })

    feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { type: 'toolCall', id: 'call_1', name: 'bash' } } })
    feed({ type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'bash', args: { command: COMMAND } })
    await settle()

    expect(assistantOf(sid)!.toolCalls![0].input).toEqual({ command: COMMAND })
    expect(wrapper.text()).toContain(COMMAND)
  })

  it('Pi：tool_execution_update 的部分输出写入卡片（运行中即可见）', async () => {
    const { useTurnStore } = await import('@/stores/turn')
    const { api, handlers } = makeHarness()
    useTurnStore(api as any)
    const sessionStore = useChatSessionStore()
    const sid = 'pi-live-output'
    sessionStore.createSession('Pi', undefined, sid)
    sessionStore.addMessage({ role: 'user', content: '跑测试' }, sid)

    const feed = (frame: any) => {
      const mapped = mapPiEvent(sid, frame)
      if (!mapped) return
      const route: Record<string, string> = {
        stream_event: 'onStreamEvent', assistant: 'onAssistant', user: 'onUser',
        tool_use: 'onToolUse', tool_result: 'onToolResult', system: 'onSystem', result: 'onResult',
      }
      handlers[route[mapped.type]]?.({ sessionId: sid, data: mapped.data })
    }

    feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 'call_2', toolName: 'bash' } })
    feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify({ command: COMMAND }) } })
    feed({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { type: 'toolCall', id: 'call_2', name: 'bash' } } })
    feed({ type: 'tool_execution_start', toolCallId: 'call_2', toolName: 'bash', args: { command: COMMAND } })

    const wrapper = mountTimeline(sid)
    await settle()

    feed({
      type: 'tool_execution_update',
      toolCallId: 'call_2',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'running 37 tests...' }], details: {} },
    })
    await settle()

    expect(assistantOf(sid)!.toolCalls![0].output).toBe('running 37 tests...')
    const card = wrapper.findComponent(BashToolCard)
    expect(card.exists()).toBe(true)
    expect(card.props('toolCall').output).toBe('running 37 tests...')

    await wrapper.find('.tool-header').trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('running 37 tests...')
  })

  it('运行中的工具耗时会按秒推进（generic 行与 Bash 卡片）', async () => {
    await resolveToolComponent('Bash')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const messages = ref<Message[]>([{
      id: 'duration-msg',
      role: 'assistant',
      content: '',
      timestamp: Date.now() - 10_000,
      toolCalls: [
        { id: 'dur-generic', name: 'CustomTool', input: {}, status: 'running', startTime: Date.now() - 5_000 },
        { id: 'dur-bash', name: 'Bash', input: { command: COMMAND }, status: 'running', startTime: Date.now() - 5_000 },
      ],
      timelineEvents: [
        { id: 'tool-dur-generic', type: 'tool_call', timestamp: Date.now(), status: 'running', toolCallId: 'dur-generic' },
        { id: 'tool-dur-bash', type: 'tool_call', timestamp: Date.now(), status: 'running', toolCallId: 'dur-bash' },
      ],
    }] as Message[])

    const wrapper = mount(AgentTimeline, {
      props: { messages: messages.value, loading: true },
      global: { stubs: STUBS },
    })
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(wrapper.text()).toContain('5.0s')
    const bash = wrapper.findComponent(BashToolCard)
    expect(bash.exists()).toBe(true)
    expect(bash.props('now')).toBeTypeOf('number')

    vi.advanceTimersByTime(1000)
    await nextTick()

    expect(wrapper.text()).toContain('6.0s')
    expect(bash.props('now')).toBeGreaterThan(Date.now() - 1000)
  })
})
