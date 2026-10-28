import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { Message } from '@/types'

/**
 * 工具卡片是动态 import 的懒加载组件。dev server 重启/HMR 断连时 import 会失败：
 * 这里钉住「失败不抛未捕获 rejection，且清掉 loading 标记后能重试」。
 */
vi.mock('../tools/index', () => ({
  hasToolComponent: (name: string) => name === 'Bash' || name === 'Read',
  resolveToolComponent: vi.fn(),
}))

import AgentTimeline from '../AgentTimeline.vue'
import { resolveToolComponent } from '../tools/index'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': {}, 'en-US': {} },
})

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'ThinkingState', 'ErrorCard']

function makeMessages(names: string[]): Message[] {
  return [{
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: names.map((name, index) => ({
      id: `tool-${index}`,
      name,
      input: {},
      status: 'running' as const,
    })),
  }]
}

async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 20))
  await nextTick()
}

describe('AgentTimeline 工具卡片加载失败可重试', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    config.global.plugins = [i18n, pinia]
    vi.mocked(resolveToolComponent).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('import 失败只告警，不永久锁死；后续工具事件会重新加载', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(resolveToolComponent)
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ render: () => null })

    const wrapper = mount(AgentTimeline, {
      props: { messages: makeMessages(['Bash']), loading: true },
      global: { stubs: STUBS },
    })
    await settle()

    expect(resolveToolComponent).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()

    // 新工具名让 specialToolNames 变化 → 触发第二轮加载；
    // Bash 若仍被 loading 标记卡住就不会重试（旧缺陷）。
    await wrapper.setProps({ messages: makeMessages(['Bash', 'Read']) })
    await settle()

    const attempted = vi.mocked(resolveToolComponent).mock.calls.map(call => call[0])
    expect(attempted.filter(name => name === 'Bash')).toHaveLength(2)
    expect(attempted).toContain('Read')
  })
})
