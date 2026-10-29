/**
 * 本地待办面板：增删改查、调序、勾选创建运行与错误码展示。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryBacklogItem } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryBacklogPanel from '../FactoryBacklogPanel.vue'

const items: FactoryBacklogItem[] = [
  { id: 'bl-1', title: '第一件事', goal: '目标一', createdAt: '2026-10-28T10:00:00Z', order: 0 },
  { id: 'bl-2', title: '第二件事', goal: '', createdAt: '2026-10-28T10:01:00Z', order: 1 },
]

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(FactoryBacklogPanel, {
    props: {
      items,
      loading: false,
      error: null,
      runError: null,
      claimedIds: [],
      creating: false,
      runId: null,
      ...props,
    },
  })
}

describe('FactoryBacklogPanel', () => {
  it('renders items, loading and empty states', () => {
    expect(mountPanel().findAll('[data-backlog-item]')).toHaveLength(2)
    expect(mountPanel({ items: [] }).find('[data-backlog-empty]').exists()).toBe(true)
    expect(mountPanel({ items: [], loading: true }).find('[data-backlog-loading]').exists()).toBe(true)
  })

  it('creates a task with a title and goal, rejecting a blank title', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-backlog-title]').setValue('   ')
    await wrapper.find('[data-backlog-add]').trigger('click')
    expect(wrapper.emitted('create')).toBeUndefined()

    await wrapper.find('[data-backlog-title]').setValue('新任务')
    await wrapper.find('[data-backlog-goal]').setValue('新目标')
    await wrapper.find('[data-backlog-add]').trigger('click')
    expect(wrapper.emitted('create')?.[0]).toEqual([{ title: '新任务', goal: '新目标' }])
    expect((wrapper.find('[data-backlog-title]').element as HTMLInputElement).value).toBe('')
  })

  it('edits the title and goal of an existing task', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-backlog-edit="bl-1"]').trigger('click')
    await wrapper.find('[data-backlog-edit-title]').setValue('改过的标题')
    await wrapper.find('[data-backlog-edit-goal]').setValue('改过的目标')
    await wrapper.find('[data-backlog-save="bl-1"]').trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ id: 'bl-1', title: '改过的标题', goal: '改过的目标' }])
  })

  it('moves and deletes tasks', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-backlog-down="bl-1"]').trigger('click')
    expect(wrapper.emitted('move')?.[0]).toEqual(['bl-1', 'down'])
    await wrapper.find('[data-backlog-delete="bl-2"]').trigger('click')
    expect(wrapper.emitted('remove')?.[0]).toEqual(['bl-2'])
  })

  it('creates a run from the checked tasks and disables already claimed ones', async () => {
    const wrapper = mountPanel({ claimedIds: ['bl-2'] })
    const claimed = wrapper.find('[data-backlog-check="bl-2"]')
    expect((claimed.element as HTMLInputElement).disabled).toBe(true)
    expect(wrapper.find('[data-backlog-create-run]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-backlog-check="bl-1"]').setValue(true)
    await wrapper.find('[data-backlog-create-run]').trigger('click')
    expect(wrapper.emitted('create-run')?.[0]).toEqual([['bl-1']])
  })

  it('clears the selection once a run is created', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-backlog-check="bl-1"]').setValue(true)
    await wrapper.setProps({ runId: 'run-1' })
    expect(wrapper.find('[data-backlog-create-run]').attributes('disabled')).toBeDefined()
  })

  it('translates backlog and run error codes', () => {
    const wrapper = mountPanel({ error: 'title-required', runError: { code: 'duplicate-tasks', params: { ids: 'bl-1' } } })
    expect(wrapper.find('[data-backlog-error]').text()).toBe('factory.backlog.errors.title-required')
    expect(wrapper.find('[data-run-error]').text()).toBe(
      'factory.run.errors.duplicate-tasks|{"ids":"bl-1"}',
    )
  })
})
