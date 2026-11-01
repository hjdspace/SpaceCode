/**
 * 观察面板：只读镜像任务当前阶段的会话。
 * Seam: props（任务 + 转录 + 加载/错误）与 emits；消息解析走真实的
 * buildMessagesFromHistory，渲染组件用桩替换，避免把聊天页全局状态拖进来。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import type { FactoryTask, FactoryTaskTranscriptResult } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('@/components/chat/MessageItem.vue', () => ({
  default: {
    name: 'MessageItem',
    props: { message: { type: Object, required: true }, canRewind: Boolean, sessionId: String },
    setup(props: { message: { content: string }; canRewind?: boolean }) {
      return () =>
        h(
          'div',
          { 'data-stub-message-item': '', 'data-rewind': String(props.canRewind) },
          props.message.content,
        )
    },
  },
}))

vi.mock('@/components/chat/AgentTimeline.vue', () => ({
  default: {
    name: 'AgentTimeline',
    props: { messages: { type: Array, required: true }, sessionId: String },
    setup(props: { messages: { content: string }[] }) {
      return () =>
        h(
          'div',
          { 'data-stub-timeline': '', 'data-message-count': String(props.messages.length) },
          props.messages.map((message) => message.content).join('|'),
        )
    },
  },
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

function transcript(): FactoryTaskTranscriptResult {
  return {
    ok: true,
    sessionId: 'fac-run-1-bl-1-impl',
    engineType: 'claude-code',
    messages: rawTranscript(),
  }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(FactoryTranscriptPanel, {
    props: { task: task(), transcript: transcript(), loading: false, error: null, ...props },
  })
}

describe('FactoryTranscriptPanel', () => {
  it('renders the title, branch and the read-only banner', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-watch-title]').text()).toBe('登录态在刷新后丢失')
    expect(wrapper.find('[data-watch-branch]').text()).toContain('agent/task-bl-1')
    expect(wrapper.find('[data-watch-readonly]').text()).toBe('factory.watch.readonly')
  })

  it('groups the transcript into user bubbles and assistant timelines', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-stub-message-item]').text()).toBe('修一下恢复顺序')
    expect(wrapper.find('[data-stub-message-item]').attributes('data-rewind')).toBe('false')
    const timeline = wrapper.find('[data-stub-timeline]')
    expect(timeline.attributes('data-message-count')).toBe('1')
    expect(timeline.text()).toContain('先看 sessionRestore 的调用顺序')
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

  it('says the session is empty when it has no messages yet', () => {
    const empty: FactoryTaskTranscriptResult = {
      ok: true,
      sessionId: 'fac-run-1-bl-1-impl',
      engineType: 'claude-code',
      messages: [],
    }
    expect(mountPanel({ transcript: empty }).find('[data-watch-empty]').text()).toBe(
      'factory.watch.empty',
    )
  })

  it('closes from the header button and the overlay, not from the panel body', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-watch-close]').trigger('click')
    await wrapper.find('[data-watch-panel]').trigger('click')
    await wrapper.find('.watch-panel').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
