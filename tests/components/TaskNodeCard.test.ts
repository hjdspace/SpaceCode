// tests/components/TaskNodeCard.test.ts
// TaskNodeCard 组件测试 — 缩小版聊天节点卡片。
// Seam: TaskNodeCard 公共接口 (props + events)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import TaskNodeCard from '@/components/orchestration/TaskNodeCard.vue'

// Mock ChatPanel to avoid rendering the full chat interface
vi.mock('@/components/layout/ChatPanel.vue', () => ({
  default: {
    name: 'ChatPanel',
    props: ['sessionId', 'paneId', 'paneTabId'],
    template: '<div data-testid="chat-panel-mock" :data-session-id="sessionId"></div>',
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  globalInjection: true,
})

function mountCard(props: Record<string, unknown>) {
  return mount(TaskNodeCard, {
    props: {
      id: 'test-node',
      data: { sessionId: 'test-session-1', draft: '', label: 'Task' },
      ...props,
    } as any,
    global: {
      plugins: [i18n],
      stubs: {
        ChatPanel: true,
      },
    },
  })
}

describe('TaskNodeCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the node card with a delete button', () => {
    const wrapper = mountCard({})
    expect(wrapper.find('.task-node-card').exists()).toBe(true)
    expect(wrapper.find('.task-node-delete').exists()).toBe(true)
  })

  it('emits remove event when delete button is clicked', async () => {
    const wrapper = mountCard({})
    const deleteBtn = wrapper.find('.task-node-delete')
    await deleteBtn.trigger('click')
    expect(wrapper.emitted('remove')).toBeTruthy()
    expect(wrapper.emitted('remove')![0]).toEqual(['test-node'])
  })

  it('emits openDrawer event on double-click', async () => {
    const wrapper = mountCard({})
    await wrapper.find('.task-node-card').trigger('dblclick')
    expect(wrapper.emitted('openDrawer')).toBeTruthy()
    expect(wrapper.emitted('openDrawer')![0]).toEqual(['test-node'])
  })

  it('renders a draft input textarea', () => {
    const wrapper = mountCard({})
    expect(wrapper.find('.task-node-draft-input').exists()).toBe(true)
  })

  it('displays the draft text in the textarea', () => {
    const wrapper = mountCard({
      data: { sessionId: 'test-session-1', draft: 'My draft text', label: 'Task' },
    })
    const textarea = wrapper.find('.task-node-draft-input')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('My draft text')
  })

  it('emits updateDraft event when draft textarea input changes', async () => {
    const wrapper = mountCard({})
    const textarea = wrapper.find('.task-node-draft-input')
    await textarea.setValue('New draft content')
    expect(wrapper.emitted('updateDraft')).toBeTruthy()
    expect(wrapper.emitted('updateDraft')![0]).toEqual(['test-node', 'New draft content'])
  })

  it('does not render ChatPanel in the card (only in drawer)', () => {
    const wrapper = mountCard({})
    // ChatPanel should not be rendered inside the card — only a draft input + header
    expect(wrapper.find('[data-testid="chat-panel-mock"]').exists()).toBe(false)
  })
})
