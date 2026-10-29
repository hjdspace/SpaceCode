/**
 * GitHub Issues 面板：标签过滤、已领取禁用、批量领取与错误原因展示。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryGithubIssue } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryGithubPanel from '../FactoryGithubPanel.vue'

const issues: FactoryGithubIssue[] = [
  {
    number: 12,
    title: '刷新登录态',
    body: '正文',
    labels: ['ready-for-agent'],
    state: 'open',
    claimed: false,
  },
  {
    number: 34,
    title: '修复分页',
    body: '',
    labels: [],
    state: 'open',
    claimed: true,
  },
]

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(FactoryGithubPanel, {
    props: {
      label: 'ready-for-agent',
      issues,
      loading: false,
      error: null,
      claiming: false,
      claimError: null,
      runId: null,
      ...props,
    },
  })
}

describe('FactoryGithubPanel', () => {
  it('renders issues, loading and empty states', () => {
    expect(mountPanel().findAll('[data-github-item]')).toHaveLength(2)
    expect(mountPanel({ issues: [] }).find('[data-github-empty]').exists()).toBe(true)
    expect(mountPanel({ issues: [], loading: true }).find('[data-github-loading]').exists()).toBe(true)
  })

  it('disables already claimed issues and claims only the checked ones', async () => {
    const wrapper = mountPanel()
    const claimed = wrapper.find('[data-github-check="34"]')
    expect((claimed.element as HTMLInputElement).disabled).toBe(true)
    expect(wrapper.find('[data-github-claim]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-github-check="12"]').setValue(true)
    await wrapper.find('[data-github-claim]').trigger('click')
    expect(wrapper.emitted('claim')?.[0]).toEqual([[12]])
  })

  it('refreshes with the edited label', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-github-label]').setValue('needs-triage')
    expect(wrapper.emitted('update:label')?.[0]).toEqual(['needs-triage'])
    await wrapper.find('[data-github-refresh]').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('translates failure reasons and lists the affected issues', () => {
    const wrapper = mountPanel({
      error: { reason: 'rate-limit' },
      claimError: {
        reason: 'partial-failed',
        failed: [
          { number: 12, reason: 'already-claimed' },
          { number: 34, reason: 'unknown' },
        ],
      },
    })
    expect(wrapper.find('[data-github-error]').text()).toBe('factory.github.errors.rate-limit')
    expect(wrapper.find('[data-github-claim-error]').text()).toBe(
      'factory.github.errors.partial-failed|{"numbers":"#12, #34"}',
    )
  })

  it('clears the selection once a run is created', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-github-check="12"]').setValue(true)
    await wrapper.setProps({ runId: 'run-1' })
    expect(wrapper.find('[data-github-claim]').attributes('disabled')).toBeDefined()
  })
})
