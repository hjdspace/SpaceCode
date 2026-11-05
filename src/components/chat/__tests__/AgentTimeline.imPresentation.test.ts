import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
import { ErrorCategory, type ClassifiedError, type Message } from '@/types'
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
const ROUTE_FENCE = '```super-agent:route'

function mountTimeline(messages: Message[], presentation?: 'im') {
  return mount(AgentTimeline, {
    props: { messages, loading: false, ...(presentation ? { presentation } : {}) },
    global: { stubs: STUBS },
  })
}

function textContents(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: 'MarkdownRenderer' }).map(c => c.props('content'))
}

/** 一轮典型的 Router 产出：推理 + 工具 + 正文（正文里挂着建单协议块）。 */
function routerTurn(): Message {
  return {
    id: 'r1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    reasoning: { content: '用户想派一个做考勤表的活', startTime: 1000, endTime: 2000 },
    toolCalls: [{
      id: 'tool-1',
      name: 'Bash',
      input: { command: 'gh issue list' },
      status: 'completed',
      startTime: 1,
    }],
    timelineEvents: [
      { id: 'e-reasoning', type: 'reasoning', timestamp: 1, status: 'completed', content: '用户想派一个做考勤表的活' },
      { id: 'e-tool', type: 'tool_call', timestamp: 2, status: 'completed', toolCallId: 'tool-1' },
      { id: 'e-text-a', type: 'text', timestamp: 3, status: 'completed', content: '收到，这就安排。' },
      { id: 'e-text-b', type: 'text', timestamp: 4, status: 'completed', content: `\n\n${ROUTE_FENCE}\n{ "version": 1, "tickets": [{ "title": "做考勤表", "text": "做一个考勤表" }] }\n\`\`\`` },
    ],
  }
}

describe('AgentTimeline IM 展示模式', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('推理与工具事件不进气泡流，只留正文', () => {
    const wrapper = mountTimeline([routerTurn()], 'im')

    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(0)
    expect(wrapper.findAll('.tool-row')).toHaveLength(0)
    expect(wrapper.findAll('.tool-group')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('gh issue list')
  })

  it('同一模式仍不破坏跨帧 text 的合并：正文只出一块', () => {
    const wrapper = mountTimeline([routerTurn()], 'im')

    expect(textContents(wrapper)).toHaveLength(1)
  })

  it('剥掉建单协议块，只留给人看的那句话', () => {
    const wrapper = mountTimeline([routerTurn()], 'im')

    expect(textContents(wrapper)).toEqual(['收到，这就安排。'])
    expect(wrapper.text()).not.toContain('super-agent:route')
  })

  it('默认模式保持原样：推理、工具、协议原文都可见', () => {
    const wrapper = mountTimeline([routerTurn()])

    expect(wrapper.findAllComponents({ name: 'ReasoningCard' }).length).toBeGreaterThan(0)
    const body = textContents(wrapper).join('')
    expect(body).toContain('收到，这就安排。')
    expect(body).toContain('super-agent:route')
  })

  it('IM 模式不显示汇总条、状态徽章与计时器', () => {
    const wrapper = mountTimeline([routerTurn()], 'im')

    expect(wrapper.findAllComponents({ name: 'TurnSummaryBar' })).toHaveLength(0)
    expect(wrapper.find('.timeline-status-badge').exists()).toBe(false)
    expect(wrapper.find('.timeline-timer').exists()).toBe(false)
  })

  it('默认模式仍然有汇总条与计时器', () => {
    const wrapper = mountTimeline([routerTurn()])

    expect(wrapper.findAllComponents({ name: 'TurnSummaryBar' })).toHaveLength(1)
    expect(wrapper.find('.timeline-timer').exists()).toBe(true)
  })

  it('流式半截的协议块也不闪现在气泡里', () => {
    const streaming: Message = {
      id: 'r2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'running', content: '我先建单。' },
        { id: 't2', type: 'text', timestamp: 2, status: 'running', content: `\n\n${ROUTE_FENCE}\n{ "version": 1` },
      ],
    }

    expect(textContents(mountTimeline([streaming], 'im'))).toEqual(['我先建单。'])
  })

  it('错误事件在 IM 模式仍然可见：坏消息不能只留空白气泡', () => {
    const classifiedError: ClassifiedError = {
      category: ErrorCategory.NETWORK_ERROR,
      title: '网络异常',
      message: '连不上网关',
      technicalDetail: 'ECONNREFUSED',
      retryable: true,
      originalError: 'ECONNREFUSED',
      timestamp: Date.now(),
    }
    const msg: Message = {
      id: 'r3',
      role: 'assistant',
      content: '正在处理。',
      timestamp: Date.now(),
      metadata: { error: classifiedError },
    }

    const wrapper = mountTimeline([msg], 'im')

    expect(wrapper.findAllComponents({ name: 'ErrorCard' })).toHaveLength(1)
    expect(textContents(wrapper)).toEqual(['正在处理。'])
  })

  it('气泡流不挂角色头，并切到 im 排版；默认模式照旧', () => {
    const im = mountTimeline([routerTurn()], 'im')
    const plain = mountTimeline([routerTurn()])

    expect(im.classes()).toContain('im')
    expect(im.find('.timeline-header').exists()).toBe(false)
    expect(im.find('.timeline-events').exists()).toBe(true)

    expect(plain.classes()).not.toContain('im')
    expect(plain.find('.timeline-header').exists()).toBe(true)
  })
})
