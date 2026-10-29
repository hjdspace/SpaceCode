/**
 * 六泳道看板渲染：顺序/数量/空态/卡片内容与点击选中。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryLane, FactoryRun, FactoryTask } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryBoard from '../FactoryBoard.vue'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '登录态在刷新后丢失',
    goal: '修复恢复顺序',
    lane: 'queued',
    stageIdx: 0,
    branch: 'agent/task-bl-1',
    worktree: null,
    model: 'Opus 4.8',
    iteration: 0,
    maxIterations: 5,
    diff: { additions: 0, deletions: 0 },
    timestamps: { claimedAt: '2026-10-28T10:00:00Z' },
    ...overrides,
  }
}

function run(overrides: Partial<FactoryRun> = {}): FactoryRun {
  return {
    id: 'run-1',
    status: 'running',
    paused: false,
    createdAt: '2026-10-28T10:00:00Z',
    maxConcurrency: 4,
    spendUsd: 0,
    elapsedMs: 0,
    ...overrides,
  }
}

const tasks = [
  task(),
  task({
    id: 'bl-2',
    title: '合并预检失败',
    lane: 'blocked',
    stageIdx: 5,
    attention: { reason: 'base 已前进 3 个提交', action: 'fix' },
  }),
  task({ id: 'bl-3', title: '已合并任务', lane: 'done', stageIdx: 6 }),
]

function mountBoard(items: FactoryTask[], runValue: FactoryRun | null = run()) {
  return mount(FactoryBoard, { props: { tasks: items, selectedId: null, run: runValue } })
}

describe('FactoryBoard', () => {
  it('renders the six lanes in prototype order with counts', () => {
    const wrapper = mountBoard(tasks)
    const lanes = wrapper.findAll('[data-lane]')
    expect(lanes).toHaveLength(6)
    expect(lanes.map((lane) => lane.attributes('data-lane'))).toEqual([
      'queued',
      'implementing',
      'reviewing',
      'mergeable',
      'blocked',
      'done',
    ])
    expect(wrapper.find('[data-lane="queued"] [data-lane-count]').text()).toBe('1')
    expect(wrapper.find('[data-lane="blocked"] [data-lane-count]').text()).toBe('1')
    expect(wrapper.find('[data-lane="reviewing"] [data-lane-count]').text()).toBe('0')
  })

  it('shows an empty state instead of placeholder cards', () => {
    const wrapper = mountBoard([])
    expect(wrapper.findAll('[data-task-card]')).toHaveLength(0)
    expect(wrapper.findAll('[data-lane-empty]')).toHaveLength(6)
  })

  it('renders card title, branch, model and blocked marker', () => {
    const wrapper = mountBoard(tasks)
    const queued = wrapper.find('[data-lane="queued"] [data-task-card]')
    expect(queued.text()).toContain('登录态在刷新后丢失')
    expect(queued.text()).toContain('agent/task-bl-1')
    expect(queued.text()).toContain('Opus 4.8')
    expect(queued.text()).toContain('factory.cardStatus.queued')

    const blocked = wrapper.find('[data-lane="blocked"] [data-task-card]')
    expect(blocked.classes()).toContain('blocked')
    expect(blocked.text()).toContain('base 已前进 3 个提交')
  })

  it('shows the relative worktree path once the task starts', () => {
    const wrapper = mountBoard([task({ lane: 'implementing', stageIdx: 2, worktree: '.spacecode/worktrees/bl-1' })])
    expect(wrapper.find('[data-card-worktree]').text()).toContain('.spacecode/worktrees/bl-1')

    const queued = mountBoard([task()])
    expect(queued.find('[data-card-worktree]').exists()).toBe(false)
  })

  it('runs the pulse off the board run, not off the task alone', () => {
    const running = mountBoard([task({ lane: 'implementing', stageIdx: 2 })])
    expect(running.find('[data-card-dot]').classes()).toContain('pulse')

    const paused = mountBoard([task({ lane: 'implementing', stageIdx: 2 })], run({ paused: true }))
    expect(paused.find('[data-card-dot]').classes()).not.toContain('pulse')

    const stopped = mountBoard([task({ lane: 'implementing', stageIdx: 2 })], run({ status: 'stopped' }))
    expect(stopped.find('[data-card-dot]').classes()).not.toContain('pulse')
  })

  it('marks the selected card and emits select on click', async () => {
    const wrapper = mount(FactoryBoard, { props: { tasks, selectedId: 'bl-1', run: run() } })
    const card = wrapper.find('[data-task-card="bl-1"]')
    expect(card.classes()).toContain('selected')

    await wrapper.find('[data-task-card="bl-2"]').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['bl-2'])
  })

  it('scrolls the requested lane inside the board scroller only', () => {
    const wrapper = mountBoard(tasks)
    const board = wrapper.find('.factory-board').element as HTMLElement
    const lane = wrapper.find('[data-lane="reviewing"]').element as HTMLElement
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 100 } as DOMRect)
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 500 } as DOMRect)
    const scrollTo = vi.fn()
    board.scrollTo = scrollTo

    ;(wrapper.vm as unknown as { focusLane: (key: FactoryLane) => void }).focusLane('reviewing')

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: 400, behavior: 'smooth' })
  })
})
