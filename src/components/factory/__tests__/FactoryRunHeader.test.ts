/**
 * 运行头部：状态、并发、用量统计，以及暂停↔继续与配置入口。
 */
import { describe, it, expect, vi } from 'vitest'
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
})
