// Sidebar 分屏接线测试：会话右键菜单的「分屏」必须真正改变中央区分屏布局。
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../Sidebar.vue'
import SessionList from '@/components/explorer/SessionList.vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSplitLayoutStore, collectLeaves } from '@/stores/splitLayout'

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

describe('Sidebar split-screen menu wiring', () => {
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

  it('moves the requested session into a new pane without touching the current one', async () => {
    const sessionStore = useChatSessionStore()
    const appStore = useAppStore()
    const splitLayout = useSplitLayoutStore()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const current = sessionStore.createSession('A')
    const target = sessionStore.createSession('B', undefined, undefined, { activate: false })
    appStore.activeCenterTab = `session-${current.id}`
    expect(splitLayout.leafCount).toBe(1)

    const wrapper = shallowMount(Sidebar, {
      props: { collapsed: false },
      global: { plugins: [pinia] },
    })
    wrapper.findComponent(SessionList).vm.$emit('split-screen', target.id)
    await flushPromises()

    // 1. 布局真的变了：所选会话进入新 pane，原会话留在基准 pane
    expect(splitLayout.leafCount).toBe(2)
    const contents = collectLeaves(splitLayout.root).map(l => l.content)
    expect(contents).toContainEqual({ kind: 'session', tabId: `session-${target.id}` })
    expect(contents).toContainEqual({ kind: 'session', tabId: `session-${current.id}` })
    expect(splitLayout.activePane?.content).toEqual({ kind: 'session', tabId: `session-${target.id}` })

    // 2. 分屏后走完整选中链路，与点击会话列表的副作用一致
    expect(sessionStore.currentSessionId).toBe(target.id)

    // 3. 不再派发那个只有发送方、没有监听器的自定义事件
    const splitEvents = dispatchSpy.mock.calls.filter(call => (call[0] as Event).type === 'split-screen-requested')
    expect(splitEvents).toHaveLength(0)

    wrapper.unmount()
  })
})
