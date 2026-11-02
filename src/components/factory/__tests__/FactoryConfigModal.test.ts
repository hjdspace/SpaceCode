/**
 * 阶段配置弹窗：固定五阶段表、按阶段收敛的权限选项、合并闸门二次确认与错误展示。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import {
  FACTORY_BACKLOG_PATH,
  FACTORY_SANDBOX_WORKTREE_ROOT,
  type FactoryConfig,
} from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryConfigModal from '../FactoryConfigModal.vue'

function configFixture(overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  return {
    version: 1,
    revision: 1,
    repo: { root: '.', baseBranch: 'main' },
    template: 'parallel-planner-with-review',
    agent: { engineType: 'claude-code', model: 'sonnet', maxIterations: 5, maxConcurrency: 4 },
    sandbox: { type: 'worktree', root: FACTORY_SANDBOX_WORKTREE_ROOT },
    tracker: { type: 'local', backlogPath: FACTORY_BACKLOG_PATH, mergeMode: 'local' },
    stages: {
      plan: { enabled: true, permissionMode: 'plan', humanGate: false },
      implement: { enabled: true, permissionMode: 'acceptEdits', humanGate: false },
      verify: { enabled: true, permissionMode: 'default', humanGate: false },
      review: { enabled: true, permissionMode: 'acceptEdits', humanGate: true },
      merge: { enabled: true, permissionMode: 'default', humanGate: true },
    },
    commands: { verify: 'npm run test' },
    prompts: {
      plan: '.spacecode/factory/prompts/plan.md',
      implement: '.spacecode/factory/prompts/implement.md',
      review: '.spacecode/factory/prompts/review.md',
      fix: '.spacecode/factory/prompts/fix.md',
      'merge-conflict': '.spacecode/factory/prompts/merge-conflict.md',
    },
    limits: { taskTimeoutSec: 3600, idleTimeoutSec: 600, keepDoneRuns: 20 },
    ...overrides,
  }
}

function mountModal(props: Record<string, unknown> = {}) {
  return mount(FactoryConfigModal, {
    props: {
      config: configFixture(),
      totalTokens: 0,
      costUsd: 0,
      hasCost: false,
      saving: false,
      error: null,
      fieldErrors: [],
      conflictRevision: null,
      confirmGateOff: false,
      ...props,
    },
  })
}

/** 输入框监听的是 change 事件，setValue 只触发 input，需手动派发。 */
async function changeInput(wrapper: VueWrapper, selector: string, value: string): Promise<void> {
  const input = wrapper.find(selector)
  ;(input.element as HTMLInputElement).value = value
  await input.trigger('change')
}

describe('FactoryConfigModal', () => {
  it('renders the five fixed stages and keeps verify agent-free', () => {
    const wrapper = mountModal()
    expect(wrapper.findAll('[data-config-row]').map((row) => row.attributes('data-config-row'))).toEqual([
      'plan',
      'implement',
      'verify',
      'review',
      'merge',
    ])
    expect(wrapper.find('[data-config-fixed-hint]').exists()).toBe(true)
    expect(wrapper.find('[data-config-no-agent]').text()).toBe('factory.config.noAgent')
    expect(wrapper.find('[data-config-model="verify"]').exists()).toBe(false)
    expect(wrapper.find('[data-config-permission="verify"]').exists()).toBe(false)
    // 只有审查与合并阶段暴露人工闸门。
    expect(wrapper.find('[data-config-gate="implement"]').exists()).toBe(false)
    expect(wrapper.find('[data-config-gate="review"]').exists()).toBe(true)
    expect(wrapper.find('[data-config-gate="merge"]').exists()).toBe(true)
  })

  it('only offers the permission modes allowed for each stage', () => {
    const wrapper = mountModal()
    const options = (key: string) =>
      wrapper.find(`[data-config-permission="${key}"]`).findAll('option').map((option) => option.attributes('value'))
    expect(options('plan')).toEqual(['plan'])
    expect(options('implement')).toEqual(['default', 'acceptEdits', 'bypassPermissions'])
    expect(options('review')).toEqual(['default', 'acceptEdits'])
    expect(options('merge')).toEqual(['default', 'acceptEdits'])
  })

  it('emits stage, concurrency and verify updates', async () => {
    const wrapper = mountModal()

    await wrapper.find('[data-config-permission="implement"]').setValue('default')
    expect(wrapper.emitted('update:stage')?.[0]).toEqual(['implement', { permissionMode: 'default' }])

    await changeInput(wrapper, '[data-config-model="review"]', 'opus')
    expect(wrapper.emitted('update:stage')?.[1]).toEqual(['review', { model: 'opus' }])

    await wrapper.find('[data-config-enabled="verify"]').setValue(false)
    expect(wrapper.emitted('update:stage')?.[2]).toEqual(['verify', { enabled: false }])

    await changeInput(wrapper, '[data-config-iterations]', '3')
    expect(wrapper.emitted('update:stage')?.[3]).toEqual(['implement', { maxIterations: 3 }])

    await changeInput(wrapper, '[data-config-concurrency]', '2')
    expect(wrapper.emitted('update:concurrency')).toEqual([[2]])

    await changeInput(wrapper, '[data-config-verify]', 'npm run build')
    expect(wrapper.emitted('update:verify')).toEqual([['npm run build']])
  })

  it('warns before turning the merge gate off and requires explicit confirmation', async () => {
    const wrapper = mountModal()
    expect(wrapper.find('[data-config-gate-warning]').exists()).toBe(false)

    await wrapper.find('[data-config-gate="merge"]').setValue(false)
    expect(wrapper.emitted('update:stage')?.[0]).toEqual(['merge', { humanGate: false }])
    expect(wrapper.find('[data-config-gate-warning]').exists()).toBe(false)

    // 父组件更新配置后弹窗才显示风险与确认。
    const closed = mountModal({
      config: configFixture({
        stages: { ...configFixture().stages, merge: { ...configFixture().stages.merge, humanGate: false } },
      }),
    })
    expect(closed.find('[data-config-gate-warning]').exists()).toBe(true)

    await closed.find('[data-config-gate-confirm]').setValue(true)
    expect(closed.emitted('update:gateConfirm')).toEqual([[true]])
  })

  it('shows conflict revisions and field errors in the error block', () => {
    const wrapper = mountModal({
      error: 'revision-conflict',
      conflictRevision: 3,
      fieldErrors: ['stages.implement.permissionMode'],
    })
    expect(wrapper.find('[data-config-error] p').text()).toContain(
      'factory.config.errors.revision-conflict|{"current":3}',
    )
    const fields = wrapper.find('[data-config-field-errors]').findAll('li')
    expect(fields.map((field) => field.text())).toEqual([
      'factory.config.fields.stages.implement.permissionMode',
    ])
  })

  it('shows tokens without a price and spend when a cost is known', () => {
    const tokens = mountModal({ totalTokens: 60, hasCost: false })
    expect(tokens.find('[data-config-spend]').text()).toBe('factory.run.tokenCount|{"count":60}')

    const spend = mountModal({ totalTokens: 60, costUsd: 0.12, hasCost: true })
    expect(spend.find('[data-config-spend]').text()).toBe('$0.12')
  })

  it('emits save and disables both actions while saving', async () => {
    const wrapper = mountModal()
    await wrapper.find('[data-config-save]').trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)

    const saving = mountModal({ saving: true })
    expect(saving.find('[data-config-save]').attributes('disabled')).toBeDefined()
    expect(saving.findAll('button').some((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('asks for confirmation before restarting setup from the footer', async () => {
    const wrapper = mountModal()
    const restart = wrapper.find('[data-config-restart]')
    expect(restart.text()).toContain('factory.config.restart')
    expect(wrapper.find('[data-config-restart-confirm]').exists()).toBe(false)

    await restart.trigger('click')
    const confirm = wrapper.find('[data-config-restart-confirm]')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('factory.config.restartHint')
    // 只是弹提示，还没进向导。
    expect(wrapper.emitted('restart')).toBeUndefined()

    await wrapper.find('[data-config-restart-cancel]').trigger('click')
    expect(wrapper.find('[data-config-restart-confirm]').exists()).toBe(false)
    expect(wrapper.emitted('restart')).toBeUndefined()

    await wrapper.find('[data-config-restart]').trigger('click')
    await wrapper.find('[data-config-restart-proceed]').trigger('click')
    expect(wrapper.emitted('restart')).toHaveLength(1)
  })

  it('keeps restart disabled while saving', () => {
    const wrapper = mountModal({ saving: true })
    expect(wrapper.find('[data-config-restart]').attributes('disabled')).toBeDefined()
  })
})
