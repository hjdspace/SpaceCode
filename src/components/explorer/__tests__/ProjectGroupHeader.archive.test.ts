import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectGroupHeader from '../ProjectGroupHeader.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

function mountHeader(workingDirectory: string) {
  return mount(ProjectGroupHeader, {
    props: {
      workingDirectory,
      displayName: 'SpaceCode',
      isCollapsed: false,
      isFolderHovered: true,
      isCurrent: false,
      showRemoveButton: true,
    },
  })
}

describe('ProjectGroupHeader archive menu item', () => {
  it('offers archive for a real project and emits archive-project on click', async () => {
    const wrapper = mountHeader('D:\\AI\\SpaceCode')
    await wrapper.find('.action-btn[aria-label="explorer.projectMenuAria"]').trigger('click')
    const item = wrapper.find('[data-testid="project-archive-menu-item"]')
    expect(item.exists()).toBe(true)
    expect(item.text()).toContain('sidebar.archiveWorkspace')
    expect(item.classes()).toContain('destructive')
    await item.trigger('click')
    expect(wrapper.emitted('archive-project')).toEqual([['D:\\AI\\SpaceCode']])
  })

  it('hides archive for the no-project group', async () => {
    const wrapper = mountHeader('')
    await wrapper.find('.action-btn[aria-label="explorer.projectMenuAria"]').trigger('click')
    expect(wrapper.find('[data-testid="project-archive-menu-item"]').exists()).toBe(false)
  })
})