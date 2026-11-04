/**
 * Sidebar Super Agent 入口契约（T01 #71）：
 *  - New Chat 下方的入口点击后打开中置单例 tab；
 *  - Attention 徽章位在有待处理项时显示计数，无待处理时不渲染。
 */
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../Sidebar.vue'
import { useAppStore } from '@/stores/app'
import { useSuperAgentStore } from '@/stores/superAgent'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en-US' },
      t: (key: string) => key,
    },
  }),
  useI18n: () => ({
    t: (key: string) => key,
    locale: { value: 'en-US' },
    tm: () => undefined,
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: null,
    image: null,
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue('D:/repo'),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(''),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
    terminal: { onExit: vi.fn() },
  },
}))

function mountSidebar(pinia: Pinia) {
  return shallowMount(Sidebar, {
    props: { collapsed: false },
    global: { plugins: [pinia] },
  })
}

describe('Sidebar Super Agent entry', () => {
  let pinia: Pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2)}`) })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
  })

  it('opens the singleton center tab when clicked', async () => {
    const appStore = useAppStore()
    const wrapper = mountSidebar(pinia)

    await wrapper.find('[data-testid="super-agent-entry"]').trigger('click')

    expect(appStore.activeCenterTab).toBe('super-agent')
    expect(appStore.centerTabs.filter(tab => tab.id === 'super-agent')).toHaveLength(1)
    wrapper.unmount()
  })

  it('renders the attention count only when there are pending items', () => {
    const superAgentStore = useSuperAgentStore()
    const wrapper = mountSidebar(pinia)
    expect(wrapper.find('[data-testid="super-agent-attention-badge"]').exists()).toBe(false)

    // T10 #80：入口徽章 = Attention + review 超时提醒（都按工单去重后合并；
    // review 工单不可能同时挂 open Attention，两组集合天然不相交）
    superAgentStore.snapshot = {
      repoRoot: 'D:/repo',
      seq: 1,
      asOf: Date.now(),
      staleAfterMs: 5000,
      router: null,
      attention: { unanswered: 3 },
      review: { reminded: 2 },
    }

    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.find('[data-testid="super-agent-attention-badge"]').text()).toBe('5')
      wrapper.unmount()
    })
  })
})
