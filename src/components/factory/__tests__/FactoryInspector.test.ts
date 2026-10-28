/**
 * 检查器：空态、概览字段、六阶段进度、时间戳、页签空态与切换不丢选中。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryTask } from '@/shared/factory'
import { formatTimestamp } from '@/stores/factory/board'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryInspector from '../FactoryInspector.vue'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
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
    timestamps: { claimedAt: '2026-10-28T10:00:00Z', startedAt: '2026-10-28T10:01:00Z' },
    ...overrides,
  }
}

describe('FactoryInspector', () => {
  it('shows an empty state without tabs when nothing is selected', () => {
    const wrapper = mount(FactoryInspector, { props: { task: null, tab: 'overview' } })
    expect(wrapper.find('[data-inspector-empty]').exists()).toBe(true)
    expect(wrapper.findAll('[data-inspector-tab]')).toHaveLength(0)
  })

  it('renders the overview fields and the six stage rail', () => {
    const selected = task()
    const wrapper = mount(FactoryInspector, { props: { task: selected, tab: 'overview' } })

    expect(wrapper.find('[data-inspector-title]').text()).toBe(selected.title)
    expect(wrapper.find('[data-inspector-status]').text()).toBe(
      'factory.cardStatus.implementing|{"iteration":2,"max":5}',
    )
    expect(wrapper.text()).toContain(selected.goal)
    expect(wrapper.text()).toContain(selected.branch)
    expect(wrapper.text()).toContain(selected.worktree!)
    expect(wrapper.text()).toContain(selected.model)
    expect(wrapper.text()).toContain(formatTimestamp(selected.timestamps.claimedAt))
    expect(wrapper.text()).toContain(formatTimestamp(selected.timestamps.startedAt))

    const steps = wrapper.findAll('[data-step]')
    expect(steps).toHaveLength(6)
    expect(steps.map((step) => step.classes().find((cls) => cls !== 'step'))).toEqual([
      'done',
      'done',
      'active',
      'pending',
      'pending',
      'pending',
    ])
  })

  it('falls back to a placeholder before the worktree exists', () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ worktree: null }), tab: 'overview' },
    })
    expect(wrapper.text()).toContain('factory.inspector.worktreePending')
  })

  it('lists the four tabs and emits the chosen one', async () => {
    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    const tabs = wrapper.findAll('[data-inspector-tab]')
    expect(tabs.map((tab) => tab.attributes('data-inspector-tab'))).toEqual([
      'overview',
      'events',
      'diff',
      'review',
    ])

    await wrapper.find('[data-inspector-tab="events"]').trigger('click')
    expect(wrapper.emitted('select-tab')?.[0]).toEqual(['events'])
  })

  it('renders empty bodies for events, diff and review in this ticket', () => {
    for (const tab of ['events', 'diff', 'review'] as const) {
      const wrapper = mount(FactoryInspector, { props: { task: task(), tab } })
      expect(wrapper.find(`[data-empty="${tab}"]`).exists()).toBe(true)
    }
    expect(mount(FactoryInspector, { props: { task: task(), tab: 'overview' } }).find('[data-empty]').exists()).toBe(
      false,
    )
  })

  it('keeps the selected task when switching tabs', async () => {
    const selected = task()
    const wrapper = mount(FactoryInspector, { props: { task: selected, tab: 'overview' } })
    await wrapper.setProps({ tab: 'diff' })
    expect(wrapper.find('[data-inspector-title]').text()).toBe(selected.title)
  })
})
