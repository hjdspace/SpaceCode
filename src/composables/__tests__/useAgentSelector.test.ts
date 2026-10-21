import { createApp, defineComponent, nextTick, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const activeSessionId = ref<string | undefined>()
let store: any

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

// 只替换边界：选择器要验证的是「读哪个会话的 agent」，不是 store 的持久化实现。
vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => {
    if (!store) {
      const sessions = reactive([
        { id: 'session-a', agent: 'reviewer' },
        { id: 'session-b', agent: undefined as string | undefined },
      ])
      store = reactive({
        currentAgent: 'reviewer',
        sessions,
        getSession: (id: string | null | undefined) =>
          (id ? sessions.find(s => s.id === id) || null : null),
      })
    }
    return store
  },
}))

import { useAgentSelector } from '../useAgentSelector'

describe('useAgentSelector', () => {
  it('follows the bound session instead of the global default', async () => {
    activeSessionId.value = 'session-a'

    // composable 里有 onUnmounted，放到真实组件上下文里跑，避免生命周期警告
    let selector!: ReturnType<typeof useAgentSelector>
    const app = createApp(defineComponent({
      setup() {
        selector = useAgentSelector({ sessionId: () => activeSessionId.value })
        return () => null
      },
    }))
    app.mount(document.createElement('div'))
    const { selectedAgent } = selector
    expect(selectedAgent.value).toBe('reviewer')

    // 切到没选过 agent 的会话：选择器不能继续亮着上一个会话的名字
    activeSessionId.value = 'session-b'
    await nextTick()
    expect(selectedAgent.value).toBe('')

    // 回到 A，或 A 自己改了选择，都跟着会话走
    activeSessionId.value = 'session-a'
    await nextTick()
    expect(selectedAgent.value).toBe('reviewer')
    store.sessions[0].agent = 'planner'
    await nextTick()
    expect(selectedAgent.value).toBe('planner')

    // 没有会话时（新对话输入框）才读全局默认
    activeSessionId.value = undefined
    await nextTick()
    expect(selectedAgent.value).toBe('reviewer')
    store.currentAgent = 'architect'
    await nextTick()
    expect(selectedAgent.value).toBe('architect')

    app.unmount()
  })
})
