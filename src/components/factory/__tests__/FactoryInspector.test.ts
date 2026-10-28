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

  it('renders the event stream as level-coloured summaries', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task(),
        tab: 'events',
        events: [
          {
            seq: 1,
            at: '2026-10-28T10:02:00Z',
            runId: 'run-1',
            taskId: 'bl-1',
            stage: 'implement',
            code: 'task.started',
            level: 'ok',
            params: { branch: 'agent/task-bl-1' },
          },
          {
            seq: 2,
            at: '2026-10-28T10:03:00Z',
            runId: 'run-1',
            taskId: 'bl-1',
            stage: 'implement',
            code: 'agent.turn',
            level: 'info',
            params: { inputTokens: 10, outputTokens: 4 },
          },
        ],
      },
    })

    const rows = wrapper.findAll('[data-event-code]')
    expect(rows.map((row) => row.attributes('data-event-code'))).toEqual(['task.started', 'agent.turn'])
    expect(rows[0].text()).toContain('factory.events.task.started|{"branch":"agent/task-bl-1"}')
    expect(rows[0].classes()).toContain('ok')
    expect(rows[1].text()).toContain('factory.events.agent.turn|{"inputTokens":10,"outputTokens":4}')
  })

  it('shows diff files, commits, and the no-commit empty state', () => {
    const withCommits = mount(FactoryInspector, {
      props: {
        task: task({
          diff: {
            additions: 12,
            deletions: 3,
            files: [
              { path: 'src/a.ts', additions: 10, deletions: 1 },
              { path: 'src/b.ts', additions: 2, deletions: 2 },
            ],
          },
          commits: [{ sha: 'abcdef1234567', message: 'fix: restore session' }],
        }),
        tab: 'diff',
      },
    })

    expect(withCommits.find('[data-diff-summary]').text()).toContain('+12 −3')
    expect(withCommits.findAll('[data-diff-files] li')).toHaveLength(2)
    expect(withCommits.findAll('[data-commit-list] li')).toHaveLength(1)
    expect(withCommits.text()).toContain('abcdef1')
    expect(withCommits.text()).toContain('fix: restore session')
    expect(withCommits.find('[data-empty="commits"]').exists()).toBe(false)

    const withoutCommits = mount(FactoryInspector, { props: { task: task(), tab: 'diff' } })
    expect(withoutCommits.find('[data-empty="commits"]').exists()).toBe(true)
  })

  it('offers start, stop, reveal and dirty confirmation actions', async () => {
    const queued = mount(FactoryInspector, {
      props: { task: task({ lane: 'queued', stageIdx: 0 }), tab: 'overview', pendingDirty: true },
    })
    expect(queued.find('[data-task-start]').exists()).toBe(true)
    expect(queued.find('[data-task-stop]').exists()).toBe(false)
    await queued.find('[data-task-start]').trigger('click')
    await queued.find('[data-task-confirm-dirty]').trigger('click')
    expect(queued.emitted('start')).toHaveLength(1)
    expect(queued.emitted('confirm-dirty')).toHaveLength(1)

    const running = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(running.find('[data-task-start]').exists()).toBe(false)
    await running.find('[data-task-stop]').trigger('click')
    await running.find('[data-reveal-worktree]').trigger('click')
    expect(running.emitted('stop')).toHaveLength(1)
    expect(running.emitted('reveal')).toHaveLength(1)
  })
})
