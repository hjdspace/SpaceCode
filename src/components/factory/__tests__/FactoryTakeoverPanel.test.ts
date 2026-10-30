/**
 * 看板内接管面板（issue 09）。
 * Seam: FactoryTakeoverPanel 的公共接口 — props、emits，以及它交给现有聊天链路的会话绑定。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryTask } from '@/shared/factory'

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
    props: { sessionId: String, compact: Boolean },
    setup(props: { sessionId: string; compact: boolean }) {
      chatPanelProps.calls.push({ sessionId: props.sessionId, compact: props.compact })
      return () => []
    },
  },
}))

import FactoryTakeoverPanel from '../FactoryTakeoverPanel.vue'

function takenOverTask(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '登录态在刷新后丢失',
    goal: '修复 sessionRestore 的恢复顺序，并补一条回归测试。',
    lane: 'implementing',
    stageIdx: 2,
    branch: 'agent/task-bl-1',
    worktree: '.spacecode/worktrees/bl-1',
    model: 'Opus 4.8',
    iteration: 2,
    maxIterations: 5,
    diff: { additions: 34, deletions: 8 },
    takeover: { at: '2026-10-28T10:05:00Z', sessionId: 'fac-run-1-bl-1-takeover' },
    timestamps: { claimedAt: '2026-10-28T10:00:00Z', startedAt: '2026-10-28T10:01:00Z' },
    ...overrides,
  }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(FactoryTakeoverPanel, {
    props: { task: takenOverTask(), returning: false, verifyFailed: false, ...props },
  })
}

describe('FactoryTakeoverPanel', () => {
  it('展示任务标题、分支、工作树与任务摘要', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('[data-takeover-title]').text()).toBe('登录态在刷新后丢失')
    expect(wrapper.find('[data-takeover-branch]').text()).toContain('agent/task-bl-1')
    expect(wrapper.find('[data-takeover-branch]').text()).toContain('.spacecode/worktrees/bl-1')
    expect(wrapper.find('[data-takeover-goal]').text()).toBe(
      '修复 sessionRestore 的恢复顺序，并补一条回归测试。',
    )
  })

  it('显著标明后台 Agent 已暂停', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('[data-takeover-paused]').text()).toBe('factory.takeoverPanel.paused')
  })

  it('关闭面板只发出关闭请求，交回按钮发出交回请求', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-takeover-close]').trigger('click')
    await wrapper.find('[data-takeover-return]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('return')).toHaveLength(1)
  })

  it('交回进行中时按钮禁用并显示进行中文案', () => {
    const wrapper = mountPanel({ returning: true })
    const button = wrapper.find('[data-takeover-return]')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('factory.actions.returning')
  })

  it('复用现有聊天链路展示该接管会话的历史与流式回复', () => {
    mountPanel()

    expect(chatPanelProps.calls[0]).toMatchObject({
      sessionId: 'fac-run-1-bl-1-takeover',
      compact: true,
    })
  })

  it('交回验证失败时在面板内提示，任务仍是接管中', () => {
    const wrapper = mountPanel({ verifyFailed: true })

    expect(wrapper.find('[data-takeover-verify-failed]').text()).toBe(
      'factory.takeoverPanel.verifyFailed',
    )
  })
})
