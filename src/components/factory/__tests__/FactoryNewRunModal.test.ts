/**
 * 新建运行弹窗：可领取任务、跳过原因、并发与验证命令、错误展示与确认门槛。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { NewRunCandidate } from '@/stores/factory/newRun'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryNewRunModal from '../FactoryNewRunModal.vue'

function candidate(overrides: Partial<NewRunCandidate> = {}): NewRunCandidate {
  return { id: 'bl-1', title: '登录态在刷新后丢失', claimed: false, ...overrides }
}

function mountModal(props: Record<string, unknown> = {}) {
  return mount(FactoryNewRunModal, {
    props: {
      source: 'local',
      candidates: [
        candidate(),
        candidate({ id: 'bl-2', title: '合并预检失败', detail: '基础分支已前进', claimed: false }),
        candidate({ id: 'bl-3', title: '已在运行中', claimed: true }),
      ],
      verifyCommand: 'npm run test:changed',
      defaultConcurrency: 4,
      creating: false,
      loading: false,
      error: null,
      planEnabled: true,
      planning: false,
      planError: null,
      planned: [],
      planWarnings: [],
      ...props,
    },
  })
}

describe('FactoryNewRunModal', () => {
  it('lists claimable tasks and explains why claimed ones are skipped', () => {
    const wrapper = mountModal()
    expect(wrapper.findAll('[data-new-run-item]')).toHaveLength(3)

    const selectable = wrapper.find('[data-new-run-check="bl-1"]')
    expect((selectable.element as HTMLInputElement).disabled).toBe(false)

    const skipped = wrapper.find('[data-new-run-check="bl-3"]')
    expect((skipped.element as HTMLInputElement).disabled).toBe(true)
    expect(wrapper.find('[data-new-run-skip="bl-3"]').text()).toBe('factory.newRun.skipClaimed')
    expect(wrapper.find('[data-new-run-note]').text()).toContain('factory.newRun.skipNote')
  })

  it('keeps confirm disabled until a task is selected and emits ids with concurrency', async () => {
    const wrapper = mountModal()
    expect(wrapper.find('[data-new-run-confirm]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-new-run-selected]').text()).toBe(
      'factory.newRun.selected|{"count":0}',
    )

    await wrapper.find('[data-new-run-check="bl-2"]').setValue(true)
    expect(wrapper.find('[data-new-run-selected]').text()).toBe(
      'factory.newRun.selected|{"count":1}',
    )
    expect(wrapper.find('[data-new-run-confirm]').attributes('disabled')).toBeUndefined()

    await wrapper.find('[data-new-run-concurrency]').setValue('2')
    await wrapper.find('[data-new-run-confirm]').trigger('click')
    expect(wrapper.emitted('create')).toEqual([[{ ids: ['bl-2'], concurrency: 2 }]])
  })

  it('clamps the concurrency into the supported range', async () => {
    const wrapper = mountModal()
    await wrapper.find('[data-new-run-check="bl-1"]').setValue(true)

    await wrapper.find('[data-new-run-concurrency]').setValue('99')
    await wrapper.find('[data-new-run-confirm]').trigger('click')
    expect(wrapper.emitted('create')?.[0]).toEqual([{ ids: ['bl-1'], concurrency: 20 }])

    await wrapper.find('[data-new-run-concurrency]').setValue('')
    await wrapper.find('[data-new-run-confirm]').trigger('click')
    expect(wrapper.emitted('create')?.[1]).toEqual([{ ids: ['bl-1'], concurrency: 4 }])
  })

  it('shows the verify command read-only', () => {
    const wrapper = mountModal()
    expect(wrapper.find('[data-new-run-verify]').text()).toBe('npm run test:changed')
    expect(wrapper.find('input[data-new-run-verify]').exists()).toBe(false)

    const empty = mountModal({ verifyCommand: '' })
    expect(empty.find('[data-new-run-verify]').text()).toBe('factory.newRun.verifyEmpty')
  })

  it('drops selections that become claimed after a refresh', async () => {
    const wrapper = mountModal()
    await wrapper.find('[data-new-run-check="bl-1"]').setValue(true)
    expect(wrapper.find('[data-new-run-selected]').text()).toContain('"count":1')

    await wrapper.setProps({
      candidates: [candidate({ claimed: true }), candidate({ id: 'bl-3', claimed: true })],
    })
    expect(wrapper.find('[data-new-run-selected]').text()).toContain('"count":0')
    expect(wrapper.find('[data-new-run-confirm]').attributes('disabled')).toBeDefined()
  })

  it('renders local run errors with their params', () => {
    const wrapper = mountModal({
      error: { code: 'duplicate-tasks', params: { ids: 'bl-1' } },
    })
    expect(wrapper.find('[data-new-run-error]').text()).toBe(
      'factory.run.errors.duplicate-tasks|{"ids":"bl-1"}',
    )
  })

  it('renders github claim errors with the failed issue numbers', () => {
    const wrapper = mountModal({
      source: 'github-issues',
      error: {
        reason: 'duplicate-issues',
        failed: [
          { number: 12, reason: 'already-claimed' },
          { number: 13, reason: 'already-claimed' },
        ],
      },
    })
    expect(wrapper.find('[data-new-run-error]').text()).toBe(
      'factory.github.errors.duplicate-issues|{"numbers":"#12, #13"}',
    )
  })

  it('disables confirm, cancel and close while creating', async () => {
    const wrapper = mountModal({ creating: true })
    expect(wrapper.find('[data-new-run-confirm]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-new-run-cancel]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-new-run-close]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-new-run-confirm]').trigger('click')
    expect(wrapper.emitted('create')).toBeUndefined()
  })

  it('shows loading and empty states instead of the list', () => {
    expect(mountModal({ loading: true }).find('[data-new-run-loading]').exists()).toBe(true)
    expect(mountModal({ loading: true }).find('[data-new-run-list]').exists()).toBe(false)

    const empty = mountModal({ candidates: [] })
    expect(empty.find('[data-new-run-empty]').text()).toBe('factory.backlog.empty')
    expect(empty.find('[data-new-run-list]').exists()).toBe(false)

    const githubEmpty = mountModal({ source: 'github-issues', candidates: [] })
    expect(githubEmpty.find('[data-new-run-empty]').text()).toBe('factory.github.empty')
  })

  it('closes from the cancel button and the backdrop', async () => {
    const wrapper = mountModal()
    await wrapper.find('[data-new-run-cancel]').trigger('click')
    await wrapper.find('[data-new-run-modal]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('asks the planner for every claimable candidate', async () => {
    const wrapper = mountModal()
    expect(wrapper.find('[data-new-run-plan]').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-new-run-plan]').trigger('click')
    expect(wrapper.emitted('plan')?.[0]).toEqual([['bl-1', 'bl-2']])
  })

  it('disables planning when the stage is off or a plan is running', () => {
    expect(mountModal({ planEnabled: false }).find('[data-new-run-plan]').attributes('disabled')).toBeDefined()
    expect(mountModal({ planning: true }).find('[data-new-run-plan]').attributes('disabled')).toBeDefined()
  })

  it('applies the planned selection and dependencies before creating the run', async () => {
    const wrapper = mountModal()
    await wrapper.setProps({
      planned: [
        { candidateId: 'bl-1', dependsOn: [] },
        { candidateId: 'bl-2', dependsOn: ['bl-1'] },
      ],
    })

    expect((wrapper.find('[data-new-run-check="bl-1"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.find('[data-new-run-check="bl-2"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('[data-new-run-dep="bl-2"]').text()).toContain('登录态在刷新后丢失')

    await wrapper.find('[data-new-run-confirm]').trigger('click')
    expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
      ids: ['bl-1', 'bl-2'],
      dependencies: { 'bl-2': ['bl-1'] },
    })
  })

  it('explains an empty plan and renders plan errors', async () => {
    const empty = mountModal()
    await empty.setProps({ planned: [] })
    expect(empty.find('[data-new-run-plan-empty]').exists()).toBe(true)

    const failed = mountModal({ planError: 'plan-invalid' })
    expect(failed.find('[data-new-run-plan-error]').text()).toBe(
      'factory.newRun.planErrors.plan-invalid',
    )
  })
})
