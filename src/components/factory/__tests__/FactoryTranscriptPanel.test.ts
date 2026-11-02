/**
 * 观察面板：把流水线阶段会话挂成只读镜像，并复用聊天渲染链路。
 * Seam: props（任务 + 转录 + 加载/错误 + 最近事件）、emits，以及面板对
 * chatSession / turn 两个 store 的挂载与释放。聊天页本身用桩替换，避免全局状态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import type { FactoryEvent, FactoryTask, FactoryTaskTranscriptResult } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

const chatPanelProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }))

vi.mock('@/components/layout/ChatPanel.vue', () => ({
  default: {
    name: 'ChatPanel',
    props: { sessionId: String, compact: Boolean, readonly: Boolean },
    setup(props: Record<string, unknown>) {
      chatPanelProps.calls.push({ ...props })
      return () => h('div', { 'data-stub-chat-panel': '' })
    },
  },
}))

const observed = vi.hoisted(() => ({
  state: { session: null as any },
  attachObservedSession: vi.fn(),
  detachObservedSession: vi.fn(),
  getSession: vi.fn(),
  releaseObservedSession: vi.fn(),
  getIsLoading: vi.fn(),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    attachObservedSession: observed.attachObservedSession,
    detachObservedSession: observed.detachObservedSession,
    getSession: observed.getSession,
  }),
}))

vi.mock('@/stores/turn', () => ({
  useTurnStore: () => ({
    releaseObservedSession: observed.releaseObservedSession,
    getIsLoading: observed.getIsLoading,
  }),
}))

import FactoryTranscriptPanel from '../FactoryTranscriptPanel.vue'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '登录态在刷新后丢失',
    goal: '',
    lane: 'implementing',
    stageIdx: 2,
    branch: 'agent/task-bl-1',
    worktree: '.spacecode/worktrees/bl-1',
    model: 'Opus 4.8',
    iteration: 2,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: {},
    ...overrides,
  }
}

function rawTranscript(): unknown[] {
  return [
    {
      type: 'user',
      uuid: 'u-1',
      timestamp: '2026-10-28T10:01:00Z',
      message: { role: 'user', content: [{ type: 'text', text: '修一下恢复顺序' }] },
    },
    {
      type: 'assistant',
      uuid: 'a-1',
      timestamp: '2026-10-28T10:01:05Z',
      message: {
        role: 'assistant',
        id: 'msg-1',
        model: 'opus',
        content: [{ type: 'text', text: '先看 sessionRestore 的调用顺序' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
  ]
}

function transcript(
  overrides: Partial<Extract<FactoryTaskTranscriptResult, { ok: true }>> = {},
): FactoryTaskTranscriptResult {
  return {
    ok: true,
    sessionId: 'fac-run-1-bl-1-impl',
    engineType: 'claude-code',
    messages: rawTranscript(),
    running: true,
    ...overrides,
  }
}

function event(overrides: Partial<FactoryEvent> = {}): FactoryEvent {
  return {
    seq: 1,
    at: '2026-10-28T10:01:00Z',
    runId: 'run-1',
    taskId: 'bl-1',
    code: 'agent.turn',
    level: 'info',
    params: { inputTokens: 10, outputTokens: 4 },
    ...overrides,
  }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(FactoryTranscriptPanel, {
    props: {
      task: task(),
      transcript: transcript(),
      loading: false,
      error: null,
      lastEvent: null,
      ...props,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  chatPanelProps.calls.length = 0
  observed.state.session = null
  observed.getIsLoading.mockReturnValue(false)
  observed.getSession.mockImplementation((id: string) =>
    observed.state.session?.id === id ? observed.state.session : undefined,
  )
  observed.attachObservedSession.mockImplementation((input: Record<string, any>) => {
    observed.state.session = {
      id: input.sessionId,
      messages: input.messages,
      observedSession: true,
      processStatus: 'active',
    }
    return observed.state.session
  })
})

describe('FactoryTranscriptPanel', () => {
  it('renders the title, branch and the read-only banner', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-watch-title]').text()).toBe('登录态在刷新后丢失')
    expect(wrapper.find('[data-watch-branch]').text()).toContain('agent/task-bl-1')
    expect(wrapper.find('[data-watch-readonly]').text()).toBe('factory.watch.readonly')
  })

  it('attaches the stage session as a read-only mirror and renders the chat chain', () => {
    const wrapper = mountPanel()
    const id = 'fac-run-1-bl-1-impl'

    expect(observed.attachObservedSession).toHaveBeenCalledTimes(1)
    const input = observed.attachObservedSession.mock.calls[0][0]
    expect(input.sessionId).toBe(id)
    expect(input.engineType).toBe('claude-code')
    expect(input.messages[0].content).toContain('修一下恢复顺序')

    expect(wrapper.find('[data-watch-live-body]').exists()).toBe(true)
    expect(chatPanelProps.calls[0]).toMatchObject({ sessionId: id, compact: true, readonly: true })
  })

  it('shows the latest pipeline event and a live chip while the stage is running', () => {
    const wrapper = mountPanel({ lastEvent: event() })

    expect(wrapper.find('[data-watch-activity]').text()).toBe(
      'factory.events.agent.turn|{"inputTokens":10,"outputTokens":4}',
    )
    expect(wrapper.find('[data-watch-live]').text()).toBe('factory.watch.live')

    const idle = mountPanel({ task: task({ lane: 'done' }), transcript: transcript({ running: false }) })
    expect(idle.find('[data-watch-activity]').text()).toBe('factory.watch.idle')
    expect(idle.find('[data-watch-live]').exists()).toBe(false)
  })

  it('shows a paused state instead of live while the task is taken over', () => {
    const wrapper = mountPanel({
      task: task({ takeover: { at: '2026-11-01T00:00:00Z', sessionId: 'fac-run-1-bl-1-impl' } }),
      transcript: transcript({ running: false }),
    })

    expect(wrapper.find('[data-watch-activity]').text()).toBe('factory.watch.paused')
    expect(wrapper.find('[data-watch-live]').exists()).toBe(false)
  })

  it('refreshes the mirror when a newer snapshot has the same session id', async () => {
    const wrapper = mountPanel()
    const messages = [
      ...rawTranscript(),
      {
        type: 'user',
        uuid: 'u-2',
        timestamp: '2026-10-28T10:02:00Z',
        message: { role: 'user', content: [{ type: 'text', text: '继续' }] },
      },
    ]

    await wrapper.setProps({ transcript: transcript({ messages }) })

    expect(observed.attachObservedSession).toHaveBeenCalledTimes(2)
    expect(observed.attachObservedSession.mock.calls[1][0].messages).toHaveLength(3)
  })

  it('renders an existing real session read-only without releasing its turn on close', () => {
    const id = 'fac-run-1-bl-1-impl'
    observed.state.session = {
      id,
      messages: [{ id: 'm-1', role: 'user', content: '已有会话', timestamp: 0 }],
      observedSession: false,
    }
    observed.attachObservedSession.mockImplementation(() => observed.state.session)

    const wrapper = mountPanel()
    expect(wrapper.find('[data-watch-live-body]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChatPanel' }).props()).toMatchObject({
      sessionId: id,
      readonly: true,
    })

    wrapper.unmount()
    expect(observed.releaseObservedSession).not.toHaveBeenCalled()
    expect(observed.detachObservedSession).not.toHaveBeenCalled()
  })

  it('shows the loading placeholder only before any transcript arrives', () => {
    expect(
      mountPanel({ transcript: null, loading: true }).find('[data-watch-loading]').text(),
    ).toBe('factory.watch.loading')
    expect(
      mountPanel({ loading: true }).find('[data-watch-loading]').exists(),
    ).toBe(false)
  })

  it('maps each failure code to its own message', () => {
    expect(
      mountPanel({ transcript: null, error: 'no-session' }).find('[data-watch-error]').text(),
    ).toBe('factory.watch.noSession')
    expect(
      mountPanel({ transcript: null, error: 'worktree-missing' }).find('[data-watch-error]').text(),
    ).toBe('factory.watch.worktreeMissing')
    expect(
      mountPanel({ transcript: null, error: 'read-failed' }).find('[data-watch-error]').text(),
    ).toBe('factory.watch.loadFailed')
  })

  it('says the session is empty when a settled stage has no messages', () => {
    const empty = transcript({ messages: [], running: false })
    expect(
      mountPanel({ task: task({ lane: 'done' }), transcript: empty })
        .find('[data-watch-empty]')
        .text(),
    ).toBe('factory.watch.empty')
  })

  it('closes from the header button and the overlay, not from the panel body', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-watch-close]').trigger('click')
    await wrapper.find('[data-watch-panel]').trigger('click')
    await wrapper.find('.watch-panel').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('releases the mirror without touching the engine when the panel unmounts', () => {
    const wrapper = mountPanel()
    wrapper.unmount()

    expect(observed.releaseObservedSession).toHaveBeenCalledWith('fac-run-1-bl-1-impl')
    expect(observed.detachObservedSession).toHaveBeenCalledWith('fac-run-1-bl-1-impl')
  })

  it('swaps the mirror when the stage session changes', async () => {
    const wrapper = mountPanel()
    const next: FactoryTaskTranscriptResult = {
      ok: true,
      sessionId: 'fac-run-1-bl-1-review',
      engineType: 'claude-code',
      messages: [],
      running: true,
    }

    await wrapper.setProps({ transcript: next, task: task({ lane: 'reviewing' }) })
    await nextTick()

    expect(observed.releaseObservedSession).toHaveBeenCalledWith('fac-run-1-bl-1-impl')
    expect(observed.detachObservedSession).toHaveBeenCalledWith('fac-run-1-bl-1-impl')
    expect(observed.attachObservedSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'fac-run-1-bl-1-review' }),
    )
    expect(wrapper.findComponent({ name: 'ChatPanel' }).props('sessionId')).toBe(
      'fac-run-1-bl-1-review',
    )
  })
})
