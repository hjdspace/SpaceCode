import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
const rootPinia = createPinia()
config.global.plugins = [i18n, rootPinia]

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'LoadingState', 'ErrorCard']

function mountTimeline(messages: Message[], loading = false) {
  return mount(AgentTimeline, {
    props: { messages, loading },
    global: { stubs: STUBS },
  })
}

function toolCall(id: string) {
  return { id, name: 'UnknownTool', input: { file_path: `src/${id}.ts` }, status: 'completed' as const, startTime: 1, endTime: 2 }
}

describe('AgentTimeline 推理并入工具折叠组', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const loopMessage: Message = {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [toolCall('tool-1'), toolCall('tool-2')],
    timelineEvents: [
      { id: 'r1', type: 'reasoning', timestamp: 1, status: 'completed', content: '先看看文件' },
      { id: 'tool-tool-1', type: 'tool_call', timestamp: 2, status: 'completed', toolCallId: 'tool-1' },
      { id: 'r2', type: 'reasoning', timestamp: 3, status: 'completed', content: '再改一处' },
      { id: 'tool-tool-2', type: 'tool_call', timestamp: 4, status: 'completed', toolCallId: 'tool-2' },
    ],
  }

  it('推理与工具合成一个组，不再逐段占据时间线', () => {
    const wrapper = mountTimeline([loopMessage])

    expect(wrapper.findAll('.tool-group')).toHaveLength(1)
    // 顶层不再有独立的推理行
    expect(wrapper.findAll('.timeline-events > .timeline-event')).toHaveLength(0)
  })

  it('折叠摘要同时报告推理段数与工具数', () => {
    const wrapper = mountTimeline([loopMessage])

    expect(wrapper.find('.tool-group__count').text()).toBe('推理 2 段 · 2 个工具调用')
  })

  it('重复调用的同一工具聚合成一个计数 chip', () => {
    const wrapper = mountTimeline([loopMessage])

    const chips = wrapper.findAll('.tool-group__chip').map(chip => chip.text())
    expect(chips).toEqual(['UnknownTool ×2'])
  })

  it('回合结束后自动折叠；回合进行中保持展开', async () => {
    const wrapper = mountTimeline([loopMessage], true)
    expect(wrapper.find('.tool-group__summary').exists()).toBe(false)

    await wrapper.setProps({ loading: false })
    expect(wrapper.find('.tool-group__summary').exists()).toBe(true)
    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(2)
  })

  it('只有推理、没有工具时不组队（ReasoningCard 本身就是一行）', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '答案',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 'r1', type: 'reasoning', timestamp: 1, status: 'completed', content: '想好了' },
      ],
    }

    const wrapper = mountTimeline([msg])
    expect(wrapper.findAll('.tool-group')).toHaveLength(0)
    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(1)
  })

  it('文本答复打断分组：前后循环各自成组', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [toolCall('tool-1'), toolCall('tool-2')],
      timelineEvents: [
        { id: 'r1', type: 'reasoning', timestamp: 1, status: 'completed', content: '第一次' },
        { id: 'tool-tool-1', type: 'tool_call', timestamp: 2, status: 'completed', toolCallId: 'tool-1' },
        { id: 't1', type: 'text', timestamp: 3, status: 'completed', content: '中间说明' },
        { id: 'r2', type: 'reasoning', timestamp: 4, status: 'completed', content: '第二次' },
        { id: 'tool-tool-2', type: 'tool_call', timestamp: 5, status: 'completed', toolCallId: 'tool-2' },
      ],
    }

    const wrapper = mountTimeline([msg])
    expect(wrapper.findAll('.tool-group')).toHaveLength(2)
  })
})
