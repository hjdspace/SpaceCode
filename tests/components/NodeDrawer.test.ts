// tests/components/NodeDrawer.test.ts
// NodeDrawer 组件测试 — 节点抽屉，全尺寸 ChatPanel。
// Seam: NodeDrawer 公共接口 (props + events)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import NodeDrawer from '@/components/orchestration/NodeDrawer.vue'

// Mock ChatPanel
vi.mock('@/components/layout/ChatPanel.vue', () => ({
  default: {
    name: 'ChatPanel',
    props: ['sessionId', 'paneId', 'paneTabId'],
    template: '<div data-testid="chat-panel-mock" :data-session-id="sessionId">ChatPanel Mock</div>',
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  globalInjection: true,
})

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(NodeDrawer, {
    props: {
      sessionId: 'test-session-1',
      ...props,
    } as any,
    global: {
      plugins: [i18n],
    },
  })
}

describe('NodeDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not render when sessionId is empty', () => {
    const wrapper = mountDrawer({ sessionId: '' })
    expect(wrapper.find('.node-drawer').exists()).toBe(false)
  })

  it('renders the drawer overlay when sessionId is provided', () => {
    const wrapper = mountDrawer({ sessionId: 'test-session-1' })
    expect(wrapper.find('.node-drawer').exists()).toBe(true)
  })

  it('renders a close button', () => {
    const wrapper = mountDrawer({ sessionId: 'test-session-1' })
    expect(wrapper.find('.node-drawer-close').exists()).toBe(true)
  })

  it('emits close event when close button is clicked', async () => {
    const wrapper = mountDrawer({ sessionId: 'test-session-1' })
    await wrapper.find('.node-drawer-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close event when overlay backdrop is clicked', async () => {
    const wrapper = mountDrawer({ sessionId: 'test-session-1' })
    await wrapper.find('.node-drawer-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not emit close when drawer body is clicked', async () => {
    const wrapper = mountDrawer({ sessionId: 'test-session-1' })
    await wrapper.find('.node-drawer').trigger('click')
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('renders ChatPanel with the correct sessionId prop', () => {
    const wrapper = mountDrawer({ sessionId: 'test-session-42' })
    const chatPanel = wrapper.find('[data-testid="chat-panel-mock"]')
    expect(chatPanel.exists()).toBe(true)
    expect(chatPanel.attributes('data-session-id')).toBe('test-session-42')
  })
})
