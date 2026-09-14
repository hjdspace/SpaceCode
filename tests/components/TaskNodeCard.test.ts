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

// Mock Vue Flow Handle — requires VueFlow provider context, not available in unit tests
vi.mock('@vue-flow/core', () => ({
  Handle: {
    name: 'Handle',
    props: ['type', 'position'],
    template: '<div class="vue-flow__handle-stub"></div>',
  },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
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

  // ── 单节点停止 ──

  it('shows stop button when status is running', () => {
    const wrapper = mountCard({ status: 'running', isRunning: true })
    expect(wrapper.find('.task-node-stop').exists()).toBe(true)
  })

  it('does not show stop button when status is not running', () => {
    const wrapper = mountCard({ status: 'pending', isRunning: true })
    expect(wrapper.find('.task-node-stop').exists()).toBe(false)
  })

  it('emits stopNode event when stop button is clicked', async () => {
    const wrapper = mountCard({ status: 'running', isRunning: true })
    await wrapper.find('.task-node-stop').trigger('click')
    expect(wrapper.emitted('stopNode')).toBeTruthy()
    expect(wrapper.emitted('stopNode')![0]).toEqual(['test-node'])
  })

  // ── 失败节点重试 ──

  it('shows retry button when status is failed', () => {
    const wrapper = mountCard({ status: 'failed', isRunning: false })
    expect(wrapper.find('.task-node-retry').exists()).toBe(true)
  })

  it('does not show retry button when status is not failed', () => {
    const wrapper = mountCard({ status: 'running', isRunning: true })
    expect(wrapper.find('.task-node-retry').exists()).toBe(false)
  })

  it('emits retryNode event when retry button is clicked', async () => {
    const wrapper = mountCard({ status: 'failed', isRunning: false })
    await wrapper.find('.task-node-retry').trigger('click')
    expect(wrapper.emitted('retryNode')).toBeTruthy()
    expect(wrapper.emitted('retryNode')![0]).toEqual(['test-node'])
  })

  // ── 运行中节点追加消息 ──

  it('shows add message input when status is running', () => {
    const wrapper = mountCard({ status: 'running', isRunning: true })
    expect(wrapper.find('.task-node-add-msg').exists()).toBe(true)
  })

  it('does not show add message input when status is not running', () => {
    const wrapper = mountCard({ status: 'pending', isRunning: true })
    expect(wrapper.find('.task-node-add-msg').exists()).toBe(false)
  })

  it('emits addMessage event when add message form is submitted', async () => {
    const wrapper = mountCard({ status: 'running', isRunning: true })
    const input = wrapper.find('.task-node-add-msg input')
    await input.setValue('extra context')
    await wrapper.find('.task-node-add-msg').trigger('submit')
    expect(wrapper.emitted('addMessage')).toBeTruthy()
    expect(wrapper.emitted('addMessage')![0]).toEqual(['test-node', 'extra context'])
  })

  // ── 权限徽标 ──

  it('shows permission badge when hasPendingPermission is true', () => {
    const wrapper = mountCard({ status: 'running', isRunning: true, hasPendingPermission: true })
    expect(wrapper.find('.task-node-perm-badge').exists()).toBe(true)
  })

  it('does not show permission badge when hasPendingPermission is false', () => {
    const wrapper = mountCard({ status: 'running', isRunning: true, hasPendingPermission: false })
    expect(wrapper.find('.task-node-perm-badge').exists()).toBe(false)
  })
})
