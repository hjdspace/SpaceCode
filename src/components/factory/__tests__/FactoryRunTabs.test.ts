/**
 * 运行页签条：每次运行一个页签、当前页签可关闭，「+」始终保留用于新建运行。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryRun, FactoryRunStatus } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryRunTabs from '../FactoryRunTabs.vue'

function run(id: string, status: FactoryRunStatus = 'running'): FactoryRun {
  return {
    id,
    status,
    paused: false,
    createdAt: '2026-10-28T10:00:00Z',
    maxConcurrency: 4,
    spendUsd: 0,
    elapsedMs: 0,
  }
}

describe('FactoryRunTabs', () => {
  it('renders one tab per run and marks the active one', () => {
    const wrapper = mount(FactoryRunTabs, {
      props: { runs: [run('run-2'), run('run-1', 'stopped')], activeId: 'run-2' },
    })

    expect(wrapper.findAll('[data-run-tab]')).toHaveLength(2)
    expect(wrapper.find('[data-run-tab="run-2"]').attributes('data-run-tab-active')).toBe('true')
    expect(wrapper.find('[data-run-tab="run-1"]').attributes('data-run-tab-active')).toBeUndefined()
    expect(wrapper.find('[data-run-tab="run-2"]').text()).toContain(
      'factory.runTabs.label|{"id":"run-2"}',
    )
  })

  it('emits select when a tab is clicked', async () => {
    const wrapper = mount(FactoryRunTabs, {
      props: { runs: [run('run-2'), run('run-1')], activeId: 'run-2' },
    })

    await wrapper.find('[data-run-tab="run-1"] .tab-main').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['run-1']])
  })

  it('only shows the close entry on the active tab', async () => {
    const wrapper = mount(FactoryRunTabs, {
      props: { runs: [run('run-2'), run('run-1')], activeId: 'run-2' },
    })

    expect(wrapper.find('[data-run-tab-close="run-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-run-tab-close="run-1"]').exists()).toBe(false)

    await wrapper.find('[data-run-tab-close="run-2"]').trigger('click')
    expect(wrapper.emitted('close')).toEqual([['run-2']])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('keeps the new-run entry when no tabs remain', async () => {
    const wrapper = mount(FactoryRunTabs, { props: { runs: [], activeId: null } })

    expect(wrapper.findAll('[data-run-tab]')).toHaveLength(0)
    await wrapper.find('[data-run-tab-add]').trigger('click')
    expect(wrapper.emitted('new-run')).toEqual([[]])
  })
})
