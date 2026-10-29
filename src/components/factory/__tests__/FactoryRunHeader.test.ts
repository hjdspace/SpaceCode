/**
 * 运行头部：状态、并发、用量统计，以及暂停↔继续与配置入口。
 */
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { FactoryRun, FactoryTask } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryRunHeader from '../FactoryRunHeader.vue'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '任务',
    goal: '',
    lane: 'queued',
    stageIdx: 0,
    branch: 'agent/task-bl-1',
    worktree: null,
    model: 'Opus 4.8',
    iteration: 0,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: {},
    ...overrides,
  }
}

function run(overrides: Partial<FactoryRun> = {}): FactoryRun {
  return {
    id: 'run-1',
    status: 'pending',
    paused: false,
    createdAt: '2026-10-28T10:00:00Z',
    maxConcurrency: 4,
    spendUsd: 0,
    elapsedMs: 0,
    ...overrides,
  }
}

const tasks = [
  task({ id: 'a', lane: 'queued' }),
  task({ id: 'b', lane: 'queued' }),
  task({ id: 'c', lane: 'implementing', stageIdx: 2 }),
]

describe('FactoryRunHeader', () => {
  it('shows status, concurrency, elapsed and tokens for a pending run', () => {
    const wrapper = mount(FactoryRunHeader, { props: { run: run(), tasks } })
    expect(wrapper.find('[data-run-status]').text()).toBe('factory.run.status.pending')
    const concurrency = wrapper.find('[data-run-concurrency]').text()
    expect(concurrency).toContain('"running":1')
    expect(concurrency).toContain('"max":4')
    expect(wrapper.find('[data-run-elapsed]').text()).toBe('00:00')
    expect(wrapper.find('[data-run-tokens]').text()).toContain('"count":0')
    // 没有单价信息时不显示花费，只保留 token。
    expect(wrapper.find('[data-run-spend]').exists()).toBe(false)
  })

  it('keeps config visible and pause/stop disabled until the run starts', async () => {
    const wrapper = mount(FactoryRunHeader, { props: { run: run(), tasks } })
    expect(wrapper.find('[data-run-pause]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-run-stop]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-run-disabled-hint]').text()).toBe('factory.run.disabledHint')

    await wrapper.find('[data-run-config]').trigger('click')
    expect(wrapper.emitted('config')).toHaveLength(1)
  })

  it('opens a new-run plan from the header while a run is in progress', async () => {
    const wrapper = mount(FactoryRunHeader, {
      props: { run: run({ status: 'running' }), tasks },
    })
    const button = wrapper.find('[data-run-new-run]')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(wrapper.emitted('new-run')).toHaveLength(1)
  })

  it('enables controls once the run is running and formats elapsed time', async () => {
    const wrapper = mount(FactoryRunHeader, {
      props: { run: run({ status: 'running', startedAt: '2026-10-28T10:00:00Z', elapsedMs: 90_000 }), tasks },
    })
    expect(wrapper.find('[data-run-pause]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-run-stop]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-run-disabled-hint]').exists()).toBe(false)
    expect(wrapper.find('[data-run-elapsed]').text()).toBe('01:30')

    await wrapper.find('[data-run-pause]').trigger('click')
    expect(wrapper.emitted('pause')).toHaveLength(1)
  })

  it('shows the paused status and switches the control to resume', async () => {
    const wrapper = mount(FactoryRunHeader, {
      props: { run: run({ status: 'running', paused: true }), tasks },
    })
    expect(wrapper.find('[data-run-status]').text()).toBe('factory.run.status.paused')
    expect(wrapper.find('[data-run-resume]').exists()).toBe(true)
    expect(wrapper.find('[data-run-pause]').exists()).toBe(false)

    await wrapper.find('[data-run-resume]').trigger('click')
    expect(wrapper.emitted('resume')).toHaveLength(1)
  })

  it('sums tokens from tasks and shows spend only when a price exists', () => {
    const priced = mount(FactoryRunHeader, {
      props: {
        run: run({ status: 'running' }),
        tasks: [
          task({ id: 'a', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.12 } }),
          task({ id: 'b', usage: { inputTokens: 30, outputTokens: 15 } }),
        ],
      },
    })
    expect(priced.find('[data-run-tokens]').text()).toContain('"count":60')
    expect(priced.find('[data-run-spend]').text()).toBe('$0.12')

    const unpriced = mount(FactoryRunHeader, {
      props: {
        run: run({ status: 'running' }),
        tasks: [task({ id: 'a', usage: { inputTokens: 10, outputTokens: 5 } })],
      },
    })
    expect(unpriced.find('[data-run-tokens]').text()).toContain('"count":15')
    expect(unpriced.find('[data-run-spend]').exists()).toBe(false)
  })

  it('renders the six pipeline segments with lane counts', () => {
    const wrapper = mount(FactoryRunHeader, { props: { run: run(), tasks } })
    const segments = wrapper.findAll('[data-segment]')
    expect(segments.map((segment) => segment.attributes('data-segment'))).toEqual([
      'queued',
      'implementing',
      'reviewing',
      'mergeable',
      'blocked',
      'done',
    ])
    expect(wrapper.find('[data-segment="queued"] [data-segment-count]').text()).toBe('2')
    expect(wrapper.find('[data-segment="implementing"] [data-segment-count]').text()).toBe('1')
  })

  it('shows the owner/repo label and hides it when unknown', () => {
    const labelled = mount(FactoryRunHeader, {
      props: { run: run(), tasks, repoLabel: 'hjdspace/SpaceCode' },
    })
    expect(labelled.find('[data-run-repo]').text()).toBe('hjdspace/SpaceCode')

    const blank = mount(FactoryRunHeader, { props: { run: run(), tasks } })
    expect(blank.find('[data-run-repo]').exists()).toBe(false)
  })

  it('counts blocked and needs-changes tasks, labelling chips by kind', async () => {
    const review = (verdict: 'approved' | 'needs_changes') => ({
      verdict,
      summary: '',
      comments: [],
      at: '2026-10-29T10:00:00Z',
    })
    const wrapper = mount(FactoryRunHeader, {
      props: {
        run: run({ status: 'running' }),
        tasks: [
          task({ id: 'bl-blocked', lane: 'blocked', stageIdx: 5 }),
          task({ id: 'bl-review', lane: 'reviewing', review: review('needs_changes') }),
          task({ id: 'bl-approved', lane: 'reviewing', review: review('approved') }),
          task({ id: 'bl-impl', lane: 'implementing' }),
        ],
      },
    })

    expect(wrapper.find('.a-label').text()).toContain('factory.run.attention')
    expect(wrapper.find('.a-label').text()).toContain('"count":2')
    const chips = wrapper.findAll('[data-attention-chip]')
    expect(chips.map((chip) => chip.attributes('data-attention-chip'))).toEqual(['merge', 'review'])
    expect(chips[0].text()).toContain('factory.run.attentionMerge')
    expect(chips[1].text()).toContain('factory.run.attentionReview')

    await chips[0].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['bl-blocked']])
  })

  it('asks for the lane to be focused when a segment is clicked and flashes it briefly', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(FactoryRunHeader, { props: { run: run(), tasks } })
      const segment = wrapper.find('[data-segment="reviewing"]')
      await segment.trigger('click')
      await nextTick()

      expect(wrapper.emitted('focus-lane')).toEqual([['reviewing']])
      expect(segment.classes()).toContain('flash')

      vi.advanceTimersByTime(800)
      await nextTick()
      expect(wrapper.find('[data-segment="reviewing"]').classes()).not.toContain('flash')
    } finally {
      vi.useRealTimers()
    }
  })

  it('confirms before stopping and does nothing until the user agrees', async () => {
    const wrapper = mount(FactoryRunHeader, { props: { run: run({ status: 'running' }), tasks } })

    await wrapper.find('[data-run-stop]').trigger('click')
    const dialog = wrapper.find('[data-stop-confirm]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('factory.run.stopConfirm.message')

    await wrapper.find('[data-stop-cancel]').trigger('click')
    expect(wrapper.find('[data-stop-confirm]').exists()).toBe(false)
    expect(wrapper.emitted('stop')).toBeUndefined()

    await wrapper.find('[data-run-stop]').trigger('click')
    await wrapper.find('[data-stop-confirm-button]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
    expect(wrapper.find('[data-stop-confirm]').exists()).toBe(false)
  })

  it('does not open the stop dialog again for an already stopped run', async () => {
    const wrapper = mount(FactoryRunHeader, { props: { run: run({ status: 'stopped' }), tasks } })

    await wrapper.find('[data-run-stop]').trigger('click')
    expect(wrapper.find('[data-stop-confirm]').exists()).toBe(false)
    expect(wrapper.emitted('stop')).toBeUndefined()
  })
})
