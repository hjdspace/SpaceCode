/**
 * 卡片信息面：脉冲状态点、变更量、审查条数、接管角标、进度条与合并结果。
 * 判定都来自 board.ts 的投影，这里只验证它们落到 DOM 的哪个位置。
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

import FactoryCard from '../FactoryCard.vue'

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
    timestamps: {},
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

function mountCard(
  overrides: Partial<FactoryTask> = {},
  runValue: FactoryRun | null = run(),
  extra: Record<string, unknown> = {},
) {
  return mount(FactoryCard, {
    props: { task: task(overrides), selected: false, nowMs: 0, run: runValue, ...extra },
  })
}

describe('FactoryCard', () => {
  it('pulses the status dot while the run keeps advancing an implementing task', () => {
    const wrapper = mountCard({ lane: 'implementing', stageIdx: 2 })
    expect(wrapper.find('[data-card-dot]').classes()).toContain('pulse')
  })

  it('stops pulsing once the run is paused or stopped, or the task leaves implementing', () => {
    expect(mountCard({ lane: 'implementing' }, run({ paused: true })).find('[data-card-dot]').classes()).not.toContain('pulse')
    expect(mountCard({ lane: 'implementing' }, run({ status: 'stopped' })).find('[data-card-dot]').classes()).not.toContain('pulse')
    expect(mountCard({ lane: 'implementing' }, null).find('[data-card-dot]').classes()).not.toContain('pulse')
    expect(mountCard({ lane: 'queued' }).find('[data-card-dot]').classes()).not.toContain('pulse')
  })

  it('stops pulsing once the background no longer drives the task', () => {
    const takenOver = mountCard({
      lane: 'implementing',
      stageIdx: 2,
      worktree: '.spacecode/worktrees/bl-1',
      takeover: { at: '2026-10-28T10:00:00Z', sessionId: 'sess-1' },
    })
    expect(takenOver.find('[data-card-dot]').classes()).not.toContain('pulse')
    expect(takenOver.find('[data-card-takeover]').exists()).toBe(true)

    const cancelled = mountCard({ lane: 'implementing', stageIdx: 2, cancelled: true })
    expect(cancelled.find('[data-card-dot]').classes()).not.toContain('pulse')
  })

  it('shows the change counts in the foot', () => {
    const wrapper = mountCard({ diff: { additions: 86, deletions: 12 } })
    const stat = wrapper.find('[data-card-diffstat]')
    expect(stat.find('b').text()).toBe('+86')
    expect(stat.find('em').text()).toBe('−12')
  })

  it('shows a placeholder instead of +0 −0 for an untouched task', () => {
    const wrapper = mountCard()
    const stat = wrapper.find('[data-card-diffstat]')
    expect(stat.exists()).toBe(true)
    expect(stat.classes()).toContain('empty')
    expect(stat.text()).toBe('—')
  })

  it('puts the pending comment count on the status chip of a reviewing task', () => {
    const wrapper = mountCard({
      lane: 'reviewing',
      stageIdx: 4,
      review: {
        verdict: 'needs_changes',
        summary: '',
        comments: [
          { id: 'c-1', body: '缺少回归测试', severity: 'blocker', status: 'open' },
          { id: 'c-2', body: '命名建议', severity: 'suggestion', status: 'accepted' },
        ],
        at: '2026-10-28T10:00:00Z',
      },
    })
    expect(wrapper.find('.status-chip').text()).toBe(
      'factory.cardStatus.reviewingComments|{"count":1}',
    )
  })

  it('keeps a plain reviewing chip before the review lands', () => {
    const wrapper = mountCard({ lane: 'reviewing', stageIdx: 4 })
    expect(wrapper.find('.status-chip').text()).toBe('factory.cardStatus.reviewing')
  })

  it('marks a taken-over card with a corner badge', () => {
    const wrapper = mountCard({
      lane: 'implementing',
      stageIdx: 2,
      worktree: '.spacecode/worktrees/bl-1',
      takeover: { at: '2026-10-28T10:00:00Z', sessionId: 'sess-1' },
    })
    expect(wrapper.find('[data-card-takeover]').exists()).toBe(true)
    expect(wrapper.find('[data-card-takeover]').text()).toBe('factory.cardTakeover')
    expect(wrapper.find('.status-chip').exists()).toBe(false)
  })

  it('已接管角标用来重新打开接管面板，不再走选中', async () => {
    const wrapper = mountCard({
      lane: 'implementing',
      stageIdx: 2,
      worktree: '.spacecode/worktrees/bl-1',
      takeover: { at: '2026-10-28T10:00:00Z', sessionId: 'sess-1' },
    })

    await wrapper.find('[data-card-takeover]').trigger('click')

    expect(wrapper.emitted('action')).toEqual([['bl-1', 'takeover-panel']])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('draws the progress bar only for implementing and reviewing tasks', () => {
    expect(mountCard({ lane: 'queued' }).find('[data-card-progress]').exists()).toBe(false)
    expect(mountCard({ lane: 'mergeable' }).find('[data-card-progress]').exists()).toBe(false)
    expect(mountCard({ lane: 'blocked' }).find('[data-card-progress]').exists()).toBe(false)
    expect(mountCard({ lane: 'done' }).find('[data-card-progress]').exists()).toBe(false)
    expect(mountCard({ lane: 'implementing' }).find('[data-card-progress]').exists()).toBe(true)
  })

  it('walks the bar by iteration and reads full once the task is in review', () => {
    const implementing = mountCard({ lane: 'implementing', stageIdx: 2, iteration: 2 })
    expect(implementing.find('[data-card-progress] i').attributes('style')).toContain('width: 40%')

    const reviewing = mountCard({ lane: 'reviewing', stageIdx: 4 })
    expect(reviewing.find('[data-card-progress] i').attributes('style')).toContain('width: 100%')
  })

  it('drops the bar on a cancelled task', () => {
    expect(
      mountCard({ lane: 'implementing', cancelled: true }).find('[data-card-progress]').exists(),
    ).toBe(false)
  })

  it('replaces the run metadata with the merge result on a done card', () => {
    const wrapper = mountCard({
      lane: 'done',
      stageIdx: 6,
      mergedCommits: 3,
      timestamps: { mergedAt: '2026-10-28T23:07:00' },
    })
    expect(wrapper.find('[data-card-merged]').text()).toBe(
      'factory.cardMeta.merged|{"time":"23:07","commits":3}',
    )
    expect(wrapper.find('[data-card-elapsed]').exists()).toBe(false)
    expect(wrapper.find('.card-model').exists()).toBe(false)
  })

  it('weakens a cancelled card and never claims it was merged', () => {
    const wrapper = mountCard({
      lane: 'done',
      stageIdx: 6,
      cancelled: true,
      mergedCommits: 3,
      timestamps: { mergedAt: '2026-10-28T03:58:00' },
    })
    expect(wrapper.classes()).toContain('cancelled')
    expect(wrapper.find('[data-card-merged]').exists()).toBe(false)
    expect(wrapper.find('.status-chip').text()).toBe('factory.cardStatus.cancelled')
  })

  it('still emits select through the card body', async () => {
    const wrapper = mountCard({ lane: 'queued' })
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['bl-1'])
  })

  it('lists the lane actions in the card action row', () => {
    expect(
      mountCard({ lane: 'queued' }).findAll('[data-card-action]').map((item) => item.attributes('data-card-action')),
    ).toEqual(['start', 'cancel'])

    const blocked = mountCard({
      lane: 'blocked',
      stageIdx: 2,
      worktree: '.spacecode/worktrees/bl-1',
    })
    expect(blocked.findAll('[data-card-action]').map((item) => item.attributes('data-card-action'))).toEqual([
      'retry',
      'cancel',
    ])
  })

  it('emits the action with the task id without selecting through it', async () => {
    const wrapper = mountCard({ lane: 'queued' })
    await wrapper.find('[data-card-action="cancel"]').trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['bl-1', 'cancel'])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('moves 交回 into the action row once the card is taken over', async () => {
    const wrapper = mountCard({
      lane: 'implementing',
      stageIdx: 2,
      worktree: '.spacecode/worktrees/bl-1',
      takeover: { at: '2026-10-28T10:00:00Z', sessionId: 'sess-1' },
    })
    expect(wrapper.find('[data-card-return]').exists()).toBe(false)
    expect(wrapper.find('[data-card-action="return"]').exists()).toBe(true)

    await wrapper.find('[data-card-action="return"]').trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['bl-1', 'return'])
  })

  it('disables every action and names the reason while another window holds the lock', () => {
    const wrapper = mountCard({ lane: 'queued' }, run(), { readonly: true })
    const buttons = wrapper.findAll('[data-card-action]')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.attributes('disabled')).toBeDefined()
      expect(button.attributes('title')).toBe('factory.storage.readonlyHint')
    }
    expect(wrapper.find('[data-card-locked]').text()).toBe('factory.storage.readonlyBadge')
  })

  it('keeps the read-only reason on a card that has no action left', () => {
    const wrapper = mountCard(
      { lane: 'implementing', stageIdx: 2, cancelled: true },
      run(),
      { readonly: true },
    )
    expect(wrapper.findAll('[data-card-action]')).toHaveLength(0)
    expect(wrapper.find('[data-card-locked]').text()).toBe('factory.storage.readonlyBadge')
  })

  it('disables only the action that is already in flight', () => {
    const wrapper = mountCard({ lane: 'queued' }, run(), { busy: 'start' })
    expect(wrapper.find('[data-card-action="start"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-card-action="cancel"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-card-locked]').exists()).toBe(false)
  })

  it('leaves the action row out when the lane has no next step', () => {
    const wrapper = mountCard({ lane: 'implementing', stageIdx: 2, cancelled: true })
    expect(wrapper.find('[data-card-actions]').exists()).toBe(false)
  })
})
